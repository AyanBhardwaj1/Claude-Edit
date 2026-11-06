"""Screen recordings / app screenshots "on a backdrop": the picture at 92% with rounded corners and a soft shadow.

  editor overlay frame OUT_DIR [--size 1920x1080 --scale 0.92 --radius 18 --backdrop "#f4f1e6"]
      -> OUT_DIR/frame_bg.png (backdrop + shadow) and OUT_DIR/frame_mask.png (rounded-rect alpha mask)
  editor overlay still SRC OUT.mp4 [--dur 4] [--z0 1 --z1 1.07 --fx .5 --fy .5] [--punch T Z X Y] [--start S]
      -> SRC (an image or a video) cover-fitted into the frame, slow Ken Burns z0 -> z1, optional punch-in that
         eases (smoothstep, 0.35 s) at T seconds to zoom Z centred on X/Y (fractions of the picture)

Proven on the Walk-Free demo (build.py `still()`); the video path is the same filter graph with the clip's frames.
"""
from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from ..util import EditorError, log, probe, run

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp", ".bmp")
DEFAULT_BACKDROP = "#f4f1e6"


def _even(v: float) -> int:
    return max(2, int(round(v / 2)) * 2)


def box(width: int = 1920, height: int = 1080, scale: float = 0.92) -> tuple[int, int, int, int]:
    """(x, y, w, h) of the inner picture: centred, scale of the frame, even sizes (1766x994 at 77,43 for 1080p)."""
    w, h = _even(width * scale), _even(height * scale)
    return (width - w) // 2, (height - h) // 2, w, h


def assets(out_dir: str | Path, width: int = 1920, height: int = 1080, scale: float = 0.92, radius: int = 18,
           backdrop: str = DEFAULT_BACKDROP, shadow: float = 0.18, shadow_blur: float = 30,
           shadow_offset: float = 24) -> dict:
    """Write frame_bg.png (backdrop + a soft shadow under the picture) and frame_mask.png (rounded-rect L mask at the
    picture size). Shadow blur/offset are for 1080 px and scale with the short side. Returns paths and the box."""
    from PIL import Image, ImageDraw, ImageFilter, ImageColor

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    x, y, w, h = box(width, height, scale)
    k = min(width, height) / 1080
    try:
        bg_rgb = ImageColor.getrgb(backdrop)[:3]
    except ValueError as e:
        raise EditorError(f"bad backdrop colour: {backdrop}") from e

    sh = Image.new("L", (width, height), 0)
    dy = round(shadow_offset * k)
    ImageDraw.Draw(sh).rounded_rectangle([x, y + dy, x + w - 1, y + dy + h - 1], radius=radius,
                                         fill=int(255 * shadow))
    sh = sh.filter(ImageFilter.GaussianBlur(shadow_blur * k))
    bg = Image.new("RGB", (width, height), bg_rgb)
    bg = Image.composite(Image.new("RGB", (width, height), (0, 0, 0)), bg, sh)

    ss = 4                                               # supersampled, so the corners are antialiased
    mask = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w * ss - 1, h * ss - 1], radius=radius * ss, fill=255)
    mask = mask.resize((w, h), Image.LANCZOS)

    bg.paste(bg_rgb, (x, y, x + w, y + h), mask)          # no shadow under the picture itself
    bg_path, mask_path = out_dir / "frame_bg.png", out_dir / "frame_mask.png"
    bg.save(bg_path)
    mask.save(mask_path)
    return {"bg": str(bg_path), "mask": str(mask_path), "x": x, "y": y, "w": w, "h": h}


def _zoom_exprs(n: int, fps: int, z0: float, z1: float, fx, fy, punch):
    """zoompan z/x/y expressions: linear z0 -> z1 over n frames, times a smoothstep punch-in at (t, zoom, fx, fy)."""
    z = f"({z0}+({z1}-{z0})*on/{n})"
    if punch:
        pt, pz, pfx, pfy = punch
        k = f"min(1,max(0,(on/{fps}-{pt})/0.35))"
        k = f"({k}*{k}*(3-2*{k}))"
        z = f"({z}*(1+({pz}-1)*{k}))"
        fx = f"({fx}+({pfx}-{fx})*{k})"
        fy = f"({fy}+({pfy}-{fy})*{k})"
    return z, fx, fy


def composite(src: str | Path, out: str | Path, dur: float | None = None, start: float = 0.0,
              width: int = 1920, height: int = 1080, fps: int = 30, z0: float = 1.0, z1: float = 1.07,
              fx: float = 0.5, fy: float = 0.5, punch: tuple[float, float, float, float] | None = None,
              scale: float = 0.92, radius: int = 18, backdrop: str = DEFAULT_BACKDROP,
              assets_dir: str | Path | None = None, crf: int = 14, audio: bool = False) -> Path:
    """A still image or a video, cover-fitted into the rounded frame on the backdrop, with Ken Burns (z0 -> z1 over
    the clip, focus fx/fy) and an optional punch-in punch=(t, zoom, fx, fy). Writes an H.264 mp4 (yuv420p).
    Images need `dur`; videos default to the rest of the clip after `start`. `audio` keeps a video's sound."""
    src, out = Path(src), Path(out)
    if not src.exists():
        raise EditorError(f"not found: {src}")
    is_image = src.suffix.lower() in IMAGE_EXT
    has_audio = False
    if is_image:
        if not dur:
            raise EditorError("a still needs --dur")
    else:
        info = probe(src)
        if not info.get("has_video"):
            raise EditorError(f"{src}: no video stream")
        has_audio = info.get("has_audio", False)
        dur = dur or max(0.0, info["duration"] - start)
    n = max(1, int(round(dur * fps)))
    with tempfile.TemporaryDirectory(prefix="frame_") as tmp:
        a = assets(assets_dir or tmp, width, height, scale, radius, backdrop)
        w, h = a["w"], a["h"]
        z, zx, zy = _zoom_exprs(n, fps, z0, z1, fx, fy, punch)
        pre = "" if is_image else f"fps={fps},"
        # 2x oversample before zoompan so its integer crop steps don't judder
        vf = (f"[1:v]{pre}scale={2 * w}:{2 * h}:force_original_aspect_ratio=increase:flags=lanczos,"
              f"crop={2 * w}:{2 * h},setsar=1,"
              f"zoompan=z='{z}':x='{zx}*(iw-iw/zoom)':y='{zy}*(ih-ih/zoom)':d=1:s={w}x{h}:fps={fps},format=rgba[s];"
              f"[2:v]format=gray,scale={w}:{h}[m];[s][m]alphamerge[sa];"
              f"[0:v][sa]overlay={a['x']}:{a['y']}:shortest=1,format=yuv420p[v]")
        loop = ["-loop", "1", "-framerate", str(fps), "-t", f"{dur}"]
        src_in = [*loop, "-i", str(src)] if is_image else ["-ss", f"{start}", "-t", f"{dur}", "-i", str(src)]
        keep_audio = audio and has_audio
        out.parent.mkdir(parents=True, exist_ok=True)
        run(["ffmpeg", "-y", *loop, "-i", a["bg"], *src_in, *loop, "-i", a["mask"], "-filter_complex", vf,
             "-map", "[v]", *(["-map", "1:a:0", "-c:a", "aac", "-b:a", "192k", "-t", f"{dur}"] if keep_audio else ["-an"]),
             "-frames:v", str(n), "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", "yuv420p",
             "-r", str(fps), "-movflags", "+faststart", str(out)])
    log(f"overlay: framed {src.name} -> {out} ({n} frames, {w}x{h} in {width}x{height})")
    return out


def _size(s: str) -> tuple[int, int]:
    try:
        w, h = s.lower().split("x")
        return int(w), int(h)
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"expected WxH, e.g. 1920x1080, got {s}") from e


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="editor overlay", description="framed screen recordings / screenshots")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("frame", "still"):
        p = sub.add_parser(name, help={"frame": "write frame_bg.png + frame_mask.png",
                                       "still": "an image or video on the backdrop with Ken Burns / punch-in"}[name])
        if name == "frame":
            p.add_argument("out_dir")
        else:
            p.add_argument("src", help="image or video")
            p.add_argument("out", help="output .mp4")
            p.add_argument("--dur", type=float, help="seconds (required for an image; video: rest of the clip)")
            p.add_argument("--start", type=float, default=0.0, help="video: source start time")
            p.add_argument("--fps", type=int, default=30)
            p.add_argument("--z0", type=float, default=1.0, help="Ken Burns start zoom")
            p.add_argument("--z1", type=float, default=1.07, help="Ken Burns end zoom")
            p.add_argument("--fx", type=float, default=0.5, help="focus x (0 left .. 1 right)")
            p.add_argument("--fy", type=float, default=0.5, help="focus y (0 top .. 1 bottom)")
            p.add_argument("--punch", type=float, nargs=4, metavar=("T", "ZOOM", "X", "Y"),
                           help="punch-in at T s to ZOOM, focus X/Y (eased over 0.35 s)")
            p.add_argument("--audio", action="store_true", help="keep the video's audio")
            p.add_argument("--crf", type=int, default=14)
        p.add_argument("--size", type=_size, default=(1920, 1080), help="frame size WxH (default 1920x1080)")
        p.add_argument("--scale", type=float, default=0.92, help="picture size as a fraction of the frame")
        p.add_argument("--radius", type=int, default=18, help="corner radius (px)")
        p.add_argument("--backdrop", default=DEFAULT_BACKDROP, help="backdrop colour")
    a = ap.parse_args(argv)
    w, h = a.size
    if a.cmd == "frame":
        r = assets(a.out_dir, w, h, a.scale, a.radius, a.backdrop)
        print(f"{r['bg']}\n{r['mask']}\npicture box: {r['w']}x{r['h']} at {r['x']},{r['y']}")
    else:
        composite(a.src, a.out, a.dur, a.start, w, h, a.fps, a.z0, a.z1, a.fx, a.fy, a.punch, a.scale, a.radius,
                  a.backdrop, crf=a.crf, audio=a.audio)
    return 0
