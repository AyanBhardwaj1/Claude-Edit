"""Self-review of a render, before anyone else sees it (video-use's self-eval step).

inspect  filmstrip + waveform + word labels for any time range. Uses video-use's own
         timeline_view.py helper (vendored in .claude/skills/video-use/helpers/).
review   checks every cut boundary of the rendered output:
           - audio click: sample-to-sample jump at the cut far above the local level
           - flash / black frame: one frame whose brightness jumps away from both neighbours
           - mid-word cut: the boundary falls inside a transcript word
         and writes review sheets (frame before | frame after | waveform per cut) for Claude to
         read, plus review.json with every issue and its timecode.
Cap: if issues remain after 3 fix-and-rerender passes, report them instead of looping.
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

from .util import fmt_ts, load_json, log, probe, run, save_json

TIMELINE_VIEW = Path(__file__).resolve().parent.parent / ".claude" / "skills" / "video-use" / "helpers" / "timeline_view.py"


def inspect(video: str | Path, start: float, end: float, out: str | Path, transcript: str | Path | None = None,
            n_frames: int = 10) -> Path:
    cmd = [sys.executable, str(TIMELINE_VIEW), str(video), f"{start}", f"{end}", "-o", str(out),
           "--n-frames", str(n_frames)]
    if transcript:
        cmd += ["--transcript", str(transcript)]
    run(cmd)
    log(f"timeline view {fmt_ts(start)}-{fmt_ts(end)} -> {out}")
    return Path(out)


def _audio(path: Path, sr: int = 48000) -> np.ndarray:
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(sr),
                           "-f", "f32le", "-"], capture_output=True)
    return np.frombuffer(proc.stdout, np.float32)


def _luma_series(path: Path, fps: float) -> np.ndarray:
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", "scale=64:-2,format=gray",
                           "-f", "rawvideo", "-"], capture_output=True)
    info = probe(path)["video"]
    h = int(round(64 * info["height"] / info["width"] / 2) * 2)
    n = len(proc.stdout) // (64 * h)
    return np.frombuffer(proc.stdout[:n * 64 * h], np.uint8).reshape(n, h * 64).mean(axis=1)


def _covered_faces(video: Path, work: Path, meta: dict) -> list[dict]:
    """Hard rule from both vendored skills: never cover a face. For every card/overlay window and
    step pill, if the speaker's face is visible in the clean reframed frame but not in the render,
    something is sitting on it."""
    try:
        import cv2
    except ImportError:
        return []
    if not hasattr(cv2, "CascadeClassifier") or not (work / "track.json").exists():
        return []
    from .render import still
    edl = load_json(meta["edl"]) if Path(meta["edl"]).exists() else {}
    det = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
    v = probe(video)["video"]
    preset = next((k for k, pr in __import__("editor.render", fromlist=["PRESETS"]).PRESETS.items()
                   if tuple(pr["size"]) == (v["width"], v["height"])), "reels")
    checks = [(float(b["start"]) + float(b["dur"]) / 2, f"{b.get('mode', 'full')} {Path(b['path']).name}")
              for b in edl.get("broll", []) if b.get("mode") in ("card", "overlay")]
    checks += [(float(c["start"]) + 0.6, f"pill '{c['text']}'") for c in edl.get("chapters", []) or []]

    def faces(img):
        g = cv2.cvtColor(cv2.resize(img, (img.shape[1] // 3, img.shape[0] // 3)), cv2.COLOR_BGR2GRAY)
        return len(det.detectMultiScale(cv2.equalizeHist(g), 1.1, 4, minSize=(g.shape[1] // 12,) * 2))
    out = []
    for t, what in checks:
        if t >= meta["duration"]:
            continue
        clean = still(work, t, preset)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                              "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True).stdout
        if len(raw) < v["width"] * v["height"] * 3:
            continue
        rendered = np.frombuffer(raw[:v["width"] * v["height"] * 3], np.uint8).reshape(v["height"], v["width"], 3)
        if faces(clean) and not faces(rendered):
            out.append({"t": round(t, 3), "kind": "face-covered", "detail": f"{what} hides the speaker's face"})
    return out


def review(video: str | Path, work_dir: str | Path, out_dir: str | Path | None = None) -> dict:
    from PIL import Image, ImageDraw
    from .viz import _font
    video, work = Path(video), Path(work_dir)
    out_dir = Path(out_dir or video.parent / "review")
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = load_json(work / "cut_meta.json")
    fps = meta["fps"]
    cuts = [seg["start"] for seg in meta["timeline"][1:]]
    sr = 48000
    audio = _audio(video, sr)
    luma = _luma_series(video, fps)
    words = load_json(work / "cut_words.json")["words"] if (work / "cut_words.json").exists() else []
    issues, rows = [], []
    from .transitions import expand
    edl = load_json(meta["edl"]) if Path(meta["edl"]).exists() else {}
    designed = [(tr["at"] - tr["dur"] / 2 - 0.05, tr["at"] + tr["dur"] / 2 + 0.05)
                for tr in expand(edl, meta["duration"], meta["timeline"])]
    for b in edl.get("broll", []):     # b-roll that whips or slides in/out jumps on purpose
        for side, at in (("in", float(b["start"])), ("out", float(b["start"]) + float(b["dur"]))):
            if b.get(side):
                designed.append((at - 0.25, at + 0.4))
    for t in cuts:
        i = int(t * sr)
        win = audio[max(0, i - int(0.02 * sr)):i + int(0.02 * sr)]
        ctx = audio[max(0, i - int(0.3 * sr)):i + int(0.3 * sr)]
        jump = float(np.max(np.abs(np.diff(win)))) if len(win) > 2 else 0.0
        typical = float(np.percentile(np.abs(np.diff(ctx)), 99.5)) if len(ctx) > 2 else 0.0
        if jump > 0.05 and jump > 3 * typical:
            issues.append({"t": round(t, 3), "kind": "audio-click", "detail": f"jump {jump:.3f} vs {typical:.3f}"})
        f = int(round(t * fps))
        for k in (f - 1, f, f + 1):
            if 1 <= k < len(luma) - 1:
                d = min(abs(luma[k] - luma[k - 1]), abs(luma[k] - luma[k + 1]))
                if d > 40 and not any(lo <= k / fps <= hi for lo, hi in designed):
                    issues.append({"t": round(k / fps, 3), "kind": "flash-frame", "detail": f"luma jump {d:.0f}"})
        inside = [w for w in words if w["start"] + 0.04 < t < w["end"] - 0.04]
        if inside:
            issues.append({"t": round(t, 3), "kind": "mid-word", "detail": f"cut inside '{inside[0]['text']}'"})
        rows.append(t)

    issues += _covered_faces(video, work, meta)

    # review sheets: per cut, the frame before, the frame after, and the waveform around it
    tw, th = 270, int(270 * probe(video)["video"]["height"] / probe(video)["video"]["width"])
    per_sheet, sheets = 6, []
    font = _font(20, False)
    for s0 in range(0, len(rows), per_sheet):
        chunk = rows[s0:s0 + per_sheet]
        sheet = Image.new("RGB", (tw * 2 + 520, len(chunk) * (th + 12) + 12), (20, 20, 24))
        d = ImageDraw.Draw(sheet)
        with tempfile.TemporaryDirectory() as tmp:
            for r, t in enumerate(chunk):
                y = 12 + r * (th + 12)
                for c, tt in enumerate((max(t - 1 / fps, 0), t + 0.5 / fps)):
                    png = Path(tmp) / f"{r}_{c}.png"
                    run(["ffmpeg", "-y", "-ss", f"{tt:.3f}", "-i", str(video), "-frames:v", "1", "-vf",
                         f"scale={tw}:{th}", str(png)])
                    sheet.paste(Image.open(png).convert("RGB"), (c * tw, y))
                seg = audio[max(0, int((t - 1.0) * sr)):int((t + 1.0) * sr)]
                x0, wv = tw * 2 + 12, 496
                if len(seg):
                    step = max(1, len(seg) // wv)
                    env = np.abs(seg[:step * wv].reshape(-1, step)).max(axis=1)
                    for k, v in enumerate(env):
                        hh = v * (th - 40) / 2
                        d.line((x0 + k, y + th / 2 - hh, x0 + k, y + th / 2 + hh), fill=(120, 170, 255))
                d.line((x0 + wv / 2, y, x0 + wv / 2, y + th), fill=(255, 90, 0), width=2)
                bad = [i for i in issues if abs(i["t"] - t) < 0.06]
                d.text((x0, y + 4), f"cut {s0 + r + 1} @ {fmt_ts(t)}" + (f"  !! {bad[0]['kind']}" if bad else "  ok"),
                       font=font, fill=(255, 90, 90) if bad else (200, 200, 205))
        path = out_dir / f"review_{s0 // per_sheet + 1}.png"
        sheet.save(path)
        sheets.append(str(path))
    report = {"video": str(video), "cuts": len(cuts), "issues": issues, "sheets": sheets,
              "passed": not issues}
    save_json(out_dir / "review.json", report)
    log(f"review: {len(cuts)} cuts, {len(issues)} issue(s); read {', '.join(Path(s).name for s in sheets) or 'no sheets'}")
    for i in issues:
        log(f"  {fmt_ts(i['t'])}  {i['kind']}: {i['detail']}")
    return report
