"""Cover / thumbnail: pick the best frame and set the title on it.

Scores sampled frames by sharpness (variance of the Laplacian), a visible face and
open-eyed brightness, then draws the title large in the top third (Instagram shows the
centre 4:5 in the profile grid and TikTok/Shorts overlay UI at the bottom, so the title
stays high and centred). Writes cover.jpg plus cover_grid.jpg (the 4:5 crop the grid shows).
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from .util import log, probe
from .viz import _font


def cover(video: str | Path, out: str | Path, title: str = "", samples: int = 24, at: float | None = None,
          accent: str = "#FFE600", highlight: list[str] | None = None, work: str | Path | None = None,
          preset: str = "reels") -> Path:
    """With `work` (the project's work dir) frames come from the clean cut, reframed like the render,
    so the cover has no burned-in captions, hook title or overlays."""
    import cv2
    from PIL import Image, ImageDraw
    info = probe(video)
    v, dur = info["video"], info["duration"]
    w, h = v["width"], v["height"]
    times = [at] if at is not None else [dur * (k + 0.5) / samples for k in range(samples)]
    face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml") \
        if hasattr(cv2, "CascadeClassifier") else None
    best, best_score, best_t = None, -1.0, 0.0
    if work is not None:
        from .render import PRESETS, still
        w, h = PRESETS[preset]["size"]
    for t in times:
        if work is not None:
            img = still(work, t, preset)
        else:
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                                  "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True).stdout
            if len(raw) < w * h * 3:
                continue
            img = np.frombuffer(raw[:w * h * 3], np.uint8).reshape(h, w, 3)
        gray = cv2.cvtColor(cv2.resize(img, (w // 4, h // 4)), cv2.COLOR_BGR2GRAY)
        sharp = cv2.Laplacian(gray, cv2.CV_64F).var()
        faces = face.detectMultiScale(gray, 1.1, 5, minSize=(gray.shape[1] // 10,) * 2) if face is not None else []
        bright = 1 - abs(gray.mean() / 255 - 0.5)
        score = np.log1p(sharp) * bright * (1.6 if len(faces) else 1.0)
        if score > best_score:
            best, best_score, best_t = img, score, t
    if best is None:
        raise RuntimeError("could not read frames for the cover")
    pil = Image.fromarray(cv2.cvtColor(best, cv2.COLOR_BGR2RGB)).convert("RGBA")
    if title:
        d = ImageDraw.Draw(pil)
        size = int(w * 0.11)
        hl = {x.lower() for x in (highlight or [])}
        while True:  # wrap to <= 3 lines within 86% width, shrinking if needed
            f = _font(size)
            lines, cur = [], []
            for wd in title.split():
                trial = " ".join(cur + [wd])
                if cur and d.textlength(trial, font=f) > w * 0.86:
                    lines.append(cur)
                    cur = [wd]
                else:
                    cur.append(wd)
            lines.append(cur)
            if len(lines) <= 3 or size < w * 0.06:
                break
            size = int(size * 0.9)
        y = h * 0.17
        for line in lines:
            lw = d.textlength(" ".join(line), font=f)
            x = (w - lw) / 2
            for wd in line:
                color = accent if wd.lower().strip(".,!?") in hl else "#FFFFFF"
                d.text((x, y), wd, font=f, fill=color, stroke_width=max(4, int(size * 0.09)), stroke_fill="#000000")
                x += d.textlength(wd + " ", font=f)
            y += size * 1.12
    out = Path(out)
    rgb = pil.convert("RGB")
    rgb.save(out, quality=95)
    gh = int(w * 5 / 4)
    if gh < h:
        top = (h - gh) // 2
        rgb.crop((0, top, w, top + gh)).save(out.with_name(out.stem + "_grid.jpg"), quality=92)
    log(f"cover from {best_t:.2f}s -> {out}")
    return out
