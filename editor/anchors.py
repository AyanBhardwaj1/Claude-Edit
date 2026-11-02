"""Word anchors: put things on the words they illustrate instead of on output seconds.

Any timed EDL entry (broll, zooms, chapters, transitions, sfx, music automation) may say WHERE in
the speech it goes instead of WHEN, so re-cutting, re-timing or changing speed never breaks it:

  "words": "w44-w49"        word ids from transcript.json (`editor words <work>` lists the kept ones)
  "words": "w44"            one word
  "on": "twenty bucks"      a phrase in the kept words (first match; "twenty bucks#2" for the second)

Optional: "lead" (seconds before the first word, default 0.1 for b-roll), "hold" (seconds after the
last word), "min" (shortest it may be, default 1.2 s for b-roll so a picture can be read).
The resolved times are filled in at render (output seconds); entries whose words were cut are
dropped with a warning. Entries with plain "start"/"at" times are left alone.
"""
from __future__ import annotations

import copy
import re
from pathlib import Path

from .util import EditorError, load_json, log

DEFAULTS = {"broll": (0.10, 1.2), "zooms": (0.0, 0.6), "chapters": (0.0, 0.0), "transitions": (0.0, 0.0),
            "sfx": (0.0, 0.0), "automation": (0.0, 0.0)}


def _norm(t: str) -> str:
    return "".join(ch for ch in t.lower() if ch.isalnum() or ch in "'%$")


def load_words(work: str | Path) -> list[dict]:
    p = Path(work) / "cut_words.json"
    return load_json(p)["words"] if p.exists() else []


def find(words: list[dict], anchor: dict) -> tuple[dict, dict] | None:
    """(first word, last word) on the cut timeline for an entry's anchor, or None if it isn't there."""
    if anchor.get("words"):
        spec = anchor["words"]
        ids = spec if isinstance(spec, list) else [s.strip() for s in str(spec).split("-")]
        a, b = ids[0], ids[-1]
        by_id = {w["id"]: w for w in words if "id" in w}
        if a not in by_id or b not in by_id:
            return None
        first, last = by_id[a], by_id[b]
        return (first, last) if last["end"] >= first["start"] else (last, first)
    phrase, _, nth = str(anchor["on"]).partition("#")
    toks = [_norm(t) for t in re.split(r"\s+", phrase.strip()) if _norm(t)]
    if not toks:
        raise EditorError(f"empty anchor phrase: {anchor['on']!r}")
    norm = [_norm(w["text"]) for w in words]
    want = int(nth) if nth.strip().isdigit() else 1
    seen = 0
    for i in range(len(words) - len(toks) + 1):
        if norm[i:i + len(toks)] == toks:
            seen += 1
            if seen == want:
                return words[i], words[i + len(toks) - 1]
    return None


def _anchored(e) -> bool:
    return isinstance(e, dict) and bool(e.get("words") or e.get("on"))


def resolve(edl: dict, words: list[dict]) -> dict:
    """A copy of the EDL with every word-anchored entry given output times."""
    edl = copy.deepcopy(edl)
    music = edl.get("music") if isinstance(edl.get("music"), dict) else {}
    groups = {"broll": edl.get("broll"), "zooms": edl.get("zooms"), "chapters": edl.get("chapters"),
              "transitions": edl.get("transitions"), "sfx": edl.get("sfx") if isinstance(edl.get("sfx"), list) else None,
              "automation": music.get("automation")}
    for kind, entries in groups.items():
        if not entries:
            continue
        kept = []
        for e in entries:
            if not _anchored(e):
                kept.append(e)
                continue
            if not words:
                raise EditorError("word anchors need work/cut_words.json: run the cut stage first")
            hit = find(words, e)
            label = e.get("on") or e.get("words")
            if hit is None:
                log(f"anchors: {kind} on {label!r} is not in the cut any more, skipped")
                continue
            first, last = hit
            lead_d, min_d = DEFAULTS[kind]
            lead = float(e.get("lead", lead_d))
            start = max(0.0, first["start"] - lead)
            end = last["end"] + float(e.get("hold", 0.0))
            end = max(end, start + float(e.get("min", min_d)))
            if kind == "broll":
                e["start"] = round(start, 3)
                e.setdefault("dur", round(end - start, 3))
                i0, i1 = words.index(first), words.index(last)      # each spoken word, for walls and lists
                e["word_times"] = [round(w["start"], 3) for w in words[i0:i1 + 1]]
                e["spoken"] = " ".join(w["text"] for w in words[i0:i1 + 1])
            elif kind in ("zooms", "automation"):
                e["start"], e["end"] = round(start, 3), round(end, 3)
            elif kind == "chapters":
                e["start"] = round(start, 3)
            else:                                    # transitions and sfx land on the first word
                e["at"] = round(first["start"], 3)
            kept.append(e)
        if kind == "automation":
            music["automation"] = kept
        else:
            edl[kind] = kept
    return edl


def resolve_work(edl: dict, work: str | Path) -> dict:
    return resolve(edl, load_words(work))


def listing(work: str | Path, find_phrase: str | None = None, unsure: float = 0.5) -> str:
    """The kept words with ids and output times, one line per phrase (what Claude reads to anchor things)."""
    words = load_words(work)
    if not words:
        raise EditorError(f"no cut_words.json in {work}: run the cut stage first")
    if find_phrase:
        out, k = [], 1
        while (hit := find(words, {"on": f"{find_phrase}#{k}"})) is not None:
            out.append(f"{hit[0].get('id')}-{hit[1].get('id')}  {hit[0]['start']:.2f}-{hit[1]['end']:.2f}s")
            k += 1
        return "\n".join(out) or f"'{find_phrase}' is not in the kept words"
    lines, cur, seg = [], [], None
    for w in words:
        if cur and (w["segment"] != seg or w["start"] - cur[-1]["end"] > 0.5):
            lines.append(cur)
            cur = []
        cur.append(w)
        seg = w["segment"]
    if cur:
        lines.append(cur)
    flag = lambda w: "(?)" if w.get("prob", 1.0) < unsure else ""      # noqa: E731
    return "\n".join(f"{ln[0]['start']:6.2f}s  " + " ".join(f"{w['text']}{flag(w)}[{w.get('id', '?')}]" for w in ln)
                     for ln in lines)
