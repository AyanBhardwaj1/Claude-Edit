"""Professional transitions that keep the timeline intact (no word timing moves).

Each transition is centred on a cut (output seconds) and spans `dur` seconds around it: the
outgoing shot builds into the cut and the incoming shot settles out of it, the way editors fake
camera moves across a jump cut.

  whip-left/right/up/down  fast pan with motion blur across the cut (pairs with a whoosh)
  zoom                     punch through the cut: zoom in, land zoomed, ease back, radial blur
  blur                     defocus out and back in
  glitch                   RGB split + displaced slices for a few frames
  leak                     warm film light leak sweeping across the frame
  shake                    impact camera shake after the hit (pairs with an impact)
  flash                    white flash on the cut
  dip                      dip to black and back (a chapter / time-jump break)

EDL "transitions": [{"at": 12.4, "type": "whip-left", "dur": 0.3},
                    {"at": "chapters", "type": "zoom"}, {"at": "cuts", "type": "blur"}]
  "at" is output seconds, or "chapters" (every chapter start), or "cuts" (every cut: use sparingly).
B-roll entries take "in" / "out": fade | slide-left/right/up/down | whip-left/... | flash | dip.

flash and dip are applied to the final composite (ffmpeg eq), so they also work over b-roll; the rest are
applied to the speaker layer frame by frame in render.py.
"""
from __future__ import annotations

import numpy as np

from .util import EditorError

DURATIONS = {"whip": 0.28, "zoom": 0.34, "blur": 0.3, "glitch": 0.2, "leak": 0.8, "shake": 0.4,
             "flash": 0.24, "dip": 0.5}
KINDS = set(DURATIONS)
DIRS = {"left": (-1, 0), "right": (1, 0), "up": (0, -1), "down": (0, 1)}
COMPOSITE = {"flash", "dip"}
BROLL_IN_OUT = {"fade", "flash", "dip"} | {f"{m}-{d}" for m in ("slide", "whip") for d in DIRS}


def kind_of(t: str) -> str:
    k = t.split("-")[0]
    if k not in KINDS or (k == "whip" and t[5:] not in DIRS) or (k != "whip" and "-" in t):
        raise EditorError(f"unknown transition '{t}'. Known: {', '.join(sorted(KINDS - {'whip'}))}, "
                          f"whip-left/right/up/down")
    return k


def expand(edl: dict, duration: float, timeline: list[dict] | None = None) -> list[dict]:
    """Resolve the EDL's transitions (and the b-roll in/out ones) to concrete, sorted entries."""
    out = []
    for tr in edl.get("transitions") or []:
        at = tr.get("at")
        if at == "chapters":
            times = [float(c["start"]) for c in edl.get("chapters") or [] if float(c["start"]) > 0.05]
        elif at == "cuts":
            times = [float(s["end"]) for s in (timeline or [])[:-1]]
        else:
            times = [float(at)]
        for t in times:
            out.append(_entry(t, tr["type"], tr.get("dur"), tr.get("strength", 1.0), "edl"))
    for b in edl.get("broll") or []:
        s, e = float(b["start"]), float(b["start"]) + float(b["dur"])
        for side, t in (("in", s), ("out", e)):
            typ = b.get(side)
            if typ in COMPOSITE:
                out.append(_entry(t, typ, None, 1.0, f"b-roll {side}"))
            elif isinstance(typ, str) and typ.startswith("whip-"):
                # the b-roll whips in over the speaker: blur the speaker layer in the same direction
                out.append(_entry(t, typ, 0.2, 0.6, f"b-roll {side}", shift=False))
    out = [t for t in out if 0 < t["at"] < duration]
    return sorted(out, key=lambda t: t["at"])


def _entry(at, typ, dur, strength, why, shift=True):
    k = kind_of(typ)
    return {"at": round(at, 3), "type": typ, "kind": k, "dur": float(dur or DURATIONS[k]),
            "strength": float(strength), "why": why, "shift": shift}


def _g(t, tr):
    """(u in [-1, 1] across the transition, envelope peaking at 1 on the cut) or None outside it."""
    half = tr["dur"] / 2
    u = (t - tr["at"]) / half
    if abs(u) >= 1:
        return None
    return u, (1 - abs(u)) ** 2


def zoom_boost(transitions: list[dict], n_frames: int, fps: float) -> np.ndarray:
    """Multiplier on the render's zoom curve for "zoom" transitions."""
    m = np.ones(n_frames)
    t = np.arange(n_frames) / fps
    for tr in transitions:
        if tr["kind"] != "zoom":
            continue
        u = (t - tr["at"]) / (tr["dur"] / 2)
        env = np.clip(1 - np.abs(u), 0, 1) ** 2
        m *= 1 + 0.55 * tr["strength"] * env
    return m


def max_boost(transitions: list[dict]) -> float:
    return max([1 + 0.55 * t["strength"] for t in transitions if t["kind"] == "zoom"] + [1.0])


def frame_fx(transitions: list[dict], fps: float):
    """Returns apply(img, frame_index) -> img for the speaker-layer effects, or None if there are none."""
    layer = [t for t in transitions if t["kind"] not in COMPOSITE]
    if not layer:
        return None
    import cv2

    def apply(img, k):
        t = k / fps
        for tr in layer:
            hit = _g(t, tr)
            if hit is None:
                continue
            u, g = hit
            s = tr["strength"]
            kind = tr["kind"]
            if kind == "whip":
                img = _whip(cv2, img, tr["type"][5:], u, g * s, tr.get("shift", True))
            elif kind == "zoom":
                img = _radial_blur(cv2, img, g * s)
            elif kind == "blur":
                if g * s > 0.02:
                    img = cv2.GaussianBlur(img, (0, 0), 1 + 22 * g * s)
            elif kind == "glitch":
                img = _glitch(img, g * s, k)
            elif kind == "leak":
                img = _leak(cv2, img, u, g * s)
            elif kind == "shake" and u >= 0:
                img = _shake(cv2, img, (1 - u) * s, k)
        return img
    return apply


def _whip(cv2, img, direction, u, g, shift):
    h, w = img.shape[:2]
    vx, vy = DIRS[direction]
    if shift:
        amp = 0.45 * g * (w if vx else h)
        sign = 1 if u < 0 else -1          # outgoing travels along v; incoming arrives from the far side
        dx, dy = vx * amp * sign, vy * amp * sign
        img = cv2.warpAffine(img, np.float32([[1, 0, dx], [0, 1, dy]]), (w, h), borderMode=cv2.BORDER_REFLECT_101)
    length = int(g * 0.22 * (w if vx else h))
    if length > 2:
        img = cv2.blur(img, (length, 1) if vx else (1, length))
    return img


def _radial_blur(cv2, img, g):
    if g < 0.03:
        return img
    h, w = img.shape[:2]
    acc = img.astype(np.float32)
    steps = 4
    for i in range(1, steps + 1):
        z = 1 + 0.035 * g * i
        cw, ch = int(w / z), int(h / z)
        x0, y0 = (w - cw) // 2, (h - ch) // 2
        acc += cv2.resize(img[y0:y0 + ch, x0:x0 + cw], (w, h), interpolation=cv2.INTER_LINEAR)
    return (acc / (steps + 1)).astype(np.uint8)


def _glitch(img, g, k):
    if g < 0.15:
        return img
    h, w = img.shape[:2]
    rng = np.random.default_rng(k)
    dx = max(2, int(0.018 * w * g))
    out = img.copy()
    out[..., 0] = np.roll(img[..., 0], dx, axis=1)      # blue right
    out[..., 2] = np.roll(img[..., 2], -dx, axis=1)     # red left
    for _ in range(int(3 + 6 * g)):                     # displaced slices
        y0 = int(rng.integers(0, h - 8))
        bh = int(rng.integers(6, max(8, h // 14)))
        out[y0:y0 + bh] = np.roll(out[y0:y0 + bh], int(rng.integers(-1, 2) * 0.06 * w * g), axis=1)
    return out


def _leak(cv2, img, u, g):
    if g < 0.02:
        return img
    h, w = img.shape[:2]
    sw, sh = max(8, w // 8), max(8, h // 8)
    yy, xx = np.mgrid[0:sh, 0:sw].astype(np.float32)
    cx = (-0.2 + 1.4 * (u + 1) / 2) * sw                 # sweeps left to right across the transition
    cy = 0.35 * sh
    d = np.sqrt(((xx - cx) / (0.55 * sw)) ** 2 + ((yy - cy) / (0.75 * sh)) ** 2)
    a = np.clip(1 - d, 0, 1) ** 1.6 * g
    leak = np.dstack([a * 40, a * 150, a * 255]).astype(np.float32)   # BGR warm orange
    leak = cv2.resize(leak, (w, h), interpolation=cv2.INTER_LINEAR)
    base = img.astype(np.float32)
    return (255 - (255 - base) * (255 - leak) / 255).astype(np.uint8)  # screen blend


def _shake(cv2, img, amp, k):
    if amp < 0.03:
        return img
    h, w = img.shape[:2]
    rng = np.random.default_rng(1000 + k)
    dx, dy = rng.uniform(-1, 1, 2) * 0.022 * w * amp
    z = 1 + 0.03 * amp
    m = np.float32([[z, 0, dx - (z - 1) * w / 2], [0, z, dy - (z - 1) * h / 2]])
    return cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REFLECT_101)


def eq_filter(transitions: list[dict]) -> str | None:
    """flash / dip on the final composite: an eq filter with per-frame brightness and saturation."""
    bright, desat = [], []
    for tr in transitions:
        if tr["kind"] not in COMPOSITE:
            continue
        env = f"pow(max(0,1-abs(t-{tr['at']:.3f})/{tr['dur'] / 2:.3f}),2)"
        s = tr["strength"]
        bright.append(f"{0.6 * s if tr['kind'] == 'flash' else -1.0 * s:.3f}*{env}")
        desat.append(f"{0.7 * s if tr['kind'] == 'flash' else 1.0 * s:.3f}*{env}")
    if not bright:
        return None
    return (f"eq=brightness='{'+'.join(bright)}':saturation='max(0,1-({'+'.join(desat)}))':eval=frame")


def overlay_motion(b: dict, w: int, h: int) -> tuple[str, str]:
    """Overlay x/y expressions for a b-roll's slide/whip in and out."""
    start, end = float(b["start"]), float(b["start"]) + float(b["dur"])
    xs, ys = [], []
    for side in ("in", "out"):
        typ = b.get(side) or ""
        mode, _, direction = typ.partition("-")
        if mode not in ("slide", "whip") or direction not in DIRS:
            continue
        d = 0.35 if mode == "slide" else 0.18
        vx, vy = DIRS[direction]
        if side == "in":   # arrives travelling along v: starts one frame away on the opposite side
            p = f"pow(1-min(1,max(0,(t-{start:.3f})/{d})),3)"
            sx, sy = -vx, -vy
        else:              # leaves travelling along v
            p = f"pow(min(1,max(0,(t-{end - d:.3f})/{d})),3)"
            sx, sy = vx, vy
        if sx:
            xs.append(f"{sx * w}*{p}")
        if sy:
            ys.append(f"{sy * h}*{p}")
    return ("+".join(xs) or "0"), ("+".join(ys) or "0")
