"""Re-time corrected text onto a transcript.

Fixes what speech recognition got wrong without losing word timings: punctuation and
casing (Vosk has none), brand names ("whisper ex" -> "WhisperX"), misheard words. Also
aligns a written script to the recording.

Input text can be:
  * an edited copy of transcript.txt (lines keep their "[src] mm:ss-mm:ss" prefix), or
  * plain text / a script (aligned against all sources in order).
The corrected words are sequence-aligned to the timed words (difflib). Matched words
keep their timing, a replaced run shares the original run's time span by length, and
inserted words squeeze into the neighbouring gap. The original goes to transcript.orig.json.
"""
from __future__ import annotations

import re
import shutil
from difflib import SequenceMatcher
from pathlib import Path

from .transcribe import write_transcript
from .util import EditorError, load_json, log

# an optional speaker label is "S1:" / "speaker_0:" / "SPEAKER_00:" only: "Tip: always back up" keeps its "Tip"
LINE = re.compile(r"^\s*\[(\d+)\]\s+\d+:\d+(?:\.\d+)?-\d+:\d+(?:\.\d+)?\s*(?:(?:S\d+|[Ss]peaker_?\w*|SPEAKER_?\w*):)?\s*(.*)$")


def _norm(t: str) -> str:
    return re.sub(r"[^\w']", "", t.lower())


def _parse(text: str) -> dict[int | None, list[str]]:
    by_src: dict[int | None, list[str]] = {}
    for line in text.splitlines():
        if line.lstrip().startswith("#") or not line.strip():
            continue
        m = LINE.match(line)
        src, body = (int(m.group(1)), m.group(2)) if m else (None, line)
        by_src.setdefault(src, []).extend(body.split())
    if None in by_src and len(by_src) > 1:
        raise EditorError("mixes prefixed transcript lines and plain lines; use one format")
    return by_src


def _spread(out: list[dict], tokens: list[str], start: float, end: float, base: dict) -> None:
    """New words over [start, end] in proportion to their length (a little room when the span is empty)."""
    if end <= start:
        end = start + 0.05 * len(tokens)
    weights = [len(t) + 1 for t in tokens]
    total, acc = sum(weights), 0.0
    for t, wgt in zip(tokens, weights):
        s = start + (end - start) * acc / total
        acc += wgt
        e = start + (end - start) * acc / total
        out.append(dict(base, start=round(s, 3), end=round(e, 3), text=t, prob=0.9, retext=True))


def align(old: list[dict], new_tokens: list[str]) -> list[dict]:
    a = [_norm(w["text"]) for w in old]
    b = [_norm(t) for t in new_tokens]
    out: list[dict] = []
    sm = SequenceMatcher(None, a, b, autojunk=False)
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == "equal":
            for k in range(i2 - i1):
                out.append(dict(old[i1 + k], text=new_tokens[j1 + k]))
        elif op == "delete":
            continue
        else:  # replace / insert: spread the new words over the old span (or the gap)
            if i2 > i1:
                # never across two clips: each clip's run of old words gets a share of the new ones by its size
                groups, k = [], i1
                while k < i2:
                    g = k
                    while g + 1 < i2 and old[g + 1].get("src") == old[k].get("src"):
                        g += 1
                    groups.append((k, g))
                    k = g + 1
                toks, left = new_tokens[j1:j2], i2 - i1
                for n, (ga, gb) in enumerate(groups):
                    size = gb - ga + 1
                    take = len(toks) if n == len(groups) - 1 else round(len(toks) * size / left)
                    part, toks, left = toks[:take], toks[take:], left - size
                    if part:
                        _spread(out, part, old[ga]["start"], old[gb]["end"], dict(old[ga]))
                continue
            if i1 < len(old) and (i1 == 0 or old[i1 - 1].get("src") != old[i1].get("src")):
                # words added at the start of a clip: just before its first word, in that clip's own time
                end = old[i1]["start"]
                start = max(0.0, end - 0.3 * (j2 - j1))
                base = dict(old[i1])
            else:
                start = old[i1 - 1]["end"] if i1 > 0 else (old[0]["start"] if old else 0.0)
                end = old[i1]["start"] if i1 < len(old) else start + 0.3 * (j2 - j1)
                base = dict(old[min(i1, len(old) - 1)]) if old else {"src": 0}
            _spread(out, new_tokens[j1:j2], start, end, base)
    return out


def retext(work_dir: str | Path, text_path: str | Path) -> Path:
    work = Path(work_dir)
    tr = load_json(work / "transcript.json")
    by_src = _parse(Path(text_path).read_text())
    words = sorted(tr["words"], key=lambda w: (w["src"], w["start"]))
    if None in by_src:
        new = align(words, by_src[None])
    else:
        new = []
        for src in sorted({w["src"] for w in words} | set(by_src)):
            old = [w for w in words if w["src"] == src]
            new += align(old, by_src.get(src, [])) if src in by_src else old
    changed = sum(1 for w in new if w.get("retext"))
    matched = len(new) - changed
    if words and matched < 0.5 * len(words):
        log(f"warning: only {matched}/{len(words)} words matched; is this the right text for this recording?")
    orig = work / "transcript.orig.json"
    if not orig.exists():
        shutil.copy2(work / "transcript.json", orig)
    path = write_transcript(work, tr["sources"], new)
    log(f"retext: {matched} words kept their timing, {changed} re-timed, "
        f"{len(words) - matched} originals replaced or dropped")
    return path
