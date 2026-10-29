"""Sound design: effects placed on visible events.

Real recordings win: drop your own (or licensed, or `editor gen sfx`-generated) files into
library/sfx/<type>/ (e.g. library/sfx/whoosh/air-01.wav) and they are used, rotating between
variants so no two hits sound identical, with each file's transient found automatically. Without
them every effect is synthesized here (numpy), so there is nothing to license. Rules from
video-use's launch edits:
  * every effect is tied to something visible (a card landing, a step pill, a snap zoom);
  * fewer is better: auto mode caps density (default one every 3 s);
  * hit on the frame: each file starts `attack` seconds before the event, so its
    transient lands exactly on the visible frame;
  * effects sit well under the voice (-18 to -26 dB relative) and are mixed before the limiter.
EDL: "sfx": "auto" (default) | "none" | [{"type": "whoosh", "at": 5.6, "db": -20}, ...]
Auto also scores transitions: whips and zooms get a whoosh, glitches a glitch, shakes an impact.
"""
from __future__ import annotations

import subprocess
import wave
from pathlib import Path

import numpy as np

from .util import log

SR = 48000
CACHE = Path(__file__).resolve().parent.parent / "library" / "sfx"
# type: (attack seconds = time from file start to the transient, default level dB)
TYPES = {"whoosh": (0.22, -22.0), "pop": (0.0, -20.0), "click": (0.0, -24.0), "riser": (1.1, -24.0),
         "impact": (0.0, -18.0), "ding": (0.0, -22.0), "whip": (0.12, -21.0), "glitch": (0.0, -24.0)}
AUDIO_EXT = {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aif", ".aiff"}
TRANSITION_SFX = {"whip": "whip", "zoom": "whoosh", "glitch": "glitch", "shake": "impact"}


def _env(n, attack, decay):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / decay)


def _noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)


def _bandpass_sweep(x, f0, f1):
    """Cheap time-varying band-pass via spectrogram masking (offline, no scipy)."""
    n_fft, hop = 1024, 256
    win = np.hanning(n_fft)
    frames = 1 + (len(x) - n_fft) // hop
    out = np.zeros(len(x))
    norm = np.zeros(len(x))
    freqs = np.fft.rfftfreq(n_fft, 1 / SR)
    for k in range(frames):
        seg = x[k * hop:k * hop + n_fft] * win
        spec = np.fft.rfft(seg)
        c = f0 * (f1 / f0) ** (k / max(frames - 1, 1))
        spec *= np.exp(-0.5 * (np.log2(np.maximum(freqs, 1) / c) / 0.6) ** 2)
        out[k * hop:k * hop + n_fft] += np.fft.irfft(spec) * win
        norm[k * hop:k * hop + n_fft] += win ** 2
    return out / np.maximum(norm, 1e-6)


def synth(kind: str) -> np.ndarray:
    if kind == "whoosh":
        n = int(0.45 * SR)
        x = _bandpass_sweep(_noise(n, 1), 300, 5000)
        t = np.arange(n) / SR
        env = np.where(t < 0.22, (t / 0.22) ** 2, np.exp(-(t - 0.22) / 0.07))
        y = x * env
    elif kind == "pop":
        n = int(0.09 * SR)
        t = np.arange(n) / SR
        f = 900 * np.exp(-t * 28) + 260
        y = np.sin(2 * np.pi * np.cumsum(f) / SR) * _env(n, 0.002, 0.03)
    elif kind == "click":
        n = int(0.03 * SR)
        y = _bandpass_sweep(_noise(n + 1024, 3), 3000, 3000)[:n] * _env(n, 0.0005, 0.006)
    elif kind == "riser":
        n = int(1.2 * SR)
        t = np.arange(n) / SR
        tone = np.sin(2 * np.pi * np.cumsum(200 + 900 * (t / 1.2) ** 2) / SR)
        y = (0.5 * tone + 0.5 * _bandpass_sweep(_noise(n, 4), 400, 6000)) * (t / 1.2) ** 2.5
        y[int(1.1 * SR):] *= np.linspace(1, 0, n - int(1.1 * SR))
    elif kind == "impact":
        n = int(0.8 * SR)
        t = np.arange(n) / SR
        boom = np.sin(2 * np.pi * np.cumsum(90 * np.exp(-t * 6) + 40) / SR) * _env(n, 0.002, 0.25)
        y = boom + 0.25 * _bandpass_sweep(_noise(n, 5), 2500, 800) * _env(n, 0.001, 0.05)
    elif kind == "whip":
        n = int(0.26 * SR)
        x = _bandpass_sweep(_noise(n, 6), 700, 7000)
        t = np.arange(n) / SR
        y = x * np.where(t < 0.12, (t / 0.12) ** 3, np.exp(-(t - 0.12) / 0.04))
    elif kind == "glitch":
        n = int(0.22 * SR)
        t = np.arange(n) / SR
        gate = (np.floor(t * 60) % 2 == 0).astype(float)
        crush = np.round(_noise(n, 7) * 3) / 3
        buzz = np.sign(np.sin(2 * np.pi * 180 * t))
        y = (0.6 * crush * gate + 0.4 * buzz * (1 - gate)) * _env(n, 0.001, 0.12)
    elif kind == "ding":
        n = int(0.9 * SR)
        t = np.arange(n) / SR
        y = sum(a * np.sin(2 * np.pi * f * t) for f, a in ((1320, 1.0), (2640, 0.35), (3960, 0.12))) * _env(n, 0.002, 0.25)
    else:
        raise ValueError(f"unknown sfx type {kind}")
    return (y / (np.max(np.abs(y)) + 1e-9) * 0.89).astype(np.float32)


def variants(kind: str) -> list[Path]:
    d = CACHE / kind
    return sorted(p for p in d.iterdir() if p.suffix.lower() in AUDIO_EXT) if d.is_dir() else []


_ATTACK: dict[str, float] = {}


def attack_of(path: Path) -> float:
    """Seconds from the file start to its loudest moment (where the hit lands)."""
    key = str(path)
    if key not in _ATTACK:
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", key, "-ac", "1", "-ar", "8000", "-f", "f32le", "-"],
                             capture_output=True).stdout
        x = np.abs(np.frombuffer(raw, np.float32))
        if len(x) < 80:
            _ATTACK[key] = 0.0
        else:
            env = np.convolve(x, np.ones(80) / 80, mode="same")  # 10 ms envelope
            _ATTACK[key] = round(float(np.argmax(env)) / 8000, 3)
    return _ATTACK[key]


def path_for(kind: str, k: int = 0) -> Path:
    """A real recording from library/sfx/<kind>/ (variant k, rotating) if there is one, else the synth."""
    real = variants(kind)
    if real:
        return real[k % len(real)]
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / f"{kind}.wav"
    if not p.exists():
        y = synth(kind)
        stereo = np.repeat((y * 32767).astype(np.int16)[:, None], 2, axis=1)
        with wave.open(str(p), "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(stereo.tobytes())
    return p


def plan_events(edl: dict, duration: float, min_spacing: float = 3.0, transitions: list[dict] | None = None
                ) -> list[dict]:
    spec = edl.get("sfx", "auto")
    if spec == "none" or not spec:
        return []
    if isinstance(spec, list):
        events = [dict(e) for e in spec]
    else:
        events = []
        for b in edl.get("broll", []):
            events.append({"type": "whoosh", "at": float(b["start"]), "why": "b-roll in"})
        for c in edl.get("chapters", []) or []:
            events.append({"type": "pop", "at": float(c["start"]), "why": "step pill"})
        for z in edl.get("zooms", []):
            if float(z.get("ease", 0.18)) == 0:
                events.append({"type": "click", "at": float(z["start"]), "why": "snap zoom"})
        for tr in transitions or []:
            kind = TRANSITION_SFX.get(tr["kind"])
            if kind and tr.get("why") == "edl":
                events.append({"type": kind, "at": float(tr["at"]), "why": f"{tr['type']} transition"})
        events.sort(key=lambda e: e["at"])
        kept, last = [], -1e9
        for e in events:  # density cap: fewer effects reads as designed, not stock
            if e["at"] - last >= min_spacing:
                kept.append(e)
                last = e["at"]
        events = kept
    out = []
    for k, e in enumerate(events):
        attack, db = TYPES[e["type"]]
        f = Path(e["file"]) if e.get("file") else path_for(e["type"], k)
        if f.parent != CACHE or e.get("file"):   # a real recording: find where its hit is
            attack = attack_of(f)
        start = float(e["at"]) - attack
        if start < 0 or e["at"] > duration:
            continue
        out.append({**e, "file": str(f), "start": round(start, 3), "db": float(e.get("db", db))})
    if out:
        log(f"sfx: {len(out)} effects ({', '.join(sorted({e['type'] for e in out}))})")
    return out
