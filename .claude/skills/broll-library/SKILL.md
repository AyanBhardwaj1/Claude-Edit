---
name: broll-library
description: Triage raw clips (founder-to-camera vs reusable vs one-off B-roll), keep a shared organised B-roll library, and generate B-roll automatically (Playwright web screenshots/scroll recordings, iPhone Simulator and Android screen recordings of the user's app). Use when footage arrives, when a reel needs visuals, or when the user mentions their app, website, assets folder or B-roll.
---

# B-roll library and capture

The library (`library/broll/<category>/`, indexed in `library/broll/index.json`)
is shared across every reel, so good footage gets filmed once and reused.

## Triage: the per-clip decision rule
```bash
python3 -m editor triage projects/<name>
```
For each clip it proposes a role from face and voice detection and writes a contact
sheet to `work/triage/`. **Read every sheet** and set `role` in `work/triage.json`:

| role | rule | action |
|---|---|---|
| `a-roll` | founder-to-camera: someone talking to the lens | stays in raw/, gets transcribed and cut |
| `broll-reusable` | would fit other reels: campus/drone shots, workspace, app demo, product, city | `python3 -m editor broll add <raw/clip> --category <cat> --tags ... --desc "<what's on screen>"` |
| `broll-oneoff` | only makes sense in this reel (a specific event, a one-time screen) | copy to `projects/<name>/broll/` |

Write `--desc` as what is literally visible ("aerial drone pass over the tower at
sunset"). You match B-roll to spoken lines by description and tags later.
Categories: short, plural-free slugs (`campus`, `app-demo`, `workspace`, `screenshots`, `people`).

## Finding B-roll for a line
```bash
python3 -m editor broll list [query]
```
Reference library clips in the EDL by id: `{"path": "<id>", "start": 6.1, "dur": 2.0}`.

## Real pictures of named things (free, licensed)
```bash
python3 -m editor images search "spotify" --logo                 # Simple Icons, CC0 brand logos
python3 -m editor images search "golden gate bridge photo"       # Openverse + Wikimedia Commons
python3 -m editor images fetch 2 --project projects/<n>          # -> broll/web/<name>.png, credit in credits.json
python3 -m editor names projects/<n>/work                         # apps/brands said but never shown, with word anchors
python3 -m editor names projects/<n>/work --logos [--apply]       # fetch each logo; --apply adds card entries to the EDL
```
Only CC0, public domain, CC BY and CC BY-SA come back (no NC/ND/fair use). **Look at every picture before
placing it**: a matching title can carry another building, dish or a diagram. CC BY credits are added to the post
caption by `editor post`. Search by kind: a brand, app or tool: its name with `--logo` (and its real screen via
`capture web` for an app or site); a place, object, food or event: the specific noun plus "photo". Shows, films and
memes are rarely there: use a text pop with the name. Never a stranger standing in for a specific real person.

## Files the user hands over in a note
```bash
python3 -m editor attach ~/Downloads/meme.gif --project projects/<n>     # -> broll/attached/meme.mp4
```
JPG/PNG copied; HEIC, still GIF/WebP, BMP -> PNG; animated GIF/WebP -> a silent clip looped to >= 3 s; clips up to
60 s / 200 MB. Place it on the words the note names (doctrine.md, "Notes").

## Making B-roll automatically
- **Websites, tweets, docs, GitHub repos** (Playwright, phone viewport by default):
  ```bash
  python3 -m editor capture web "https://github.com/m-bain/whisperX" -o projects/<n>/broll/whisperx.png
  python3 -m editor capture web "<url>" -o projects/<n>/broll/site.mp4 --video 6      # smooth scroll recording
  ```
  `--desktop` for a desktop layout, `--dark` for dark mode, `--full-page` for long screenshots.
  First time: `pip install playwright && python3 -m playwright install chromium`.
- **Web app demos (clicks, typing, sliders; heavy WebGL/3D pages, no GPU needed)**: write a shot list and run
  `capture shots`. Every action runs inside the page with its own timeout (no Playwright waits that hang on a
  3D page), failures are logged and listed instead of stopping the run, `read` saves the real on-screen numbers
  for captions. Budget ~60-90 s a shot for a Three.js app on a 4-CPU cloud machine.
  ```json
  {"base": "http://localhost:5173", "viewport": [1440, 810], "settle": 8,
   "shots": [{"name": "route", "url": "/demo?tab=route", "wait": 40, "do": [{"dismiss": "No live weather"},
              {"click": "Quickest"}], "read": {"minutes": "text=min walk"}},
             {"name": "night", "do": [{"slider": "input[aria-label='Time of day']", "value": 22}]},
             {"name": "search", "do": [{"type": "PCL", "into": "input[placeholder^='Search']"}]}]}
  ```
  ```bash
  python3 -m editor capture shots shots.json -o projects/<n>/broll/app     # route.png ... shots.json shots_sheet.jpg
  python3 -m editor capture shots shots.json -o projects/<n>/broll/app --record   # + shots.mp4 (Xvfb, Linux)
  python3 -m editor capture stills-from choppy.mp4 projects/<n>/broll/stills --min-gap 1   # clean frames
  ```
  Actions: `click` (visible text or `css=`), `type` + `into`, `key`, `slider` + `value`, `select` + `value`,
  `scroll`, `wait`, `dismiss` (close button near a text), `eval` (raw JS, logged); `"required": true` stops the run.
  Shots without `url` continue on the same page. Full format: `pydoc editor.shots`. Read `shots_sheet.jpg`
  before using them. `--record` gives real motion, as choppy as the page renders (a heavy shader: ~2-3 fps):
  use `stills-from` on it, or animate the stills with camera moves.
- **The user's iPhone app** (macOS with Xcode): boot it with `open -a Simulator`, run the app, then
  ```bash
  python3 -m editor capture sim -o projects/<n>/broll/app.mov --seconds 8 [--url myapp://profile/123]
  python3 -m editor capture sim -o projects/<n>/broll/app.png --screenshot
  ```
  Deep links (`--url`) let you open specific screens without tapping. For scripted taps,
  install `idb` and drive it with `idb ui tap X Y` between captures.
- **No Mac / no simulator / cloud session**: ask the user for a screen recording from their phone
  (iOS Control Centre → Screen Recording, or Android's built-in recorder) or screenshots, or capture the
  web/PWA version with `capture web`. Then show it as a phone: `{"mode": "card", "frame": "phone"}` draws
  the device bezel, rounded screen and dynamic island, so it looks like a simulator recording.
- **Android app**: `python3 -m editor capture android -o projects/<n>/broll/app.mp4 --seconds 8`.
- Blur or crop personal data (other people's names, photos, emails) before using a capture.
  Ask the user when in doubt.

Captures of things you'll show again (the app, the website) belong in the library:
`broll add ... --category app-demo`.
