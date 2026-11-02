"""Pictures, GIFs and clips the user hands over in a note ("put this over my face when I say 'the ick'").

  editor attach meme.gif --project projects/<name>   -> projects/<name>/broll/attached/meme.mp4 (+ .attach.json)

Normalised so the renderer can use any of them: JPG/PNG copied; HEIC/HEIF, still GIF/WebP and BMP become
PNG; an animated GIF or WebP becomes a silent H.264 clip looped to at least 3 seconds; clips are copied.
Limits: pictures 25 MB, clips and GIFs 200 MB and 60 s. Then place it with a word anchor:
  {"path": "broll/attached/meme.mp4", "on": "the ick", "treatment": "full-frame"}
(over/instead of the face = full-frame, next to me = side-card, above my head = card-above-head).
"""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

from .util import EditorError, log, probe, save_json

PICTURES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif", ".bmp"}
CLIPS = {".mp4", ".mov", ".m4v", ".webm"}


def _animated(path: Path) -> bool:
    try:
        from PIL import Image
        with Image.open(path) as im:
            return getattr(im, "n_frames", 1) > 1
    except Exception:  # noqa: BLE001 (Pillow can't read it: ffmpeg decides below)
        return path.suffix.lower() == ".gif"


def attach(src: str | Path, project: str | Path, name: str | None = None) -> dict:
    src, project = Path(src).expanduser(), Path(project)
    ext = src.suffix.lower()
    if not src.exists():
        raise EditorError(f"{src} not found")
    if ext not in PICTURES | CLIPS:
        raise EditorError("That file type isn't supported. Use a picture (JPG, PNG, GIF, HEIC) or a short video (MP4, MOV).")
    size = src.stat().st_size
    dest_dir = project / "broll" / "attached"
    dest_dir.mkdir(parents=True, exist_ok=True)
    stem = re.sub(r"[^a-z0-9]+", "-", (name or src.stem).lower()).strip("-")[:40] or "attached"
    info: dict = {"name": src.name, "bytes": size}
    if ext in PICTURES and not (ext in (".gif", ".webp") and _animated(src)):
        if size > 25 * 1024 * 1024:
            raise EditorError("That picture is too big. Use one under 25 MB.")
        if ext in (".jpg", ".jpeg", ".png"):
            dest = dest_dir / f"{stem}{'.jpg' if ext == '.jpeg' else ext}"
            shutil.copy2(src, dest)
        else:
            dest = dest_dir / f"{stem}.png"
            try:
                from PIL import Image
                Image.open(src).convert("RGBA").save(dest)
            except Exception:  # noqa: BLE001 (HEIC without pillow-heif: let ffmpeg try)
                proc = subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-frames:v", "1", str(dest)])
                if proc.returncode != 0 or not dest.exists():
                    raise EditorError("I couldn't open that picture. Save it as JPG or PNG and try again.") from None
        info["kind"] = "image"
    else:
        if size > 200 * 1024 * 1024:
            raise EditorError("That file is too big. Use a clip or GIF under 200 MB.")
        dest = dest_dir / f"{stem}.mp4" if ext in (".gif", ".webp") else dest_dir / f"{stem}{ext}"
        if ext in (".gif", ".webp"):                  # animated: a silent H.264 clip, looped to >= 3 s
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-stream_loop", "-1", "-i", str(src), "-t", "60",
                            "-vf", "fps=30,scale='min(1920,iw)':-2:flags=lanczos,format=yuv420p", "-an",
                            "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", str(dest.with_suffix(".tmp.mp4"))],
                           check=True)
            one = probe(src)["duration"] or 0
            loop_to = max(3.0, one)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(dest.with_suffix(".tmp.mp4")), "-t",
                            f"{loop_to:.2f}", "-c", "copy", str(dest)], check=True)
            dest.with_suffix(".tmp.mp4").unlink()
            info["from_gif"] = True
        else:
            if (probe(src)["duration"] or 0) > 60.5:
                raise EditorError("That clip is too long. Use one that is 1 minute or shorter.")
            shutil.copy2(src, dest)
        p = probe(dest)
        info.update(kind="video", duration=round(p["duration"], 2), has_audio=p["has_audio"])
    v = probe(dest).get("video") or {}
    info.update(path=str(dest), width=v.get("width"), height=v.get("height"))
    save_json(dest.with_name(dest.name + ".attach.json"), info)
    log(f"attached {src.name} -> {dest}" + (" (plays silently)" if info.get("kind") == "video" else ""))
    return info
