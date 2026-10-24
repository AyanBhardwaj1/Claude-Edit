# Claude-Edit

Edit Reels, TikToks, Shorts and YouTube videos with Claude Code. Drop in raw
footage and get a finished, captioned, platform-ready video. Claude makes the
editorial decisions; ffmpeg, Whisper and OpenCV do the media work locally.
No cloud services and no API keys.

## What it does
| stage | what happens |
|---|---|
| **transcribe** | faster-whisper word-level timestamps, prompted to keep "um"/"uh" so they can be cut |
| **plan** | auto rough cut: pauses > 0.3 s, filler words, false starts and retakes (keeps the last take) |
| **Claude's pass** | picks the hook, cuts tangents, reorders, sets speed, hook title and emphasis words |
| **cut** | frame-accurate parallel segment render, cached; iPhone HDR is tone-mapped to SDR |
| **audio** | high-pass, denoise, EQ, de-ess, compression, ducked music, two-pass loudness to -14 LUFS |
| **track** | face tracking, so a 16:9 → 9:16 crop follows the speaker |
| **captions** | word-synced animated captions (`bold` Hormozi-style, `beast`, `clean`, `minimal`) + SRT |
| **render** | face-follow reframe, punch-ins on alternating jump cuts, emphasis zooms, B-roll and screenshots, Remotion alpha overlays, colour grade, sharpening, one high-quality x264 encode |
| **check** | resolution / codec / bt709 / duration / loudness / true peak, plus a contact sheet Claude reads to check the frames |

## Setup
```bash
./setup.sh                 # ffmpeg, Python deps, Montserrat caption fonts, Whisper model
python3 -m editor doctor   # everything should say ok
```
Requires Python 3.10+ and ffmpeg with libass, libx264 and zimg (the Homebrew and apt builds have them).
A CUDA GPU is used for Whisper automatically if present.

## Use it with Claude Code
```bash
python3 -m editor new myreel          # creates projects/myreel/{raw,broll,music,work,out}
# copy your clips into projects/myreel/raw/ (B-roll into broll/, a music track into music/)
claude
> /edit-reel projects/myreel
```
Or just say "edit the clips in projects/myreel into a reel". Claude reads the
transcript, plans the cut, shows you what it removed, renders, checks the
frames, and hands you `projects/myreel/out/myreel_reels.mp4`.

Other things to ask for:
- `/reel-script` "a 30 s reel about ..." gives hooks, a script, B-roll list and recording tips
- "make it under 40 seconds", "use the first take of the intro", "tighter pacing"
- "add a zoom on 'free'", "put broll/demo.mp4 where I mention the app"
- "beast captions", "cinematic grade", "add the music quieter"
- "also export a YouTube version and a 4:5 feed version"

## Use it without Claude
```bash
python3 -m editor auto projects/myreel                       # whole pipeline, defaults
python3 -m editor auto projects/myreel --to plan             # stop to edit work/edl.json by hand
python3 -m editor auto projects/myreel --from cut --style clean --grade warm --speed 1.1
python3 -m editor --help                                     # every stage is also its own command
```

## The EDL (`work/edl.json`)
The single source of truth for an edit. Segment times are source seconds, and
zoom and B-roll times are output seconds (`python3 -m editor timeline projects/<name>/work`).
```jsonc
{
  "speed": 1.1,
  "segments": [{"src": 0, "start": 6.78, "end": 9.69, "text": "..."}],   // play order
  "title": "3 tools that edit for you",
  "emphasis": ["claude", "free"],
  "auto_punch_in": 1.12,
  "zooms": [{"start": 3.2, "end": 4.6, "scale": 1.25, "ease": 0}],
  "broll": [{"path": "broll/demo.mp4", "start": 5.6, "dur": 2.0},
            {"path": "broll/title.mov", "start": 0, "dur": 2.5, "mode": "overlay"}]
}
```

## Tests
```bash
python3 -m pytest -q                                   # unit tests + an end-to-end render
python3 tests/make_fixture.py projects/demo --face     # synthetic project with TTS speech and a moving face
python3 -m editor auto projects/demo --from plan
```

## Layout
`editor/` Python package · `.claude/skills/` the workflow Claude follows
(edit-reel, rough-cut, captions, broll-motion, audio-polish, export-qa,
reel-script) · `CLAUDE.md` project rules · `projects/` your footage (git-ignored).
