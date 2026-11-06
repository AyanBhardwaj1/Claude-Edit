"""Effort: trade time for quality on purpose, and learn how long things really take on this machine.

Three efforts, the same everywhere (editor auto, the skills, and Cutmind's Fast / Balanced / Best):
  rush      a deadline is close: the fewest passes that still deliver a correct, watchable video
  standard  the default: the full workflow with up to 3 self-review passes
  polish    time for quality: slower encode, finer tracking, a bigger transcription model, every review,
            plus a critic sub-agent (skill level)

`editor auto --budget 10` picks the best effort whose estimate fits the time (in minutes), using timings
learned from every earlier run on this machine (`library/style/timings.json`, an exponential moving average
per stage and effort, scaled by minutes of media). Each run records what each stage really took, so the
estimates get better with every video. Productions run by hand (overlay renders, screen captures, composites)
record their own stages with `editor effort record` so they're planned better next time too.
"""
from __future__ import annotations

import json
import os
import platform
from datetime import date
from pathlib import Path

from .util import EditorError, log

EFFORTS = ("rush", "standard", "polish")
ALIASES = {"fast": "rush", "quick": "rush", "draft": "rush", "balanced": "standard", "normal": "standard",
           "best": "polish", "quality": "polish", "max": "polish"}

# What each effort changes in `editor auto` (and what the skills do around it).
PROFILE = {
    "rush": dict(model="base", track_fps=2.0, encode="veryfast", crf_delta=1, review=False, cover=False,
                 drafts=0, passes=1, critic=False,
                 what="one pass: base transcription model, light face tracking, fast encode, spec check + contact "
                      "sheet only (no per-cut review or cover), no draft renders, 1 fix pass"),
    "standard": dict(model="small", track_fps=5.0, encode="slow", crf_delta=0, review=True, cover=True,
                     drafts=2, passes=3, critic=False,
                     what="the full workflow: small model, face tracking, slow encode, check + review of every cut + "
                          "cover, up to 2 drafts and 3 fix passes"),
    "polish": dict(model="medium", track_fps=8.0, encode="slower", crf_delta=-1, review=True, cover=True,
                   drafts=2, passes=3, critic=True,
                   what="everything in standard plus a bigger transcription model, finer face tracking, a slower, "
                        "higher-quality encode and a critic sub-agent roast before delivery"),
}

# Built-in priors, seconds of work per minute of media, before this machine has taught us anything.
# auto stages scale with source minutes (transcribe, plan, cut) or output minutes (the rest).
PRIORS = {
    "transcribe": 35.0, "plan": 3.0, "cut": 20.0, "audio": 12.0, "track": 15.0, "captions": 1.0,
    "render": 95.0, "check": 30.0,
    # hand-run productions (editor effort record): per minute of the finished video
    "capture": 120.0,     # app screenshots / screen captures (slow without a GPU); `capture shots` records
                          # itself with 1 shot = 5 s of media
    "pieces": 75.0,       # per-shot clips: framing, Ken Burns, speed changes
    "overlay": 57.0,      # editor overlay render (measured: 176 s video in 166 s at -j 3)
    "mix": 10.0,          # audio mix + loudnorm
    "composite": 45.0,    # final picture + overlay + audio encode at 16 Mbps (measured: 176 s in 133 s)
}
# How each effort scales a stage before it has its own measurements.
SCALE = {
    "rush": {"transcribe": 0.6, "track": 0.45, "render": 0.55, "check": 0.35,
             "capture": 0.5, "pieces": 0.6, "overlay": 0.7, "composite": 0.6},
    "standard": {},
    "polish": {"transcribe": 2.2, "track": 1.5, "render": 1.8, "check": 1.0,
               "capture": 1.5, "pieces": 1.3, "overlay": 1.2, "composite": 1.8},
}
AUTO_STAGES = ["transcribe", "plan", "cut", "audio", "track", "captions", "render", "check"]
ALPHA = 0.4            # weight of a new measurement in the moving average
FIT = 0.85             # plan to finish inside 85% of the budget: leave room for looking and one fix

ROOT = Path(os.environ.get("CLAUDE_EDIT_STYLE", Path(__file__).resolve().parent.parent / "library" / "style"))


def normalise(effort: str | None) -> str | None:
    if effort is None:
        return None
    e = ALIASES.get(effort.lower(), effort.lower())
    if e not in EFFORTS:
        raise EditorError(f"unknown effort '{effort}' (rush, standard, polish; or fast, balanced, best)")
    return e


def machine() -> str:
    """Timings depend on the machine: key them by OS, CPU count and whether there's a GPU encoder."""
    return f"{platform.system().lower()}-{platform.machine()}-{os.cpu_count() or 1}cpu"


def _path() -> Path:
    return ROOT / "timings.json"


def load() -> dict:
    p = _path()
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            log(f"timings: {p} is not valid JSON, starting fresh")
    return {"version": 1, "machines": {}}


def save(data: dict) -> None:
    _path().parent.mkdir(parents=True, exist_ok=True)
    _path().write_text(json.dumps(data, indent=1, sort_keys=True) + "\n")


def record(stage: str, effort: str, seconds: float, media_seconds: float, data: dict | None = None) -> float:
    """Fold one measurement in; returns the new seconds-per-media-minute rate."""
    if seconds < 0 or media_seconds <= 0:
        raise EditorError("record needs a positive media length and non-negative seconds")
    own = data is None
    data = data or load()
    effort = normalise(effort) or "standard"
    rate = seconds / (media_seconds / 60.0)
    stages = data.setdefault("machines", {}).setdefault(machine(), {})
    entry = stages.setdefault(f"{stage}:{effort}", {"rate": rate, "runs": 0})
    entry["rate"] = round(rate if entry["runs"] == 0 else (1 - ALPHA) * entry["rate"] + ALPHA * rate, 3)
    entry["runs"] += 1
    entry["last"] = date.today().isoformat()
    if own:
        save(data)
    return entry["rate"]


def rate(stage: str, effort: str, data: dict | None = None) -> tuple[float, bool]:
    """Seconds per media minute for a stage at an effort, and whether it was learned on this machine."""
    data = data or load()
    stages = data.get("machines", {}).get(machine(), {})
    hit = stages.get(f"{stage}:{effort}")
    if hit:
        return hit["rate"], True
    base = stages.get(f"{stage}:standard")          # learned at standard: scale it like a prior
    r = base["rate"] if base else PRIORS.get(stage, 10.0)
    return r * SCALE[effort].get(stage, 1.0), bool(base)


def estimate(effort: str, media_seconds: float, stages: list[str] | None = None,
             data: dict | None = None) -> dict:
    effort = normalise(effort) or "standard"
    data = data or load()
    stages = stages or AUTO_STAGES
    out, total, learned = {}, 0.0, 0
    for s in stages:
        r, was = rate(s, effort, data)
        secs = r * media_seconds / 60.0
        out[s] = round(secs, 1)
        total += secs
        learned += was
    return {"effort": effort, "stages": out, "seconds": round(total, 1), "learned": learned, "of": len(stages)}


def choose(budget_minutes: float, media_seconds: float, stages: list[str] | None = None,
           data: dict | None = None) -> tuple[str, list[dict], bool]:
    """The best effort whose estimate fits FIT x budget. Returns (effort, all estimates, fits)."""
    data = data or load()
    ests = [estimate(e, media_seconds, stages, data) for e in EFFORTS]
    limit = budget_minutes * 60.0 * FIT
    fitting = [e for e in ests if e["seconds"] <= limit]
    if fitting:
        return fitting[-1]["effort"], ests, True
    return "rush", ests, False


def fmt_secs(s: float) -> str:
    return f"{s:.0f} s" if s < 90 else f"{s / 60:.1f} min"


def table(media_seconds: float, stages: list[str] | None = None, budget_minutes: float | None = None) -> str:
    data = load()
    lines = [f"Estimates for {media_seconds:.0f} s of media on {machine()}:"]
    pick, _, fits = choose(budget_minutes, media_seconds, stages, data) if budget_minutes else (None, None, True)
    for e in EFFORTS:
        est = estimate(e, media_seconds, stages, data)
        mark = ""
        if e == pick:
            mark = "  <- best that fits your budget" if fits else \
                "  <- nothing fits: rush, draft first, drop optional shots and graphics"
        src = f"learned {est['learned']}/{est['of']} stages" if est["learned"] else "built-in guesses"
        lines.append(f"  {e:<9} about {fmt_secs(est['seconds']):>8}  ({src}){mark}")
        lines.append(f"            {PROFILE[e]['what']}")
    return "\n".join(lines)
