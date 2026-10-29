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
| `studio` | HPF 75, low warmth, mud cut, presence, air, de-ess, two-stage comp (level, then glue) | good mic, "make it sound like a podcast / radio" |
| `podcast` | `studio` denser and closer, light denoise | voiceovers, talking heads that should feel intimate |

**Realism, built in** (`editor auto` does these by default):
- **Room tone under every cut**: each cut's 30 ms fade drops the room's air for a moment; the quietest pause in the
  original takes is laid softly under each cut (`work/roomtone.wav`) so the background never blinks.
  `--no-room-tone` turns it off; `editor audio ... --room-tone` does it by hand.
- **Neural denoise**: with the RNNoise model (`python3 -m editor models rnnoise`, `./setup.sh` fetches it),
  `phone` / `noisy` / `podcast` run it before the spectral denoiser: much better on fans, traffic and keyboards.
- **Natural sound from b-roll**: `"nat": -18` on a b-roll entry plays that clip's own audio under the voice
  (faded in/out), the way documentary editors keep a shot alive. -14 to -22 dB.

Always two-pass EBU R128 to **-14 LUFS integrated, -1 dBTP** (Reels, TikTok,
Shorts, YouTube all normalise near there; louder only gets turned down).

## Music
- Drop one file in `projects/<n>/music/` or pass `--music`. It loops to length,
  fades in 0.5 s / out 1.5 s, and is sidechain-ducked under the voice.
- `--music-db`: -18 (energetic) to -24 (talky). The voice must always win; if
  the user says "can't hear the music", go up 2 dB at a time, not more.
- Only use music the user owns or has licensed. Say so if they ask you to find music. If they have none and
  ask for it, an original bed can be generated (`editor gen music`, ai-generate skill).

## Sound effects
**Real recordings sound best**: put the user's own / licensed files (or ones made with
`editor gen sfx "<prompt>" --type whoosh`, ai-generate skill) in `library/sfx/<type>/`, e.g.
`library/sfx/whoosh/air-01.wav`. They're used automatically, rotating between variants, each placed so its
loudest moment lands on the frame. Without them the effects are synthesized in `editor/sfx.py`
(whoosh, whip, pop, click, riser, impact, ding, glitch), so there's nothing to license.
`"sfx": "auto"` (EDL default) ties a whoosh to each b-roll/card entrance, a pop to each step pill and a
click to snap zooms, a whip/whoosh/glitch/impact to each transition, at most one every 3 s, each started early by its attack so the hit lands on the
frame. Override with a list: `"sfx": [{"type": "impact", "at": 12.4, "db": -16}]`, or `"none"`.
Fewer is better: ~8 effects in a minute reads as designed, 20 reads as stock.

## Diagnosing
- Hiss/hum left over: try `noisy`; check `editor doctor` shows the RNNoise model (or pass
  `--rnnoise-model path/to/other.rnnn`, models: github.com/GregorR/rnnoise-models).
- Sibilant/harsh: raise `deesser=i=` in `editor/audio.py` PRESETS.
- Room echo can't be fully removed; say so, and suggest a closer mic next time.
- Listen proxy: you can't hear, so check numbers. `python3 -m editor check out.mp4`
  reports LUFS and true peak; `ffmpeg -i out.mp4 -af astats -f null -` shows clipping.
