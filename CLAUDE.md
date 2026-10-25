# Claude-Edit: reel & video editing with Claude Code

This repo turns Claude Code into a video editor for short-form (Reels, TikTok,
Shorts) and YouTube. Python scripts in `editor/` do the deterministic media
work with ffmpeg, WhisperX/faster-whisper, OpenCV, yt-dlp and Playwright.
Claude makes the editorial calls and checks the result visually.

## How to work here
- For any "edit this video / make a reel" request (files or a pasted link), follow the
  **edit-reel** skill. Its five steps each have a skill:
  1 hook → `hooks` · 2 rough cut → `rough-cut` · 3 subtitles → `captions` ·
  4 music → `music-library` · 5 B-roll → `broll-library` + `broll-motion` ·
  final pass → `export-qa` (+ `audio-polish` for sound problems).
  `reel-script` is for planning a video before it's recorded.
- Every command: `python3 -m editor <cmd> --help`. One-shot: `python3 -m editor auto projects/<name>`.
  Stop and resume with `--from/--to <stage>` (transcribe, plan, cut, audio, track, captions, render, check).
- First run on a machine: `./setup.sh`, then `python3 -m editor doctor`.

## Rules
- Never modify or delete anything in `projects/*/raw/`. Outputs go to `work/` and `out/`;
  library additions are copies.
- Review `work/edl.json` against `work/transcript.txt` and `work/rough_cut_viz.png` **before**
  rendering; the automatic plan is a draft, not the edit.
- Before telling the user an edit is done, run `check` and **Read the contact sheet PNG**
  (and frames at cards/chapters). Say what you couldn't verify: you can't hear audio.
- `edl.json` is the single source of truth. Change it, then re-run from the earliest affected stage.
- Segment times in the EDL are **source** seconds; `zooms`, `broll` and `chapters` are
  **output** seconds (`python3 -m editor timeline projects/<name>/work`).
- Only use music/B-roll the user provides, owns or has licensed. Blur other people's personal
  data in app/web captures.

## Layout
```
editor/            python package (python3 -m editor)
  fetch.py         yt-dlp: links -> raw/, music, reference footage (+ post caption metadata)
  triage.py        raw clips -> a-roll / reusable b-roll / one-off b-roll (work/triage.json)
  transcribe.py    WhisperX (aligned) or faster-whisper word timestamps -> work/transcript.json/.txt
  plan.py          silences / fillers / retakes (keeps the better take) -> work/edl.json
  viz.py           before/after rough-cut card -> work/rough_cut_viz.png
  cut.py           EDL -> work/cut.mkv (frame-accurate, cached per segment, HDR->SDR) + cut_words.json
  audio.py         voice mastering + ducked music, 2-pass loudnorm -> work/voice.wav
  track.py         face tracking -> work/track.json
  captions.py      word-synced ASS captions, hook title, chapter pills, SRT
  render.py        reframe, zooms, grade, b-roll (full/contain/card/overlay), captions, final x264 encode
  library.py       shared music (by mood) and b-roll (by category) libraries
  capture.py       b-roll makers: Playwright web, iOS Simulator, Android
  qa.py            spec/loudness check, contact sheet, frame grabs
library/           hooks.md (265 hook templates), music/, broll/  (media git-ignored)
.claude/skills/    the workflow Claude follows
projects/<name>/   raw/ broll/ music/ work/ out/   (git-ignored)
tests/             pytest suite + make_fixture.py (synthetic test project, no Whisper needed)
assets/fonts/      caption fonts (Montserrat via ./setup.sh)
```

## Dev
- `python3 -m pytest -q` (about 1 min; the end-to-end test renders a real reel from TTS speech).
- `python3 tests/make_fixture.py projects/demo [--face]`, then `python3 -m editor auto projects/demo --from plan`
  exercises everything after transcription.
- Match the existing style: small modules, ffmpeg built-in filters, no new heavy dependencies
  (WhisperX and Playwright stay optional).
