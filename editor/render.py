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

from .util import EditorError, load_json, log, probe

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")

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
    # from video-use's grade.py: minimal corrective, and its opt-in retro/cinematic look
    "neutral_punch": (["curves=master='0/0 0.25/0.23 0.75/0.77 1/1'"], "eq=contrast=1.06"),
    "warm_cinematic": (["colorbalance=rs=0.02:gs=0.0:bs=-0.03:rm=0.04:gm=0.01:bm=-0.02:rh=0.08:gh=0.02:bh=-0.05",
                        "curves=master='0/0 0.25/0.22 0.75/0.78 1/1'"],
                       "eq=contrast=1.12:brightness=-0.02:saturation=0.88"),
}
FACE_Y = 0.38          # where the face sits vertically in a zoomed/vertical crop
SMOOTH_SECONDS = 0.6   # gaussian sigma for camera motion inside a segment
EASE_DEFAULT = 0.18


def render(cut_dir: str | Path, out: str | Path, preset: str = "reels", audio: str | None = None,
           captions: str | None = None, track: str | None = None, zooms: list[dict] | None = None,
           punch_in: float | None = None, grade: str = "natural", lut: str | None = None,
           sharpen: float = 0.35, fit: str = "crop", broll: list[dict] | None = None, crf: int | None = None,
           fps_cap: float = 60.0, auto_color: float = 0.5, sfx: bool = True) -> Path:
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
    from . import transitions as tx
    trans = tx.expand({**edl, "broll": broll or []}, meta["duration"], timeline)
    max_zoom = max([punch_in] + [z.get("scale", 1.0) * punch_in for z in zooms] + [1.0]) * tx.max_boost(trans)

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
    zoom = _zoom_curve(seg_of_frame, zooms, punch_in, n_frames, fps) * tx.zoom_boost(trans, n_frames, fps)
    fx = tx.frame_fx(trans, fps)

    import cv2
    decoder = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vf",
         f"scale={dec_w}:{dec_h}:flags=lanczos:in_color_matrix=bt709:in_range=tv",
         "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], stdout=subprocess.PIPE)
    from .sfx import plan_events
    sfx_events = plan_events(edl, meta["duration"], transitions=trans) if sfx else []
    progress = edl.get("progress_bar")
    luts = _color_luts(src, timeline, auto_color) if auto_color > 0 else None
    enc_cmd, enc_log = _encoder_cmd(out, out_w, out_h, fps_str, cut_dir, audio, captions, grade, lut, sharpen,
                                    broll or [], crf or p["crf"], p, sfx_events, progress, meta["duration"],
                                    tx.eq_filter(trans), edl.get("grain", 0))
    encoder = subprocess.Popen(enc_cmd, stdin=subprocess.PIPE, stderr=enc_log)

    frame_bytes = dec_w * dec_h * 3
    log(f"render: {preset} {out_w}x{out_h} @ {fps_str}, {n_frames} frames, fit={fit}, grade={grade}, "
        f"punch_in={punch_in}, zooms={len(zooms)}, broll={len(broll or [])}, transitions={len(trans)}")
    i = 0
    try:
        while True:
            buf = decoder.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            frame = np.frombuffer(buf, np.uint8).reshape(dec_h, dec_w, 3)
            k = min(i, n_frames - 1)
            if luts is not None:
                frame = cv2.LUT(frame, luts[seg_of_frame[k]])
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
            if fx is not None:
                img = fx(img, i)
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
    from .genai import provenance
    ai = [Path(b["path"]).name for b in broll or [] if provenance(b["path"])]
    if ai:
        log(f"AI-generated in this edit: {', '.join(ai)}. Turn on the platform's AI label if it's realistic.")
    return Path(out)


def still(cut_dir: str | Path, t: float, preset: str = "reels", track: str | Path | None = None) -> np.ndarray:
    """One clean frame of the cut, reframed exactly like the render (no captions or overlays)."""
    import cv2
    cut_dir = Path(cut_dir)
    meta = load_json(cut_dir / "cut_meta.json")
    out_w, out_h = PRESETS[preset]["size"]
    fps, n = meta["fps"], int(round(meta["duration"] * meta["fps"]))
    src_w, src_h = meta["width"], meta["height"]
    ar = out_w / out_h
    base_w, base_h = (src_h * ar, src_h) if src_w / src_h > ar else (src_w, src_w / ar)
    track = track or (cut_dir / "track.json")
    fx, fy, has = _face_path(track if Path(track).exists() else None, meta["timeline"], n, fps)
    k = min(int(round(t * fps)), n - 1)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(cut_dir / "cut.mkv"), "-frames:v", "1",
                          "-vf", "scale=in_color_matrix=bt709:in_range=tv", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
                         capture_output=True).stdout
    frame = np.frombuffer(raw[:src_w * src_h * 3], np.uint8).reshape(src_h, src_w, 3)
    x0 = fx[k] * src_w - base_w / 2 if has[k] else (src_w - base_w) / 2
    y0 = fy[k] * src_h - FACE_Y * base_h if has[k] else (src_h - base_h) / 2
    x0 = int(round(min(max(x0, 0), src_w - base_w)))
    y0 = int(round(min(max(y0, 0), src_h - base_h)))
    crop = frame[y0:y0 + int(base_h), x0:x0 + int(base_w)]
    return cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_AREA if crop.shape[1] > out_w else cv2.INTER_LANCZOS4)


def _encoder_cmd(out, w, h, fps_str, cut_dir, audio, captions, grade, lut, sharpen, broll, crf, p,
                 sfx_events=(), progress=None, duration=0.0, eq=None, grain=0):
    from .transitions import overlay_motion
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
    next_idx = 2
    nats = []          # b-roll natural sound under the voice: (input index, start, dur, dB)
    for n, b in enumerate(broll):
        idx, next_idx = next_idx, next_idx + 1
        path = str(b["path"])
        start, dur = float(b["start"]), float(b["dur"])
        is_image = Path(path).suffix.lower() in IMAGE_EXT
        if is_image:
            cmd += ["-loop", "1", "-t", f"{dur:.3f}", "-i", path]
        else:
            cmd += ["-ss", f"{float(b.get('src_start', 0)):.3f}", "-t", f"{dur:.3f}", "-i", path]
        mode = b.get("mode", "contain" if is_image else "full")
        if b.get("nat") is not None and not is_image and probe(path)["has_audio"]:
            nats.append((idx, start, dur, float(b["nat"])))
        to_yuv = "scale=out_color_matrix=bt709:out_range=tv,format=yuv444p"
        end_t = start + dur
        enable = f"enable='between(t,{start:.3f},{end_t:.3f})'"
        if mode == "card":         # floating rounded card (or phone) over the speaker: shadow, fade + slide-in
            a = _card_assets(path, w, h, b, cut_dir / "cards", n)
            extra = [a["mask"], a["shadow"]] + ([a["bezel"]] if "bezel" in a else [])
            m_idx, s_idx = next_idx, next_idx + 1
            z_idx = next_idx + 2 if "bezel" in a else None
            next_idx += len(extra)
            for img in extra:
                cmd += ["-loop", "1", "-t", f"{dur:.3f}", "-i", str(img)]
            fades = (f"fade=t=in:st={start:.3f}:d=0.15:alpha=1,"
                     f"fade=t=out:st={max(end_t - 0.15, start):.3f}:d=0.15:alpha=1")
            shift = f"setpts=PTS-STARTPTS+{start:.3f}/TB"
            cw, ch = a["cw"], a["ch"]
            graph.append(f"[{idx}:v]scale={cw}:{ch}:flags=lanczos,setsar=1,{to_yuv},format=yuva444p[c{n}];"
                         f"[{m_idx}:v]scale={cw}:{ch},format=gray[m{n}];[c{n}][m{n}]alphamerge,fps={fps_str},"
                         f"{shift},{fades}[cm{n}];"
                         f"[{s_idx}:v]format=yuva444p,fps={fps_str},{shift},{fades}[sh{n}]")
            slide = f"40*max(0,1-(t-{start:.3f})/0.2)"
            oy = a["cy"] - a["oh"] / 2
            ox = a["cx"] - a["ow"] / 2
            graph.append(f"[{label}][sh{n}]overlay=x={ox - a['spad']:.1f}:y='{oy - a['spad'] + h * 0.012:.1f}+{slide}':eval=frame:"
                         f"eof_action=pass:{enable}[shd{n}];"
                         f"[shd{n}][cm{n}]overlay=x={ox + a['bez']:.1f}:y='{oy + a['bez']:.1f}+{slide}':eval=frame:"
                         f"eof_action=pass:{enable}[cmp{n}]")
            if z_idx is not None:
                graph.append(f"[{z_idx}:v]format=yuva444p,fps={fps_str},{shift},{fades}[bz{n}];"
                             f"[cmp{n}][bz{n}]overlay=x={ox:.1f}:y='{oy:.1f}+{slide}':eval=frame:eof_action=pass:"
                             f"{enable}[base{n + 1}]")
            else:
                graph[-1] = graph[-1].replace(f"[cmp{n}]", f"[base{n + 1}]")
            label = f"base{n + 1}"
            continue
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
        fades = ""
        if b.get("in") == "fade":
            fades += f",fade=t=in:st={start:.3f}:d=0.3:alpha=1"
        if b.get("out") == "fade":
            fades += f",fade=t=out:st={max(end_t - 0.3, start):.3f}:d=0.3:alpha=1"
        if fades:
            fades = ",format=yuva444p" + fades
        grain = f"noise=alls={int(b['grain'])}:allf=t+u," if b.get("grain") else ""   # match AI/clean b-roll to phone footage
        graph.append(f"[p{n}]{grain}fps={fps_str},setpts=PTS-STARTPTS+{start:.3f}/TB{fades}[b{n}]")
        ox, oy = overlay_motion(b, w, h)
        pos = f"x='{ox}':y='{oy}':eval=frame:" if (ox, oy) != ("0", "0") else ""
        graph.append(f"[{label}][b{n}]overlay={pos}eof_action=pass:{enable}[base{n + 1}]")
        label = f"base{n + 1}"
    tail = [eq] if eq else []      # flash / dip transitions on the composite
    if grain:                      # film grain over the whole picture, under the captions
        tail.append(f"noise=alls={int(grain)}:allf=t+u")
    if progress:  # thin progress bar along the top: a retention cue on short-form
        pc = progress if isinstance(progress, dict) else {}
        color = pc.get("color", "white").lstrip("#")
        color = f"0x{color}" if all(ch in "0123456789abcdefABCDEF" for ch in color) and len(color) == 6 else color
        tail.append(f"drawbox=x=0:y=0:w='max(1,iw*t/{duration:.3f})':h={int(pc.get('height', 10))}:"
                    f"color={color}@{pc.get('opacity', 0.9)}:t=fill")
    if captions:
        fonts = Path(__file__).resolve().parent.parent / "assets" / "fonts"
        opt = f":fontsdir='{_esc(str(fonts))}'" if fonts.exists() else ""
        tail.append(f"ass='{_esc(str(captions))}'{opt}")
    tail.append("format=yuv420p")
    graph.append(f"[{label}]{','.join(tail)}[vout]")
    gop = str(round(float(Fraction(fps_str)) * 2))
    audio_map = "1:a:0"
    if sfx_events or nats:
        parts = ["[1:a:0]aresample=48000,aformat=channel_layouts=stereo[a0]"]
        for k, (idx, start, dur, db) in enumerate(nats):
            ms = int(round(start * 1000))
            parts.append(f"[{idx}:a:0]aresample=48000,aformat=channel_layouts=stereo,volume={db}dB,"
                         f"afade=t=in:d=0.15,afade=t=out:st={max(dur - 0.3, 0):.3f}:d=0.3,adelay={ms}|{ms}[n{k}]")
        for k, e in enumerate(sfx_events):
            cmd += ["-i", e["file"]]
            ms = int(round(e["start"] * 1000))
            parts.append(f"[{next_idx}:a]aresample=48000,volume={e['db']}dB,adelay={ms}|{ms}[x{k}]")
            next_idx += 1
        labels = "".join(f"[n{k}]" for k in range(len(nats))) + "".join(f"[x{k}]" for k in range(len(sfx_events)))
        # mix under the voice, then a true-peak-safe limiter (the voice was already loudness-normalised)
        parts.append(f"[a0]{labels}amix=inputs={len(sfx_events) + len(nats) + 1}:duration=first:normalize=0,"
                     f"alimiter=limit=0.89:level=false[aout]")
        graph += parts
        audio_map = "[aout]"
    cmd += ["-filter_complex", ";".join(graph), "-map", "[vout]", "-map", audio_map,
            "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-profile:v", "high", "-level:v", "4.2",
            "-maxrate", p["maxrate"], "-bufsize", p["bufsize"], "-g", gop, "-bf", "2",
            "-x264-params", "aq-mode=3:deblock=-1,-1", "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
            "-c:a", "aac", "-b:a", "320k", "-ar", "48000", "-movflags", "+faststart", "-shortest", str(out)]
    return cmd, tempfile.TemporaryFile()


def _color_luts(src, timeline, strength):
    """Per-segment correction LUTs so takes shot at different times match: partial grey-world
    white balance and exposure pulled toward mid-grey, both limited (a nudge, not a regrade)."""
    luts = {}
    for seg in timeline:
        t = (seg["start"] + seg["end"]) / 2
        proc = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
                               "-vf", "scale=160:-2:in_color_matrix=bt709:in_range=tv", "-f", "rawvideo",
                               "-pix_fmt", "bgr24", "-"], capture_output=True)
        px = np.frombuffer(proc.stdout, np.uint8).reshape(-1, 3).astype(np.float32) / 255 if proc.stdout else None
        lut = np.arange(256, dtype=np.float32)[:, None].repeat(3, axis=1) / 255
        if px is not None and len(px):
            mid = px[(px.max(axis=1) < 0.95) & (px.min(axis=1) > 0.05)]  # ignore clipped pixels
            mid = mid if len(mid) > 100 else px
            means = mid.mean(axis=0) + 1e-4
            gains = np.clip((means.mean() / means) ** (0.6 * strength), 0.93, 1.07)
            luma = float((mid @ np.array([0.0722, 0.7152, 0.2126], np.float32)).mean())
            gamma = 1.0
            if abs(np.log2(max(luma, 1e-3) / 0.45)) > 0.35:
                gamma = float(np.clip((np.log(0.45) / np.log(max(min(luma, 0.95), 0.02))) ** strength, 0.82, 1.2))
            lut = np.clip((lut * gains) ** gamma, 0, 1)
        luts[seg["index"]] = (lut * 255 + 0.5).astype(np.uint8).reshape(256, 1, 3)
    return luts


def _rounded_mask(cv2, w, h, r):
    mask = np.zeros((h, w), np.uint8)
    r = max(1, min(r, w // 2, h // 2))
    cv2.rectangle(mask, (r, 0), (w - r, h), 255, -1)
    cv2.rectangle(mask, (0, r), (w, h - r), 255, -1)
    for cx_, cy_ in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        cv2.circle(mask, (cx_, cy_), r, 255, -1, lineType=cv2.LINE_AA)
    return mask


def _card_assets(path, w, h, b, out_dir, n):
    """Size a floating card and draw its masks, soft shadow and (for "frame": "phone") a phone bezel.

    The phone frame is the no-simulator way to show an app: any screen recording or screenshot
    (iPhone/Android built-in screen recording, a Playwright capture) becomes a phone on screen.
    """
    import cv2
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    v = probe(path)["video"]
    sw, sh = v["width"], v["height"]
    phone = b.get("frame") == "phone"
    cw = float(b.get("width", 0.5 if phone else 0.84)) * w
    ch = cw * sh / sw
    max_h = float(b.get("max_height", 0.42 if phone else 0.32)) * h
    if ch > max_h:
        ch, cw = max_h, max_h * sw / sh
    cw, ch = int(cw // 2 * 2), int(ch // 2 * 2)
    bez = int(round(cw * 0.045)) if phone else 0          # bezel thickness around the screen
    ow, oh = cw + 2 * bez, ch + 2 * bez                    # outer (device or card) size
    cy = float(b.get("y", 0.6 if phone else 0.53)) * h     # below the face, above the captions
    cx = float(b.get("x", 0.73 if phone else 0.5)) * w     # phones sit beside the face by default
    cx = min(max(cx, ow / 2 + w * 0.02), w - ow / 2 - w * 0.02)
    screen_r = int(cw * 0.11) if phone else int(min(cw, ch) * 0.06)
    mask = _rounded_mask(cv2, cw, ch, screen_r)
    outer = _rounded_mask(cv2, ow, oh, screen_r + bez)
    spad = int(ow * 0.06)
    alpha = np.zeros((oh + 2 * spad, ow + 2 * spad), np.uint8)
    alpha[spad:spad + oh, spad:spad + ow] = (outer * 0.55).astype(np.uint8)
    alpha = cv2.GaussianBlur(alpha, (0, 0), spad / 2.5)
    shadow = np.dstack([np.zeros_like(alpha)] * 3 + [alpha])
    paths = {"mask": out_dir / f"card{n}_mask.png", "shadow": out_dir / f"card{n}_shadow.png"}
    cv2.imwrite(str(paths["mask"]), mask)
    cv2.imwrite(str(paths["shadow"]), shadow)
    if phone:
        body = np.zeros((oh, ow, 4), np.uint8)
        body[..., :3] = (18, 18, 20)
        hole = np.zeros((oh, ow), np.uint8)
        hole[bez:bez + ch, bez:bez + cw] = mask
        body[..., 3] = np.where(hole > 0, 0, outer)
        # subtle edge highlight + dynamic island
        ring = cv2.subtract(outer, cv2.erode(outer, np.ones((5, 5), np.uint8)))
        body[ring > 0, :3] = (70, 70, 76)
        iw, ih = int(cw * 0.3), int(cw * 0.085)
        ix, iy = (ow - iw) // 2, bez + int(cw * 0.035)
        pill = np.zeros((oh, ow), np.uint8)
        cv2.rectangle(pill, (ix + ih // 2, iy), (ix + iw - ih // 2, iy + ih), 255, -1)
        cv2.circle(pill, (ix + ih // 2, iy + ih // 2), ih // 2, 255, -1, lineType=cv2.LINE_AA)
        cv2.circle(pill, (ix + iw - ih // 2, iy + ih // 2), ih // 2, 255, -1, lineType=cv2.LINE_AA)
        body[pill > 0] = (0, 0, 0, 255)
        paths["bezel"] = out_dir / f"card{n}_bezel.png"
        cv2.imwrite(str(paths["bezel"]), body)
    return {"cw": cw, "ch": ch, "ow": ow, "oh": oh, "bez": bez, "cx": cx, "cy": cy, "spad": spad, **paths}


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

