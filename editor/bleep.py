"""Bleeps: strong swear words bleeped (a 1 kHz tone with the voice muted, subtitles masked "f***"), the same word list
as Cutmind's lib/bleep.ts. Platforms limit ads on strong language and many brands won't sponsor it; mild words
("damn", "hell", "crap") are left alone.

In the EDL: "bleep": true bleeps every strong word on the cut; "bleep": ["w12", "w40"] bleeps those word ids.
The audio stage mutes and tones them (audio.master), the captions stage masks them (captions.build).
"""
from __future__ import annotations

import re

STRONG = re.compile(r"^(fuck\w*|motherfuck\w*|\w*fucker|shit|shits|shitty|shitting|bullshit|horseshit|bitch\w*|"
                    r"asshole\w*|cunt\w*|dickhead\w*|bastard\w*|wtf|stfu|goddamn\w*)$")


def is_swear(word: str) -> bool:
    return bool(STRONG.match(re.sub(r"[^a-z]", "", str(word).lower())))


def chosen(words: list[dict], bleep) -> list[dict]:
    """The cut words to bleep for the EDL's "bleep" value."""
    if bleep is True:
        return [w for w in words if is_swear(w.get("text", ""))]
    if isinstance(bleep, list):
        ids = {str(x) for x in bleep}
        return [w for w in words if w.get("id") in ids]
    return []


def spans(words: list[dict], bleep, pad: float = 0.03) -> list[tuple[float, float]]:
    """Output-time spans to bleep, a little wider than each word so its edges don't leak."""
    return sorted((max(0.0, float(w["start"]) - pad), float(w["end"]) + pad) for w in chosen(words, bleep))


def mask(text: str) -> str:
    """The first letter, then stars: "Fucking," -> "F******,"."""
    seen = False

    def star(m):
        nonlocal seen
        if seen:
            return "*"
        seen = True
        return m.group(0)
    return re.sub(r"[^\W\d_]", star, text)
