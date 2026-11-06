# `editor produce` spec reference

One JSON file is the whole video. Paths are relative to the spec's folder. Times are seconds on the output timeline
**or references** (anywhere a time goes: audio `at`, overlay `t_in`/`t_out`/`t`/`times`/`t_column`, extras, post):
`"s3"` (start of piece s3), `"s3+1.2"`, `"s3.end-0.5"`, `"@v3:2.01"` (where source second 2.01 of voice v3 lands).

```bash
python3 -m editor produce init projects/<name>/raw -o projects/<name>/produce.json   # a first draft
python3 -m editor produce projects/<name>/produce.json --plan                       # table, captions, checks
python3 -m editor produce projects/<name>/produce.json --range d7b d7c.end          # quick look at a stretch
python3 -m editor produce projects/<name>/produce.json --preview --note "<note>"    # render + version
python3 -m editor produce projects/<name>/produce.json --only mix|overlay|composite|extras|post|review
```
Stages: pieces → overlay → mix → composite → extras → post → review (rush skips review; polish encodes slower).
The spec is validated first (missing files, unknown fields, bad references, malformed punches, overlay elements):
errors stop the render before anything is drawn; `--plan` lists them.

## Top level
| key | meaning |
|---|---|
| `output` | `width` `height` `fps` (1920/1080/30), `file` (out/…mp4), `work` (work/produce), `duration` (target, checked), `max_duration`, `lufs` (−14), `tp` (−1.5), `bitrate` (16M), `preset`, `min_voice_gap` (9 dB), `max_still` (7 s) |
| `frame` | the backdrop for framed screens: `scale` (0.92), `radius` (18), `backdrop` (#f4f1e6) |
| `pieces` | the picture, in order (below) |
| `audio` | `voices`, `music`, `sfx`, `beds`, `duck` (below) |
| `captions` | generated caption cards (below) |
| `overlay` | the overlay spec inline or a path (`editor/overlay/README.md`: 23 element types, theme) |
| `extras` | extra cuts (below) |
| `post` | `srt` (true), `chapters` [[time, title]…], `cover` {`at`, `title`, `window`, `accent`}, and for `<name>_description.txt`: `title`, `summary`, `credits` [...], `ai_label`, `hashtags` (links come from the end card) |
| `brief` | path to the brief: numbers on screen must appear in it… |
| `numbers_from_screen` | …or be listed here (numbers read off the app's screen) |
| `todo` | notes for yourself (ignored) |

## Pieces
Every piece: `name` (unique), `type`, optional `chapter` (YouTube chapter title), `note`. Labels never re-render.
| type | fields |
|---|---|
| `video` | `src`, `in`, `out`, `speed`, `fit` cover/contain, `crop_y` (0-1), `grade` (none, neutral, hot, cool, warm, punchy, bw, or a raw ffmpeg chain; `bloom` false to drop hot's glow), `z0`/`z1` Ken Burns, `fx`/`fy` focus, `push` [at, dur, zoom, fx, fy] (accelerating push-in, a transition), `fade_in`/`fade_out` (s or [s, "white"]), `ramp_waits` {`speed` 6, `keep` 0.3, `min` 1.0, `label` "thinking…"}, `from_shot` ("caps/shots.json#route": that shot's stretch of a `capture shots --record` video) |
| `framed` | `src` (image or video), `dur`, `in`, `z0`/`z1`, `fx`/`fy`, `punch` [t, zoom, fx, fy], `flash` (s of white shutter flash), `scale`/`radius`/`backdrop` overrides, `focus_from` ("shots/shots.json#route": aim the push and a punch-in at the element `capture shots` recorded with the shot's `"focus": "text=Quickest"`, centred as far as the edges allow) |
| `still` | like framed but full frame |
| `sequence` | `srcs` (stills blended in order: a time-lapse), `dur`, `framed` (true), `z1` |
| `freeze` | `from` (a piece), `dur`, `blur`, `darken` (0-1), `blur_at`, `fade_out` |
| `color` | `color`, `dur` (placeholders, title backgrounds) |

## Audio
| list | item fields |
|---|---|
| `voices` | `name` (to anchor captions on), `src`, `in`, `out`, `at`, `gain` dB, `clean` (true: highpass, denoise, compressor), `fade_in`/`fade_out`, `automation` [[t, dB]…], `captions` false to skip the coverage check |
| `music` | `src` (file, or `{"compose": {mood, bpm, key, mode, seed, sections, end_chord_at, ring, length}}` or `{"lofi": {...}}`), `at`, `in`/`out` or `dur`, `gain`, `duck` (true), `fade_in`/`fade_out`, `automation` (hard stops: [[10.29, 0], [10.3, -60], [11.65, -60], [11.66, 0]]) |
| `sfx` | `src` (a built-in name: whoosh, whoosh_rev, whip, click, pop, thud, shutter, paper, ding; or a file), `at`, `gain` |
| `beds` | like music but never ducks: ambiences `{"ambience": "cicadas"\|"birdsong"\|"room"}`, app audio |
`duck`: `threshold` (0.015), `ratio` (10), `attack` (150 ms), `release` (400 ms). Under on-camera dialogue keep music far
lower than under voice-over (the review measures it in the speech band).

## Captions
`"captions": {"voices": {...}, "replace": {"walk free": "Walk-Free"}, "max_chars": 42, "lines": 2, "gap": 0.6, "max_dur": 3.5}`
- `"v1": "work/inventory/scene1.words.json"`: cards from the recognised words.
- `"v1": {"words": "...", "lines": ["Exact line one.", "Line two."]}`: the script's lines, one card each, timed on what was heard.
- `"v1": {"words": "...", "script": "The script as text."}`: the script's words, cards break automatically.
`editor produce captions-from-brief spec.json BRIEF.md` fills `lines` from the brief's caption list.
Hand-written `caption` elements in the overlay are fine too (`t_in`/`t_out` as references).

## Extras
| kind | fields |
|---|---|
| (crop) | `name`, `from`, `to`, `size` [w, h], `x`/`y` (crop position 0-1), `file` |
| `band` | `name`, `size` (e.g. [1080, 1920]), `from`/`to` or `ranges` [[from, to]…] (a highlight reel), `title`, `title_size`, `title_color`, `font`, `blur`, `darken`, `band_y` |

## Review (work/produce/review/review.md)
Length vs target, loudness, caption coverage per voice (< 60% flagged), music under each voice in the speech band
(median < `min_voice_gap` flagged), the longest stretch with nothing new (> `max_still`), graphics over faces, numbers
not in the brief, overlapping captions, graphics after the end; a contact sheet and a frame at every graphic. Then a
critic sub-agent ([critic.md](critic.md)) at standard and polish.
