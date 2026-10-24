---
name: audio-polish
description: Make voice audio sound professional and add background music — denoise, EQ, de-ess, compression, music ducking and loudness normalisation to platform targets (-14 LUFS). Use when the user says the audio is bad/noisy/quiet/echoey, wants music added, or the QA loudness check fails.
---

# Audio polish

```bash
python3 -m editor audio projects/<n>/work/cut.mkv -o projects/<n>/work/voice.wav \
    --preset phone [--music projects/<n>/music/track.mp3 --music-db -20] [--lufs -14]
```
The render picks up `work/voice.wav` automatically.

| preset | chain | when |
|---|---|---|
| `clean` | HPF 70 Hz, light mud cut, presence, de-ess, 2.5:1 comp | lav / shotgun / USB mic, quiet room |
| `phone` (default) | HPF 90, FFT denoise, mud cut, presence + air, de-ess, 3.5:1 comp | phone or laptop mic |
| `noisy` | HPF 100, strong denoise, LPF 14k, firmer comp | street, fans, AC hum |

Always two-pass EBU R128 to **-14 LUFS integrated, -1 dBTP** (Reels, TikTok,
Shorts, YouTube all normalise near there; louder only gets turned down).

## Music
- Drop one file in `projects/<n>/music/` or pass `--music`. It loops to length,
  fades in 0.5 s / out 1.5 s, and is sidechain-ducked under the voice.
- `--music-db`: -18 (energetic) to -24 (talky). The voice must always win; if
  the user says "can't hear the music", go up 2 dB at a time, not more.
- Only use music the user owns or has licensed. Say so if they ask you to find music.

## Diagnosing
- Hiss/hum left over: try `noisy`, or an RNNoise model: `--rnnoise-model path/to/sh.rnnn`
  (models: github.com/GregorR/rnnoise-models).
- Sibilant/harsh: raise `deesser=i=` in `editor/audio.py` PRESETS.
- Room echo can't be fully removed; say so, and suggest a closer mic next time.
- Listen proxy: you can't hear, so check numbers. `python3 -m editor check out.mp4`
  reports LUFS and true peak; `ffmpeg -i out.mp4 -af astats -f null -` shows clipping.
