"""Signal-processing building blocks for `editor compose` (numpy/scipy, all vectorised).

Everything works on float64 buffers at 48 kHz: mono = shape (n,), stereo = shape (n, 2).
Mastering and file writing go through ffmpeg (loudnorm two-pass, 24-bit WAV).
"""
from __future__ import annotations

import json
import re
import subprocess
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from functools import lru_cache
from pathlib import Path

import numpy as np
import scipy.signal as ss
from scipy.ndimage import maximum_filter1d, uniform_filter1d

from ..util import EditorError, log, require_bin

SR = 48000


def mtof(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(n: int) -> np.ndarray:
    return np.arange(n) / SR


def add(buf: np.ndarray, x: np.ndarray, start: float) -> None:
    """Mix x into buf at `start` seconds (clipped at both ends; a negative start drops x's head)."""
    i = int(round(start * SR))
    if i < 0:
        x, i = x[-i:], 0
    if i >= len(buf) or len(x) == 0:
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += x[:j - i]


def addp(buf: np.ndarray, x: np.ndarray, start: float, p: float = 0.0, gain: float = 1.0) -> None:
    """add() for a mono source panned (equal power) into a stereo buffer, without building a stereo copy."""
    i = int(round(start * SR))
    if i < 0:
        x, i = x[-i:], 0
    if i >= len(buf) or len(x) == 0:
        return
    j = min(len(buf), i + len(x))
    a = (p + 1) * np.pi / 4
    seg = x[:j - i]
    buf[i:j, 0] += seg * (gain * np.cos(a))
    buf[i:j, 1] += seg * (gain * np.sin(a))


def pan(x: np.ndarray, p: float) -> np.ndarray:
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], 1)


@lru_cache(maxsize=None)
def _sos(fc, kind: str, order: int):
    return ss.butter(order, list(fc) if isinstance(fc, tuple) else fc, kind, fs=SR, output="sos")


def filt(x: np.ndarray, fc, kind: str = "low", order: int = 2) -> np.ndarray:
    """Butterworth filter (kind: low | high | band) along time."""
    key = tuple(fc) if isinstance(fc, (list, tuple)) else float(fc)
    return ss.sosfilt(_sos(key, kind, order), x, axis=0)


def sweep_bp(x: np.ndarray, fc, q: float = 1.0, n_fft: int = 1024, hop: int = 256) -> np.ndarray:
    """Time-varying resonant band-pass (fc may be an array, one value per sample).

    Replaces the per-sample state-variable filter loop: the signal is cut into overlapping frames, each
    frame's spectrum is shaped by a 2-pole band-pass response centred on that frame's fc (gain q at fc,
    like a Chamberlin SVF), then overlap-added. Fully vectorised.
    """
    x = np.asarray(x, float)
    n = len(x)
    fc = np.broadcast_to(np.asarray(fc, float), (n,))
    xp = np.concatenate([np.zeros(n_fft), x, np.zeros(2 * n_fft)])
    frames = 1 + (len(xp) - n_fft) // hop
    idx = hop * np.arange(frames)[:, None] + np.arange(n_fft)[None, :]
    win = np.hanning(n_fft)
    spec = np.fft.rfft(xp[idx] * win, axis=1)
    centre = np.clip(hop * np.arange(frames) + n_fft // 2 - n_fft, 0, n - 1)
    c = np.clip(fc[centre], 20, SR / 2.2)[:, None]
    f = np.maximum(np.fft.rfftfreq(n_fft, 1 / SR), 1.0)[None, :]
    spec *= q / np.sqrt(1 + q * q * (f / c - c / f) ** 2)
    out = np.zeros(len(xp))
    norm = np.zeros(len(xp))
    np.add.at(out, idx, np.fft.irfft(spec, n_fft, axis=1) * win)
    np.add.at(norm, idx, np.broadcast_to(win * win, idx.shape))
    return (out / np.maximum(norm, 1e-3))[n_fft:n_fft + n]


@lru_cache(maxsize=8)
def _ir(rt: float, pre: float, bright: float, seed: int) -> np.ndarray:
    r = np.random.default_rng(seed)
    n = int(rt * SR)
    ir = r.standard_normal((n, 2)) * np.exp(-tt(n) * 6.9 / rt)[:, None]
    ir = filt(ir, bright, "low", 1)
    k = int(0.004 * SR)
    ir[:k] *= np.linspace(0, 1, k)[:, None]
    ir = np.vstack([np.zeros((int(pre * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(0))


def reverb(x: np.ndarray, rt: float = 2.2, pre: float = 0.02, bright: float = 6000, seed: int = 3) -> np.ndarray:
    """Convolution reverb with a synthetic stereo decaying-noise impulse response (wet only)."""
    ir = _ir(float(rt), float(pre), float(bright), seed)
    with ThreadPoolExecutor(2) as ex:
        chans = list(ex.map(lambda c: ss.oaconvolve(x[:, c], ir[:, c])[:len(x)], range(2)))
    return np.stack(chans, 1)


def delay(x: np.ndarray, dt: float, fb: float = 0.4, taps: int = 5, lpf: float = 4000, pingpong: bool = True
          ) -> np.ndarray:
    """Feedback delay (wet only): each repeat darker and quieter, ping-ponging between channels."""
    y = np.zeros_like(x)
    d = int(dt * SR)
    cur = x
    for k in range(1, taps + 1):
        if k * d >= len(x):
            break
        cur = filt(cur, lpf, "low", 1) * fb
        if pingpong:
            cur = cur[:, ::-1]
        y[k * d:] += cur[:len(x) - k * d]
    return y


def chorus(x: np.ndarray, rate: float = 0.5, depth: float = 0.003, base: float = 0.012, mix: float = 0.5
           ) -> np.ndarray:
    n = len(x)
    t = tt(n)
    idx = np.arange(n)
    y = np.empty_like(x)
    for c, ph in enumerate((0, np.pi / 2)):
        pos = idx - (base + depth * np.sin(2 * np.pi * rate * t + ph)) * SR  # modulated read position
        i0 = np.floor(pos).astype(np.int64)
        fr = pos - i0
        lo = np.clip(i0, 0, n - 1)
        hi = np.clip(i0 + 1, 0, n - 1)
        y[:, c] = np.where(i0 >= 0, x[lo, c] * (1 - fr) + x[hi, c] * fr, 0.0)
    return x * (1 - mix) + y * mix


def sidechain(n: int, times, depth: float = 0.6, tau: float = 0.16) -> np.ndarray:
    """Gain curve that dips by `depth` at each time and recovers with time constant tau (kick pumping)."""
    imp = np.zeros(n)
    idx = (np.asarray(list(times), float) * SR).astype(int)
    imp[idx[(idx >= 0) & (idx < n)]] = 1
    a = np.exp(-1 / (tau * SR))
    e = ss.lfilter([1], [1, -a], imp)
    e = uniform_filter1d(np.clip(e, 0, 1), int(0.004 * SR))
    return 1 - depth * e


def limit(x: np.ndarray, ceil_db: float) -> np.ndarray:
    """Look-ahead brickwall-ish limiter (4 ms window, smoothed gain)."""
    c = 10 ** (ceil_db / 20)
    a = np.abs(x).max(1) if x.ndim == 2 else np.abs(x)
    need = np.minimum(1, c / np.maximum(a, 1e-9))
    w = int(0.004 * SR)
    g = uniform_filter1d(-maximum_filter1d(-need, 2 * w + 1), w)
    return x * (g[:, None] if x.ndim == 2 else g)


def stereo(x: np.ndarray) -> np.ndarray:
    x = np.asarray(x, float)
    return np.stack([x, x], 1) if x.ndim == 1 else x


def true_peak_db(x: np.ndarray) -> float:
    """4x-oversampled peak in dBFS, oversampling only the blocks within 3 dB of the sample peak."""
    x = stereo(x)
    a = np.abs(x).max(1)
    pk = a.max()
    if pk <= 0:
        return -120.0
    blk = 4096
    m = -(-len(a) // blk)
    bmax = np.pad(a, (0, m * blk - len(a))).reshape(m, blk).max(1)
    best = pk
    for k in np.flatnonzero(bmax >= pk * 0.7):
        i0, i1 = max(0, k * blk - 64), min(len(x), (k + 1) * blk + 64)
        best = max(best, np.abs(ss.resample_poly(x[i0:i1], 4, 1, axis=0)).max())
    return float(20 * np.log10(best))


_KW = np.array([[1.53512485958697, -2.69169618940638, 1.19839281085285, 1.0, -1.69065929318241, 0.73248077421585],
                [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])  # BS.1770 K-weighting, 48 kHz


def lufs_of(x: np.ndarray) -> float:
    """Integrated loudness (ITU-R BS.1770-4: K-weighting, 400 ms blocks, absolute + relative gates)."""
    p = (ss.sosfilt(_KW, stereo(x), axis=0) ** 2).sum(1)
    hop = SR // 10
    m = len(p) // hop
    if m < 4:
        return -70.0
    seg = p[:m * hop].reshape(m, hop).sum(1)
    z = (seg[:-3] + seg[1:-2] + seg[2:-1] + seg[3:]) / (4 * hop)
    loud = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
    gated = z[loud > -70]
    if not len(gated):
        return -70.0
    rel = -0.691 + 10 * np.log10(gated.mean()) - 10
    return float(-0.691 + 10 * np.log10(z[(loud > -70) & (loud > rel)].mean()))


# ---------------------------------------------------------------- files and loudness

def _ffmpeg(x: np.ndarray, args: list[str]) -> str:
    """Pipe a float stereo buffer into ffmpeg; returns stderr."""
    require_bin("ffmpeg")
    cmd = ["ffmpeg", "-hide_banner", "-nostats", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "pipe:0", *args]
    proc = subprocess.run(cmd, input=np.ascontiguousarray(stereo(x), np.float32).tobytes(), capture_output=True)
    err = proc.stderr.decode(errors="replace")
    if proc.returncode != 0:
        raise EditorError("ffmpeg failed: " + "\n".join(err.strip().splitlines()[-8:]))
    return err


def _loudnorm_json(err: str) -> dict:
    blob = err[err.rfind("{"):err.rfind("}") + 1]
    if not blob:
        raise EditorError("loudnorm printed no measurement")
    return json.loads(blob)


def measure(x: np.ndarray, lufs: float = -16.0, tp: float = -1.5) -> dict:
    """loudnorm pass 1: integrated loudness, true peak, LRA, threshold."""
    j = _loudnorm_json(_ffmpeg(x, ["-af", f"loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json", "-f", "null", "-"]))
    return {k: float(j[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}


def write_wav(x: np.ndarray, path: str | Path) -> Path:
    """48 kHz stereo 24-bit WAV."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    _ffmpeg(x, ["-c:a", "pcm_s24le", "-ar", str(SR), str(path)])
    return path


def master(x: np.ndarray, path: str | Path, lufs: float = -16.0, tp: float = -1.5) -> dict:
    """Glue, limit and loudness-normalise to `lufs` integrated with true peak <= `tp`, then write.

    numpy does the gain and the look-ahead limiting (so loudnorm never has to fall back to its
    pumping dynamic mode); ffmpeg loudnorm measures (pass 1) and applies the final linear trim
    (pass 2, linear=true), writing 48 kHz 24-bit stereo.
    """
    x = stereo(x)
    pk = np.abs(x).max()
    if pk < 1e-9:
        raise EditorError("nothing to master: the mix is silent")
    x = np.tanh(1.4 * x / pk) / np.tanh(1.4)  # gentle glue
    ceil = tp - 0.7
    for _ in range(8):  # fast numpy loudness/true-peak loop to get close, then ffmpeg for the exact trim
        level, peak = lufs_of(x), true_peak_db(x)
        if abs(level - lufs) < 0.2 and peak <= tp - 0.2:
            break
        x = limit(x * 10 ** ((lufs - level) / 20), ceil)
        peak = true_peak_db(x)
        if peak > tp - 0.2:
            ceil -= (peak - (tp - 0.2)) + 0.2
    m = measure(x, lufs, tp)  # loudnorm pass 1
    lra = float(np.clip(np.ceil(m["input_lra"] + 1), 11, 50))  # linear mode needs measured LRA <= target
    af = (f"loudnorm=I={lufs}:TP={tp}:LRA={lra}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={max(m['input_thresh'], -99)}:"
          f"offset={m['target_offset']}:linear=true:print_format=json")
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    j = _loudnorm_json(_ffmpeg(x, ["-af", af, "-ar", str(SR), "-c:a", "pcm_s24le", str(path)]))
    if j.get("normalization_type") != "linear":
        log(f"compose: loudnorm used {j.get('normalization_type')} mode (expected linear)")
    return {**ebur128(path), "normalization": j.get("normalization_type")}


def ebur128(path: str | Path) -> dict:
    """Independent check of a written file: integrated LUFS, LRA and true peak (ffmpeg ebur128)."""
    require_bin("ffmpeg")
    err = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "ebur128=peak=true",
                          "-f", "null", "-"], capture_output=True, text=True).stderr
    summary = err[err.rfind("Summary:"):]

    def grab(label: str) -> float | None:
        m = re.search(label + r":\s+(-?[\d.]+|-inf)", summary)
        return None if not m or m.group(1) == "-inf" else float(m.group(1))
    return {"lufs": grab("I"), "true_peak": grab("Peak"), "lra": grab("LRA")}


def peak_normalise(x: np.ndarray, path: str | Path, db: float = -1.5) -> dict:
    """Scale so the (4x oversampled) true peak sits at `db` dBFS, then write."""
    x = stereo(x)
    x = x * 10 ** ((db - true_peak_db(x)) / 20)
    write_wav(x, path)
    return {"true_peak": round(db, 2)}


def sidecar(path: str | Path, kind: str, params: dict, measured: dict, extra: dict | None = None) -> Path:
    """<file>.json provenance next to every file compose writes."""
    path = Path(path)
    data = {"generator": "editor compose", "original": True, "licence": "original work, royalty-free",
            "kind": kind, "created": date.today().isoformat(), "file": path.name, "params": params,
            "measured": measured, **(extra or {})}
    side = path.with_name(path.name + ".json")
    side.write_text(json.dumps(data, indent=2) + "\n")
    return side
