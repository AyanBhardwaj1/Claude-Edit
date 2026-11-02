"""Built-in motion graphics, rendered to transparent ProRes 4444 overlays.

No Node, no CDN, no API key: Pillow draws each frame from t (one clock, deterministic),
ffmpeg encodes RGBA -> ProRes 4444 with alpha. Add the result to the EDL as
{"path": "broll/x.mov", "start": S, "dur": D, "mode": "overlay"}.

Templates: counter, lower-third, checklist, title (kinetic hook), cta (end card), and the four Reel Studio
cards (MIT, see THIRD_PARTY.md): quote (a line someone said, word by word), logo-pop (a named brand),
price-tag (a spoken price, optionally the old one struck through), typing (a typed prompt or command,
terminal or chat). These sit above the face (y about 0.24) on a light card that pops in (from 86%, a short
rise, no slow fade) and hold their final frame; pass --at with the spoken word times to land each reveal.
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


LIGHT = {"card": (251, 250, 247, 255), "ink": (29, 27, 24, 255), "muted": (120, 116, 108, 255)}


def _out_back(t):
    t = min(max(t, 0.0), 1.0)
    c1 = 1.70158
    return 1 + (c1 + 1) * (t - 1) ** 3 + c1 * (t - 1) ** 2


def _pop_card(img, card, cx, cy, t, t0=0.0, tilt=0.0):
    """Paste a card that pops in at t0: opaque on its first frame, scale 0.86 -> 1 (outBack), 30 px rise."""
    from PIL import Image
    p = (t - t0) / 0.22
    if p < 0:
        return img
    s = 0.86 + 0.14 * _out_back(p)
    c = card.resize((max(1, int(card.width * s)), max(1, int(card.height * s))), Image.BICUBIC)
    if tilt:
        c = c.rotate(-tilt, resample=Image.BICUBIC, expand=True)
    rise = (1 - ease_out(p)) * 30
    img.alpha_composite(c, (int(cx - c.width / 2), int(cy - c.height / 2 + rise)))
    return img


def _card(w, h, fill=None, radius=None):
    from PIL import ImageDraw
    c = _canvas(int(w), int(h))
    ImageDraw.Draw(c).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius or int(min(w, h) * 0.08),
                                        fill=fill or LIGHT["card"])
    return c


def _wrap(d, words, font, max_w):
    lines, cur = [], []
    for wd in words:
        if cur and d.textlength(" ".join(cur + [wd]), font=font) > max_w:
            lines.append(cur)
            cur = [wd]
        else:
            cur.append(wd)
    return lines + [cur] if cur else lines


def quote(out, text, w=1080, h=1920, fps=30, dur=None, at=None, highlight=None, author="", accent="#2F5BFF",
          y=0.24, tilt=-1.5):
    """A line someone said: big serif-weight words popping in one at a time, on their spoken times."""
    from PIL import ImageDraw
    words = text.split()
    at = at or [0.2 + 0.18 * i for i in range(len(words))]
    dur = dur or min(10.0, max(2.5, at[-1] + 1.6))
    hl = {x.lower().strip(".,!?") for x in (highlight or [])}
    size = int(w * 0.075)
    while True:
        f = _font(size)
        d = ImageDraw.Draw(_canvas(10, 10))
        lines = _wrap(d, words, f, w * 0.74)
        if len(lines) <= 4 or size < w * 0.045:
            break
        size = int(size * 0.92)
    lh = size * 1.18
    cw = w * 0.86
    ch = lh * len(lines) + w * (0.2 if author else 0.13)
    fa = _font(int(w * 0.036), False)

    def frame(t):
        img = _canvas(w, h)
        card = _card(cw, ch)
        cd = ImageDraw.Draw(card)
        cd.text((w * 0.05, -w * 0.02), "\u201c", font=_font(int(w * 0.16)), fill=_rgb(accent))
        k = 0
        for li, line in enumerate(lines):
            x = (cw - cd.textlength(" ".join(line), font=f)) / 2
            for wd in line:
                if t >= at[k]:
                    color = _rgb(accent) if wd.lower().strip(".,!?") in hl else LIGHT["ink"]
                    cd.text((x, w * 0.08 + li * lh), wd, font=f, fill=color)
                x += cd.textlength(wd + " ", font=f)
                k += 1
        if author and t >= at[-1]:
            cd.text((cw / 2, ch - w * 0.06), f"- {author}", font=fa, fill=LIGHT["muted"], anchor="mm")
        return _pop_card(img, card, w / 2, h * y + ch / 2 - w * 0.1, t, 0.0, tilt)
    return _encode(frame, out, w, h, fps, dur)


def logo_pop(out, image, label="", w=1080, h=1920, fps=30, dur=2.5, size=0.28, background="card", y=0.24):
    """A named brand: its logo pops in (from 55%, outBack), the name lands under it. Never tilted."""
    from PIL import Image, ImageDraw
    logo = Image.open(image).convert("RGBA")
    side = int(w * size)
    logo.thumbnail((side, side))
    fl = _font(int(w * 0.05))

    def frame(t):
        img = _canvas(w, h)
        p = t / 0.3
        if p < 0:
            return img
        s = 0.55 + 0.45 * _out_back(p)
        box = int(side * 1.35)
        tile = _card(box, box) if background in ("card", "white") else _canvas(box, box)
        tile.alpha_composite(logo, ((box - logo.width) // 2, (box - logo.height) // 2))
        tile = tile.resize((max(1, int(box * s)), max(1, int(box * s))), Image.BICUBIC)
        cy = h * y + box / 2 - w * 0.08
        img.alpha_composite(tile, (int(w / 2 - tile.width / 2), int(cy - tile.height / 2)))
        if label and t >= 0.18:
            d = ImageDraw.Draw(img)
            d.text((w / 2, cy + box / 2 + w * 0.06), label, font=fl, fill=(255, 255, 255, 255), anchor="mm",
                   stroke_width=int(w * 0.006), stroke_fill=(0, 0, 0, 255))
        return img
    return _encode(frame, out, w, h, fps, dur)


def price_tag(out, value, old=None, label="", w=1080, h=1920, fps=30, dur=None, y=0.24, tilt=-3.0,
              accent="#E0362C"):
    """A spoken price on a tag that slides in from the right; an old price gets struck through first."""
    from PIL import ImageDraw
    dur = dur or (3.2 if old else 2.6)
    fb, fs, fl = _font(int(w * 0.15)), _font(int(w * 0.07)), _font(int(w * 0.045), False)
    d0 = ImageDraw.Draw(_canvas(10, 10))
    tw = max(d0.textlength(str(value), font=fb), d0.textlength(str(old or ""), font=fs)) + w * 0.24
    th = w * (0.36 if old else 0.26) + (w * 0.06 if label else 0)

    def frame(t):
        img = _canvas(w, h)
        tag = _card(tw, th, radius=int(w * 0.04))
        td = ImageDraw.Draw(tag)
        td.ellipse((w * 0.04, th / 2 - w * 0.022, w * 0.084, th / 2 + w * 0.022), fill=(0, 0, 0, 0))  # punched hole
        yy = w * 0.05
        if old:
            td.text((tw / 2 + w * 0.03, yy + w * 0.04), str(old), font=fs, fill=LIGHT["muted"], anchor="mm")
            strike = ease_out((t - 0.35) / 0.2)
            if strike > 0:
                x0 = tw / 2 + w * 0.03 - d0.textlength(str(old), font=fs) / 2
                td.line((x0, yy + w * 0.045, x0 + d0.textlength(str(old), font=fs) * strike, yy + w * 0.035),
                        fill=_rgb(accent), width=int(w * 0.012))
            yy += w * 0.1
        if not old or t >= 0.63:
            td.text((tw / 2 + w * 0.03, yy + w * 0.09), str(value), font=fb, fill=LIGHT["ink"], anchor="mm")
        if label:
            td.text((tw / 2 + w * 0.03, th - w * 0.05), label, font=fl, fill=LIGHT["muted"], anchor="mm")
        slide = (1 - ease_out(t / 0.3)) * w * 0.15
        return _pop_card(img, tag, w / 2 + slide, h * y + th / 2 - w * 0.08, max(t, 0.22), 0, tilt)
    return _encode(frame, out, w, h, fps, dur)


def typing(out, text, response="", style="terminal", w=1080, h=1920, fps=30, dur=None, cps=None, start=0.2, y=0.24):
    """A typed command or prompt: a terminal (traffic lights, mono, caret) or a chat bubble, then a reply."""
    from PIL import ImageDraw
    cps = cps or min(45, max(18, len(text) / 1.6))
    t_end = start + len(text) / cps
    dur = dur or (t_end + (1.8 if response else 1.2))
    mono = _mono(int(w * 0.045))
    cw = w * 0.86
    d0 = ImageDraw.Draw(_canvas(10, 10))
    lines = _wrap(d0, ("> " + text).split(), mono, cw * 0.86)
    rlines = _wrap(d0, response.split(), mono, cw * 0.86) if response else []
    lh = w * 0.06
    ch = w * 0.12 + lh * (len(lines) + len(rlines) + (0.6 if rlines else 0))
    dark = style == "terminal"

    def frame(t):
        img = _canvas(w, h)
        card = _card(cw, ch, fill=(29, 27, 24, 245) if dark else LIGHT["card"], radius=int(w * 0.03))
        cd = ImageDraw.Draw(card)
        if dark:
            for i, c in enumerate(((255, 95, 86), (255, 189, 46), (39, 201, 63))):
                cd.ellipse((w * 0.03 + i * w * 0.04, w * 0.025, w * 0.055 + i * w * 0.04, w * 0.05), fill=c + (255,))
        n = int(max(0, t - start) * cps)
        full, shown = " ".join(" ".join(ln) for ln in lines), 0
        ink = (235, 233, 228, 255) if dark else LIGHT["ink"]
        for li, ln in enumerate(lines):
            s_ = " ".join(ln)
            part = s_[:max(0, min(len(s_), n + 2 - shown))]
            shown += len(s_) + 1
            cd.text((w * 0.04, w * 0.08 + li * lh), part, font=mono, fill=ink)
        if t < t_end and int(t * 2) % 2 == 0:
            cd.rectangle((w * 0.04, w * 0.08 + (len(lines) - 1) * lh + lh * 0.9, w * 0.07,
                          w * 0.08 + (len(lines) - 1) * lh + lh * 0.98), fill=ink)
        if rlines and t >= t_end + 0.3:
            for li, ln in enumerate(rlines):
                cd.text((w * 0.04, w * 0.08 + (len(lines) + 0.6 + li) * lh), " ".join(ln), font=mono,
                        fill=(140, 220, 160, 255) if dark else (47, 91, 255, 255))
        del full
        return _pop_card(img, card, w / 2, h * y + ch / 2 - w * 0.08, t, 0.0, 0)
    return _encode(frame, out, w, h, fps, dur)


def _mono(size):
    import shutil
    import subprocess
    from PIL import ImageFont
    if shutil.which("fc-match"):
        path = subprocess.run(["fc-match", "-f", "%{file}", "JetBrains Mono:bold"], capture_output=True, text=True).stdout
        if path:
            return ImageFont.truetype(path, size)
    return _font(size, False)


TEMPLATES = {"counter": counter, "lower-third": lower_third, "checklist": checklist, "title": title, "cta": cta,
             "quote": quote, "logo-pop": logo_pop, "price-tag": price_tag, "typing": typing}


def make(kind: str, out: str | Path, **kw) -> Path:
    if kind not in TEMPLATES:
        raise EditorError(f"unknown graphic '{kind}'; choose from {list(TEMPLATES)}")
    path = TEMPLATES[kind](Path(out), **{k: v for k, v in kw.items() if v is not None})
    log(f"graphic {kind} -> {path}")
    return path
