# Claude-Edit

Claude Code edits your reels. Paste a link or drop raw footage, and you get a
finished, captioned, platform-ready Reel / TikTok / Short / YouTube video.
Claude makes the editorial calls; ffmpeg, WhisperX, OpenCV, yt-dlp and
Playwright do the media work locally. No editing app needed.

## The workflow
| step | what happens | tools |
|---|---|---|
| **0. Footage in** | paste a link (`editor fetch`) or drop clips in `raw/`; every clip is triaged: founder-to-camera, reusable B-roll, or one-off | yt-dlp, OpenCV |
| **1. The hook** | Claude reads the transcript, picks a template from a 265-hook library, and adapts it to this video | `library/hooks.md` |
| **2. Rough cut** | word-level timestamps; every pause, filler word and repeated line is cut, and of two takes the better one is kept; Claude then cuts tangents and moves the hook first; a before/after card shows what was cut | WhisperX / faster-whisper |
| **3. Subtitles** | word-synced captions (`white` creator look, `bold` Hormozi pop, `beast`, `clean`, `minimal`), hook title, black step pills ("1: The hook") | libass |
| **4. Music** | a shared library grouped by mood (Hype, Uplifting, Emotional, Tense/Dark, Cool/Fun) with tags, stars and BPM; Claude picks by topic; ducked under the voice | yt-dlp, ffmpeg |
| **5. B-roll** | a shared, organized B-roll library; auto-captured screenshots and scroll videos of websites, recordings of your iPhone/Android app; floating rounded "cards" over the speaker, or full cutaways | Playwright, simctl, adb |
| **Final pass** | face-follow 9:16 reframe, punch-in zooms, grade, -14 LUFS voice master, one high-quality encode, spec/loudness check, and Claude reads the frames before handing it over | OpenCV, x264 |

## Setup
```bash
./setup.sh                  # ffmpeg, Python deps, Playwright Chromium, caption fonts, Whisper model
WHISPERX=1 ./setup.sh       # also install WhisperX (best word alignment; large, pulls in torch)
python3 -m editor doctor    # everything should say ok
```
Python 3.10+, ffmpeg with libass/libx264/zimg (the Homebrew and apt builds have them).
iPhone Simulator capture needs macOS with Xcode. A CUDA GPU is used automatically if present.

## Use it with Claude Code
```bash
claude
> /edit-reel https://www.instagram.com/reel/XXXX/      # or: /edit-reel projects/myreel
```
Or `python3 -m editor new myreel`, copy clips into `projects/myreel/raw/`, and say
"edit projects/myreel into a reel". Claude walks the five steps, shows you the hook it
picked and what it cut, and delivers `projects/myreel/out/myreel_reels.mp4`.

Build up the libraries as you go:
```bash
python3 -m editor music add "<song link or file>" --mood cool-fun --tags bouncy playful --star
python3 -m editor broll add drone.mp4 --category campus --tags drone aerial --desc "drone pass over the tower"
python3 -m editor capture web "https://github.com/m-bain/whisperX" -o projects/myreel/broll/whisperx.png
python3 -m editor capture sim -o projects/myreel/broll/app.mov --seconds 8     # booted iPhone Simulator
```

Other things to ask for:
- `/reel-script` "a 30 s reel about ..." gives hooks, a script, a B-roll list and recording tips
- "give me 5 hook options", "make it under 40 seconds", "use the first take of the intro"
- "put the GitHub page on screen when I say WhisperX", "add step pills"
- "find music that fits", "beast captions", "cinematic grade"
- "also export a YouTube version and a 4:5 feed version"

## Use it without Claude
```bash
python3 -m editor auto projects/myreel                    # whole pipeline, defaults
python3 -m editor auto projects/myreel --to plan          # stop to edit work/edl.json by hand
python3 -m editor auto projects/myreel --from cut --style white --grade warm
python3 -m editor --help                                  # every stage is its own command
```

## The EDL (`work/edl.json`)
The single source of truth for an edit. Segment times are source seconds. Zoom,
B-roll and chapter times are output seconds (`python3 -m editor timeline projects/<name>/work`).
```jsonc
{
  "speed": 1.1,
  "segments": [{"src": 0, "start": 6.78, "end": 9.69, "text": "..."}],     // play order
  "title": "Claude Code edits my reels",                                    // hook text
  "chapters": [{"start": 2.7, "text": "1: The hook"}],                      // step pills
  "emphasis": ["whisperx", "free"],
  "music": {"track": "pixel-bounce", "db": -20, "start": 0},               // library id or file
  "auto_punch_in": 1.12,
  "zooms": [{"start": 3.2, "end": 4.6, "scale": 1.25, "ease": 0}],
  "broll": [{"path": "work/rough_cut_viz.png", "start": 5.6, "dur": 2.2, "mode": "card"},
            {"path": "campus-drone", "start": 8.0, "dur": 1.6}]
}
```

## Tests
```bash
python3 -m pytest -q                                   # unit tests + an end-to-end render
python3 tests/make_fixture.py projects/demo --face     # synthetic project: TTS speech, a moving face
python3 -m editor auto projects/demo --from plan
```

## Layout
`editor/` Python package · `library/` hooks, music, B-roll shared across reels ·
`.claude/skills/` the workflow Claude follows (edit-reel, hooks, rough-cut, captions,
music-library, broll-library, broll-motion, audio-polish, export-qa, reel-script) ·
`CLAUDE.md` project rules · `projects/` your footage (git-ignored).
