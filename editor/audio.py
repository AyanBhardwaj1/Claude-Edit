"""Voice mastering and music bed.

Chain (all ffmpeg built-ins): rumble high-pass -> denoise -> mud cut / presence
lift / air -> de-esser -> compressor -> optional ducked music -> two-pass EBU R128
loudness normalisation to the platform target (-14 LUFS, -1 dBTP by default).

Realism:
  * room tone: every cut has a 30 ms fade, which drops the room's air for a moment. A real editor lays
    room tone under the cuts; `room_tone_fill` finds the quietest pause in the original takes and lays
    a soft bed of it under each cut, so the background never blinks.
  * AI denoise: with an RNNoise model in library/models/rnnoise/ (`editor models rnnoise`), speech is
    denoised by the neural model before the spectral denoiser (better on fans, traffic, keyboards).
  * presets "studio" (warm broadcast voice, two-stage compression) and "podcast" (denser, closer).
"""
from __future__ import annotations

import json
import re
import subprocess
import wave
from pathlib import Path

import numpy as np

from .util import EditorError, load_json, log, probe, run

PRESETS = {
    # light touch for clean mics (lav / shotgun)
    "clean": ["highpass=f=70", "equalizer=f=250:t=q:w=1:g=-1.5", "equalizer=f=4000:t=q:w=1.2:g=1.5",
              "deesser=i=0.3", "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=1.5"],
    # phone / laptop mic in a normal room: denoise + more presence + firmer compression
    "phone": ["highpass=f=90", "afftdn=nf=-25:tn=1", "equalizer=f=300:t=q:w=1:g=-2.5",
              "equalizer=f=3500:t=q:w=1.2:g=2.5", "highshelf=f=10000:g=1.5", "deesser=i=0.4",
              "acompressor=threshold=-22dB:ratio=3.5:attack=5:release=90:makeup=2.5"],
    # warm broadcast voice for good mics: low warmth, presence, air, two-stage (level then glue) compression
    "studio": ["highpass=f=75", "lowshelf=f=150:g=1.5", "equalizer=f=320:t=q:w=1.1:g=-2",
               "equalizer=f=4500:t=q:w=1.3:g=2", "highshelf=f=11000:g=2", "deesser=i=0.35",
               "acompressor=threshold=-21dB:ratio=3:attack=12:release=160:makeup=2",
               "acompressor=threshold=-12dB:ratio=2:attack=3:release=60:makeup=1"],
    # podcast / voiceover: closer and denser, light denoise
    "podcast": ["highpass=f=80", "afftdn=nf=-30:tn=1", "lowshelf=f=120:g=2", "equalizer=f=350:t=q:w=1:g=-2.5",
                "equalizer=f=3800:t=q:w=1.2:g=2.5", "highshelf=f=10000:g=1.5", "deesser=i=0.45",
                "acompressor=threshold=-24dB:ratio=4:attack=6:release=100:makeup=3",
                "acompressor=threshold=-12dB:ratio=2.5:attack=2:release=50:makeup=1"],
    # noisy places (street, fans, AC): stronger spectral denoise
    "noisy": ["highpass=f=100", "afftdn=nf=-20:nr=18:tn=1", "lowpass=f=14000",
              "equalizer=f=300:t=q:w=1:g=-2.5", "equalizer=f=3000:t=q:w=1.2:g=3", "deesser=i=0.45",
              "acompressor=threshold=-24dB:ratio=4:attack=5:release=80:makeup=3"],
}


def master(src: str | Path, out: str | Path, preset: str = "phone", target_lufs: float = -14.0,
           true_peak: float = -1.0, music: str | None = None, music_db: float = -20.0,
           duck: bool = True, rnnoise_model: str | None = None, music_start: float = 0.0,
           fill: str | Path | None = None) -> Path:
    info = probe(src)
    if not info["has_audio"]:
        raise EditorError(f"{src} has no audio")
    chain = list(PRESETS[preset])
    if rnnoise_model is None and preset in ("phone", "noisy", "podcast"):
        from .models import rnnoise_model as library_model
        rnnoise_model = library_model(download=False)
    if rnnoise_model:
        chain.insert(1, f"arnndn=m='{rnnoise_model}'")
    duration = info["duration"]
    inputs = ["-i", str(src)]
    voice_in = "[0:a]aresample=48000"
    if music:
        inputs += ["-stream_loop", "-1", "-ss", f"{music_start:.3f}", "-i", str(music)]
        fade_st = max(duration - 1.5, 0)
        graph = (f"{voice_in},{','.join(chain)},asplit=2[voice][key];"
                 f"[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{duration:.3f},"
                 f"volume={music_db}dB,afade=t=in:d=0.5,afade=t=out:st={fade_st:.3f}:d=1.5[mus];")
        if duck:
            graph += ("[mus][key]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400:makeup=1[bed];"
                      "[voice][bed]amix=inputs=2:duration=first:normalize=0")
        else:
            graph += "[key]anullsink;[voice][mus]amix=inputs=2:duration=first:normalize=0"
    else:
        graph = f"{voice_in},{','.join(chain)}"
    if fill:   # room tone under the cuts, mixed in before the chain so it is processed like the voice
        fi = 2 if music else 1
        inputs += ["-i", str(fill)]
        graph = (f"[0:a]aresample=48000,aformat=channel_layouts=stereo[v0];"
                 f"[{fi}:a]aresample=48000,aformat=channel_layouts=stereo[rt];"
                 f"[v0][rt]amix=inputs=2:duration=first:normalize=0[vf];" + graph.replace(voice_in, "[vf]anull", 1))

    # pass 1: measure
    measure = run(["ffmpeg", *inputs, "-filter_complex",
                   f"{graph},loudnorm=I={target_lufs}:TP={true_peak}:LRA=11:print_format=json[out]",
                   "-map", "[out]", "-f", "null", "-"], quiet=False)
    m = _loudnorm_json(measure.stderr)
    # pass 2: apply linear normalisation using the measured values
    ln = (f"loudnorm=I={target_lufs}:TP={true_peak}:LRA=11:measured_I={m['input_i']}:"
          f"measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:"
          f"offset={m['target_offset']}:linear=true")
    out = Path(out)
    run(["ffmpeg", "-y", *inputs, "-filter_complex", f"{graph},{ln},aresample=48000[out]",
         "-map", "[out]", "-t", f"{duration:.3f}", "-c:a", "pcm_s24le", out])
    log(f"mastered audio ({preset}{', +music' if music else ''}{', +room tone' if fill else ''}"
        f"{', +RNNoise' if rnnoise_model else ''}) "
        f"{m['input_i']} LUFS -> {target_lufs} LUFS: {out}")
    return out


def room_tone_fill(work: str | Path, out: str | Path | None = None, piece: float = 0.24) -> Path | None:
    """A track of room tone laid under every cut of work/cut.mkv (None if no clean pause exists)."""
    work = Path(work)
    meta = load_json(work / "cut_meta.json")
    edl = load_json(meta["edl"]) if Path(meta["edl"]).exists() else {}
    cuts = [s["end"] for s in meta["timeline"][:-1]]
    if not cuts:
        return None
    best = None
    for k, src in enumerate(edl.get("sources", [])):
        x = _decode(src["path"], 16000, mono=True, limit=600)
        win, hop = 8000, 800                              # 0.5 s windows, 50 ms hop
        if len(x) < win * 2:
            continue
        sq = np.concatenate([[0.0], np.cumsum(x.astype(np.float64) ** 2)])
        starts = np.arange(0, len(x) - win, hop)
        rms = np.sqrt((sq[starts + win] - sq[starts]) / win)
        ok = rms > 1e-5                                   # not digital silence
        if not ok.any():
            continue
        i = int(np.argmin(np.where(ok, rms, np.inf)))
        floor_db, median_db = 20 * np.log10(rms[i]), 20 * np.log10(np.median(rms[ok]) + 1e-9)
        if median_db - floor_db < 12:                     # no real pause in this take
            continue
        if best is None or floor_db < best[0]:
            best = (floor_db, k, starts[i] / 16000)
    if best is None:
        log("room tone: no clean pause found in the takes, skipped")
        return None
    _, k, t0 = best
    tone = _decode(edl["sources"][k]["path"], 48000, start=t0, dur=0.5)
    sr, n = 48000, int(meta["duration"] * 48000) + 1
    bed = np.zeros((n, 2), np.float32)
    m = int(piece * sr)
    reps = np.tile(tone, (int(np.ceil(m / len(tone))) + 1, 1))[:m]
    env = np.hanning(m)[:, None].astype(np.float32)
    for c in cuts:
        a = int((c - piece / 2) * sr)
        lo, hi = max(a, 0), min(a + m, n)
        if hi > lo:
            bed[lo:hi] += (reps * env)[lo - a:hi - a]
    out = Path(out or work / "roomtone.wav")
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(bed, -1, 1) * 32767).astype(np.int16).tobytes())
    log(f"room tone: {len(cuts)} cuts filled from source {k} at {t0:.2f}s ({best[0]:.0f} dBFS) -> {out}")
    return out


def _decode(path, sr, mono=False, start=0.0, dur=None, limit=None):
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{start:.3f}", "-i", str(path)]
    if dur or limit:
        cmd += ["-t", f"{dur or limit:.3f}"]
    cmd += ["-map", "0:a:0", "-ac", "1" if mono else "2", "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True).stdout
    x = np.frombuffer(raw, np.float32)
    return x if mono else x.reshape(-1, 2)


def measure_loudness(path: str | Path) -> dict:
    proc = run(["ffmpeg", "-i", str(path), "-map", "0:a:0", "-af", "loudnorm=print_format=json",
                "-f", "null", "-"], quiet=False)
    return _loudnorm_json(proc.stderr)


def _loudnorm_json(stderr: str) -> dict:
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr, re.S)
    if not match:
        raise EditorError("could not parse loudnorm output")
    return json.loads(match.group(0))
