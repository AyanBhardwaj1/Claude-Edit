"""Caption text fixes on the timed words: corrections, numbers as digits, hidden ranges.

EDL "captions": {
  "corrections": [{"from": "pay pal", "to": "PayPal"}, {"from": "cloud", "to": "Claude"}],
  "hidden": [{"on": "this part is private"}, {"words": "w80-w84"}],     # no captions on these words
  "digits": true                                                        # "twenty five percent" -> 25% (default)
}
Corrections replace a whole misheard phrase (longest first) and keep the original timing and any
trailing punctuation. A correction that never matched is reported, so a stale one gets noticed.
"""
from __future__ import annotations

import re

from .util import log

ONES = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
        "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
        "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90}
SCALES = {"hundred": 100, "thousand": 1000, "million": 1_000_000, "billion": 1_000_000_000}
# "one" is usually a pronoun ("the one thing"); only a number after these words, or as a list opener
ONE_AFTER = {"number", "step", "day", "week", "month", "year", "level", "part", "chapter", "rule", "tip", "page",
             "round", "season", "episode", "version", "top", "plus", "minus", "times", "of"}
CURRENCY = {"dollars": "$", "dollar": "$", "bucks": None, "pounds": "£", "euros": "€"}


def _bare(t: str) -> str:
    return re.sub(r"[^\w'%$€£]", "", t.lower())


def _split_punct(t: str) -> tuple[str, str, str]:
    m = re.match(r"^(\W*)(.*?)(\W*)$", t, re.S)
    return m.group(1), m.group(2), m.group(3)


def apply_corrections(words: list[dict], corrections: list[dict] | None) -> list[dict]:
    if not corrections:
        return words
    words = [dict(w) for w in words]
    used = set()
    for k, c in sorted(enumerate(corrections), key=lambda kc: -len(str(kc[1]["from"]).split())):
        frm = [_bare(t) for t in str(c["from"]).split() if _bare(t)]
        if not frm:
            continue
        i = 0
        while i <= len(words) - len(frm):
            if [_bare(w["text"]) for w in words[i:i + len(frm)]] == frm:
                lead, _, _ = _split_punct(words[i]["text"])
                _, last, trail = _split_punct(words[i + len(frm) - 1]["text"])
                poss = "'s" if last.lower().endswith("'s") and not str(c["to"]).lower().endswith("'s") else ""
                words[i] = {**words[i], "text": f"{lead}{c['to']}{poss}{trail}",
                            "end": words[i + len(frm) - 1]["end"]}
                del words[i + 1:i + len(frm)]
                used.add(k)
            i += 1
    for k, c in enumerate(corrections):
        if k not in used:
            log(f"captions: correction '{c['from']}' -> '{c['to']}' matched nothing")
    return words


def _number_run(tokens: list[str]) -> tuple[int, int] | None:
    """(value, tokens used) for a spoken number at the start of tokens."""
    total, cur, used = 0, 0, 0
    for t in tokens:
        if t in ONES:
            cur += ONES[t]
        elif t in TENS:
            cur += TENS[t]
        elif t in SCALES and (cur or total):
            cur = max(cur, 1) * SCALES[t]
            if SCALES[t] >= 1000:
                total, cur = total + cur, 0
        elif t == "and" and used and tokens[used:used + 2] and tokens[min(used + 1, len(tokens) - 1)] in {**ONES, **TENS}:
            pass
        else:
            break
        used += 1
    return (total + cur, used) if used else None


def _fmt(n: int) -> str:
    return f"{n:,}" if n >= 1000 else str(n)


def digits(words: list[dict]) -> list[dict]:
    """Spoken numbers as digits: 'twenty five' -> 25, '64 percent' -> 64%, 'three thousand' -> 3,000,
    'twenty dollars' -> $20, '3' ',000' -> 3,000. Timing spans the merged words."""
    out: list[dict] = []
    i = 0
    while i < len(words):
        w = words[i]
        toks = [_bare(x["text"]) for x in words[i:i + 8]]
        run = _number_run(toks)
        if run and not (toks[0] == "one" and run[1] == 1 and not (out and _bare(out[-1]["text"]) in ONE_AFTER)):
            value, n = run
            lead, _, _ = _split_punct(w["text"])
            _, _, trail = _split_punct(words[i + n - 1]["text"])
            text, end = _fmt(value), words[i + n - 1]["end"]
            nxt = _bare(words[i + n]["text"]) if i + n < len(words) else ""
            if nxt in ("percent", "%"):
                _, _, trail = _split_punct(words[i + n]["text"])
                text, end, n = text + "%", words[i + n]["end"], n + 1
            elif nxt in CURRENCY and CURRENCY[nxt]:
                _, _, trail = _split_punct(words[i + n]["text"])
                text, end, n = CURRENCY[nxt] + text, words[i + n]["end"], n + 1
            out.append({**w, "text": f"{lead}{text}{trail}", "end": end})
            i += n
            continue
        raw = w["text"].strip()
        if out and re.fullmatch(r",\d{3}\W*", raw) and re.search(r"\d$", out[-1]["text"]):
            out[-1] = {**out[-1], "text": out[-1]["text"] + raw, "end": w["end"]}            # "3" ",000"
        elif out and _bare(raw) in ("%", "percent") and re.search(r"\d$", out[-1]["text"]):
            out[-1] = {**out[-1], "text": out[-1]["text"] + "%" + _split_punct(w["text"])[2], "end": w["end"]}
        else:
            out.append(w)
        i += 1
    return out


def hide(words: list[dict], hidden: list[dict] | None) -> list[dict]:
    if not hidden:
        return words
    from .anchors import find
    drop = set()
    for h in hidden:
        hit = find(words, h)
        if hit is None:
            log(f"captions: hidden range {h.get('on') or h.get('words')!r} not found")
            continue
        a, b = words.index(hit[0]), words.index(hit[1])
        drop.update(range(a, b + 1))
    return [w for k, w in enumerate(words) if k not in drop]


def fix(words: list[dict], look: dict) -> list[dict]:
    words = hide(words, look.get("hidden"))
    words = apply_corrections(words, look.get("corrections"))
    if look.get("digits", True):
        words = digits(words)
    return words
