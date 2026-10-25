"""Built-in motion graphics, rendered to transparent ProRes 4444 overlays.

No Node, no CDN, no API key: Pillow draws each frame from t (one clock, deterministic),
ffmpeg encodes RGBA -> ProRes 4444 with alpha. Add the result to the EDL as
{"path": "broll/x.mov", "start": S, "dur": D, "mode": "overlay"}.

Templates: counter, lower-third, checklist, title (kinetic hook), cta (end card).
Motion rules (from claude-video-studio's ban list): cubic easing only, nothing scales up
from zero, one accent colour, no glow, at most ~6 words on screen at once.
For richer looks use the claude-video-studio skill (HyperFrames) or manim-video.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

from .util import EditorError, log
from .viz import _font


def ease_out(t):
    t = min(max(t, 0.0), 1.0)
    return 1 - (1 - t) ** 3


def ease_in_out(t):
    t = min(max(t, 0.0), 1.0)
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def _rgb(hex_color: str, alpha: int = 255):
    h = hex_color.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), alpha)


def _encode(frames_fn, out: Path, w: int, h: int, fps: int, dur: float) -> Path:
    out = Path(out).with_suffix(".mov")
    out.parent.mkdir(parents=True, exist_ok=True)
    enc = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba",
                            "-s", f"{w}x{h}", "-r", str(fps), "-i", "-", "-c:v", "prores_ks", "-profile:v", "4444",
                            "-pix_fmt", "yuva444p10le", "-vendor", "apl0", str(out)], stdin=subprocess.PIPE)
    n = max(1, int(round(dur * fps)))
    for i in range(n):
        enc.stdin.write(frames_fn(i / fps).tobytes())
    enc.stdin.close()
    if enc.wait() != 0:
        raise EditorError("ffmpeg failed encoding the graphic")
    return out


def _canvas(w, h):
    from PIL import Image
    return Image.new("RGBA", (w, h), (0, 0, 0, 0))


def _fade(t, dur, inn=0.3, out=0.3):
    return min(ease_out(t / inn) if inn else 1, ease_out((dur - t) / out) if out else 1)


def _with_alpha(img, a):
    if a >= 1:
        return img
    r, g, b, al = img.split()
    al = al.point(lambda v: int(v * max(a, 0)))
    img.putalpha(al)
    return img


def counter(out, w=1080, h=1920, fps=30, dur=3.0, start=0, to=1000, prefix="", suffix="", label="",
            accent="#FF5A00", y=0.40, count_time=1.3):
    from PIL import ImageDraw
    big, small = _font(int(w * 0.17)), _font(int(w * 0.045), False)

    def frame(t):
        img = _canvas(w, h)
        d = ImageDraw.Draw(img)
        v = start + (to - start) * ease_out(t / count_time)
        num = f"{prefix}{int(round(v)):,}{suffix}"
        final = f"{prefix}{int(to):,}{suffix}"
        bw = d.textlength(final, font=big) + w * 0.12   # card sized to the final value: no jumping box
        bh = w * 0.34 if label else w * 0.24
        cx, cy = w / 2, h * y + (1 - ease_out(t / 0.35)) * w * 0.04
        d.rounded_rectangle((cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2), radius=w * 0.04,
                            fill=(12, 12, 14, 225))
        d.text((cx, cy - (w * 0.04 if label else 0)), num, font=big, fill=(255, 255, 255, 255), anchor="mm")
        if label:
            d.text((cx, cy + bh / 2 - w * 0.075), label, font=small, fill=_rgb(accent), anchor="mm")
        return _with_alpha(img, _fade(t, dur, 0.25, 0.3))
    return _encode(frame, out, w, h, fps, dur)


def lower_third(out, w=1080, h=1920, fps=30, dur=3.5, name="Your Name", title="", accent="#FF5A00", y=0.60):
    from PIL import ImageDraw
    f1, f2 = _font(int(w * 0.062)), _font(int(w * 0.04), False)

    def frame(t):
        img = _canvas(w, h)
        d = ImageDraw.Draw(img)
        p_in, p_out = ease_out(t / 0.45), ease_out((dur - t) / 0.35)
        p = min(p_in, p_out)
        x0 = w * 0.07 - (1 - p) * w * 0.5
        tw = max(d.textlength(name, font=f1), d.textlength(title, font=f2) if title else 0)
        box_h = w * (0.17 if title else 0.11)
        d.rounded_rectangle((x0, h * y, x0 + tw + w * 0.1, h * y + box_h), radius=w * 0.025, fill=(12, 12, 14, 230))
        bar = ease_out((t - 0.15) / 0.35) * box_h
        d.rectangle((x0, h * y, x0 + w * 0.012, h * y + bar), fill=_rgb(accent))
        d.text((x0 + w * 0.05, h * y + w * 0.03), name, font=f1, fill=(255, 255, 255, 255))
        if title:
            d.text((x0 + w * 0.05, h * y + w * 0.105), title, font=f2, fill=(190, 190, 195, 255))
        return img
    return _encode(frame, out, w, h, fps, dur)


def checklist(out, items, w=1080, h=1920, fps=30, dur=None, title="", at=None, accent="#22C55E", y=0.44):
    from PIL import ImageDraw
    at = at or [0.4 + 0.8 * i for i in range(len(items))]
    dur = dur or (at[-1] + 1.6)
    f_item, f_title = _font(int(w * 0.046)), _font(int(w * 0.052))
    row = w * 0.088
    top = h * y
    box_w = w * 0.76
    box_h = (row * len(items)) + (w * 0.1 if title else w * 0.03) + w * 0.035

    def frame(t):
        img = _canvas(w, h)
        d = ImageDraw.Draw(img)
        x0 = (w - box_w) / 2
        d.rounded_rectangle((x0, top, x0 + box_w, top + box_h), radius=w * 0.04, fill=(12, 12, 14, 225))
        yy = top + w * 0.04
        if title:
            d.text((x0 + w * 0.06, yy), title, font=f_title, fill=(255, 255, 255, 255))
            yy += w * 0.09
        for k, item in enumerate(items):
            p = ease_out((t - at[k]) / 0.3)
            if p <= 0:
                yy += row
                continue
            slide = (1 - p) * w * 0.04
            bx, by, s = x0 + w * 0.06, yy + w * 0.01 + slide, w * 0.052
            d.rounded_rectangle((bx, by, bx + s, by + s), radius=s * 0.25, outline=_rgb(accent, int(255 * p)),
                                width=max(2, int(w * 0.005)), fill=_rgb(accent, int(255 * p * ease_out((t - at[k] - 0.1) / 0.2))))
            tick = ease_out((t - at[k] - 0.15) / 0.25)
            if tick > 0:
                pts = [(bx + s * 0.22, by + s * 0.52), (bx + s * 0.42, by + s * 0.72), (bx + s * 0.78, by + s * 0.3)]
                seg = pts[:2] if tick < 0.5 else pts
                d.line(seg, fill=(255, 255, 255, 255), width=max(3, int(w * 0.008)), joint="curve")
            d.text((bx + s * 1.5, by + s / 2), item, font=f_item, fill=(255, 255, 255, int(255 * p)), anchor="lm")
            yy += row
        return _with_alpha(img, _fade(t, dur, 0.25, 0.3))
    return _encode(frame, out, w, h, fps, dur)


def title(out, text, w=1080, h=1920, fps=30, dur=2.6, accent="#FFE600", highlight=None, y=0.16):
    """Kinetic hook title: words rise in one by one behind a mask (no scaling from zero)."""
    from PIL import ImageDraw
    words = text.split()
    f = _font(int(w * 0.085))
    hl = {x.lower() for x in (highlight or [])}

    def frame(t):
        img = _canvas(w, h)
        d = ImageDraw.Draw(img)
        lines, cur = [], []
        for wd in words:  # greedy wrap at 86% width
            trial = " ".join(cur + [wd])
            if cur and d.textlength(trial, font=f) > w * 0.86:
                lines.append(cur)
                cur = [wd]
            else:
                cur.append(wd)
        lines.append(cur)
        lh = w * 0.105
        k = 0
        for li, line in enumerate(lines):
            lw = d.textlength(" ".join(line), font=f)
            x = (w - lw) / 2
            base = h * y + li * lh
            for wd in line:
                p = ease_out((t - 0.08 * k) / 0.35)
                ww = d.textlength(wd + " ", font=f)
                if p > 0:
                    layer = _canvas(int(ww + 20), int(lh * 1.4))
                    ld = ImageDraw.Draw(layer)
                    color = _rgb(accent) if wd.lower().strip(".,!?") in hl else (255, 255, 255, 255)
                    ld.text((10, lh * 0.2 + (1 - p) * lh), wd, font=f, fill=color, stroke_width=int(w * 0.007),
                            stroke_fill=(0, 0, 0, 255))
                    img.alpha_composite(layer, (int(x - 10), int(base - lh * 0.2)))
                x += ww
                k += 1
        return _with_alpha(img, _fade(t, dur, 0, 0.3))
    return _encode(frame, out, w, h, fps, dur)


def cta(out, text="Follow for part 2", sub="", w=1080, h=1920, fps=30, dur=2.5, accent="#FF5A00", y=0.42):
    from PIL import ImageDraw
    f1, f2 = _font(int(w * 0.07)), _font(int(w * 0.042), False)

    def frame(t):
        img = _canvas(w, h)
        d = ImageDraw.Draw(img)
        p = ease_out(t / 0.4)
        s = 0.92 + 0.08 * p                     # lands from 92%, never from zero
        tw = d.textlength(text, font=f1) * s
        bw, bh = tw + w * 0.14, w * 0.17 * s
        cx, cy = w / 2, h * y + (1 - p) * w * 0.05
        d.rounded_rectangle((cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2), radius=bh / 2, fill=_rgb(accent))
        fs = _font(int(w * 0.07 * s))
        d.text((cx, cy), text, font=fs, fill=(255, 255, 255, 255), anchor="mm")
        if sub:
            d.text((cx, cy + bh / 2 + w * 0.06), sub, font=f2, fill=(255, 255, 255, int(255 * ease_out((t - 0.3) / 0.3))),
                   anchor="mm", stroke_width=3, stroke_fill=(0, 0, 0, 200))
        return _with_alpha(img, min(p * 1.6, 1) if t < dur - 0.3 else _fade(t, dur, 0, 0.3))
    return _encode(frame, out, w, h, fps, dur)


TEMPLATES = {"counter": counter, "lower-third": lower_third, "checklist": checklist, "title": title, "cta": cta}


def make(kind: str, out: str | Path, **kw) -> Path:
    if kind not in TEMPLATES:
        raise EditorError(f"unknown graphic '{kind}'; choose from {list(TEMPLATES)}")
    path = TEMPLATES[kind](Path(out), **{k: v for k, v in kw.items() if v is not None})
    log(f"graphic {kind} -> {path}")
    return path
