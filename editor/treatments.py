"""B-roll treatments: Reel Studio's named looks, expanded into what render.py draws.

EDL broll entries may name a "treatment" instead of a raw "mode" (anchor them on words, see anchors.py):

  card-above-head  a picture of the thing named, over the hair, down to the brows, sized to read
  side-card        beside the face ("side": left | right | auto)
  phone-card       an app, site, post or message inside a phone, beside the face
  full-frame       covers the frame (face hidden): footage or a picture that IS the moment
  split-top        the asset on the top band, the speaker moved to the bottom ("split": 0.3-0.5)
  text-pop         words on screen: "style": "pop" (big outlined capitals, tilted) or "label" (dark on a
                   white box: hook titles and "2: Editing" step labels); "text" is what it says
  post-wall        "items": [pictures]: a full-screen grid, one tile per spoken word
  icon-wall        "items": [logos]: a grid above the face, one logo per spoken word
  animation        a rendered .mov overlay (editor graphic ...), shown as is

Cards get Reel Studio's default look: a short tilt (about -2.5 degrees) on stills, level on clips.
Placement is face-aware (placement.py); when a card can't read where it was asked it moves beside
the face, then to a split view, and the render log says so in plain words.
"""
from __future__ import annotations

import math
from pathlib import Path

from .placement import SAFE_TOP, SIDE, caption_top, core, face_box, kind_of, place_card
from .util import log, probe

IMAGE_EXT = (".png", ".jpg", ".jpeg", ".webp")


def _aspect(path: str) -> float:
    if Path(path).suffix.lower() in IMAGE_EXT:
        from PIL import Image
        with Image.open(path) as im:
            return im.width / im.height
    v = probe(path)["video"]
    return v["width"] / v["height"]


def expand(broll: list[dict], work: str | Path, W: int, H: int) -> list[dict]:
    """Turn treatment entries into card / split / overlay / full entries (others pass through)."""
    work = Path(work)
    out_dir = work / "treatments"
    out = []
    for n, b in enumerate(broll):
        t = b.get("treatment")
        if not t and not (b.get("mode") == "card" and b.get("place")):
            out.append(b)
            continue
        b = dict(b)
        start, dur = float(b["start"]), float(b["dur"])
        face = face_box(work, W, H, start, start + dur)
        if t in ("full-frame",):
            b["mode"] = "full" if abs(math.log(_aspect(b["path"]) / (W / H))) < 0.22 else "contain"
        elif t in ("card-above-head", "side-card", "phone-card") or b.get("mode") == "card":
            phone = t == "phone-card" or b.get("frame") == "phone"
            want = b.get("side", b.get("place", "auto"))
            if (t == "side-card" or phone) and want == "auto":
                want = "beside"
            kind = b.get("kind") or ("photo" if phone else kind_of(b["path"]))
            aspect = 9 / 19.5 if phone else _aspect(b["path"])
            spot = place_card(aspect, kind, face, W, H, side=want)
            if spot["mode"] == "split":
                b["mode"], b["split"] = "split", b.get("split", 0.42)
            else:
                b.update(mode="card", x=round(spot["x"], 4), y=round(spot["y"], 4), width=round(spot["width"], 4),
                         max_height=1.0)
                if phone:
                    b["frame"] = "phone"
                still = Path(b["path"]).suffix.lower() in IMAGE_EXT and not phone
                toward = 2.0 if spot["x"] * W < face["cx"] else -2.0      # side cards lean toward the face
                b.setdefault("tilt", (toward if "beside" in spot["how"] else -2.5) if still else 0)
            log(f"b-roll {Path(b['path']).name}: {spot['how']}")
        elif t == "split-top":
            b["mode"] = "split"
        elif t == "text-pop":
            b.update(mode="overlay", path=str(text_pop(out_dir / f"textpop{n}.png", b.get("text") or b.get("spoken", ""),
                                                       b.get("style", "pop"), face, W, H, b.get("tilt"))))
        elif t in ("post-wall", "icon-wall"):
            items = b.get("items") or [b["path"]]
            times = b.get("word_times") or []
            steps = _step_times(len(items), start, dur, times)
            for k in range(len(items)):
                png = wall(out_dir / f"{t}{n}_{k}.png", items[:k + 1], t, face, W, H, total=len(items))
                s0 = steps[k]
                s1 = steps[k + 1] if k + 1 < len(steps) else start + dur
                out.append({**b, "mode": "overlay", "path": str(png), "start": round(s0, 3),
                            "dur": round(max(0.05, s1 - s0), 3), "treatment": None})
            continue
        elif t == "animation":
            b["mode"] = "overlay"
        out.append(b)
    return out


def _step_times(n: int, start: float, dur: float, times: list[float]) -> list[float]:
    """When each of n items appears: on the spoken words if there are enough, else evenly."""
    if len(times) >= n:                                  # item k lands on spoken word k
        return [round(max(start, t - 0.05), 3) for t in times[:n]]
    step = min(0.6, dur / max(1, n + 1))
    return [start + i * step for i in range(n)]


def _font(size: int):
    from .viz import _font as f
    return f(size, True)


def text_pop(out: Path, text: str, style: str, face: dict, W: int, H: int, tilt: float | None = None) -> Path:
    """Words above the face: "pop" = big outlined capitals, "label" = dark text on a white rounded box."""
    from PIL import Image, ImageDraw
    out.parent.mkdir(parents=True, exist_ok=True)
    label = style == "label"
    text = text.strip() if label else text.strip().upper()
    c = core(face)
    zone_top, zone_bottom = SAFE_TOP * H, max(SAFE_TOP * H + 0.12 * H, c["y0"] - 0.01 * H)
    max_w = W - 2 * SIDE * W
    size = int((0.075 if label else 0.11) * W)
    while True:
        font = _font(size)
        lines = _balance(text, font, max_w * 0.9)
        lh = int(size * 1.12)
        tw = max(font.getlength(ln) for ln in lines)
        th = lh * len(lines)
        pad_x, pad_y = (0.42 * size, 0.26 * size) if label else (0, 0)
        if (tw + 2 * pad_x <= max_w and th + 2 * pad_y <= zone_bottom - zone_top) or size <= 0.045 * W:
            break
        size = int(size * 0.9)
    bw, bh = int(tw + 2 * pad_x + 20), int(th + 2 * pad_y + 20)
    card = Image.new("RGBA", (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    if label:
        d.rounded_rectangle([10, 10, bw - 10, bh - 10], radius=int(0.25 * size), fill=(255, 255, 255, 255))
    for i, ln in enumerate(lines):
        x = (bw - font.getlength(ln)) / 2
        y = 10 + pad_y + i * lh
        if label:
            d.text((x, y), ln, font=font, fill=(17, 17, 17, 255))
        else:
            d.text((x, y), ln, font=font, fill=(255, 255, 255, 255), stroke_width=max(2, int(0.09 * size)),
                   stroke_fill=(0, 0, 0, 255))
    angle = tilt if tilt is not None else (0 if label else -3)
    if angle:
        card = card.rotate(-angle, resample=Image.BICUBIC, expand=True)
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    cx = min(max(face["cx"], card.width / 2 + SIDE * W), W - card.width / 2 - SIDE * W)
    y = max(zone_top, zone_bottom - card.height)
    frame.alpha_composite(card, (int(cx - card.width / 2), int(y)))
    frame.save(out)
    return out


def _balance(text: str, font, max_w: float) -> list[str]:
    words = text.split()
    if font.getlength(text) <= max_w or len(words) < 2:
        return [text]
    best, best_d = [text], 1e9
    for k in range(1, len(words)):
        a, b = " ".join(words[:k]), " ".join(words[k:])
        d = abs(font.getlength(a) - font.getlength(b))
        if max(font.getlength(a), font.getlength(b)) <= max_w and d < best_d:
            best, best_d = [a, b], d
    return best


def wall(out: Path, items: list[str], kind: str, face: dict, W: int, H: int, total: int) -> Path:
    """post-wall: a full-screen grid of 9:16 tiles. icon-wall: logos in a grid above the face."""
    from PIL import Image, ImageDraw, ImageOps
    out.parent.mkdir(parents=True, exist_ok=True)
    if kind == "post-wall":
        frame = Image.new("RGBA", (W, H), (16, 16, 16, 255))
        cols, gap = 3, int(0.012 * W)
        tw = (W - (cols + 1) * gap) // cols
        th = int(tw * 16 / 9)
        rows = max(1, min(math.ceil(total / cols), (H - gap) // (th + gap)))
        y0 = (H - rows * (th + gap) + gap) // 2
        for i, p in enumerate(items[:rows * cols]):
            r, c = divmod(i, cols)
            tile = ImageOps.fit(_open(p), (tw, th), centering=(0.5, 0.3))
            mask = Image.new("L", (tw, th), 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw - 1, th - 1], radius=int(0.012 * W), fill=255)
            frame.paste(tile, (gap + c * (tw + gap), y0 + r * (th + gap)), mask)
        frame.save(out)
        return out
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    c = core(face)
    top, bottom = SAFE_TOP * H, max(SAFE_TOP * H + 0.15 * H, c["y0"] - 0.01 * H)
    zw, zh = W - 2 * SIDE * W, bottom - top
    best = None
    for cols in range(1, total + 1):
        rows = math.ceil(total / cols)
        cell = min(zw / cols, zh / rows)
        if best is None or cell > best[0]:
            best = (cell, cols, rows)
    cell, cols, rows = best
    full = cell < 0.13 * W
    if full:                                            # too many to read above the face: a full-screen wall
        frame = Image.new("RGBA", (W, H), (16, 16, 16, 255))
        top, zh = 0.15 * H, 0.65 * H
        cols = math.ceil(math.sqrt(total * zw / zh))
        rows = math.ceil(total / cols)
        cell = min(zw / cols, zh / rows)
    x0 = (W - cols * cell) / 2
    y0 = top + (zh - rows * cell) / 2
    for i, p in enumerate(items):
        r, k = divmod(i, cols)
        pad = int(cell * 0.1)
        logo = _open(p)
        logo.thumbnail((int(cell - 2 * pad), int(cell - 2 * pad)))
        x, y = int(x0 + k * cell), int(y0 + r * cell)
        import numpy as np
        arr = np.asarray(logo)
        vis = arr[..., 3] > 32
        lum = float((arr[..., :3][vis] @ [0.299, 0.587, 0.114]).mean()) if vis.any() else 255.0
        if lum < 70 or full:
            ImageDraw.Draw(frame).rounded_rectangle([x + pad // 2, y + pad // 2, x + int(cell) - pad // 2,
                                                     y + int(cell) - pad // 2], radius=int(cell * 0.12),
                                                    fill=(255, 255, 255, 255), outline=(40, 40, 40, 255), width=2)
        frame.alpha_composite(logo, (x + (int(cell) - logo.width) // 2, y + (int(cell) - logo.height) // 2))
    frame.save(out)
    return out


def _open(p: str):
    from PIL import Image
    if Path(p).suffix.lower() in IMAGE_EXT:
        return Image.open(p).convert("RGBA")
    import subprocess
    import tempfile
    tmp = Path(tempfile.mkdtemp()) / "f.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "0.5", "-i", str(p), "-frames:v", "1", str(tmp)], check=False)
    return Image.open(tmp).convert("RGBA")


def caption_band_top(H: int, W: int) -> float:
    return caption_top(H, W=W)
