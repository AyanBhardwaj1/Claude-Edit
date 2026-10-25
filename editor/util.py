"""Shared helpers: running ffmpeg, probing media, small JSON/time utilities."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from fractions import Fraction
from pathlib import Path

HDR_TRANSFERS = {"arib-std-b67", "smpte2084"}


class EditorError(RuntimeError):
    pass


def require_bin(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise EditorError(f"`{name}` not found on PATH. Run ./setup.sh or install ffmpeg.")
    return path


def run(cmd: list[str], quiet: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    """Run a command, raising EditorError with stderr tail on failure."""
    cmd = [str(c) for c in cmd]
    if cmd[0] == "ffmpeg" and quiet:
        cmd = [cmd[0], "-hide_banner", "-loglevel", "error", "-nostdin", *cmd[1:]]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        tail = "\n".join(proc.stderr.strip().splitlines()[-25:])
        raise EditorError(f"Command failed ({proc.returncode}): {' '.join(cmd[:8])} ...\n{tail}")
    return proc


def probe(path: str | Path) -> dict:
    """Return a compact description of a media file (display size accounts for rotation)."""
    require_bin("ffprobe")
    out = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)]).stdout
    data = json.loads(out)
    info: dict = {"path": str(path), "duration": float(data["format"].get("duration", 0) or 0)}
    v = next((s for s in data["streams"] if s["codec_type"] == "video" and s.get("disposition", {}).get("attached_pic") != 1), None)
    a = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    info["has_audio"] = a is not None
    info["has_video"] = v is not None
    if a:
        info["audio"] = {"codec": a.get("codec_name"), "sample_rate": int(a.get("sample_rate", 0) or 0),
                         "channels": a.get("channels")}
    if v:
        w, h = int(v["width"]), int(v["height"])
        rotation = 0
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rotation = int(sd["rotation"])
        if "rotate" in v.get("tags", {}):
            rotation = int(v["tags"]["rotate"])
        if abs(rotation) % 180 == 90:
            w, h = h, w
        fps = _parse_rate(v.get("avg_frame_rate")) or _parse_rate(v.get("r_frame_rate")) or Fraction(30)
        info["video"] = {
            "codec": v.get("codec_name"), "width": w, "height": h, "rotation": rotation,
            "fps": float(fps), "fps_str": f"{fps.numerator}/{fps.denominator}",
            "pix_fmt": v.get("pix_fmt"), "profile": v.get("profile"),
            "color_transfer": v.get("color_transfer"), "color_primaries": v.get("color_primaries"),
            "color_space": v.get("color_space"),
            "bit_rate": int(v.get("bit_rate", 0) or data["format"].get("bit_rate", 0) or 0),
        }
        info["video"]["hdr"] = info["video"]["color_transfer"] in HDR_TRANSFERS
    return info


def _parse_rate(rate: str | None) -> Fraction | None:
    if not rate or rate in ("0/0", "0"):
        return None
    try:
        f = Fraction(rate)
    except (ValueError, ZeroDivisionError):
        return None
    return f if f > 0 else None


def normalize_fps(fps: float) -> Fraction:
    """Snap measured (often VFR) phone frame rates to the nearest standard rate, capped at 60."""
    standards = [Fraction(24000, 1001), Fraction(24), Fraction(25), Fraction(30000, 1001), Fraction(30),
                 Fraction(50), Fraction(60000, 1001), Fraction(60)]
    fps = min(fps, 60.0)
    return min(standards, key=lambda s: abs(float(s) - fps))


def load_json(path: str | Path) -> dict:
    return json.loads(Path(path).read_text())


def save_json(path: str | Path, data) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    return path


def fmt_ts(t: float) -> str:
    m, s = divmod(max(t, 0.0), 60)
    return f"{int(m):02d}:{s:05.2f}"


def log(msg: str) -> None:
    print(f"[editor] {msg}", file=sys.stderr, flush=True)
