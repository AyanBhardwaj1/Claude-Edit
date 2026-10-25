"""Automatic rough-cut planning: transcript -> edl.json.

The EDL is the single source of truth for the edit. This module proposes one
(cut silences, filler words and retakes); Claude then reviews edl.json against
transcript.txt and edits it (drop tangents, move the hook first, add emphasis
zooms) before anything is rendered.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher
from pathlib import Path

from .util import fmt_ts, load_json, log, save_json

FILLERS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "hm", "mm", "mhm"}
AGGRESSIVE_FILLERS = FILLERS | {"like", "basically", "actually", "literally", "so", "yeah", "okay", "right"}


def norm(text: str) -> str:
    return re.sub(r"[^\w']", "", text.lower())


def _phrases(words: list[dict], gap: float) -> list[list[int]]:
    """Group word indices into phrases split on pauses, sentence ends and source changes."""
    groups: list[list[int]] = []
    for i, w in enumerate(words):
        prev = words[i - 1] if i else None
        new = (prev is None or w["src"] != prev["src"] or w["start"] - prev["end"] >= gap
               or prev["text"].rstrip().endswith((".", "?", "!")))
        if new:
            groups.append([i])
        else:
            groups[-1].append(i)
    return groups


def _is_retake(earlier: list[str], later: list[str]) -> bool:
    """True when `later` restarts the same line as `earlier` (false start or repeated take)."""
    if len(earlier) < 2 or len(later) < 2:
        return False
    n = min(len(earlier), len(later), 6)
    if n < 3 and not (len(earlier) <= 3 and later[:len(earlier)] == earlier):
        return False
    return SequenceMatcher(None, earlier[:n], later[:n]).ratio() >= 0.75


def _worse_take(i: int, j: int, phrases, texts, words, drop) -> tuple[int, int, str]:
    """Pick which of two takes of the same line to drop. Returns (loser, winner, reason)."""
    ni, nj = len(texts[i]), len(texts[j])
    if ni < 0.7 * nj:
        return i, j, "earlier was a false start"
    if nj < 0.7 * ni:
        return j, i, "later was a false start"

    def quality(p):
        idx = phrases[p]
        conf = sum(words[k].get("prob", 0.9) for k in idx) / len(idx)
        fillers = sum(1 for k in idx if drop.get(k) == "filler")
        complete = words[idx[-1]]["text"].rstrip().endswith((".", "?", "!"))
        return conf - 0.15 * fillers + (0.05 if complete else 0.0)

    qi, qj = quality(i), quality(j)
    if qi > qj + 0.05:
        return j, i, "earlier take was cleaner"
    return i, j, "cleaner or equal, later takes usually land better"


def plan(transcript_path: str | Path, out: str | Path, max_gap: float = 0.30, pad_before: float = 0.06,
         pad_after: float = 0.10, fillers: str = "standard", retakes: bool = True, speed: float = 1.0,
         lookback: int = 3) -> Path:
    tr = load_json(transcript_path)
    words = sorted(tr["words"], key=lambda w: (w["src"], w["start"]))
    filler_set = {"none": set(), "standard": FILLERS, "aggressive": AGGRESSIVE_FILLERS}[fillers]

    drop: dict[int, str] = {}
    for i, w in enumerate(words):
        if norm(w["text"]) in filler_set and not w.get("event"):
            drop[i] = "filler"

    if retakes:
        phrases = _phrases(words, gap=0.5)
        texts = [[norm(words[i]["text"]) for i in p if i not in drop] for p in phrases]
        for j in range(len(phrases)):
            for i in range(max(0, j - lookback), j):
                if all(k in drop for k in phrases[i]) or all(k in drop for k in phrases[j]):
                    continue
                if _is_retake(texts[i], texts[j]):
                    loser, winner, why = _worse_take(i, j, phrases, texts, words, drop)
                    when = fmt_ts(words[phrases[winner][0]]["start"])
                    for k in phrases[loser]:
                        drop.setdefault(k, f"retake (kept {'later' if winner == j else 'earlier'} take at {when}: {why})")

    segments, removed = [], []
    current: list[int] = []

    def flush():
        if not current:
            return
        first, last = words[current[0]], words[current[-1]]
        prev_end = words[current[0] - 1]["end"] if current[0] > 0 and words[current[0] - 1]["src"] == first["src"] else 0.0
        nxt = words[current[-1] + 1] if current[-1] + 1 < len(words) and words[current[-1] + 1]["src"] == last["src"] else None
        start = max(first["start"] - pad_before, min(prev_end + 0.01, first["start"]), 0.0)
        end = last["end"] + pad_after
        if nxt is not None:
            end = min(end, max(nxt["start"] - 0.01, last["end"]))
        segments.append({"src": first["src"], "start": round(start, 3), "end": round(end, 3),
                         "text": " ".join(words[k]["text"] for k in current)})
        current.clear()

    for i, w in enumerate(words):
        if i in drop:
            flush()
            removed.append({"src": w["src"], "start": w["start"], "end": w["end"], "text": w["text"], "reason": drop[i]})
            continue
        if current:
            prev = words[current[-1]]
            if w["src"] != prev["src"] or w["start"] - prev["end"] > max_gap or current[-1] != i - 1:
                flush()
        current.append(i)
    flush()

    removed = _merge_removed(removed)
    src_total = sum(s["duration"] for s in tr["sources"])
    kept = sum(s["end"] - s["start"] for s in segments) / speed
    edl = {
        "version": 1,
        "sources": tr["sources"],
        "speed": speed,
        "segments": segments,
        "zooms": [],
        "auto_punch_in": 1.12,
        "removed": removed,
        "stats": {"source_seconds": round(src_total, 2), "output_seconds": round(kept, 2),
                  "segments": len(segments), "removed_items": len(removed)},
    }
    path = save_json(out, edl)
    log(f"plan: {src_total:.1f}s -> {kept:.1f}s in {len(segments)} segments "
        f"({len(removed)} removals) -> {path}")
    return path


def _merge_removed(items: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for it in items:
        if merged and merged[-1]["reason"] == it["reason"] and merged[-1]["src"] == it["src"] \
                and it["start"] - merged[-1]["end"] < 0.6:
            merged[-1]["end"] = it["end"]
            merged[-1]["text"] += " " + it["text"]
        else:
            merged.append(dict(it))
    return merged
