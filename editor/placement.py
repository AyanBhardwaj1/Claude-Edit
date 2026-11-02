"""Face-aware placement: where a picture can go on a talking-head frame without hiding the face.

The protected zone is eyes-to-chin (from just above the brows to the chin, outer eyes plus a margin),
not the whole head: a card may cover hair, forehead and the sides of the head. The caption band and
the platform's top bar are kept clear too. Rules follow Reel Studio's engine (MIT, see THIRD_PARTY.md):
a card is placed as low as the brows allow and sized to read (text card >= 55% of the width, photo
>= 30%, logo >= 22%); if that can't read, it goes beside the face (>= 40% for text), then a split view.

The face box comes from work/track.json mapped through the same face-follow crop render.py uses.
"""
from __future__ import annotations

from pathlib import Path

from .util import load_json

SAFE_TOP, SAFE_BOTTOM, SIDE = 0.17, 0.83, 0.035
MIN_W = {"text": 0.55, "photo": 0.30, "logo": 0.22}
SIDE_MIN_TEXT = 0.40
FACE_Y = 0.38          # render.py keeps the face centre here in a reframed shot


def face_box(work: str | Path, W: int, H: int, t0: float, t1: float, pad: float = 0.4) -> dict:
    """The face (pixels, output frame) over a time window: the union of the tracked samples."""
    work = Path(work)
    meta = load_json(work / "cut_meta.json") if (work / "cut_meta.json").exists() else None
    tr = load_json(work / "track.json")["samples"] if (work / "track.json").exists() else []
    near = [s for s in tr if t0 - pad <= s["t"] <= t1 + pad] if meta else []
    if not near:                                     # no track: a 36%-wide face where the reframe keeps it
        fw = 0.36 * W
        return {"x0": W / 2 - fw / 2, "x1": W / 2 + fw / 2, "y0": FACE_Y * H - 0.65 * fw,
                "y1": FACE_Y * H + 0.65 * fw, "cx": W / 2, "fw": fw, "found": False}
    sw, sh = meta["width"], meta["height"]
    ar = W / H
    bw, bh = (sh * ar, sh) if sw / sh > ar else (sw, sw / ar)            # the crop render.py takes
    xs, ys, ws = [], [], []
    for s in near:
        x0 = min(max(s["cx"] * sw - bw / 2, 0), sw - bw)
        y0 = min(max(s["cy"] * sh - FACE_Y * bh, 0), sh - bh)
        xs.append((s["cx"] * sw - x0) / bw * W)
        ys.append((s["cy"] * sh - y0) / bh * H)
        ws.append(s.get("fw", 0.2) * sw / bw * W)
    fw = max(ws)
    fh = 1.3 * fw
    return {"x0": min(xs) - fw / 2, "x1": max(xs) + fw / 2, "y0": min(ys) - fh / 2, "y1": max(ys) + fh / 2,
            "cx": sum(xs) / len(xs), "fw": fw, "found": True}


def core(face: dict) -> dict:
    """Eyes-to-chin: the part of the face nothing may cover (outside full-frame treatments)."""
    fw = face["fw"]
    fh = face["y1"] - face["y0"]
    eye_d = 0.465 * fw
    eyes_y = face["y0"] + 0.38 * fh
    return {"x0": face["x0"] + fw / 2 - eye_d / 2 - 0.4 * eye_d - 0.1 * fw,
            "x1": face["x1"] - fw / 2 + eye_d / 2 + 0.4 * eye_d + 0.1 * fw,
            "y0": eyes_y - 0.5 * eye_d, "y1": face["y1"]}


def caption_top(H: int, position: float = 0.73, size: float = 0.085, W: int = 1080) -> float:
    return position * H - 1.35 * size * min(W, H)


def place_card(aspect: float, kind: str, face: dict, W: int, H: int, side: str = "auto",
               cap_top: float | None = None) -> dict:
    """Where a card of this aspect (w/h) goes: {"mode": "card", x, y, width} (fractions) or {"mode": "split"}.
    "how" says which placement won, in plain words, for the render log."""
    c = core(face)
    cap_top = cap_top if cap_top is not None else caption_top(H, W=W)
    margin = SIDE * W
    min_w = MIN_W.get(kind, 0.30) * W

    def fit(zw, zh):
        w = min(zw, zh * aspect, 0.88 * W)
        return w, w / aspect

    if side in ("auto", "above"):                              # above the face, as low as the brows allow
        top, bottom = SAFE_TOP * H, c["y0"] - 0.01 * H
        if bottom - top > 0.06 * H:
            w, h = fit(W - 2 * margin, bottom - top)
            if w >= min_w:
                cx = min(max(face["cx"], margin + w / 2), W - margin - w / 2)
                return {"mode": "card", "x": cx / W, "y": (bottom - h / 2) / H, "width": w / W,
                        "how": "above the face"}
    sides = {"left": (margin, c["x0"] - 0.01 * W), "right": (c["x1"] + 0.01 * W, W - margin)}
    order = [side] if side in sides else sorted(sides, key=lambda k: sides[k][0] - sides[k][1])
    for k in order:                                             # beside the eyes-to-chin zone
        x0, x1 = sides[k]
        top, bottom = SAFE_TOP * H, cap_top - 0.01 * H
        w, h = fit(x1 - x0, bottom - top)
        need = SIDE_MIN_TEXT * W if kind == "text" else min(min_w, 0.22 * W)
        if w >= need:
            cy = min(max((face["y0"] + face["y1"]) / 2, top + h / 2), bottom - h / 2)
            return {"mode": "card", "x": (x0 + x1) / 2 / W, "y": cy / H, "width": w / W,
                    "how": f"beside the face ({k})"}
    return {"mode": "split", "how": "split view (no readable room around the face)"}


def kind_of(path: str | Path) -> str:
    """text / logo / photo, roughly: decides how big a card must be to read."""
    try:
        import numpy as np
        from PIL import Image
        im = Image.open(path)
        if im.mode in ("RGBA", "LA") and np.asarray(im.getchannel("A")).min() < 10:
            return "logo"
        a = np.asarray(im.convert("RGB").resize((96, 96)))
        q = (a // 32).reshape(-1, 3)
        _, counts = np.unique(q, axis=0, return_counts=True)
        top8 = np.sort(counts)[::-1][:8].sum() / len(q)
        if top8 > 0.9:
            g = a.mean(axis=2)
            edges = (np.abs(np.diff(g, axis=1)) > 40).mean()
            return "text" if edges > 0.04 else "logo"
        return "photo"
    except Exception:  # noqa: BLE001 (a video or an unreadable file: treat as a photo-like card)
        return "photo"
