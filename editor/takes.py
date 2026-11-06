"""Pick a take: each line said more than once (the same retake test the plan uses), which take the cut plays now,
and an EDL whose segments play another take in its place: where the line played before (or, when none played,
where it falls in the order it was filmed). Edge fillers ("um") stay out, as in the plan."""
from __future__ import annotations

from .plan import FILLERS, _is_retake, _phrases, norm


def _sorted(words: list[dict]) -> list[dict]:
    return sorted(words, key=lambda w: (w.get("src", 0), w["start"]))


def take_lines(words: list[dict], segments: list[dict], lookback: int = 3) -> list[dict]:
    """[{"takes": [{"src", "start", "end", "text", "kept"}], "playing": index or -1}] for every line said twice or more.
    `kept` is the share of a take's spoken time the segments play."""
    ws = _sorted(words)
    phrases = _phrases(ws, gap=0.5)
    texts = [[norm(ws[i]["text"]) for i in p if norm(ws[i]["text"]) not in FILLERS] for p in phrases]
    parent = list(range(len(phrases)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for j in range(len(phrases)):
        for i in range(max(0, j - lookback), j):
            if _is_retake(texts[i], texts[j]):
                parent[find(j)] = find(i)
    groups: dict[int, list[int]] = {}
    for i in range(len(phrases)):
        groups.setdefault(find(i), []).append(i)
    out = []
    for members in groups.values():
        if len(members) < 2:
            continue
        takes = []
        for m in members:
            idx = [k for k in phrases[m] if norm(ws[k]["text"]) not in FILLERS] or phrases[m]
            a, b = ws[idx[0]], ws[idx[-1]]
            src, start, end = a.get("src", 0), a["start"], b["end"]
            spoken = sum(ws[k]["end"] - ws[k]["start"] for k in idx) or 1e-6
            played = 0.0
            for k in idx:
                w = ws[k]
                for s in segments:
                    if s.get("src", 0) == src:
                        played += max(0.0, min(s["end"], w["end"]) - max(s["start"], w["start"]))
            takes.append({"src": src, "start": round(start, 3), "end": round(end, 3),
                          "text": " ".join(ws[k]["text"] for k in idx), "kept": round(min(1.0, played / spoken), 2)})
        best = max(range(len(takes)), key=lambda k: takes[k]["kept"])
        out.append({"takes": takes, "playing": best if takes[best]["kept"] > 0 else -1})
    out.sort(key=lambda L: (L["takes"][0]["src"], L["takes"][0]["start"]))
    return out


def with_take(segments: list[dict], line: dict, n: int, pad_before: float = 0.06, pad_after: float = 0.10) -> list[dict]:
    """The segments with take `n` of `line` playing in place of the others (each take's span cut out first)."""
    spans = [(t["src"], t["start"] - pad_before, t["end"] + pad_after) for t in line["takes"]]
    out: list[dict] = []
    at = None
    for seg in segments:
        src = seg.get("src", 0)
        hit = [(a, b) for s_, a, b in spans if s_ == src and a < seg["end"] and b > seg["start"]]
        if not hit:
            out.append(seg)
            continue
        pieces = [(seg["start"], seg["end"])]
        for a, b in hit:
            pieces = [(px, py) for (x, y) in pieces for (px, py) in
                      (((x, y),) if y <= a or x >= b else ((x, a), (b, y))) if py - px >= 0.05]
        if at is None:          # the line played here: the picked take plays here too
            first = min(a for a, _ in hit)
            at = len(out) + sum(1 for _, y in pieces if y <= first + 1e-6)
        keep = {k: v for k, v in seg.items() if k != "text"}
        out += [{**keep, "start": round(x, 3), "end": round(y, 3)} for x, y in pieces]
    t = line["takes"][n]
    new = {"src": t["src"], "start": round(max(0.0, t["start"] - pad_before), 3), "end": round(t["end"] + pad_after, 3),
           "text": t["text"]}
    if at is None:      # no take played: where it was filmed
        at = next((i for i, s in enumerate(out) if (s.get("src", 0), s["start"]) > (t["src"], t["start"])), len(out))
    out.insert(at, new)
    return out
