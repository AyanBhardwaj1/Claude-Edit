"""Fit to a length ("make it under 60 seconds"), without AI: the lines that grip least are cut from the EDL's
segments until it fits. The same rules as Cutmind's lib/fit.ts: a line said again earlier in the cut goes first,
then the cold open's rules (a number, a strong word, "you", a question, short; a line naming something counts for
more). A list item ("the first one", "step 2", "finally") is never cut: the others lean on it. The first line (the
hook) and the last (the ending) stay, and at least three lines. Tighter pauses are the plan's job: re-plan with a smaller --max-gap first when that's enough."""
from __future__ import annotations

import re

from .habits import cut
from .plan import norm
from .review import grip, same_sentence, spoken_lines


_LIST = re.compile(r"\b(first|second|third|fourth|fifth|number (one|two|three|four|five|\d+)|step|tip|part|finally|lastly)\b", re.I)


def _duration(segments: list[dict], speed: float = 1.0) -> float:
    """Output seconds: a segment's own "speed" wins over the EDL's (as cut.py plays it)."""
    return sum((s["end"] - s["start"]) / float(s.get("speed", speed) or 1.0) for s in segments)


def plan_fit(edl: dict, cut_words: list[dict], transcript: list[dict], target: float) -> dict:
    """{"now", "after", "drop": [{"text", "start", "seconds", "ids"}], "reached", "segments"}. `cut_words` are the
    cut's words (output times, ids w<N> indexing the transcript)."""
    speed = float(edl.get("speed", 1.0) or 1.0)
    segs = list(edl.get("segments", []))
    now = _duration(segs, speed)
    out = {"now": round(now, 2), "after": round(now, 2), "drop": [], "reached": now <= target, "segments": segs}
    if now <= target:
        return out
    def plays(w):          # by its source time: cut_words.json is stale until `cut` re-runs after an --apply
        i = int(w["id"][1:]) if str(w.get("id", ""))[1:].isdigit() else -1
        if not 0 <= i < len(transcript):
            return True
        src = transcript[i]
        mid = (src["start"] + src["end"]) / 2
        return any(sg.get("src", 0) == src.get("src", 0) and sg["start"] <= mid <= sg["end"] for sg in segs)
    lines = [ln for ln in spoken_lines(cut_words) if any(plays(w) for w in ln)]
    order = sorted(range(len(transcript)), key=lambda i: (transcript[i].get("src", 0), transcript[i]["start"]))
    sorted_at = {i: k for k, i in enumerate(order)}
    sorted_words = [transcript[i] for i in order]

    def toks(line):
        return [norm(w["text"]) for w in line if norm(w["text"])]
    scored = []
    for k, line in enumerate(lines[1:-1], 1):
        text = " ".join(str(w["text"]).strip() for w in line)
        again = any(same_sentence(toks(o), toks(line)) for o in lines[:k])
        names = any(re.match(r"^[A-Z][a-z]", re.sub(r"^[^A-Za-z]+", "", str(w["text"]))) and not re.match(r"^I('|$)", str(w["text"]))
                    for w in line[1:])
        # a list item ("The first one is", "Number two", "Step 3", "Finally") is structure: the others lean on it
        listed = bool(_LIST.search(" ".join(str(w["text"]) for w in line[:5])))
        if listed and not again:
            continue
        score = grip(line)[0] + (2 if names else 0) - (10 if again else 0)
        scored.append((score, -(line[-1]["end"] - line[0]["start"]), k, line, text))
    scored.sort(key=lambda x: (x[0], x[1]))
    drop = []
    for score, neg_secs, k, line, text in scored:
        if now <= target or len(lines) - len(drop) <= 3:
            break
        idx = [sorted_at[int(w["id"][1:])] for w in line if str(w.get("id", "")).startswith("w")
               and w["id"][1:].isdigit() and int(w["id"][1:]) < len(transcript)]
        if not idx:
            continue
        # whole runs of consecutive words: one cut spans the line, pauses inside it included (no silent slivers)
        runs: list[list[int]] = []
        for i in sorted(idx):
            if runs and runs[-1][-1] == i - 1 and sorted_words[i - 1].get("src", 0) == sorted_words[i].get("src", 0):
                runs[-1].append(i)
            else:
                runs.append([i])
        segs = cut(segs, sorted_words, runs)
        now = _duration(segs, speed)
        drop.append({"text": text, "start": round(float(line[0]["start"]), 2), "seconds": round(-neg_secs, 2),
                     "ids": f"{line[0]['id']}-{line[-1]['id']}"})
    drop.sort(key=lambda d: d["start"])
    out.update(after=round(now, 2), drop=drop, reached=now <= target + 0.05, segments=segs)
    return out
