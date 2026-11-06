"""editor compose: original music and SFX synthesized from scratch (numpy/scipy + ffmpeg), royalty-free.

  bed       a sectioned music bed (intro / groove / build / peak / breakdown / resolve / final chord)
            in a mood (warm, lofi, tense, uplifting), key and tempo, with the final chord landing
            exactly where the edit needs it (--end-chord-at) and silence at the very end
  lofi      a lo-fi loop (Rhodes, swung drums, vinyl crackle)
  riser     a rise into a hit (the hit lands at length - 0.2 s)
  sfx       whoosh, whoosh_rev, whip, click, pop, thud, shutter, paper, ding
  ambience  cicadas, birdsong, room

Music is mastered to -16 LUFS integrated, true peak <= -1.5 dBTP (ffmpeg loudnorm two-pass); SFX and
ambiences are peak-normalised. Every file gets a sidecar <file>.json (generator, "original": true,
licence, parameters, measured loudness). Ported from the Walk-Free demo's synth.

This module is import-light (argparse only); the synthesis lives in dsp / instruments / music / fx.
"""
from __future__ import annotations

import argparse
import shutil
import time
from pathlib import Path

MOOD_TO_LIBRARY = {"warm": "uplifting", "uplifting": "uplifting", "tense": "tense-dark", "lofi": "cool-fun"}
SFX_TO_LIBRARY = {"whoosh": "whoosh", "whoosh_rev": "whoosh", "whip": "whip", "click": "click", "pop": "pop",
                  "thud": "thud", "shutter": "shutter", "paper": "paper", "ding": "ding", "riser": "riser"}
SFX_NAMES = ["whoosh", "whoosh_rev", "whip", "click", "pop", "thud", "shutter", "paper", "ding"]
AMBIENCE_KINDS = ["cicadas", "birdsong", "room"]
MUSIC_MOODS = ["warm", "lofi", "tense", "uplifting"]


def _finish(x, out, kind: str, params: dict, lufs: float | None, tp: float, peak: float, extra: dict | None = None
            ) -> dict:
    from . import dsp
    from ..util import EditorError
    dur = len(x) / dsp.SR
    if lufs is not None:
        if dur < 0.5:
            raise EditorError(f"{kind}: {dur:.2f} s is too short for integrated loudness; use --peak")
        measured = dsp.master(x, out, lufs, tp)
        measured["target"] = {"lufs": lufs, "true_peak_max": tp}
    else:
        measured = dsp.peak_normalise(x, out, peak)
    measured["duration"] = round(dur, 3)
    measured["sample_rate"] = dsp.SR
    side = dsp.sidecar(out, kind, params, measured, extra)
    return {"path": str(out), "sidecar": str(side), "measured": measured, **(extra or {})}


def bed(length: float, bpm: float | None = None, key: str = "D", mode: str | None = None, mood: str = "warm",
        sections=None, seed: int = 7, out: str | Path = "bed.wav", end_chord_at: float | None = None,
        ring: float | None = None, snap: str = "bar", lufs: float = -16.0, tp: float = -1.5) -> dict:
    """Compose a music bed of `length` s. sections=None -> automatic structure on a bar grid; or a list like
    [{"at": 0, "name": "intro"}, {"at": 10.8, "name": "groove"}, ...] (snapped to `snap`: bar | beat | none).
    The final chord lands at end_chord_at (default length - ring; ring defaults to 1.5-6 s)."""
    from . import music
    t0 = time.time()
    x, plan = music.bed(length, bpm, key, mode, mood, sections, seed, end_chord_at, ring, snap)
    params = {"length": length, "bpm": plan["bpm"], "key": key, "mode": plan["mode"], "mood": mood, "seed": seed,
              "end_chord_at": plan["end_chord_at"], "ring": plan["ring"], "snap": snap,
              "sections_given": sections is not None}
    extra = {"sections": plan["sections"], "end_chord_at": plan["end_chord_at"], "bar": round(plan["bar"], 4),
             "grid_offset": plan["grid_offset"], "silent_from": plan["silent_from"]}
    info = _finish(x, out, "bed", params, lufs, tp, -1.5, extra)
    info["seconds"] = round(time.time() - t0, 1)
    return info


def lofi(length: float = 20.0, bpm: float = 86, key: str = "C", mode: str | None = None, seed: int = 7,
         out: str | Path = "lofi.wav", swing: float = 0.62, lufs: float = -16.0, tp: float = -1.5) -> dict:
    from . import music
    x, p = music.lofi(length, bpm, key, mode, seed, swing)
    params = {k: p[k] for k in ("length", "bpm", "key", "mode", "seed", "swing")}
    return _finish(x, out, "lofi", params, lufs, tp, -1.5)


def riser(length: float = 2.0, seed: int = 7, out: str | Path = "riser.wav", peak: float = -1.5,
          lufs: float | None = None, tp: float = -1.5) -> dict:
    from . import music
    x, p = music.riser(length, seed)
    return _finish(x, out, "riser", p, lufs, tp, peak, {"hit_at": p["hit_at"]})


def sfx(name: str, out: str | Path, seed: int = 7, length: float | None = None, key: str | None = None,
        peak: float | None = None, lufs: float | None = None, tp: float = -1.5) -> dict:
    from . import fx
    from ..util import EditorError
    if name not in fx.SFX:
        raise EditorError(f"unknown sfx '{name}' (have {', '.join(fx.SFX)})")
    x = fx.render_sfx(name, seed, length, key)
    params = {"name": name, "seed": seed, "length": length, "key": key}
    return _finish(x, out, f"sfx:{name}", params, lufs, tp, fx.SFX[name][1] if peak is None else peak)


def ambience(kind: str, length: float = 20.0, out: str | Path = "ambience.wav", seed: int = 7,
             peak: float | None = None, lufs: float | None = None, tp: float = -1.5) -> dict:
    from . import fx
    from ..util import EditorError
    if kind not in fx.AMBIENCES:
        raise EditorError(f"unknown ambience '{kind}' (have {', '.join(fx.AMBIENCES)})")
    x = fx.render_ambience(kind, length, seed)
    params = {"kind": kind, "length": length, "seed": seed}
    return _finish(x, out, f"ambience:{kind}", params, lufs, tp, fx.AMBIENCES[kind][1] if peak is None else peak)


def add_to_music_library(info: dict, mood: str, title: str, tags: list[str]) -> dict:
    """Copy a composed track (and its provenance sidecar) into library/music/<mood>/."""
    from .. import library
    track = library.music_add(info["path"], mood, tags=["original", "royalty-free", *tags], title=title,
                              notes="original composition (editor compose), royalty-free")
    side = Path(info["sidecar"])
    dest = library.ROOT / (track["file"] + ".json")
    if side.resolve() != dest.resolve():
        shutil.copy2(side, dest)
    return track


def add_to_sfx_library(info: dict, sfx_type: str) -> Path:
    """Copy a composed effect into library/sfx/<type>/ so auto sound design rotates it in."""
    from ..sfx import CACHE
    src = Path(info["path"])
    dest = CACHE / sfx_type / f"compose-{src.name}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    shutil.copy2(info["sidecar"], dest.with_name(dest.name + ".json"))
    return dest


# ---------------------------------------------------------------- command line

def add_arguments(p: argparse.ArgumentParser) -> None:
    sub = p.add_subparsers(dest="compose_cmd", required=True)

    def common(q, length_help: str, lufs_default):
        q.add_argument("-o", "--out", help="output .wav (48 kHz stereo 24-bit) + <out>.json (required)")
        q.add_argument("--length", type=float, help=length_help)
        q.add_argument("--bpm", type=float)
        q.add_argument("--key", help="D, F#, Bb, Am, ...")
        q.add_argument("--seed", type=int, default=7, help="same seed + params = same audio")
        q.add_argument("--lufs", type=float, default=lufs_default,
                       help="integrated loudness target (two-pass loudnorm)" +
                            (" (default -16)" if lufs_default is not None else "; default: peak-normalise"))
        q.add_argument("--tp", type=float, default=-1.5, help="max true peak dBTP with --lufs (default -1.5)")

    q = sub.add_parser("bed", help="a sectioned original music bed ending on a final chord")
    common(q, "seconds (e.g. video length - music start)", -16.0)
    q.add_argument("--mood", choices=MUSIC_MOODS, default="warm")
    q.add_argument("--mode", choices=["major", "minor", "harmonic"], help="default: from --key (Am) or the mood")
    q.add_argument("--end-chord-at", type=float, help="seconds: where the final chord lands (e.g. the end card)")
    q.add_argument("--ring", type=float, help="seconds the final chord rings before silence (default 1.5-6)")
    q.add_argument("--sections", help="'intro@0,groove@10.8,build@94.2,...', a JSON list or a .json file "
                                      "(names: intro groove fill groove2 lead build peak breakdown resolve)")
    q.add_argument("--snap", choices=["bar", "beat", "none"], default="bar", help="snap section times (default bar)")
    q.add_argument("--library", nargs="?", const="auto", metavar="MOOD",
                   help="also add it to the music library (default mood from --mood)")
    q.add_argument("--plan", action="store_true", help="print the section plan only, render nothing")

    q = sub.add_parser("lofi", help="a lo-fi loop: Rhodes, swung drums, vinyl crackle")
    common(q, "seconds (default 20)", -16.0)
    q.add_argument("--mode", choices=["major", "minor", "harmonic"])
    q.add_argument("--swing", type=float, default=0.62, help="0.5 = straight, 0.62 = lazy (default)")
    q.add_argument("--library", nargs="?", const="cool-fun", metavar="MOOD", help="also add it to the music library")

    q = sub.add_parser("riser", help="a rise into a hit at length - 0.2 s (with --bpm: one bar)")
    common(q, "seconds (default 2, or one bar at --bpm + 0.2)", None)
    q.add_argument("--peak", type=float, default=-1.5, help="peak dBFS (default -1.5)")
    q.add_argument("--library", action="store_true", help="also file it in library/sfx/riser/")

    q = sub.add_parser("sfx", help="an effect: " + ", ".join(SFX_NAMES))
    q.add_argument("name", choices=SFX_NAMES)
    common(q, "seconds (whoosh, whoosh_rev, whip, paper, ding stretch; others are fixed)", None)
    q.add_argument("--peak", type=float, help="peak dBFS (default per effect, -1.5 to -3)")
    q.add_argument("--library", action="store_true", help="also file it in library/sfx/<type>/ for auto sound design")

    q = sub.add_parser("ambience", help="a background bed: " + ", ".join(AMBIENCE_KINDS))
    q.add_argument("kind", choices=AMBIENCE_KINDS)
    common(q, "seconds (default 20)", None)
    q.add_argument("--peak", type=float, help="peak dBFS (default cicadas -9, birdsong -6, room -12)")

    sub.add_parser("list", help="moods, sections, effects and ambiences")


def _print(info: dict) -> None:
    m = info["measured"]
    level = (f"{m['lufs']} LUFS, true peak {m['true_peak']} dBTP" if "lufs" in m else f"peak {m['true_peak']} dBFS")
    print(f"{info['path']}  ({m['duration']} s, {m['sample_rate']} Hz, {level})")
    for s in info.get("sections", []):
        print(f"  {s['at']:8.2f}-{s['end']:8.2f}  {s['name']:<10} {s['bars']:g} bars")
    if "end_chord_at" in info:
        print(f"  final chord at {info['end_chord_at']} s, silent from {info['silent_from']} s"
              + (f"  [{info['seconds']} s to compose]" if "seconds" in info else ""))
    print(f"  provenance: {info['sidecar']}")


def run(args: argparse.Namespace) -> int:
    from ..util import log
    c = args.compose_cmd
    if c == "list":
        from . import fx, music
        print("moods:     " + ", ".join(f"{k} ({v['bpm']:g} bpm, {v['mode']})" for k, v in music.MOODS.items()))
        print("sections:  " + ", ".join(music.SECTION_NAMES))
        print("sfx:       " + "; ".join(f"{k}: {v[2]}" for k, v in fx.SFX.items()))
        print("ambience:  " + ", ".join(fx.AMBIENCES))
        return 0
    from ..util import EditorError
    if not args.out and not getattr(args, "plan", False):
        raise EditorError("give -o <file.wav>")
    import math
    for name, lo, hi in (("length", 0.1, 3600), ("bpm", 30, 300)):
        v = getattr(args, name, None)
        if v is not None and (not math.isfinite(v) or not lo <= v <= hi):
            raise EditorError(f"--{name} must be between {lo:g} and {hi:g} (got {v:g})")
    if c == "bed":
        if args.length is None:
            raise EditorError("bed needs --length (seconds)")
        sections = None
        if args.sections:
            from .music import parse_sections
            sections = parse_sections(args.sections)
        if args.plan:
            from .music import plan
            P = plan(args.length, args.bpm, args.mood, sections, args.end_chord_at, args.ring, args.snap)
            for s in P["sections"]:
                print(f"  {s['at']:8.2f}-{s['end']:8.2f}  {s['name']:<10} {s['bars']:g} bars")
            print(f"  final chord at {P['end_chord_at']} s (bar {P['bar']:.3f} s at {P['bpm']:g} bpm)")
            return 0
        info = bed(args.length, args.bpm, args.key or "D", args.mode, args.mood, sections, args.seed, args.out,
                   args.end_chord_at, args.ring, args.snap, args.lufs, args.tp)
        _print(info)
        if args.library:
            mood = MOOD_TO_LIBRARY[args.mood] if args.library == "auto" else args.library
            tags = [args.mood, f"{info['measured']['duration']:.0f}s"]
            t = add_to_music_library(info, mood, Path(args.out).stem, tags)
            log(f"compose: in the music library as {t['id']} [{mood}]")
    elif c == "lofi":
        info = lofi(args.length or 20.0, args.bpm or 86, args.key or "C", args.mode, args.seed, args.out, args.swing,
                    args.lufs, args.tp)
        _print(info)
        if args.library:
            t = add_to_music_library(info, args.library, Path(args.out).stem, ["lofi"])
            log(f"compose: in the music library as {t['id']} [{args.library}]")
    elif c == "riser":
        length = args.length or ((240.0 / args.bpm + 0.2) if args.bpm else 2.0)
        info = riser(length, args.seed, args.out, args.peak, args.lufs, args.tp)
        _print(info)
        if args.library:
            log(f"compose: filed as {add_to_sfx_library(info, 'riser')}")
    elif c == "sfx":
        info = sfx(args.name, args.out, args.seed, args.length, args.key, args.peak, args.lufs, args.tp)
        _print(info)
        if args.library:
            log(f"compose: filed as {add_to_sfx_library(info, SFX_TO_LIBRARY[args.name])}")
    elif c == "ambience":
        info = ambience(args.kind, args.length or 20.0, args.out, args.seed, args.peak, args.lufs, args.tp)
        _print(info)
    return 0


def main(argv=None) -> int:
    from ..util import EditorError, log
    ap = argparse.ArgumentParser(prog="editor compose", description=__doc__.split("\n\n")[0])
    add_arguments(ap)
    args = ap.parse_args(argv)
    try:
        return run(args)
    except EditorError as e:
        log(f"ERROR: {e}")
        return 1
