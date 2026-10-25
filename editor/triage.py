"""Triage every clip in a project's raw/ folder.

For each clip it measures how much of it has a face on screen and how much has
voice-level audio, proposes a role, and makes a contact sheet so Claude can
confirm by looking:

  a-roll           founder-to-camera: goes into the edit (transcribed and cut)
  broll-reusable   good for other reels too: copy into library/broll/
  broll-oneoff     only for this reel: copy into the project's broll/

Writes work/triage.json. `auto` only transcribes clips whose role is a-roll.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import numpy as np

from .util import load_json, log, probe, run, save_json

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts"}
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".heic"}


def _face_ratio(path: Path, duration: float) -> float:
    try:
        import cv2
        from .track import _make_detector
    except ImportError:
        return 0.0
    fps = min(1.0, 20 / max(duration, 1))
    w, h = 480, 270
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path), "-vf",
                           f"fps={fps},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}",
                           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True)
    n = len(proc.stdout) // (w * h * 3)
    if not n:
        return 0.0
    try:
        detect = _make_detector(cv2, w, h, None)
    except Exception:
        return 0.0
    hits = sum(bool(detect(np.frombuffer(proc.stdout[i * w * h * 3:(i + 1) * w * h * 3], np.uint8).reshape(h, w, 3)))
               for i in range(n))
    return hits / n


def _voice_ratio(path: Path, duration: float) -> float:
    out = run(["ffmpeg", "-i", str(path), "-map", "0:a:0", "-af", "highpass=f=120,lowpass=f=4000,"
               "silencedetect=noise=-38dB:d=0.4", "-f", "null", "-"], quiet=False).stderr
    silent = sum(float(x) for x in re.findall(r"silence_duration: ([\d.]+)", out))
    return max(0.0, 1 - silent / duration) if duration else 0.0


def triage(project: str | Path) -> Path:
    from .qa import sheet
    project = Path(project)
    raw = project / "raw"
    work = project / "work"
    sheets = work / "triage"
    sheets.mkdir(parents=True, exist_ok=True)
    previous = {c["file"]: c for c in load_json(work / "triage.json")["clips"]} if (work / "triage.json").exists() else {}
    clips = []
    for f in sorted(raw.iterdir()):
        ext = f.suffix.lower()
        if ext in IMAGE_EXT:
            clips.append({"file": f.name, "kind": "image", "role": previous.get(f.name, {}).get("role", "broll-oneoff"),
                          "suggested": "broll-oneoff", "why": "still image"})
            continue
        if ext not in VIDEO_EXT:
            continue
        info = probe(f)
        dur = info["duration"]
        face = _face_ratio(f, dur)
        voice = _voice_ratio(f, dur) if info["has_audio"] else 0.0
        if face >= 0.5 and voice >= 0.35:
            role, why = "a-roll", "face on screen and talking"
        elif voice >= 0.6 and face < 0.2:
            role, why = "a-roll", "voice-over / talking without a visible face: check the sheet"
        else:
            role, why = "broll-oneoff", "no talking head; decide reusable vs one-off"
        sheet_path = sheets / f"{f.stem}.png"
        try:
            sheet(f, sheet_path, count=8, width=1200)
        except Exception as e:  # a broken clip shouldn't stop triage of the rest
            log(f"triage: no sheet for {f.name}: {e}")
        v = info.get("video", {})
        clips.append({"file": f.name, "kind": "video", "duration": round(dur, 2),
                      "size": f"{v.get('width')}x{v.get('height')}", "face": round(face, 2), "voice": round(voice, 2),
                      "suggested": role, "role": previous.get(f.name, {}).get("role", role), "why": why,
                      "sheet": str(sheet_path)})
        log(f"triage: {f.name}: face {face:.0%}, voice {voice:.0%} -> {role}")
    path = save_json(work / "triage.json", {"clips": clips})
    log(f"wrote {path}; Read each sheet, fix 'role' where wrong, then copy b-roll (see broll-library skill)")
    return path


def a_roll(project: str | Path) -> list[Path] | None:
    """Clips to transcribe, per triage.json; None when the project has not been triaged."""
    project = Path(project)
    t = project / "work" / "triage.json"
    if not t.exists():
        return None
    return [project / "raw" / c["file"] for c in load_json(t)["clips"] if c["role"] == "a-roll"]
