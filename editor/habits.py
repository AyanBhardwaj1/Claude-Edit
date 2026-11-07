"""Words said out of habit ("basically", "literally", "you know,", "I mean,"): found in what the EDL plays and cut
from its segments, the same rules as Cutmind's lib/crutch.ts. Only the forms safe to drop: "you know" / "I mean" with
a comma or a pause after them ("do you know" stays), "actually" / "like" only set off by commas ("it actually works",
"I like it" stay). Each cut goes from the middle of the pause before to the middle of the pause after."""
from __future__ import annotations

import re

ALWAYS = {"basically", "literally", "honestly", "obviously"}
_ASKS = {"do", "did", "don't", "if", "what", "as", "would", "could"}


def _bare(t: str) -> str:
    return re.sub(r"[^\w'%$€£]", "", str(t).lower().replace("’", "'"))


def _comma(t: str) -> bool:
    return bool(re.search(r"[,;—–-]$", str(t).strip()))


def _end(t: str) -> bool:
    return bool(re.search(r"[.!?][\"')]*$", str(t).strip()))


def _played(w: dict, segments: list[dict]) -> bool:
    mid = (w["start"] + w["end"]) / 2
    return any(s.get("src", 0) == w.get("src", 0) and s["start"] <= mid <= s["end"] for s in segments)


def find(words: list[dict], segments: list[dict]) -> list[dict]:
    """[{"name", "hits": [[word indices]]}] most said first, counting only words the segments play."""
    ws = sorted(words, key=lambda w: (w.get("src", 0), w["start"]))
    on = [_played(w, segments) and str(w["text"]).strip() != "" for w in ws]
    found: dict[str, list[list[int]]] = {}
    for i, w in enumerate(ws):
        if not on[i]:
            continue
        b = _bare(w["text"])
        same_next = i + 1 < len(ws) and on[i + 1] and ws[i + 1].get("src", 0) == w.get("src", 0)
        prev_on = i > 0 and on[i - 1] and ws[i - 1].get("src", 0) == w.get("src", 0)
        if b in ALWAYS:
            found.setdefault(b, []).append([i])
        elif b in ("actually", "like") and _comma(w["text"]) and (not prev_on or _comma(ws[i - 1]["text"]) or _end(ws[i - 1]["text"])):
            found.setdefault(b, []).append([i])
        elif same_next and ((b == "you" and _bare(ws[i + 1]["text"]) == "know") or (b == "i" and _bare(ws[i + 1]["text"]) == "mean")):
            nxt = ws[i + 1]
            pause = i + 2 < len(ws) and ws[i + 2].get("src", 0) == nxt.get("src", 0) and ws[i + 2]["start"] - nxt["end"] > 0.25
            # ending a sentence counts only when it starts a clause of its own ("It's tough, you know."), not when it
            # ends one ("And now you know.", "If you know, you know.")
            own = not prev_on or (re.search(r"[,;.!?—–][\"')]*$", str(ws[i - 1]["text"]).strip()) and _bare(ws[i - 1]["text"]) != "know")
            if (_comma(nxt["text"]) or pause or (_end(nxt["text"]) and own)) and not (prev_on and _bare(ws[i - 1]["text"]) in _ASKS):
                found.setdefault("I mean" if b == "i" else "you know", []).append([i, i + 1])
    return [{"name": k, "hits": v} for k, v in sorted(found.items(), key=lambda kv: -len(kv[1]))]


def cut(segments: list[dict], words: list[dict], hits: list[list[int]]) -> list[dict]:
    """The segments without these words (indices into words sorted by source and time), order kept."""
    ws = sorted(words, key=lambda w: (w.get("src", 0), w["start"]))
    spans = []
    for h in hits:
        a, b = ws[h[0]], ws[h[-1]]
        src = a.get("src", 0)
        prev = ws[h[0] - 1] if h[0] > 0 and ws[h[0] - 1].get("src", 0) == src else None
        nxt = ws[h[-1] + 1] if h[-1] + 1 < len(ws) and ws[h[-1] + 1].get("src", 0) == src else None
        x = max(a["start"] - 0.15, (prev["end"] + a["start"]) / 2) if prev else a["start"] - 0.05
        y = min(b["end"] + 0.15, (b["end"] + nxt["start"]) / 2) if nxt else b["end"] + 0.1
        spans.append((src, x, y))
    out = []
    for seg in segments:
        pieces = [(seg["start"], seg["end"])]
        for src, x, y in spans:
            if src != seg.get("src", 0):
                continue
            pieces = [p for (s, e) in pieces for p in (((s, e),) if e <= x or s >= y else ((s, x), (y, e))) if p[1] - p[0] >= 0.05]
        rest = {k: v for k, v in seg.items() if k != "text"}
        for s, e in pieces:
            piece = {**rest, "start": round(s, 3), "end": round(e, 3)}
            if (s, e) == (seg["start"], seg["end"]) and "text" in seg:
                piece["text"] = seg["text"]
            out.append(piece)
    return out
