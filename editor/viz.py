"""Before/after rough-cut visualisation (PNG).

Draws the raw take and the cut on the same seconds-per-pixel scale: kept speech
green, removed material red and labelled "cut", plus silence/filler/retake stats.
Useful for checking the plan at a glance, and as a B-roll "card" in the reel itself.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .util import fmt_ts, load_json, log

BG, PANEL, TEXT, MUTED = (24, 24, 27), (39, 39, 42), (244, 244, 245), (161, 161, 170)
GREEN, RED, GAP = (34, 197, 94), (239, 68, 68), (63, 63, 70)
SILENCE_MIN = 0.15  # gaps shorter than this are just articulation, not silence


def silence_stats(transcript: dict, edl: dict) -> dict:
    words = sorted(transcript["words"], key=lambda w: (w["src"], w["start"]))
    raw = 0.0
    for src_i, src in enumerate(transcript["sources"]):
        ws = [w for w in words if w["src"] == src_i]
        if not ws:
            raw += src["duration"]
            continue
        raw += ws[0]["start"] + max(src["duration"] - ws[-1]["end"], 0)
        raw += sum(max(b["start"] - a["end"], 0) for a, b in zip(ws, ws[1:]) if b["start"] - a["end"] > SILENCE_MIN)
    after = 0.0
    speed = float(edl.get("speed", 1.0))
    for seg in edl["segments"]:
        ws = [w for w in words if w["src"] == seg["src"] and seg["start"] <= (w["start"] + w["end"]) / 2 <= seg["end"]]
        gaps = sum(max(b["start"] - a["end"], 0) for a, b in zip(ws, ws[1:]) if b["start"] - a["end"] > SILENCE_MIN)
        after += gaps / float(seg.get("speed", speed))
    reasons = [r["reason"] for r in edl.get("removed", [])]
    return {"silence_before": raw, "silence_after": after,
            "fillers": sum(1 for r in reasons if r == "filler"),
            "retakes": sum(1 for r in reasons if r.startswith("retake")),
            "source_seconds": sum(s["duration"] for s in transcript["sources"]),
            "output_seconds": sum((s["end"] - s["start"]) / float(s.get("speed", speed)) for s in edl["segments"])}


def _font(size: int, bold: bool = True):
    from PIL import ImageFont
    here = Path(__file__).resolve().parent.parent / "assets" / "fonts"
    for name in (["Montserrat-ExtraBold.ttf", "Montserrat-Bold.ttf"] if bold else ["Montserrat-Medium.ttf"]):
        if (here / name).exists():
            return ImageFont.truetype(str(here / name), size)
    if shutil.which("fc-match"):
        pattern = "Inter:weight=200" if bold else "Inter:weight=80"
        path = subprocess.run(["fc-match", "-f", "%{file}", pattern], capture_output=True, text=True).stdout
        if path:
            return ImageFont.truetype(path, size)
    for fallback in ("Arial Bold.ttf", "Arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(fallback, size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_viz(work_dir: str | Path, out: str | Path | None = None, title: str | None = None,
               width: int = 1600, height: int = 1000) -> Path:
    from PIL import Image, ImageDraw
    work = Path(work_dir)
    tr = load_json(work / "transcript.json")
    edl = load_json(work / "edl.json")
    st = silence_stats(tr, edl)
    out = Path(out or work / "rough_cut_viz.png")

    img = Image.new("RGB", (width, height), BG)
    d = ImageDraw.Draw(img)
    pad = 70
    d.rounded_rectangle((24, 24, width - 24, height - 24), radius=36, fill=PANEL)
    d.text((pad, 60), title or f"{work.parent.name}: rough cut", font=_font(44), fill=TEXT)
    d.text((pad, 118), "every pause, filler word and repeated line, found and cut", font=_font(26, False), fill=MUTED)

    bar_w = width - 2 * pad
    total = st["source_seconds"]
    pps = bar_w / total if total else 1

    def bar(y, label, seconds):
        d.text((pad, y), label, font=_font(28), fill=TEXT)
        d.text((pad + bar_w, y), f"{seconds:.1f}s", font=_font(28), fill=MUTED, anchor="ra")
        return y + 46

    # raw take
    y = bar(190, "RAW TAKE", total)
    h = 92
    d.rounded_rectangle((pad, y, pad + bar_w, y + h), radius=14, fill=GAP)
    offsets, acc = [], 0.0
    for s in tr["sources"]:
        offsets.append(acc)
        acc += s["duration"]
    for seg in edl["segments"]:
        x0 = pad + (offsets[seg["src"]] + seg["start"]) * pps
        x1 = pad + (offsets[seg["src"]] + seg["end"]) * pps
        d.rectangle((x0, y, max(x1, x0 + 2), y + h), fill=GREEN)
    for r in edl.get("removed", []):
        x0 = pad + (offsets[r["src"]] + r["start"]) * pps
        x1 = pad + (offsets[r["src"]] + r["end"]) * pps
        d.rectangle((x0, y, max(x1, x0 + 3), y + h), fill=RED)
        if x1 - x0 > 70:
            d.text(((x0 + x1) / 2, y + h / 2), "cut", font=_font(26), fill=TEXT, anchor="mm")
    y += h + 30
    for color, label in ((GREEN, "kept"), (RED, "filler / retake"), (GAP, "silence")):
        d.rounded_rectangle((pad, y + 4, pad + 26, y + 30), radius=6, fill=color)
        d.text((pad + 38, y), label, font=_font(24, False), fill=MUTED)
        pad += 250
    pad = 70

    # after the cut, same scale
    y = bar(y + 70, "AFTER THE CUT", st["output_seconds"])
    x = pad
    speed = float(edl.get("speed", 1.0))
    for seg in edl["segments"]:
        w = (seg["end"] - seg["start"]) / float(seg.get("speed", speed)) * pps
        d.rectangle((x, y, x + w, y + h), fill=GREEN)
        d.line((x + w, y, x + w, y + h), fill=PANEL, width=3)
        x += w
    y += h + 70

    # stats
    saved = 100 * (1 - st["output_seconds"] / total) if total else 0
    cards = [(f"{st['silence_before']:.1f}s → {st['silence_after']:.1f}s", "silence"),
             (str(st["fillers"]), "filler words cut"),
             (str(st["retakes"]), "retakes (kept the better take)"),
             (f"{saved:.0f}%", "shorter")]
    cw = (bar_w - 3 * 24) / 4
    for k, (big, small) in enumerate(cards):
        cx = pad + k * (cw + 24)
        d.rounded_rectangle((cx, y, cx + cw, y + 170), radius=20, fill=BG)
        d.text((cx + 28, y + 30), big, font=_font(46), fill=TEXT)
        d.text((cx + 28, y + 108), small, font=_font(22, False), fill=MUTED)
    d.text((70, height - 70), f"{fmt_ts(total)} raw → {fmt_ts(st['output_seconds'])} cut", font=_font(22, False),
           fill=MUTED)
    img.save(out)
    log(f"rough-cut viz: silence {st['silence_before']:.1f}s -> {st['silence_after']:.1f}s, "
        f"{st['fillers']} fillers, {st['retakes']} retakes -> {out}")
    return out
