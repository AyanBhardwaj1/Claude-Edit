"""Quality checks and visual review.

check  -> verifies the export against the platform preset (size, fps, codec,
          duration, loudness, true peak) and prints a pass/warn report.
sheet  -> contact sheet PNG of evenly spaced frames, so Claude can *look* at the
          edit (crop, captions, B-roll) with its image-reading tool before delivery.
"""
from __future__ import annotations

from pathlib import Path

from .audio import measure_loudness
from .render import PRESETS
from .util import fmt_ts, log, probe, run, save_json


def check(path: str | Path, preset: str = "reels", target_lufs: float = -14.0) -> dict:
    info = probe(path)
    v = info.get("video", {})
    p = PRESETS[preset]
    loud = measure_loudness(path) if info["has_audio"] else {}
    results = []

    def add(name, ok, detail):
        results.append({"check": name, "ok": bool(ok), "detail": detail})

    add("resolution", (v.get("width"), v.get("height")) == tuple(p["size"]),
        f"{v.get('width')}x{v.get('height')} (want {p['size'][0]}x{p['size'][1]})")
    add("codec", v.get("codec") == "h264" and v.get("pix_fmt") == "yuv420p", f"{v.get('codec')} {v.get('pix_fmt')}")
    add("fps", 23.9 <= v.get("fps", 0) <= 60.01, f"{v.get('fps', 0):.3f}")
    add("color", v.get("color_primaries") in ("bt709", None) and not v.get("hdr"),
        f"primaries={v.get('color_primaries')} transfer={v.get('color_transfer')}")
    dur = info["duration"]
    add("duration", p["max_seconds"] is None or dur <= p["max_seconds"],
        f"{dur:.2f}s" + (f" (max {p['max_seconds']}s)" if p["max_seconds"] else ""))
    add("audio", info["has_audio"] and info["audio"]["sample_rate"] == 48000,
        f"{info.get('audio', {}).get('codec')} {info.get('audio', {}).get('sample_rate')} Hz")
    if loud:
        i, tp = float(loud["input_i"]), float(loud["input_tp"])
        add("loudness", abs(i - target_lufs) <= 1.0, f"{i:.1f} LUFS (target {target_lufs})")
        add("true_peak", tp <= -0.5, f"{tp:.1f} dBTP")
    # informational only: CRF encoding spends bits by complexity, so simple shots are legitimately low
    add("bitrate", True, f"{v.get('bit_rate', 0) / 1e6:.1f} Mb/s (CRF {'quality-based' if v.get('bit_rate') else ''})")

    report = {"file": str(path), "preset": preset, "passed": all(r["ok"] for r in results), "checks": results}
    for r in results:
        log(f"  {'PASS' if r['ok'] else 'WARN'}  {r['check']:<11} {r['detail']}")
    log(f"check: {'all passed' if report['passed'] else 'see warnings above'}")
    return report


def sheet(path: str | Path, out: str | Path, count: int = 12, cols: int = 4, width: int = 1600) -> Path:
    import tempfile

    import cv2
    import numpy as np
    info = probe(path)
    dur = info["duration"]
    v = info["video"]
    tile_w = width // cols
    tile_h = int(round(tile_w * v["height"] / v["width"]))
    step = dur / count
    times = [step * (k + 0.5) for k in range(count)]  # middle of each interval
    rows = (count + cols - 1) // cols
    canvas = np.full((rows * (tile_h + 4) + 4, cols * (tile_w + 4) + 4, 3), 32, np.uint8)
    with tempfile.TemporaryDirectory() as tmp:
        for k, t in enumerate(times):
            png = Path(tmp) / f"{k}.png"
            run(["ffmpeg", "-y", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1",
                 "-vf", f"scale={tile_w}:{tile_h}", str(png)])
            img = cv2.imread(str(png))
            if img is None:
                continue
            label = fmt_ts(t)
            scale = max(0.5, tile_w / 400)
            (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, 2)
            cv2.rectangle(img, (6, 6), (14 + tw, 16 + th), (0, 0, 0), -1)
            cv2.putText(img, label, (10, 11 + th), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), 2, cv2.LINE_AA)
            r, c = divmod(k, cols)
            y, x = 4 + r * (tile_h + 4), 4 + c * (tile_w + 4)
            canvas[y:y + img.shape[0], x:x + img.shape[1]] = img[:tile_h, :tile_w]
    cv2.imwrite(str(out), canvas)
    log(f"contact sheet ({count} frames, every {fmt_ts(step)}) -> {out}")
    return Path(out)


def frames(path: str | Path, out_dir: str | Path, times: list[float]) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for t in times:
        p = out_dir / f"frame_{t:07.2f}.png"
        run(["ffmpeg", "-y", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", str(p)])
        paths.append(p)
    log(f"extracted {len(paths)} frames -> {out_dir}")
    return paths


def write_report(report: dict, out: str | Path) -> Path:
    return save_json(out, report)
