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
        # "w44-w49" (or a list); "w44-w49#2" for the second time those words play (a cold open repeats a stretch):
        # the first time by default, the same as an "on" phrase
        spec = anchor["words"]
        if isinstance(spec, list):
            ids, nth = [str(x) for x in spec], ""
        else:
            body, _, nth = str(spec).partition("#")
            ids = [x.strip() for x in body.split("-")]
        want = int(nth) if nth.strip().isdigit() and int(nth) > 0 else 1
        a, b = ids[0], ids[-1]

        def num(w: dict) -> int:
            m = re.fullmatch(r"w(\d+)", str(w.get("id", "")))
            return int(m.group(1)) if m else -1

        def play(i: int) -> tuple[int, int]:
            """The stretch around word i that plays in source order (a repeat jumps back: a new play)."""
            lo, hi = i, i
            while lo > 0 and 0 <= num(words[lo - 1]) < num(words[lo]):
                lo -= 1
            while hi + 1 < len(words) and num(words[hi + 1]) > num(words[hi]) >= 0:
                hi += 1
            return lo, hi
        at = [i for i, w in enumerate(words) if w.get("id") == a]
        if len(at) < want:
            return None
        # the end word in the same play; with no #n, the first play that holds both ends
        for ia in (at[want - 1:want] if nth.strip() else at):
            lo, hi = play(ia)
            ib = next((i for i in range(lo, hi + 1) if words[i].get("id") == b), None)
            if ib is not None:
                break
        else:
            return None
        first, last = words[ia], words[ib]
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
            if kind == "broll" and e.get("treatment") == "text-pop" and "min" not in e:
                # words on screen stay long enough to read: ~0.4 s to notice, then ~4 words a second
                min_d = max(min_d, 0.4 + 0.25 * len(str(e.get("text", "")).split()))
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


def _clock(x) -> float:
    """"1:23", "1:23.5", "1m23s", "83s", "83" -> seconds."""
    t = str(x).strip().lower()
    m = re.fullmatch(r"(\d+):(\d{1,2}(?:\.\d+)?)", t) or re.fullmatch(r"(?:(\d+)\s*m(?:in)?\s*)?(?:(\d+(?:\.\d+)?)\s*s(?:ec)?)?", t)
    if m and any(m.groups()):
        if ":" in t and float(m[2]) >= 60:
            raise EditorError(f"not a time: {x!r} (seconds go up to 59 in m:ss)")
        return int(m[1] or 0) * 60 + float(m[2] or 0)
    try:
        v = float(t)
    except ValueError:
        raise EditorError(f"not a time: {x!r} (try 0:12, 1m23s or 83)") from None
    if v < 0:
        raise EditorError(f"not a time: {x!r} (times start at 0)")
    return v


def moment(work: str | Path, at, around: float = 1.5) -> str:
    """What the reel has at one output moment ("0:12" or 12.0): the segment and its source second, the words said
    around then (with ids, for anchors), and the EDL entries on screen or in the mix. A note like "at 0:12 the b-roll
    covers my face" becomes the exact entry to change."""
    work = Path(work)
    t = _clock(at)
    meta = load_json(work / "cut_meta.json")
    words = load_words(work)
    lines = [f"at {int(t // 60)}:{t % 60:05.2f} ({t:.2f} s of {meta['duration']:.2f} s)"]
    for seg in meta["timeline"]:
        if seg["start"] <= t < seg["end"] or (t == seg["end"] == meta["duration"]):
            src = seg["src_start"] + (t - seg["start"]) * seg.get("speed", 1.0)
            lines.append(f"  segment {_edl_name(seg)}: source {seg['src']} at {src:.2f} s (EDL segments are source "
                         f"seconds; speed {seg.get('speed', 1.0)})")
            break
    near = [w for w in words if w["end"] >= t - around and w["start"] <= t + around]
    if near:
        lines.append("  words:   " + " ".join(f"{w['text']}[{w.get('id', '?')}]" for w in near))
    else:
        lines.append("  words:   none around then (a pause, or past the end)")
    edl = resolve(load_json(work / "edl.json"), words) if (work / "edl.json").exists() else {}
    for b in edl.get("broll") or []:
        a = float(b.get("start", 0))
        if a <= t <= a + float(b.get("dur", 0)):
            what = b.get("path") or b.get("treatment") or b.get("text") or "?"
            lines.append(f"  b-roll:  {what} {a:.2f}-{a + float(b.get('dur', 0)):.2f}"
                         + (f" ({b['treatment']})" if b.get("treatment") and b.get("path") else "")
                         + (f" on {b.get('on') or b.get('words')!r}" if b.get("on") or b.get("words") else ""))
    for z in edl.get("zooms") or []:
        if float(z.get("start", 0)) <= t <= float(z.get("end", 0)):
            lines.append(f"  zoom:    {z.get('scale')}x {float(z['start']):.2f}-{float(z['end']):.2f}")
    music = edl.get("music") if isinstance(edl.get("music"), dict) else {}
    for au in music.get("automation") or []:
        if float(au.get("start", 0)) <= t <= float(au.get("end", 0)):
            lines.append(f"  music:   {au.get('db', au.get('gain'))} dB {float(au['start']):.2f}-{float(au['end']):.2f}")
    if music.get("path"):
        lines.append(f"  music:   {music['path']}" + (f" at {music['gain']} dB" if "gain" in music else ""))
    for x in edl.get("sfx") or [] if isinstance(edl.get("sfx"), list) else []:
        if abs(float(x.get("at", -9)) - t) <= 1.0:
            lines.append(f"  sfx:     {x.get('type') or x.get('path')} at {float(x['at']):.2f}")
    chs = [c for c in edl.get("chapters") or [] if float(c.get("start", 0)) <= t]
    if chs:
        lines.append(f"  chapter: {chs[-1].get('title')}")
    title = edl.get("title") if isinstance(edl.get("title"), dict) else None
    if title and t <= float(title.get("dur", title.get("end", 0)) or 0):
        lines.append(f"  hook title: {title.get('text')!r}")
    return "\n".join(lines)


def _edl_name(seg: dict) -> str:
    """The EDL segment(s) a cut piece came from: "3", or "3-4" when touching EDL segments play as one piece."""
    ks = seg.get("edl") or [seg["index"]]
    return str(ks[0]) if len(ks) == 1 else f"{ks[0]}-{ks[-1]}"
