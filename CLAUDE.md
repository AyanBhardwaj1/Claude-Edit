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
- **style-memory** learns the user's editing taste over time (`library/style/`, `editor style`): read
  `library/style/STYLE.md` before every first draft, record each preference the user voices with `style note`,
  and `style learn` the EDL / plan when they approve. `editor auto` applies the confident defaults itself.
- Vendored skills (MIT, see THIRD_PARTY.md): **video-use** (long-form, multi-take, interviews, launch
  videos; its rules are built into edit-reel), **claude-video-studio** (studio motion graphics with
  HyperFrames, 21 looks), **manim-video** (technical/maths animations). Their outputs come into a reel as
  `"mode": "overlay"` b-roll. **launch-video** (Keeran's) makes SaaS / app launch videos from a script,
  screenshots and a voiceover (kinetic word-synced type, pills, logo reveal, UI camera moves, 3D phone ads);
  projects in `launches/<name>/`.
- Works the same in the Claude desktop app (local files, links, browser gallery) and in cloud sessions
  (footage via the repo; transcription falls back to offline Vosk; graphics via `editor graphic`).
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
- Process: inventory → propose a plain-English plan → wait for a yes (unless told "just do it") → execute →
  `review` (cap 3 fix passes) → deliver → append to `projects/<name>/project.md`.
- Only use music/B-roll the user provides, owns or has licensed. Blur other people's personal
  data in app/web captures.

## Layout
```
editor/            python package (python3 -m editor)
  fetch.py         yt-dlp: links -> raw/, music, reference footage (+ post caption metadata)
  triage.py        raw clips -> a-roll / reusable b-roll / one-off b-roll (work/triage.json)
  transcribe.py    engines with fallback: WhisperX -> faster-whisper -> ElevenLabs Scribe -> Vosk (offline);
                   cached per source in work/transcripts/ -> work/transcript.json/.txt
  models.py        offline Vosk models (official host, or the npm copy) -> library/models/
  retext.py        re-time corrected text / a script onto the timed words
  plan.py          silences / fillers / retakes (keeps the better take) -> work/edl.json
  viz.py           before/after rough-cut card -> work/rough_cut_viz.png
  cut.py           EDL -> work/cut.mkv (frame-accurate, cached per segment, HDR->SDR) + cut_words.json
  audio.py         voice mastering + ducked music, 2-pass loudnorm -> work/voice.wav
  track.py         face tracking -> work/track.json
  captions.py      word-synced ASS captions, hook title, chapter pills, SRT
  render.py        reframe, zooms, grade, b-roll (full/contain/card/overlay), captions, final x264 encode
  library.py       shared music (by mood) and b-roll (by category) libraries
  capture.py       b-roll makers: Playwright web, iOS Simulator, Android
  graphics.py      built-in motion graphics (counter, lower-third, checklist, title, cta) -> ProRes 4444 alpha
  sfx.py           synthesized SFX placed on visible events (mixed at render)
  review.py        inspect (video-use timeline view) + review of every cut and covered faces
  cover.py         cover/thumbnail from a clean reframed frame
  qa.py            spec/loudness check, contact sheet, frame grabs
  style.py         style memory: learned editing preferences (notes, draft -> approved changes) -> first drafts
library/           hooks.md (265 hook templates), glossary.txt, style/ (learned style), music/, broll/, models/, sfx/ (media git-ignored)
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
