"""Voice mastering and music bed.

Chain (all ffmpeg built-ins): rumble high-pass -> denoise -> mud cut / presence
lift / air -> de-esser -> compressor -> optional ducked music -> two-pass EBU R128
loudness normalisation to the platform target (-14 LUFS, -1 dBTP by default).
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .util import EditorError, log, probe, run

PRESETS = {
    # light touch for clean mics (lav / shotgun)
    "clean": ["highpass=f=70", "equalizer=f=250:t=q:w=1:g=-1.5", "equalizer=f=4000:t=q:w=1.2:g=1.5",
              "deesser=i=0.3", "acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=1.5"],
    # phone / laptop mic in a normal room: denoise + more presence + firmer compression
    "phone": ["highpass=f=90", "afftdn=nf=-25:tn=1", "equalizer=f=300:t=q:w=1:g=-2.5",
              "equalizer=f=3500:t=q:w=1.2:g=2.5", "highshelf=f=10000:g=1.5", "deesser=i=0.4",
              "acompressor=threshold=-22dB:ratio=3.5:attack=5:release=90:makeup=2.5"],
    # noisy places (street, fans, AC): stronger spectral denoise
    "noisy": ["highpass=f=100", "afftdn=nf=-20:nr=18:tn=1", "lowpass=f=14000",
              "equalizer=f=300:t=q:w=1:g=-2.5", "equalizer=f=3000:t=q:w=1.2:g=3", "deesser=i=0.45",
              "acompressor=threshold=-24dB:ratio=4:attack=5:release=80:makeup=3"],
}


def master(src: str | Path, out: str | Path, preset: str = "phone", target_lufs: float = -14.0,
           true_peak: float = -1.0, music: str | None = None, music_db: float = -20.0,
           duck: bool = True, rnnoise_model: str | None = None, music_start: float = 0.0) -> Path:
    info = probe(src)
    if not info["has_audio"]:
        raise EditorError(f"{src} has no audio")
    chain = list(PRESETS[preset])
    if rnnoise_model:
        chain.insert(1, f"arnndn=m='{rnnoise_model}'")
    duration = info["duration"]
    inputs = ["-i", str(src)]
    if music:
        inputs += ["-stream_loop", "-1", "-ss", f"{music_start:.3f}", "-i", str(music)]
        fade_st = max(duration - 1.5, 0)
        graph = (f"[0:a]aresample=48000,{','.join(chain)},asplit=2[voice][key];"
                 f"[1:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:{duration:.3f},"
                 f"volume={music_db}dB,afade=t=in:d=0.5,afade=t=out:st={fade_st:.3f}:d=1.5[mus];")
        if duck:
            graph += ("[mus][key]sidechaincompress=threshold=0.04:ratio=8:attack=20:release=400:makeup=1[bed];"
                      "[voice][bed]amix=inputs=2:duration=first:normalize=0")
        else:
            graph += "[key]anullsink;[voice][mus]amix=inputs=2:duration=first:normalize=0"
    else:
        graph = f"[0:a]aresample=48000,{','.join(chain)}"

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
    log(f"mastered audio ({preset}{', +music' if music else ''}) "
        f"{m['input_i']} LUFS -> {target_lufs} LUFS: {out}")
    return out


def measure_loudness(path: str | Path) -> dict:
    proc = run(["ffmpeg", "-i", str(path), "-map", "0:a:0", "-af", "loudnorm=print_format=json",
                "-f", "null", "-"], quiet=False)
    return _loudnorm_json(proc.stderr)


def _loudnorm_json(stderr: str) -> dict:
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", stderr, re.S)
    if not match:
        raise EditorError("could not parse loudnorm output")
    return json.loads(match.group(0))
