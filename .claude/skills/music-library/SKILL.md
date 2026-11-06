---
name: music-library
description: Pick, add and organise background music in the shared mood-tagged library (library/music, grouped Hype / Uplifting / Emotional / Tense-Dark / Cool-Fun with tags, stars, tempo and loudness). Use for step 4 of a reel edit, when the user pastes a song/reel link to use as music, asks for music that fits, or wants to organise their tracks.
---

# Music library

```bash
python3 -m editor music list [--mood hype]          # library/music/LIBRARY.md, grouped by mood, ★ = favourite
python3 -m editor music add <file-or-url> --mood cool-fun --tags bouncy playful mischievous [--title ...] [--star]
python3 -m editor music tag <id> [--mood ...] [--tags ...] [--star|--unstar] [--notes "..."]
```
Links are downloaded with yt-dlp (audio extracted to m4a). Each track gets an
estimated BPM, loudness and duration. That's how you judge energy, since you
can't listen.

## Picking a track (step 4)
1. Name the video's emotional arc in a few words (e.g. "playful flex, ends on a joke").
2. Map it to a mood:
   - **Hype**: wins, launches, fast tutorials, challenges
   - **Uplifting**: growth stories, motivation, milestones
   - **Emotional**: personal stories, setbacks, gratitude
   - **Tense/Dark**: warnings, mistakes, "nobody tells you", reveals
   - **Cool/Fun**: tech demos, behind-the-scenes, lighthearted, self-deprecating humour
3. Within the mood prefer ★ tracks, then the **measured feel** in `editor music list` ("sounds driving, bright
   (energy 0.72)": measured by listening, never from the file name), then tags, then BPM. Heartfelt: gentle.
   Comedy: upbeat, light. Explainer or day story: upbeat, steady. Rant, hot take, hype: driving, hype.
4. Write it to the EDL: `"music": {"track": "<id>", "level": "under-voice"}`. Levels are measured against the
   voice: `under-voice` (19 dB under, default), `quiet` (24 dB, intimate talk), `loud-intro` (the song carries the
   opening, then drops under the first word). Leave `start` out: the song enters a bar before its first big hit.
   Lifts and dips on words: `"automation": [{"on": "and that's when it worked", "db": 3}, {"words": "w0-w12", "db": -6}]`.
   The song ends with the last word (`"fade_out": 0.6` by default). An explicit `"db"` overrides the level.
5. Tell the user which track and why. If nothing fits, say so and suggest a mood to add.

## No licensed track? Compose an original bed
When the user has no track they own or have licensed (and doesn't want an in-app sound), compose one. It is
synthesized from scratch in code (no samples, no AI model), so it is an **original, royalty-free** work: say so.
```bash
python3 -m editor compose bed --length <video length - music start> --end-chord-at <t> \
    --mood warm|lofi|tense|uplifting [--bpm 100] [--key D|Am] [--seed 7] -o projects/<n>/music/bed.wav [--library]
python3 -m editor compose bed --length 60 --end-chord-at 55.2 --plan -o x.wav   # print the section plan only
python3 -m editor compose lofi --length 20 -o loop.wav          # lo-fi loop (Rhodes, swung drums, vinyl)
python3 -m editor compose riser --bpm 100 -o riser.wav          # one-bar rise into a hit (hit at length - 0.2 s)
python3 -m editor compose list                                  # moods, sections, effects, ambiences
```
- `--length`: the output length the music covers (`editor timeline` gives the cut's duration). `editor audio`
  plays the track from the first frame, so in the EDL use `"music": {"track": "projects/<n>/music/bed.wav",
  "start": 0, "fade_out": 0.05}`: `start: 0` keeps the intro (auto entry would skip it) and the bed has its own ending.
- `--end-chord-at`: where the final chord lands (the end card, the last word, the logo hit), in the bed's time.
  The bar grid is anchored on it, so the chord falls on a downbeat; it rings out and the last ~0.2 s is silent.
  Default: `length - ring` (ring 1.5-6 s).
- Sections default to an automatic shape scaled to the length on that bar grid (intro, groove, fill, groove2,
  lead, build, peak, breakdown, resolve; fewer when short). To hit the edit's beats, pass them:
  `--sections "intro@0,groove@10.8,build@94.2,peak@103.8,breakdown@116.4,resolve@128.4"` (snapped to bars;
  `--snap beat` for finer). Put the build under the setup line and the peak under the payoff.
- Moods: warm (100 bpm, D major Rhodes + pads, the Walk-Free bed), uplifting (112, four-on-the-floor), tense
  (92, harmonic minor, darker, no lead), lofi (86, swung, vinyl). Same seed + params = same audio; a new
  `--seed` is a different take.
- Output: 48 kHz stereo 24-bit WAV at -16 LUFS integrated, true peak <= -1.5 dBTP (ffmpeg loudnorm two-pass),
  plus `<file>.json` provenance (`"generator": "editor compose", "original": true`, licence, params, measured
  loudness). `--library [MOOD]` also adds it to this library (tags original, royalty-free).
- **You can't hear it.** Report the printed LUFS / true peak and the section plan; render a spectrogram
  (`ffmpeg -i bed.wav -lavfi showspectrumpic=s=1600x600 spec.png`) and Read it to confirm the structure (intro
  thin, build rising, final chord, silent tail). Then tell the user a human must listen before it ships.

## Adding music
- Ask for (or infer) mood and 2-4 vibe tags when adding. Tags are what make picking work.
- Only add music the user owns or has a licence for. For Instagram/TikTok, platform
  trending sounds are best added **in the app** at upload (licensed there). Our mix
  can then go without music, or with a quiet bed.
- After adding a track, show the user its LIBRARY.md line.
