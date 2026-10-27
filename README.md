# Claude-Edit

Claude Code edits your reels. Paste a link or drop raw footage, and you get a finished,
captioned, sound-designed, platform-ready Reel / TikTok / Short / YouTube video, plus a cover.
Claude makes the editorial calls and checks its own work from real frames. ffmpeg, Whisper
(or offline Vosk), OpenCV and Pillow do the media work locally. Works in the **Claude desktop
app** and in Claude Code on the web or CLI.

## What's inside
| | |
|---|---|
| **edit-reel** (main skill) | hook → rough cut → subtitles → music → B-roll → graphics and sound → self-review → cover |
| **video-use** (vendored, browser-use) | conversation-driven editing for long-form, multi-take, interviews, launch videos |
| **claude-video-studio** (vendored, Claude Video 2.0) | studio motion graphics in HyperFrames, 21 looks with a live gallery |
| **manim-video** (vendored) | 3Blue1Brown-style technical and maths animations |
| **launch-video** (vendored, Keeran) | SaaS / app launch videos in code: every word lands on the voice, keyword pills, counters, glowing logo reveal, product UI with camera moves and cursor, 3D-phone app ads; your voice (line-by-line takes), Fish Audio or ElevenLabs; brand from a link via context.dev |
| **style-memory** | learns how you like videos edited (your feedback, and what you change before approving a draft) and applies it to every first draft |
| supporting skills | hooks (265 templates), rough-cut, captions, music-library, broll-library, broll-motion, audio-polish, export-qa, reel-script |

## The pipeline
| step | what happens |
|---|---|
| **Footage in** | local files (desktop app), `editor fetch <link>` (yt-dlp), or committed to the repo (cloud); clips triaged into founder-to-camera, reusable B-roll or one-off |
| **Transcribe** | WhisperX → faster-whisper → ElevenLabs Scribe → **Vosk offline**: falls back automatically and caches per source; `retext` fixes punctuation, names or a script while keeping word timings |
| **Plan → confirm** | Claude proposes the hook, shape, cuts and look in plain English and waits for your yes |
| **Rough cut** | pauses, fillers, false starts and repeated takes cut (the better take kept); 30 ms fades at every cut; a before/after card |
| **Look** | face-follow 9:16 reframe, punch-ins, emphasis zooms, per-take color matching, grades (incl. video-use's `neutral_punch` / `warm_cinematic`) |
| **Text** | word-synced captions (`white`, `bold`, `beast`, `clean`, `minimal`), hook title, step pills, optional progress bar |
| **B-roll and graphics** | library clips, web captures (Playwright), app screens as **phone mockups** (no simulator needed), built-in animated counter / lower third / checklist / kinetic title / CTA, or HyperFrames / Manim overlays |
| **Sound** | voice mastering to -14 LUFS, ducked music from a mood library, synthesized SFX on visible events only |
| **Self-review** | spec and loudness check; every cut checked for clicks, flash frames and mid-word cuts; every overlay checked for **covering the face**; review sheets Claude reads; a critic sub-agent for anything published |
| **Deliver** | MP4 per platform, `.srt`, cover plus 4:5 grid crop, a `project.md` session memory |

## Setup
```bash
./setup.sh                  # ffmpeg, Python deps, offline speech model, Playwright, fonts, Whisper model
WHISPERX=1 ./setup.sh       # also WhisperX (best word alignment; large)
python3 -m editor doctor
```
Optional: `ELEVENLABS_API_KEY=...` in `.env` (hosted Scribe: speakers, laughs, verbatim fillers),
Node 22+ (HyperFrames graphics), macOS + Xcode (iPhone Simulator capture).

## Use it
Open this folder in the Claude desktop app (or run `claude` here) and say:
> edit https://www.instagram.com/reel/XXXX/ into a reel

or `python3 -m editor new myreel`, drop clips in `projects/myreel/raw/`, and say "edit projects/myreel".
Also: "make a launch video for <product>" (launch-video), "make me a motion graphic" (claude-video-studio), "animate this concept" (manim-video),
"edit these interview takes into a 3-minute video" (video-use), `/reel-script` to plan a video first.

Without Claude: `python3 -m editor auto projects/myreel` runs everything; `python3 -m editor --help` lists
every stage (`transcribe`, `retext`, `plan`, `cut`, `audio`, `track`, `captions`, `graphic`, `render`,
`check`, `review`, `inspect`, `cover`, `fetch`, `triage`, `music`, `broll`, `capture`, `models`, `style`, ...).

## It learns your style
Every video teaches the next first draft. What you say ("captions smaller", "always 16:9", "no voiceover") is
recorded as a note; what you change in a draft before approving it counts as a strong signal; what you leave alone
counts a little. Old evidence fades, so it follows your taste as it moves. Confident preferences are applied
automatically (`editor auto` uses them for any flag you don't pass; `editor style apply` fills a launch plan),
per brand when a brand has its own look. It lives in `library/style/` (`STYLE.md` is readable).
```bash
python3 -m editor style show                     # what it has learned
python3 -m editor style note "music quieter" --kind reel --set reel.music.db=-24
python3 -m editor style learn projects/myreel/work/edl.json   # after you approve
python3 -m editor style forget <id|key>
```

## The EDL (`work/edl.json`)
Segment times are source seconds; everything else is output seconds (`editor timeline`).
```jsonc
{
  "speed": 1.1,
  "segments": [{"src": 0, "start": 6.78, "end": 9.69}],
  "title": "Claude Code edits my reels",
  "chapters": [{"start": 2.7, "text": "1: The hook"}],
  "emphasis": ["whisperx", "free"],
  "music": {"track": "pixel-bounce", "db": -20},
  "zooms": [{"start": 3.2, "end": 4.6, "scale": 1.25, "ease": 0}],
  "broll": [{"path": "broll/dau.mov", "start": 0.4, "dur": 2.2, "mode": "overlay"},
            {"path": "broll/app.mp4", "start": 5.6, "dur": 2.0, "mode": "card", "frame": "phone"}],
  "sfx": "auto",
  "progress_bar": true
}
```

## Tests
`python3 -m pytest -q` runs unit tests, real offline speech recognition on TTS speech, and an end-to-end
render. `python3 tests/make_fixture.py projects/demo --face` builds a test project.

Third-party skills and models: see [THIRD_PARTY.md](THIRD_PARTY.md).
