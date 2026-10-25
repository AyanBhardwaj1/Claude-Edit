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

## Making B-roll automatically
- **Websites, tweets, docs, GitHub repos** (Playwright, phone viewport by default):
  ```bash
  python3 -m editor capture web "https://github.com/m-bain/whisperX" -o projects/<n>/broll/whisperx.png
  python3 -m editor capture web "<url>" -o projects/<n>/broll/site.mp4 --video 6      # smooth scroll recording
  ```
  `--desktop` for a desktop layout, `--dark` for dark mode, `--full-page` for long screenshots.
  First time: `pip install playwright && python3 -m playwright install chromium`.
- **The user's iPhone app** (macOS with Xcode): boot it with `open -a Simulator`, run the app, then
  ```bash
  python3 -m editor capture sim -o projects/<n>/broll/app.mov --seconds 8 [--url myapp://profile/123]
  python3 -m editor capture sim -o projects/<n>/broll/app.png --screenshot
  ```
  Deep links (`--url`) let you open specific screens without tapping. For scripted taps,
  install `idb` and drive it with `idb ui tap X Y` between captures.
- **Android app**: `python3 -m editor capture android -o projects/<n>/broll/app.mp4 --seconds 8`.
- Blur or crop personal data (other people's names, photos, emails) before using a capture.
  Ask the user when in doubt.

Captures of things you'll show again (the app, the website) belong in the library:
`broll add ... --category app-demo`.
