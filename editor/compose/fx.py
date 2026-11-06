"""Studio SFX and ambiences, synthesized (from the Walk-Free demo's sound design).

Each SFX returns a stereo buffer and its default peak level (dBFS). Short hits are peak-normalised;
ambiences are long beds meant to sit low in the mix (the mix sets their level).
"""
from __future__ import annotations

import numpy as np

from .dsp import SR, add, filt, mtof, pan, reverb, sweep_bp, tt
from .instruments import Kit


def _panned(y: np.ndarray, p: np.ndarray) -> np.ndarray:
    a = (p + 1) * np.pi / 4
    return np.stack([y * np.cos(a), y * np.sin(a)], 1)


def whoosh(kit: Kit, length: float | None = None) -> np.ndarray:
    dur = length or 0.5
    n = int(dur * SR)
    u = tt(n) / dur
    y = sweep_bp(kit.rng.standard_normal(n), 300 + 3200 * np.sin(np.pi * u) ** 2, 1.2) * np.sin(np.pi * u) ** 2
    return _panned(y, -0.8 + 1.6 * u) * 1.414


def whoosh_rev(kit: Kit, length: float | None = None) -> np.ndarray:
    return whoosh(kit, length)[::-1].copy()


def whip(kit: Kit, length: float | None = None) -> np.ndarray:
    dur = length or 0.25
    n = int(dur * SR)
    t = tt(n)
    u = t / dur
    y = sweep_bp(kit.rng.standard_normal(n), 7000 * 0.12 ** u, 1.5) * np.minimum(t / 0.01, 1) * np.exp(-t / (0.28 * dur))
    return _panned(y, 0.7 - 1.4 * u)


def click(kit: Kit, length: float | None = None) -> np.ndarray:
    n = int(0.06 * SR)
    t = tt(n)
    y = (np.sin(2 * np.pi * 2300 * t) * np.exp(-t / 0.004) * 0.6 + np.sin(2 * np.pi * 650 * t) * np.exp(-t / 0.008) * 0.5
         + filt(kit.rng.standard_normal(n), 3000, "high") * np.exp(-t / 0.0015) * 0.4)
    return pan(y * np.clip((0.06 - t) / 0.01, 0, 1), 0)


def pop(kit: Kit, length: float | None = None) -> np.ndarray:
    n = int(0.15 * SR)
    t = tt(n)
    y = np.sin(2 * np.pi * np.cumsum(280 + 700 * (1 - np.exp(-t / 0.02))) / SR) * np.minimum(t / 0.002, 1) \
        * np.exp(-t / 0.035)
    return pan(y * np.clip((0.15 - t) / 0.02, 0, 1), 0)


def thud(kit: Kit, length: float | None = None) -> np.ndarray:
    n = int(0.3 * SR)
    t = tt(n)
    y = np.sin(2 * np.pi * np.cumsum(48 + 70 * np.exp(-t / 0.025)) / SR) * np.exp(-t / 0.08) \
        + filt(kit.rng.standard_normal(n), 400, "low") * np.exp(-t / 0.02) * 0.4
    return pan(np.tanh(1.5 * y) * np.clip((0.3 - t) / 0.03, 0, 1), 0)


def shutter(kit: Kit, length: float | None = None) -> np.ndarray:
    n = int(0.25 * SR)
    t = tt(n)
    y = np.zeros(n)
    for o in (0.0, 0.11):
        tc = np.maximum(t - o, 0)
        y += (t >= o) * (filt(kit.rng.standard_normal(n), [1500, 9000], "band") * np.exp(-tc / 0.006)
                         + np.sin(2 * np.pi * 1300 * tc) * np.exp(-tc / 0.01) * 0.5)
    y += filt(kit.rng.standard_normal(n), [800, 4000], "band") * ((t > 0.01) & (t < 0.11)) * 0.06
    return pan(y * np.clip((0.25 - t) / 0.02, 0, 1), 0)


def paper(kit: Kit, length: float | None = None) -> np.ndarray:
    dur = length or 0.8
    n = int(dur * SR)
    rng = kit.rng
    dens = np.sin(np.pi * tt(n) / dur) ** 0.7
    imp = np.zeros(n)
    k = rng.integers(0, n, int(1750 * dur))
    imp[k] = rng.standard_normal(len(k)) * dens[k]
    grain = np.exp(-np.arange(60) / 12)
    y = filt(np.convolve(imp, grain)[:n], [1200, 9000], "band") \
        + filt(rng.standard_normal(n), [2000, 6000], "band") * dens * 0.08
    y2 = filt(np.convolve(np.roll(imp, 300), grain)[:n], [800, 7000], "band")
    return np.stack([y, 0.6 * y + 0.4 * y2], 1)


def ding(kit: Kit, length: float | None = None, freq: float = 1318.5) -> np.ndarray:
    dur = length or 0.8
    n = int(dur * SR)
    t = tt(n)
    y = sum(a * np.sin(2 * np.pi * freq * r * t) * np.exp(-t / d)
            for r, a, d in ((1, 1, 0.35), (2.0, 0.35, 0.18), (2.76, 0.2, 0.12), (5.4, 0.08, 0.05), (0.5, 0.2, 0.3)))
    y = pan(y * np.minimum(t / 0.002, 1) * np.clip((dur - t) / 0.08, 0, 1), 0)
    return y + 0.2 * reverb(y, 0.8)


# name: (function, default peak dBFS, what it is for)
SFX = {
    "whoosh": (whoosh, -1.5, "air past the camera: b-roll in, slide transitions"),
    "whoosh_rev": (whoosh_rev, -1.5, "reverse whoosh: sucks into a cut"),
    "whip": (whip, -1.5, "fast whip pan"),
    "click": (click, -3.0, "UI tap / snap zoom"),
    "pop": (pop, -2.0, "a pill or bubble appearing"),
    "thud": (thud, -1.5, "soft low impact: a card landing, a stat slamming in"),
    "shutter": (shutter, -1.5, "camera shutter: a screenshot or photo"),
    "paper": (paper, -1.5, "paper / page turn"),
    "ding": (ding, -3.0, "bell: a tick, a success, a notification"),
}


def render_sfx(name: str, seed: int = 7, length: float | None = None, key: str | None = None) -> np.ndarray:
    fn = SFX[name][0]
    kit = Kit(seed)
    if name == "ding" and key:
        from .music import parse_key
        pc, _ = parse_key(key)
        return fn(kit, length, freq=mtof(84 + pc))  # the key's tonic, octave 6
    return fn(kit, length)


def mono(name: str, seed: int = 7) -> np.ndarray:
    """Mono version for editor/sfx.py's registry."""
    return render_sfx(name, seed).mean(1)


# ---------------------------------------------------------------- ambiences

def cicadas(kit: Kit, length: float = 20.0) -> np.ndarray:
    rng = kit.rng
    n = int(length * SR)
    t = tt(n)
    x = np.zeros((n, 2))
    for _ in range(5):
        fc = rng.uniform(4200, 7200)
        buzz, per = rng.uniform(140, 320), rng.uniform(4, 9)
        nz = filt(rng.standard_normal(n), [fc * 0.9, fc * 1.1], "band", 2) + 0.3 * np.sin(2 * np.pi * fc * t)
        am = (0.5 + 0.5 * np.sin(2 * np.pi * buzz * t)) ** 3
        swell = np.clip(np.sin(2 * np.pi * t / per + rng.uniform(0, 6)) * 1.4 + 0.4, 0, 1) ** 2
        x += pan(nz * am * swell * rng.uniform(0.4, 1), rng.uniform(-0.8, 0.8))
    return x + filt(rng.standard_normal((n, 2)), 500, "low", 1) * 0.05


def birdsong(kit: Kit, length: float = 28.0) -> np.ndarray:
    rng = kit.rng
    n = int(length * SR)
    x = filt(np.cumsum(rng.standard_normal((n, 2)), 0) * 0.002, [80, 1200], "band", 1) * 0.6
    for lo, hi, cd, p in ((2800, 4800, 0.08, -0.5), (3800, 6200, 0.05, 0.4), (2200, 3400, 0.14, 0.1)):
        tp = rng.uniform(0.5, 3)
        while tp < length - 1.5:
            for _ in range(int(rng.integers(3, 8))):
                d = cd * rng.uniform(0.6, 1.4)
                m = int(d * SR)
                u = tt(m) / d
                f0, f1 = rng.uniform(lo, hi), rng.uniform(lo, hi)
                fr = f0 + (f1 - f0) * u + 300 * np.sin(2 * np.pi * rng.uniform(25, 60) * tt(m))
                ch = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.sin(np.pi * u) ** 2 * rng.uniform(0.3, 0.8)
                add(x, pan(ch, p), tp)
                tp += d + rng.uniform(0.03, 0.12)
            tp += rng.uniform(1.5, 5)
    return x + 0.3 * reverb(x, 1.5, bright=8000)


def room(kit: Kit, length: float = 20.0) -> np.ndarray:
    """Quiet interior air: pinkish noise rolled off above 4 kHz, a faint low rumble, slow drift."""
    rng = kit.rng
    n = int(length * SR)
    spec = np.fft.rfft(rng.standard_normal((n, 2)), axis=0)
    f = np.maximum(np.fft.rfftfreq(n, 1 / SR), 20)[:, None]
    spec *= 1 / np.sqrt(f) / (1 + (f / 4000) ** 2) * (f > 40)
    x = np.fft.irfft(spec, n, axis=0)
    x /= np.abs(x).max() + 1e-12
    rumble = filt(rng.standard_normal((n, 2)), 120, "low", 2)
    x += 0.5 * rumble / (np.abs(rumble).max() + 1e-12)
    drift = 1 + 0.08 * np.sin(2 * np.pi * tt(n) / 7.3 + rng.uniform(0, 6))
    return x * drift[:, None]


# kind: (function, default peak dBFS)
AMBIENCES = {"cicadas": (cicadas, -9.0), "birdsong": (birdsong, -6.0), "room": (room, -12.0)}


def render_ambience(kind: str, length: float = 20.0, seed: int = 7) -> np.ndarray:
    x = AMBIENCES[kind][0](Kit(seed), length)
    fade = np.clip(np.minimum(tt(len(x)), length - tt(len(x))) / min(1.0, length / 4), 0, 1)
    return x * fade[:, None]
