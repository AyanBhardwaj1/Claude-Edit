"""Final render: reframe + punch-ins + grade + B-roll/overlays + captions + mastered audio.

Frames are decoded from cut.mkv into numpy, cropped per frame (face-following
crop, jump-cut punch-in alternation, emphasis zooms with easing) and resized with
high-quality filters, then piped into a single final x264 encode that applies the
colour grade, sharpening, overlays and captions. One generation of lossy encoding
from the near-lossless intermediate keeps quality high after Instagram/TikTok
re-compress the upload.
"""
from __future__ import annotations

import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path

import numpy as np

from .util import EditorError, load_json, log

PRESETS = {
    "reels": dict(size=(1080, 1920), crf=17, maxrate="20M", bufsize="40M", max_seconds=180),
    "tiktok": dict(size=(1080, 1920), crf=17, maxrate="20M", bufsize="40M", max_seconds=600),
    "shorts": dict(size=(1080, 1920), crf=17, maxrate="20M", bufsize="40M", max_seconds=180),
    "feed": dict(size=(1080, 1350), crf=17, maxrate="20M", bufsize="40M", max_seconds=3600),
    "square": dict(size=(1080, 1080), crf=17, maxrate="20M", bufsize="40M", max_seconds=3600),
    "youtube": dict(size=(1920, 1080), crf=16, maxrate="40M", bufsize="80M", max_seconds=None),
    "youtube4k": dict(size=(3840, 2160), crf=17, maxrate="80M", bufsize="160M", max_seconds=None),
}

# RGB-domain looks, then YUV eq; all subtle on purpose (skin tones first).
GRADES = {
    "none": ([], None),
    "natural": (["vibrance=intensity=0.12"], "eq=contrast=1.04:saturation=1.04:gamma=0.99"),
    "punchy": (["vibrance=intensity=0.25", "curves=master='0/0 0.25/0.22 0.75/0.79 1/1'"],
               "eq=contrast=1.07:saturation=1.08"),
    "warm": (["colortemperature=temperature=5600:mix=0.35", "vibrance=intensity=0.15"],
             "eq=contrast=1.04:saturation=1.03"),
    "cinematic": (["colorbalance=rs=-0.04:bs=0.05:rh=0.05:bh=-0.04", "curves=master='0/0.03 0.3/0.27 0.7/0.73 1/0.97'"],
                  "eq=contrast=1.05:saturation=0.95"),
    "bw": ([], "hue=s=0,eq=contrast=1.12"),
}
FACE_Y = 0.38          # where the face sits vertically in a zoomed/vertical crop
SMOOTH_SECONDS = 0.6   # gaussian sigma for camera motion inside a segment
EASE_DEFAULT = 0.18


def render(cut_dir: str | Path, out: str | Path, preset: str = "reels", audio: str | None = None,
           captions: str | None = None, track: str | None = None, zooms: list[dict] | None = None,
           punch_in: float | None = None, grade: str = "natural", lut: str | None = None,
           sharpen: float = 0.35, fit: str = "crop", broll: list[dict] | None = None, crf: int | None = None,
           fps_cap: float = 60.0) -> Path:
    cut_dir = Path(cut_dir)
    meta = load_json(cut_dir / "cut_meta.json")
    src = cut_dir / "cut.mkv"
    p = PRESETS[preset]
    out_w, out_h = p["size"]
    fps_str, fps = meta["fps_str"], meta["fps"]
    if fps > fps_cap:
        raise EditorError(f"fps {fps} above cap {fps_cap}")
    n_frames = int(round(meta["duration"] * fps))
    timeline = meta["timeline"]
    edl = load_json(meta["edl"]) if Path(meta["edl"]).exists() else {}
    if zooms is None:
        zooms = edl.get("zooms", [])
    if punch_in is None:
        punch_in = float(edl.get("auto_punch_in", 1.0))
    max_zoom = max([punch_in] + [z.get("scale", 1.0) * punch_in for z in zooms] + [1.0])

    src_w, src_h = meta["width"], meta["height"]
    target_ar = out_w / out_h
    base_w, base_h = (src_h * target_ar, src_h) if src_w / src_h > target_ar else (src_w, src_w / target_ar)
    if fit == "blur":
        base_w, base_h = src_w, src_h
    # decode at the smallest size that still gives >= 1:1 pixels at max zoom
    pre = min(1.0, (out_h * max_zoom) / base_h, (out_w * max_zoom) / base_w) if fit == "crop" else \
        min(1.0, out_w * max_zoom / src_w)
    dec_w = int(round(src_w * pre / 2) * 2)
    dec_h = int(round(src_h * pre / 2) * 2)
    sx = dec_w / src_w

    seg_of_frame = _segment_index(timeline, n_frames, fps)
    face_x, face_y, has_face = _face_path(track, timeline, n_frames, fps)
    zoom = _zoom_curve(seg_of_frame, zooms, punch_in, n_frames, fps)

    import cv2
    decoder = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vf",
         f"scale={dec_w}:{dec_h}:flags=lanczos:in_color_matrix=bt709:in_range=tv",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    enc_cmd, enc_log = _encoder_cmd(out, out_w, out_h, fps_str, cut_dir, audio, captions, grade, lut, sharpen,
                                    broll or [], crf or p["crf"], p)
    encoder = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stderr=enc_log)

    frame_bytes = dec_w * dec_h * 3
    log(f"render: {preset} {out_w}x{out_h} @ {fps_str}, {n_frames} frames, fit={fit}, grade={grade}, "
        f"punch_in={punch_in}, zooms={len(zooms)}, broll={len(broll or [])}")
    i = 0
    try:
        while True:
            buf = decoder.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            frame = np.frombuffer(buf, np.uint8).reshape(dec_h, dec_w, 3)
            k = min(i, n_frames - 1)
            if fit == "blur":
                img = _blur_fit(cv2, frame, out_w, out_h, zoom[k])
            else:
                cw, ch = base_w * sx / zoom[k], base_h * sx / zoom[k]
                if has_face[k]:
                    x0 = face_x[k] * dec_w - cw / 2
                    y0 = face_y[k] * dec_h - FACE_Y * ch
                else:
                    x0, y0 = (dec_w - cw) / 2, (dec_h - ch) / 2
                x0 = int(round(min(max(x0, 0), dec_w - cw)))
                y0 = int(round(min(max(y0, 0), dec_h - ch)))
                crop = frame[y0:y0 + int(round(ch)), x0:x0 + int(round(cw))]
                interp = cv2.INTER_AREA if crop.shape[1] > out_w else cv2.INTER_LANCZOS4
                img = cv2.resize(crop, (out_w, out_h), interpolation=interp)
            encoder.stdin.write(np.ascontiguousarray(img).tobytes())
            i += 1
            if n_frames and i % max(1, n_frames // 10) == 0:
                log(f"render: {100 * i // n_frames}%")
    except BrokenPipeError:
        pass
    finally:
        decoder.stdout.close()
        decoder.wait()
        if encoder.stdin:
            try:
                encoder.stdin.close()
            except BrokenPipeError:
                pass
        encoder.wait()
    if encoder.returncode != 0:
        enc_log.seek(0)
        raise EditorError("encoder failed:\n" + enc_log.read().decode(errors="replace")[-3000:])
    log(f"wrote {out}")
    return Path(out)


def _encoder_cmd(out, w, h, fps_str, cut_dir, audio, captions, grade, lut, sharpen, broll, crf, p):
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}", "-r", fps_str, "-i", "-"]
    cmd += ["-i", str(audio) if audio else str(cut_dir / "cut.mkv")]
    rgb, yuv = GRADES[grade]
    rgb = list(rgb)
    if lut:
        rgb.append(f"lut3d=file='{_esc(lut)}':interp=tetrahedral")
    chain = ["format=gbrp", *rgb, "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd", "format=yuv444p"]
    if yuv:
        chain.append(yuv)
    if sharpen > 0:
        chain.append(f"cas=strength={sharpen}")
    graph = [f"[0:v]{','.join(chain)}[base0]"]
    label = "base0"
    for n, b in enumerate(broll):
        idx = 2 + n
        path = str(b["path"])
        start, dur = float(b["start"]), float(b["dur"])
        if Path(path).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp"):
            cmd += ["-loop", "1", "-t", f"{dur:.3f}", "-i", path]
        else:
            cmd += ["-ss", f"{float(b.get('src_start', 0)):.3f}", "-t", f"{dur:.3f}", "-i", path]
        is_image = Path(path).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")
        mode = b.get("mode", "contain" if is_image else "full")
        to_yuv = "scale=out_color_matrix=bt709:out_range=tv,format=yuv444p"
        if mode == "overlay":      # transparent graphics (Remotion ProRes 4444 / WebM alpha) at output size
            graph.append(f"[{idx}:v]scale={w}:{h},format=yuva444p[p{n}]")
        elif mode == "contain":    # screenshots: whole image visible over a blurred fill of itself
            graph.append(f"[{idx}:v]setsar=1,split=2[bg{n}][fg{n}];"
                         f"[bg{n}]scale={w // 8}:{h // 8}:force_original_aspect_ratio=increase,crop={w // 8}:{h // 8},"
                         f"boxblur=6:2,scale={w}:{h},eq=brightness=-0.12[bgb{n}];"
                         f"[fg{n}]scale={int(w * 0.92)}:{int(h * 0.92)}:force_original_aspect_ratio=decrease:"
                         f"flags=lanczos[fgs{n}];[bgb{n}][fgs{n}]overlay=(W-w)/2:(H-h)/2,{to_yuv}[p{n}]")
        else:                      # full-frame cutaway, cover-cropped
            graph.append(f"[{idx}:v]scale={w}:{h}:force_original_aspect_ratio=increase:flags=lanczos,"
                         f"crop={w}:{h},setsar=1,{to_yuv}[p{n}]")
        graph.append(f"[p{n}]fps={fps_str},setpts=PTS-STARTPTS+{start:.3f}/TB[b{n}]")
        graph.append(f"[{label}][b{n}]overlay=eof_action=pass:enable='between(t,{start:.3f},{start + dur:.3f})'"
                     f"[base{n + 1}]")
        label = f"base{n + 1}"
    tail = []
    if captions:
        fonts = Path(__file__).resolve().parent.parent / "assets" / "fonts"
        opt = f":fontsdir='{_esc(str(fonts))}'" if fonts.exists() else ""
        tail.append(f"ass='{_esc(str(captions))}'{opt}")
    tail.append("format=yuv420p")
    graph.append(f"[{label}]{','.join(tail)}[vout]")
    gop = str(round(float(Fraction(fps_str)) * 2))
    cmd += ["-filter_complex", ";".join(graph), "-map", "[vout]", "-map", "1:a:0",
            "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-level:v", "4.2",
            "-maxrate", p["maxrate"], "-bufsize", p["bufsize"], "-g", gop, "-bf", "2",
            "-x264-params", "aq-mode=3:deblock=-1,-1", "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-movflags", "+faststart", "-shortest", str(out)]
    return cmd, tempfile.TemporaryFile()


def _esc(path: str) -> str:
    return path.replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def _segment_index(timeline, n_frames, fps):
    idx = np.zeros(n_frames, dtype=int)
    for seg in timeline:
        a, b = int(round(seg["start"] * fps)), int(round(seg["end"] * fps))
        idx[a:b] = seg["index"]
    return idx


def _face_path(track_path, timeline, n_frames, fps):
    fx = np.full(n_frames, 0.5)
    fy = np.full(n_frames, 0.42)
    has = np.zeros(n_frames, dtype=bool)
    if not track_path or not Path(track_path).exists():
        return fx, fy, has
    samples = load_json(track_path)["samples"]
    if not samples:
        return fx, fy, has
    st = np.array([s["t"] for s in samples])
    sx = np.array([s["cx"] for s in samples])
    sy = np.array([s["cy"] for s in samples])
    sigma = SMOOTH_SECONDS * fps
    for seg in timeline:
        a, b = int(round(seg["start"] * fps)), min(int(round(seg["end"] * fps)), n_frames)
        if b <= a:
            continue
        mask = (st >= seg["start"] - 0.2) & (st <= seg["end"] + 0.2)
        if mask.sum() == 0:
            continue
        t = np.arange(a, b) / fps
        x = np.interp(t, st[mask], sx[mask])
        y = np.interp(t, st[mask], sy[mask])
        fx[a:b], fy[a:b] = _gauss(x, sigma), _gauss(y, sigma)
        has[a:b] = True
    return fx, fy, has


def _gauss(v, sigma):
    if len(v) < 3 or sigma < 1:
        return v
    r = int(3 * sigma)
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    padded = np.pad(v, r, mode="edge")
    return np.convolve(padded, k, mode="valid")


def _zoom_curve(seg_of_frame, zooms, punch_in, n_frames, fps):
    z = np.where(seg_of_frame % 2 == 1, punch_in, 1.0) if punch_in > 1.0 else np.ones(n_frames)
    t = np.arange(n_frames) / fps
    for zm in zooms:
        s, e, scale = float(zm["start"]), float(zm["end"]), float(zm.get("scale", 1.2))
        ease = float(zm.get("ease", EASE_DEFAULT))
        if ease <= 0:
            f = ((t >= s) & (t < e)).astype(float)
        else:
            up = np.clip((t - s) / ease, 0, 1)
            down = np.clip((e - t) / ease, 0, 1)
            f = _smoothstep(np.minimum(up, down))
        z = z * (1 + (scale - 1) * f)
    return np.maximum(z, 1.0)


def _smoothstep(x):
    return x * x * (3 - 2 * x)


def _blur_fit(cv2, frame, out_w, out_h, zoom):
    h, w = frame.shape[:2]
    # background: cover-crop, tiny, blurred, darkened
    s = max(out_w / w, out_h / h)
    small = cv2.resize(frame, (max(1, int(w * s / 8)), max(1, int(h * s / 8))), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), 6)
    bg = cv2.resize(small, (int(w * s), int(h * s)), interpolation=cv2.INTER_LINEAR)
    y0, x0 = (bg.shape[0] - out_h) // 2, (bg.shape[1] - out_w) // 2
    canvas = (bg[y0:y0 + out_h, x0:x0 + out_w] * 0.55).astype(np.uint8)
    # foreground: fit width, zoom crops the sides
    fw = int(out_w * zoom)
    fh = int(h * fw / w)
    fg = cv2.resize(frame, (fw, fh), interpolation=cv2.INTER_AREA if fw < w else cv2.INTER_LANCZOS4)
    cx = (fw - out_w) // 2
    fg = fg[:, cx:cx + out_w]
    if fh > out_h:
        cy = (fh - out_h) // 2
        return np.ascontiguousarray(fg[cy:cy + out_h])
    top = (out_h - fh) // 2
    canvas[top:top + fh] = fg
    return canvas

