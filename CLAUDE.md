# Claude-Edit: reel & video editing with Claude Code

This repo turns Claude Code into a video editor for short-form (Reels, TikTok,
Shorts) and YouTube. Python scripts in `editor/` do the deterministic media
work with ffmpeg, faster-whisper and OpenCV. Claude makes the editorial calls
and checks the result visually.

## How to work here
- For any "edit this video / make a reel" request, follow the **edit-reel** skill
  (`.claude/skills/edit-reel/SKILL.md`). It calls the other skills at the right stage:
  `rough-cut` → `audio-polish` → `broll-motion` → `captions` → `export-qa`.
  `reel-script` is for planning a video before it's recorded.
- Every command: `python3 -m editor <cmd> --help`. One-shot: `python3 -m editor auto projects/<name>`.
  Stop and resume with `--from/--to <stage>` (transcribe, plan, cut, audio, track, captions, render, check).
- First run on a machine: `./setup.sh`, then `python3 -m editor doctor`.

## Rules
- Never modify or delete anything in `projects/*/raw/`. All outputs go to `work/` and `out/`.
- Review `work/edl.json` against `work/transcript.txt` **before** rendering; the
  automatic plan is a draft, not the edit.
- Before telling the user an edit is done, run `check` and **Read the contact sheet PNG**.
  Report anything you couldn't verify (you can't listen to audio; say so and rely on LUFS numbers).
- `edl.json` is the single source of truth. Change it, then re-run from the earliest affected stage.
- Segment times in the EDL are **source** seconds; `zooms` and `broll` times are **output** seconds
  (see `python3 -m editor timeline projects/<name>/work`).
- Only use music/B-roll the user provides or owns.

## Layout
```
editor/            python package (python3 -m editor)
  transcribe.py    faster-whisper word timestamps -> work/transcript.json + transcript.txt
  plan.py          silences / fillers / retakes -> work/edl.json
  cut.py           EDL -> work/cut.mkv (frame-accurate, cached per segment, HDR->SDR) + cut_words.json
  audio.py         voice mastering + ducked music, 2-pass loudnorm -> work/voice.wav
  track.py         face tracking -> work/track.json
  captions.py      word-synced ASS captions + SRT
  render.py        reframe, zooms, grade, b-roll/overlays, captions, final x264 encode
  qa.py            spec/loudness check, contact sheet, frame grabs
.claude/skills/    the workflow Claude follows
projects/<name>/   raw/ broll/ music/ work/ out/   (git-ignored)
tests/             pytest suite + make_fixture.py (synthetic test project, no Whisper needed)
assets/fonts/      caption fonts (Montserrat via ./setup.sh)
```

## Dev
- `python3 -m pytest -q` (about 1 min; the end-to-end test renders a real reel from TTS speech).
- `python3 tests/make_fixture.py projects/demo [--face]`, then `python3 -m editor auto projects/demo --from plan`
  exercises everything after transcription.
- Match the existing style: small modules, ffmpeg built-in filters, no new heavy dependencies.
