---
name: broll-motion
description: Add visual beats to an edit — emphasis punch-in zooms, jump-cut zoom alternation, B-roll cutaways, screenshots, and Remotion motion graphics (animated titles, lower thirds, callouts) composited as transparent overlays. Use when the user wants the video more dynamic/engaging, mentions B-roll, zooms, motion graphics, Remotion, animations, or "add visuals".
---

# Zooms, B-roll and motion graphics

All times here are **output-timeline** seconds. Get them with:
```bash
python3 -m editor timeline projects/<n>/work
```

## Zooms (`edl.json`)
```jsonc
"auto_punch_in": 1.12,     // every other cut zooms to 112% — hides jump cuts. 1.0 = off
"zooms": [
  {"start": 3.20, "end": 4.60, "scale": 1.25, "ease": 0},     // snap punch on a punchline
  {"start": 9.00, "end": 12.0, "scale": 1.15, "ease": 0.6}    // slow push-in for a story beat
]
```
- One emphasis zoom every 4-8 s, landing on the key word, not between words.
- Snap (`ease: 0`) for energy; `0.2-0.6` for smooth push-ins. Scale 1.15-1.35.
- The crop follows the face (track.json), so zooms stay centred on the speaker.

## B-roll (`edl.json` or `--broll path@start:dur`)
```jsonc
"broll": [
  {"path": "broll/app-demo.mp4", "start": 5.6, "dur": 2.0, "src_start": 1.5},  // video: cover-cropped
  {"path": "broll/tweet.png",    "start": 8.1, "dur": 1.2},                    // image: contained over a blurred fill
  {"path": "broll/title.mov",    "start": 0.0, "dur": 2.5, "mode": "overlay"}  // transparent graphic on top
]
```
Paths are relative to the project folder. The voice keeps playing; captions
stay on top. Modes: `full` (default for video), `contain` (default for images),
`overlay` (alpha graphics rendered at output size).
- Cut B-roll in when the speaker *names* the thing, hold 1-3 s, never over the hook's first second.
- No B-roll available? Ask the user for screenshots/screen recordings, or make
  motion graphics instead (below). Don't invent footage.

## Motion graphics with Remotion (optional)
Use for animated hook titles, lower thirds, number counters, checklists, callouts.
1. Scaffold once (needs Node 18+):
   ```bash
   npx create-video@latest motion --blank && cd motion && npm i
   npx skills add remotion-dev/skills      # Remotion's official agent skill: best-practice guidance for Claude
   ```
2. Make a composition at the output size and fps (1080x1920, fps from
   `work/cut_meta.json`), with a transparent background (no background div).
3. Render with alpha and composite as an `overlay`:
   ```bash
   npx remotion render <CompId> ../projects/<n>/broll/<name>.mov \
       --codec=prores --prores-profile=4444 --pixel-format=yuva444p10le
   ```
   Then add `{"path": "broll/<name>.mov", "start": S, "dur": D, "mode": "overlay"}` and
   re-run `--from render`.
4. Read a frame from the final render to confirm the alpha composited correctly
   (a black box means the render lacked alpha).
