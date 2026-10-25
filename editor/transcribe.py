"""Word-level transcription.

Engines
  whisperx        Whisper + wav2vec2 forced alignment: the tightest word boundaries,
                  so cuts land right at the edge of each word. Used when installed.
  faster-whisper  Whisper's own word timestamps. Lighter install, slightly looser.

Writes transcript.json (machine-readable, every word with timestamps) and
transcript.txt (one line per phrase with timestamps, for Claude to read and
make editorial decisions from).
"""
from __future__ import annotations

from pathlib import Path

from .util import EditorError, fmt_ts, log, probe, save_json

# Whisper drops disfluencies unless the prompt contains them; keeping them lets
# the planner cut "um"/"uh" precisely instead of leaving them buried in a word.
FILLER_PROMPT = "Umm, let me think, uh... Okay, so, like, hmm, here's what I, um, wanted to say."


def transcribe(paths: list[str], out_dir: str | Path, model: str = "small", language: str | None = None,
               device: str = "auto", engine: str = "auto") -> Path:
    if engine == "auto":
        try:
            import whisperx  # noqa: F401
            engine = "whisperx"
        except ImportError:
            engine = "faster-whisper"
    device, compute_type = _device(device)
    log(f"transcribing with {engine} '{model}' on {device} ({compute_type})")
    run_one = _whisperx(model, device, compute_type, language) if engine == "whisperx" \
        else _faster_whisper(model, device, compute_type, language)

    sources, words, phrases = [], [], []
    for idx, path in enumerate(paths):
        info = probe(path)
        if not info["has_audio"]:
            raise EditorError(f"{path} has no audio track to transcribe")
        log(f"transcribing [{idx}] {path} ({info['duration']:.1f}s)")
        segs, lang = run_one(str(path))
        sources.append({"path": str(Path(path).resolve()), "duration": info["duration"], "language": lang,
                        "engine": engine})
        for seg_words in segs:
            seg_words = [dict(w, src=idx) for w in seg_words if w["text"]]
            words += seg_words
            if seg_words:
                phrases.append({"src": idx, "start": seg_words[0]["start"], "end": seg_words[-1]["end"],
                                "text": " ".join(w["text"] for w in seg_words)})
    return write_transcript(out_dir, sources, words, phrases)


def _device(device: str) -> tuple[str, str]:
    if device in ("auto", "cuda"):
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                return "cuda", "float16"
        except Exception:
            pass
    return "cpu", "int8"


def _faster_whisper(model, device, compute_type, language):
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise EditorError("faster-whisper is not installed. Run: pip install -r requirements.txt") from e
    try:
        wm = WhisperModel(model, device=device, compute_type=compute_type)
    except Exception as e:  # download / disk / CUDA errors surface as many exception types
        raise EditorError(f"could not load whisper model '{model}' (first use downloads it from "
                          f"huggingface.co; check your connection or pass a local model dir): {e}") from e

    def run_one(path):
        segments, meta = wm.transcribe(path, language=language, word_timestamps=True, initial_prompt=FILLER_PROMPT,
                                       condition_on_previous_text=False, vad_filter=False, beam_size=5)
        out = [[{"start": round(w.start, 3), "end": round(w.end, 3), "text": w.word.strip(),
                 "prob": round(w.probability, 3)} for w in (seg.words or [])] for seg in segments]
        return out, meta.language
    return run_one


def _whisperx(model, device, compute_type, language):
    import whisperx
    try:
        asr = whisperx.load_model(model, device, compute_type=compute_type, language=language,
                                  asr_options={"initial_prompt": FILLER_PROMPT})
    except Exception as e:
        raise EditorError(f"could not load whisperx model '{model}': {e}") from e
    aligners: dict = {}

    def run_one(path):
        audio = whisperx.load_audio(path)
        result = asr.transcribe(audio, batch_size=16 if device == "cuda" else 4, language=language)
        lang = result["language"]
        if lang not in aligners:
            aligners[lang] = whisperx.load_align_model(language_code=lang, device=device)
        align_model, meta = aligners[lang]
        aligned = whisperx.align(result["segments"], align_model, meta, audio, device, return_char_alignments=False)
        out = []
        for seg in aligned["segments"]:
            raw = [{"start": w.get("start"), "end": w.get("end"), "text": str(w.get("word", "")).strip(),
                    "prob": round(float(w.get("score", 0.5) or 0.5), 3)} for w in seg.get("words", [])]
            out.append(fill_missing_times(raw, seg.get("start", 0.0), seg.get("end", 0.0)))
        return out, lang
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


def write_transcript(out_dir: str | Path, sources: list[dict], words: list[dict], phrases: list[dict]) -> Path:
    out_dir = Path(out_dir)
    path = save_json(out_dir / "transcript.json", {"sources": sources, "words": words, "phrases": phrases})
    lines = []
    for i, src in enumerate(sources):
        lines.append(f"# source {i}: {src['path']} ({src['duration']:.1f}s)")
        for p in phrases:
            if p["src"] == i:
                lines.append(f"[{i}] {fmt_ts(p['start'])}-{fmt_ts(p['end'])}  {p['text']}")
    (out_dir / "transcript.txt").write_text("\n".join(lines) + "\n")
    log(f"wrote {path} ({len(words)} words) and transcript.txt")
    return path
