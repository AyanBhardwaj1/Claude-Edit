"""Word-level transcription with automatic engine fallback.

Engines (`--engine auto` tries them in this order and uses the first that works):
  whisperx        Whisper + wav2vec2 forced alignment: tightest word boundaries. Local, GPU or CPU.
  faster-whisper  Whisper's own word timestamps. Local, lighter install.
  scribe          ElevenLabs Scribe (hosted, needs ELEVENLABS_API_KEY): verbatim fillers,
                  speaker labels and audio events like (laughs). Same engine video-use uses.
  vosk            Kaldi, fully offline on CPU, model from library/models (see models.py).
                  No punctuation or casing: run `editor retext` with corrected text afterwards.

Raw engine output is cached per source in work/transcripts/, keyed by file size, mtime and
engine, so a source is never transcribed twice. Writes:
  transcript.json  every word: src, start, end, text, prob (+ speaker, event)
  transcript.txt   phrase lines broken on >= 0.5 s silence or speaker change, for reading
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import subprocess
import tempfile
from pathlib import Path

from .util import EditorError, fmt_ts, load_json, log, probe, save_json

# Whisper drops disfluencies unless the prompt contains them; keeping them lets
# the planner cut "um"/"uh" precisely instead of leaving them buried in a word.
FILLER_PROMPT = "Umm, let me think, uh... Okay, so, like, hmm, here's what I, um, wanted to say."
AUTO_ORDER = ["whisperx", "faster-whisper", "scribe", "vosk"]
PHRASE_GAP = 0.5


def transcribe(paths: list[str], out_dir: str | Path, model: str = "small", language: str | None = None,
               device: str = "auto", engine: str = "auto", glossary: list[str] | None = None,
               num_speakers: int | None = None) -> Path:
    out_dir = Path(out_dir)
    cache_dir = out_dir / "transcripts"
    cache_dir.mkdir(parents=True, exist_ok=True)
    candidates = AUTO_ORDER if engine == "auto" else [engine]
    runner, used = None, None
    errors = []

    sources, words = [], []
    for idx, path in enumerate(paths):
        info = probe(path)
        if not info["has_audio"]:
            raise EditorError(f"{path} has no audio track to transcribe")
        cached = _find_cache(cache_dir, path, candidates)
        if cached:
            data = load_json(cached)
            log(f"[{idx}] cached transcript ({data['engine']}): {cached.name}")
        else:
            if runner is None:
                for cand in candidates:
                    try:
                        runner, used = _make(cand, model, device, language, glossary, num_speakers), cand
                        break
                    except EditorError as e:
                        errors.append(f"{cand}: {e}")
                        log(f"engine {cand} unavailable: {e}")
                if runner is None:
                    raise EditorError("no transcription engine available:\n  " + "\n  ".join(errors) +
                                      "\nInstall one (./setup.sh), set ELEVENLABS_API_KEY, or run "
                                      "`python3 -m editor models vosk`.")
            log(f"transcribing [{idx}] {path} ({info['duration']:.1f}s) with {used}")
            seg_words, lang = runner(str(path))
            data = {"engine": used, "model": model if used in ("whisperx", "faster-whisper") else None,
                    "language": lang, "source": str(Path(path).resolve()), "words": seg_words}
            save_json(_cache_path(cache_dir, path, used), data)
        sources.append({"path": str(Path(path).resolve()), "duration": info["duration"],
                        "language": data.get("language"), "engine": data["engine"]})
        words += [dict(w, src=idx) for w in data["words"] if w["text"]]
    return write_transcript(out_dir, sources, words)


def _cache_key(path) -> str:
    st = os.stat(path)
    return hashlib.sha1(f"{Path(path).resolve()}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:12]


def _cache_path(cache_dir: Path, path, engine: str) -> Path:
    return cache_dir / f"{Path(path).stem}.{_cache_key(path)}.{engine}.json"


def _find_cache(cache_dir: Path, path, candidates: list[str]) -> Path | None:
    for engine in candidates:
        p = _cache_path(cache_dir, path, engine)
        if p.exists():
            return p
    return None


def _make(engine, model, device, language, glossary, num_speakers):
    if engine == "whisperx":
        return _whisperx(model, device, language, glossary)
    if engine == "faster-whisper":
        return _faster_whisper(model, device, language, glossary)
    if engine == "scribe":
        return _scribe(language, num_speakers)
    if engine == "vosk":
        return _vosk()
    raise EditorError(f"unknown engine {engine}")


def _device(device: str) -> tuple[str, str]:
    if device in ("auto", "cuda"):
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                return "cuda", "float16"
        except Exception:
            pass
    return "cpu", "int8"


def _prompt(glossary):
    return FILLER_PROMPT + (" Names: " + ", ".join(glossary) + "." if glossary else "")


def _faster_whisper(model, device, language, glossary):
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise EditorError("faster-whisper is not installed") from e
    dev, ct = _device(device)
    try:
        wm = WhisperModel(model, device=dev, compute_type=ct)
    except Exception as e:  # download / disk / CUDA errors surface as many exception types
        raise EditorError(f"could not load model '{model}' (downloads from huggingface.co on first use): "
                          f"{str(e)[:120]}") from e

    def run_one(path):
        segments, meta = wm.transcribe(path, language=language, word_timestamps=True, initial_prompt=_prompt(glossary),
                                       condition_on_previous_text=False, vad_filter=False, beam_size=5)
        out = [{"start": round(w.start, 3), "end": round(w.end, 3), "text": w.word.strip(),
                "prob": round(w.probability, 3)} for seg in segments for w in (seg.words or [])]
        return out, meta.language
    return run_one


def _whisperx(model, device, language, glossary):
    try:
        import whisperx
    except ImportError as e:
        raise EditorError("whisperx is not installed (WHISPERX=1 ./setup.sh)") from e
    dev, ct = _device(device)
    try:
        asr = whisperx.load_model(model, dev, compute_type=ct, language=language,
                                  asr_options={"initial_prompt": _prompt(glossary)})
    except Exception as e:
        raise EditorError(f"could not load whisperx model '{model}': {str(e)[:120]}") from e
    aligners: dict = {}

    def run_one(path):
        audio = whisperx.load_audio(path)
        result = asr.transcribe(audio, batch_size=16 if dev == "cuda" else 4, language=language)
        lang = result["language"]
        if lang not in aligners:
            aligners[lang] = whisperx.load_align_model(language_code=lang, device=dev)
        align_model, meta = aligners[lang]
        aligned = whisperx.align(result["segments"], align_model, meta, audio, dev, return_char_alignments=False)
        out = []
        for seg in aligned["segments"]:
            raw = [{"start": w.get("start"), "end": w.get("end"), "text": str(w.get("word", "")).strip(),
                    "prob": round(float(w.get("score", 0.5) or 0.5), 3)} for w in seg.get("words", [])]
            out += fill_missing_times(raw, seg.get("start", 0.0), seg.get("end", 0.0))
        return out, lang
    return run_one


def _api_key(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    root = Path(__file__).resolve().parent.parent
    for env in (Path.cwd() / ".env", root / ".env", root / ".claude" / "skills" / "video-use" / ".env"):
        if env.exists():
            for line in env.read_text().splitlines():
                k, _, v = line.partition("=")
                if k.strip() == name and v.strip():
                    return v.strip().strip("'\"")
    return None


def _scribe(language, num_speakers):
    key = _api_key("ELEVENLABS_API_KEY")
    if not key:
        raise EditorError("ELEVENLABS_API_KEY not set (env or .env)")
    try:
        import requests
    except ImportError as e:
        raise EditorError("requests is not installed") from e

    def run_one(path):
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "audio.wav"
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", "16000",
                            "-c:a", "pcm_s16le", str(wav)], check=True)
            data = {"model_id": "scribe_v1", "diarize": "true", "tag_audio_events": "true",
                    "timestamps_granularity": "word"}
            if language:
                data["language_code"] = language
            if num_speakers:
                data["num_speakers"] = str(num_speakers)
            with open(wav, "rb") as f:
                resp = requests.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": key},
                                     files={"file": ("audio.wav", f, "audio/wav")}, data=data, timeout=1800)
        if resp.status_code != 200:
            raise EditorError(f"Scribe returned {resp.status_code}: {resp.text[:300]}")
        payload = resp.json()
        out = []
        for w in payload.get("words", []):
            kind = w.get("type", "word")
            if kind == "spacing" or w.get("start") is None:
                continue
            logprob = w.get("logprob")
            item = {"start": round(float(w["start"]), 3), "end": round(float(w["end"]), 3),
                    "text": str(w.get("text", "")).strip(),
                    "prob": round(min(1.0, math.exp(float(logprob))), 3) if logprob is not None else 0.9}
            if w.get("speaker_id"):
                item["speaker"] = w["speaker_id"]
            if kind == "audio_event":
                item["event"] = True   # (laughs), (applause): beats to keep, never cut as filler
            out.append(item)
        return out, payload.get("language_code")
    return run_one


def _vosk():
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel
    except ImportError as e:
        raise EditorError("vosk is not installed (pip install vosk)") from e
    from .models import vosk_model
    SetLogLevel(-1)
    model = Model(str(vosk_model()))

    def run_one(path):
        rec = KaldiRecognizer(model, 16000)
        rec.SetWords(True)
        proc = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-map", "0:a:0", "-ac", "1", "-ar", "16000",
                                 "-f", "s16le", "-"], stdout=subprocess.PIPE)
        out = []

        def take(res):
            for w in json.loads(res).get("result", []):
                if w.get("word") and w["word"] != "[unk]":
                    out.append({"start": round(w["start"], 3), "end": round(w["end"], 3), "text": w["word"],
                                "prob": round(float(w.get("conf", 0.8)), 3)})
        while True:
            chunk = proc.stdout.read(8000)
            if not chunk:
                break
            if rec.AcceptWaveform(chunk):
                take(rec.Result())
        take(rec.FinalResult())
        proc.wait()
        return out, "en"
    return run_one


def fill_missing_times(words: list[dict], seg_start: float, seg_end: float) -> list[dict]:
    """WhisperX leaves start/end empty for tokens it can't align (numbers, symbols).
    Give them a share of the gap between their aligned neighbours."""
    n = len(words)
    i = 0
    while i < n:
        if words[i]["start"] is not None and words[i]["end"] is not None:
            i += 1
            continue
        j = i
        while j < n and (words[j]["start"] is None or words[j]["end"] is None):
            j += 1
        left = words[i - 1]["end"] if i > 0 else seg_start
        right = words[j]["start"] if j < n else seg_end
        right = max(right, left)
        step = (right - left) / (j - i)
        for k in range(i, j):
            words[k]["start"] = left + step * (k - i)
            words[k]["end"] = left + step * (k - i + 1)
        i = j
    for w in words:
        w["start"], w["end"] = round(float(w["start"]), 3), round(float(w["end"]), 3)
    return words


def group_phrases(words: list[dict], gap: float = PHRASE_GAP) -> list[dict]:
    """Phrase lines broken on silence >= gap, speaker change or source change."""
    phrases: list[dict] = []
    for w in words:
        p = phrases[-1] if phrases else None
        if p is None or w["src"] != p["src"] or w["start"] - p["end"] >= gap or w.get("speaker") != p.get("speaker"):
            phrases.append({"src": w["src"], "start": w["start"], "end": w["end"], "text": w["text"],
                            "speaker": w.get("speaker")})
        else:
            p["end"] = w["end"]
            p["text"] += " " + w["text"]
    return phrases


def write_transcript(out_dir: str | Path, sources: list[dict], words: list[dict],
                     phrases: list[dict] | None = None) -> Path:
    out_dir = Path(out_dir)
    phrases = phrases or group_phrases(words)
    path = save_json(out_dir / "transcript.json", {"sources": sources, "words": words, "phrases": phrases})
    lines = []
    for i, src in enumerate(sources):
        n = sum(1 for p in phrases if p["src"] == i)
        lines.append(f"## source {i}: {Path(src['path']).name}  (duration {src['duration']:.1f}s, {n} phrases"
                     f"{', ' + src['engine'] if src.get('engine') else ''})")
        for p in phrases:
            if p["src"] == i:
                spk = f" {p['speaker']}:" if p.get("speaker") else ""
                lines.append(f"  [{i}] {fmt_ts(p['start'])}-{fmt_ts(p['end'])}{spk} {p['text']}")
    (out_dir / "transcript.txt").write_text("\n".join(lines) + "\n")
    log(f"wrote {path} ({len(words)} words) and transcript.txt")
    return path
