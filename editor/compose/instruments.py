"""Synthesized instruments: FM Rhodes, detuned saw pad, pluck, FM lead, sub bass and a drum kit.

A Kit carries the random generator (so a seed reproduces a track exactly) and caches what repeats:
Rhodes/pluck notes by (pitch, length, velocity), and band-limited noise banks that drum hits slice
instead of filtering fresh noise for every hat.
"""
from __future__ import annotations

import numpy as np

from .dsp import SR, filt, mtof, pan, sweep_bp, tt


class Kit:
    def __init__(self, seed: int = 7):
        self.rng = np.random.default_rng(seed)
        self._notes: dict = {}
        self._banks: dict = {}

    # ------------------------------------------------------------ helpers
    def _noise(self, key: str, n: int, fc, kind: str, order: int = 2, chans: int = 1) -> np.ndarray:
        """n samples of filtered noise, sliced at a random offset from a 4 s bank."""
        bank = self._banks.get(key)
        if bank is None or len(bank) < n + SR:
            shape = (max(4 * SR, n + SR),) + ((chans,) if chans > 1 else ())
            bank = self._banks[key] = filt(self.rng.standard_normal(shape), fc, kind, order)
        o = int(self.rng.integers(0, len(bank) - n))
        return bank[o:o + n]

    def _cached(self, key, make):
        y = self._notes.get(key)
        if y is None:
            y = self._notes[key] = make().astype(np.float32)
        return y

    # ------------------------------------------------------------ tonal
    def rhodes(self, f: float, dur: float, vel: float = 0.8) -> np.ndarray:
        def make():
            n = int((dur + 0.6) * SR)
            t = tt(n)
            index = (0.8 + 2.2 * vel) * np.exp(-t / 0.3) + 0.3
            w = 2 * np.pi * f * t
            car = np.sin(w + index * np.sin(w))
            tine = np.sin(2 * np.pi * min(f * 14, 18000) * t) * np.exp(-t / 0.018) * 0.3 * vel
            bark = np.sin(2 * w + 0.6 * np.sin(w)) * np.exp(-t / 0.12) * 0.25 * vel
            amp = np.exp(-t / (2.2 if f < 300 else 1.4))
            gate = np.where(t < dur, 1.0, np.exp(-(t - dur) / 0.12))
            return (car + tine + bark) * amp * gate * np.minimum(t / 0.002, 1) * vel
        return self._cached(("rhodes", round(f, 3), round(dur, 4), round(vel, 4)), make)

    def saw_pad(self, notes, dur: float, att: float = 0.6, rel: float = 1.0, det=(-9, 0, 8)) -> np.ndarray:
        """Detuned 3-saw-per-note pad (stereo). Two random-phase takes per chord, alternated, are cached."""
        key = ("pad", tuple(notes), round(dur, 4), att, rel, tuple(det))
        take = self._takes = getattr(self, "_takes", {})
        k = take[key] = take.get(key, -1) + 1

        def make():
            n = int((dur + rel) * SR)
            t = tt(n)
            out = np.zeros((n, 2))
            for m in notes:
                f = mtof(m)
                for d, p in zip(det, (-0.7, 0, 0.7)):
                    saw = 2 * ((f * 2 ** (d / 1200) * t + self.rng.random()) % 1) - 1
                    a = (p + 1) * np.pi / 4
                    out[:, 0] += np.cos(a) * saw
                    out[:, 1] += np.sin(a) * saw
            env = np.minimum(t / att, 1) * np.where(t < dur, 1, np.exp(-(t - dur) / (rel / 3)))
            return out * (env / np.sqrt(len(notes) * 3))[:, None]
        return self._cached(key + (k % 2,), make)

    def pluck(self, f: float, dur: float = 0.3, dec: float = 0.12, bright: float = 0.4) -> np.ndarray:
        def make():
            n = int(dur * SR)
            t = tt(n)
            w = 2 * np.pi * f * t
            s = np.sin(w + bright * np.exp(-t / 0.03) * np.sin(2 * w)) + 0.25 * np.sin(2 * w) * np.exp(-t / 0.05)
            return s * np.exp(-t / dec) * np.minimum(t / 0.002, 1) * np.clip((dur - t) / 0.02, 0, 1)
        return self._cached(("pluck", round(f, 3), dur, dec, bright), make)

    def lead(self, f: float, dur: float, vel: float = 0.7) -> np.ndarray:
        n = int((dur + 0.3) * SR)
        t = tt(n)
        vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(t / 0.4, 1)
        ph = 2 * np.pi * np.cumsum(f * vib) / SR
        s = np.sin(ph + 0.7 * np.sin(ph) * (0.5 + 0.5 * np.exp(-t / 0.2))) + 0.15 * np.sin(2 * ph)
        env = np.minimum(t / 0.03, 1) * np.where(t < dur, 0.85 + 0.15 * np.exp(-t / 0.2), np.exp(-(t - dur) / 0.08))
        return s * env * vel

    def sub(self, f: float, dur: float, vel: float = 0.8) -> np.ndarray:
        def make():
            n = int((dur + 0.08) * SR)
            t = tt(n)
            s = np.sin(2 * np.pi * f * t) + 0.12 * np.sin(4 * np.pi * f * t)
            env = np.minimum(t / 0.006, 1) * np.where(t < dur, 1, np.exp(-(t - dur) / 0.025))
            return np.tanh(1.4 * s * env)
        return self._cached(("sub", round(f, 3), round(dur, 4)), make) * vel

    # ------------------------------------------------------------ drums
    def kick(self, vel: float = 1.0, dec: float = 0.3) -> np.ndarray:
        n = int(0.5 * SR)
        t = tt(n)
        body = self._cached(("kick", dec), lambda: np.sin(2 * np.pi * np.cumsum(46 + 95 * np.exp(-t / 0.032)) / SR)
                            * np.exp(-t / dec))
        click = self._noise("kick-click", n, 2500, "high") * np.exp(-t / 0.003) * 0.25
        return np.tanh(1.6 * (body + click)) * vel

    def hat(self, vel: float = 0.5, dec: float = 0.03, n_s: float = 0.25) -> np.ndarray:
        n = int(n_s * SR)
        return self._noise("hat", n, 7500, "high") * np.exp(-tt(n) / dec) * vel

    def snare(self, vel: float = 0.6) -> np.ndarray:
        n = int(0.35 * SR)
        t = tt(n)
        tone = self._cached(("snare-tone",), lambda: np.sin(2 * np.pi * (185 + 40 * np.exp(-t / 0.01)) * t)
                            * np.exp(-t / 0.05))
        nz = self._noise("snare", n, (1200, 7000), "band") * np.exp(-t / 0.11)
        return (0.8 * nz + 0.6 * tone) * vel

    def clap(self, vel: float = 0.6) -> np.ndarray:
        n = int(0.4 * SR)
        t = tt(n)
        e = np.zeros(n)
        for k, o in enumerate((0, 0.009, 0.018)):
            e += (t >= o) * np.exp(-np.maximum(t - o, 0) / (0.006 if k < 2 else 0.12))
        return self._noise("clap", n, (900, 5000), "band") * e * vel

    def crash(self, vel: float = 0.4, dec: float = 1.4) -> np.ndarray:
        n = int(dec * 3 * SR)
        t = tt(n)
        nz = self._noise("crash", n, 4500, "high", chans=2)
        return nz * (np.exp(-t / dec) * np.minimum(t / 0.003, 1))[:, None] * vel

    def swell(self, dur: float, f0: float = 300, f1: float = 6000, vel: float = 0.3) -> np.ndarray:
        """Filtered-noise swell (band-pass sweeping up, rising level) into a section change."""
        n = int(dur * SR)
        t = tt(n)
        y = sweep_bp(self.rng.standard_normal(n), f0 * (f1 / f0) ** (t / dur), 1.5) * (t / dur) ** 2 * vel
        return pan(y, 0)
