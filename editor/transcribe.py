"""Word-level transcription with faster-whisper.

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
               device: str = "auto") -> Path:
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise EditorError("faster-whisper is not installed. Run: pip install -r requirements.txt") from e

    compute_type = "int8"
    if device in ("auto", "cuda"):
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                device, compute_type = "cuda", "float16"
            else:
                device = "cpu"
        except Exception:
            device = "cpu"
    log(f"loading whisper model '{model}' on {device} ({compute_type})")
    try:
        wm = WhisperModel(model, device=device, compute_type=compute_type)
    except Exception as e:  # download / disk / CUDA errors surface as many exception types
        raise EditorError(f"could not load whisper model '{model}' (first use downloads it from "
                          f"huggingface.co; check your connection or pass a local model dir): {e}") from e

    sources, words, phrases = [], [], []
    for idx, path in enumerate(paths):
        info = probe(path)
        if not info["has_audio"]:
            raise EditorError(f"{path} has no audio track to transcribe")
        sources.append({"path": str(Path(path).resolve()), "duration": info["duration"]})
        log(f"transcribing [{idx}] {path} ({info['duration']:.1f}s)")
        segments, meta = wm.transcribe(
            str(path), language=language, word_timestamps=True, initial_prompt=FILLER_PROMPT,
            condition_on_previous_text=False, vad_filter=False, beam_size=5,
        )
        for seg in segments:
            seg_words = []
            for w in seg.words or []:
                text = w.word.strip()
                if not text:
                    continue
                word = {"src": idx, "start": round(w.start, 3), "end": round(w.end, 3), "text": text,
                        "prob": round(w.probability, 3)}
                words.append(word)
                seg_words.append(word)
            if seg_words:
                phrases.append({"src": idx, "start": seg_words[0]["start"], "end": seg_words[-1]["end"],
                                "text": " ".join(w["text"] for w in seg_words)})
        sources[-1]["language"] = meta.language

    return write_transcript(out_dir, sources, words, phrases)


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
