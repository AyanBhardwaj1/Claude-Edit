"""Platform safe zones: does anything we put on screen sit under Instagram / TikTok / YouTube Shorts' own UI?

On a vertical post the platform draws over the video: the action buttons down the right side, the username,
caption and sound line at the bottom, a top bar. Captions or a hook title there get covered on the phone.

    editor safezone out/reel.mp4 --work projects/x/work [--platform reels|tiktok|shorts|all]

Captions are measured exactly: the reel's own captions.ass is rendered on black at low resolution and every caption
pixel is located over time, then compared with each platform's zones. A contact sheet draws the zones over real
frames (the worst moments first) to Read. Zones are approximate (from the platforms' creator guides; they move
between app versions), so a hit means "look", not "broken".
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

from .util import EditorError, log, probe

# (x0, y0, x1, y1) as 0-1 of a 9:16 frame, with what sits there
ZONES = {
    "reels": [((0.0, 0.0, 1.0, 0.09), "top bar"), ((0.88, 0.40, 1.0, 0.88), "like / comment / share buttons"),
              ((0.0, 0.79, 0.86, 1.0), "username, caption and audio line")],
    "tiktok": [((0.0, 0.0, 1.0, 0.07), "top tabs"), ((0.86, 0.36, 1.0, 0.84), "like / comment / share buttons"),
               ((0.0, 0.77, 0.84, 1.0), "username, caption and sound")],
    "shorts": [((0.0, 0.0, 1.0, 0.07), "top bar"), ((0.85, 0.42, 1.0, 0.88), "like / dislike / comment / share"),
               ((0.0, 0.80, 0.85, 1.0), "channel, title and sound")],
}
SCALE = (270, 480)            # caption pixels are located on a quarter-size render: plenty for zone overlaps


def caption_masks(ass: Path, size: tuple[int, int], duration: float, fps: float = 2.0) -> list[tuple[float, np.ndarray]]:
    """(time, boolean mask) of where caption pixels are, rendering the captions file alone on black."""
    from .render import _esc
    w, h = SCALE
    fonts = Path(__file__).resolve().parent.parent / "assets" / "fonts"
    vf = (f"scale={size[0]}:{size[1]},ass='{_esc(str(ass))}'" + (f":fontsdir='{_esc(str(fonts))}'" if fonts.exists() else "")
          + f",fps={fps},scale={w}:{h},format=gray")
    proc = subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"color=black:s=320x568:d={duration:.3f}",
                           "-vf", vf, "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True)
    if proc.returncode != 0:
        raise EditorError(f"couldn't render {ass.name} to measure captions: {proc.stderr.decode()[-300:]}")
    frames = np.frombuffer(proc.stdout, np.uint8)
    n = frames.size // (w * h)
    return [((k + 0.5) / fps, frames[k * w * h:(k + 1) * w * h].reshape(h, w) > 60) for k in range(n)]


def hits(masks: list[tuple[float, np.ndarray]], platform: str, min_share: float = 0.04) -> list[dict]:
    """Stretches where captions overlap a platform zone (at least min_share of that frame's caption pixels)."""
    out: list[dict] = []
    for (x0, y0, x1, y1), what in ZONES[platform]:
        run: dict | None = None
        for t, m in masks:
            total = int(m.sum())
            h, w = m.shape
            inside = int(m[int(y0 * h):int(np.ceil(y1 * h)), int(x0 * w):int(np.ceil(x1 * w))].sum())
            bad = total > 20 and inside / total >= min_share
            if bad and run is None:
                run = {"platform": platform, "zone": what, "from": round(t - 0.25, 2), "to": round(t + 0.25, 2),
                       "share": inside / total}
            elif bad:
                run["to"], run["share"] = round(t + 0.25, 2), max(run["share"], inside / total)
            elif run is not None:
                out.append(run)
                run = None
        if run is not None:
            out.append(run)
    for r in out:
        r["share"] = round(r["share"], 2)
    return sorted(out, key=lambda r: r["from"])


def draw_zones(img: np.ndarray, platform: str) -> np.ndarray:
    import cv2
    h, w = img.shape[:2]
    over = img.copy()
    for (x0, y0, x1, y1), _ in ZONES[platform]:
        cv2.rectangle(over, (int(x0 * w), int(y0 * h)), (int(x1 * w), int(y1 * h)), (40, 40, 230), -1)
    out = cv2.addWeighted(over, 0.35, img, 0.65, 0)
    for (x0, y0, x1, y1), _ in ZONES[platform]:
        cv2.rectangle(out, (int(x0 * w), int(y0 * h)), (int(x1 * w) - 1, int(y1 * h) - 1), (40, 40, 230), 2)
    return out


def sheet(video: Path, out: Path, platform: str, times: list[float], tile_w: int = 270) -> Path:
    import cv2
    info = probe(video)
    tile_h = int(round(tile_w * info["video"]["height"] / info["video"]["width"]))
    tiles = []
    for t in times[:8]:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(video), "-frames:v", "1",
                              "-vf", f"scale={tile_w}:{tile_h}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                             capture_output=True).stdout
        if len(raw) < tile_w * tile_h * 3:
            continue
        img = draw_zones(np.frombuffer(raw[:tile_w * tile_h * 3], np.uint8).reshape(tile_h, tile_w, 3).copy(), platform)
        cv2.putText(img, f"{t:.1f}s", (6, tile_h - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(img)
    if not tiles:
        raise EditorError(f"couldn't read frames from {video}")
    while len(tiles) % 4:
        tiles.append(np.zeros_like(tiles[0]))
    rows = [np.hstack(tiles[i:i + 4]) for i in range(0, len(tiles), 4)]
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), np.vstack(rows))
    return out


def check(video: str | Path, work: str | Path | None = None, platform: str = "all", sheets: bool = True) -> dict:
    video = Path(video)
    info = probe(video)
    w, h, dur = info["video"]["width"], info["video"]["height"], float(info["duration"])
    if w >= h:
        return {"video": str(video), "note": "not a vertical video: platform UI zones apply to 9:16 posts", "hits": []}
    plats = list(ZONES) if platform == "all" else [platform]
    work = Path(work) if work else video.parent.parent / "work"
    ass = work / "captions.ass"
    found: list[dict] = []
    if ass.exists():
        masks = caption_masks(ass, (w, h), dur)
        for pl in plats:
            found += hits(masks, pl)
    else:
        log(f"safezone: no {ass}: captions not measured, the sheet still shows the zones")
    spread = [dur * (k + 0.5) / 8 for k in range(8)]

    def moments(pl: str) -> list[float]:
        """This platform's own hits, worst (largest share of the text covered) first; else frames across the video."""
        mine = sorted((r for r in found if r["platform"] == pl), key=lambda r: -r["share"])
        return sorted({round((r["from"] + r["to"]) / 2, 2) for r in mine[:8]}) or spread
    made = {pl: str(sheet(video, video.with_name(f"{video.stem}_safezone_{pl}.png"), pl, moments(pl)))
            for pl in plats} if sheets else {}
    return {"video": str(video), "measured_captions": ass.exists(), "hits": found, "sheets": made}


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="editor safezone", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("--work", help="the project's work folder (for captions.ass); default: ../work next to the video")
    ap.add_argument("--platform", default="all", choices=["all", *ZONES])
    a = ap.parse_args(argv)
    rep = check(a.video, a.work, a.platform)
    for r in rep["hits"]:
        print(f"{r['platform']:<7} {r['from']:6.1f}-{r['to']:<6.1f} s  captions under the {r['zone']} "
              f"({round(100 * r['share'])}% of the text)")
    if not rep["hits"]:
        print(rep.get("note") or ("captions clear of every platform's UI" if rep.get("measured_captions")
                                  else "captions not measured (no captions.ass)"))
    for pl, s in rep.get("sheets", {}).items():
        print(f"sheet ({pl}): {s}")
    return 0
