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
Floating cards (screen recordings, code, GitHub pages, app screens, the rough-cut viz) keep
the speaker visible. The card floats over the chest with rounded corners and a shadow, and
fades/slides in:
```jsonc
{"path": "broll/whisperx.png", "start": 9.0, "dur": 2.5, "mode": "card"},            // defaults: width 0.84, y 0.53
{"path": "app-demo-signup", "start": 14.2, "dur": 3.0, "mode": "card", "max_height": 0.4}  // library id
{"path": "broll/app.mp4", "start": 4.0, "dur": 2.0, "mode": "card", "frame": "phone"}   // phone mockup, beside the face (x 0.73)
```
`x`/`y` are the card centre (fractions of width/height): move it if it covers the face; `review` checks.
Paths are relative to the project folder; library clips can be referenced by id. The voice keeps playing; captions
stay on top. Modes: `full` (default for video), `contain` (default for images), `card` (floating
rounded card), `overlay` (alpha graphics rendered at output size).
- Cut B-roll in when the speaker *names* the thing, hold 1-3 s, never over the hook's first second.
- No B-roll available? Ask the user for screenshots/screen recordings, or make
  motion graphics instead (below). Don't invent footage.

## Transitions (when asked, or at chapter breaks)
Straight cuts are the default and usually right. Use transitions as punctuation: chapter/step changes, a
time jump, a reveal. One every 10-20 s at most, the same family throughout a video. They never move the
timeline, so captions and word timing stay put.
```jsonc
"transitions": [
  {"at": "chapters", "type": "whip-left"},     // every chapter start
  {"at": 14.20, "type": "zoom"},               // output seconds, put it ON a cut (editor timeline)
  {"at": 31.00, "type": "dip", "dur": 0.6},     // optional dur / strength (0-1)
  {"at": "cuts", "type": "blur"}                // every cut: rarely a good idea
]
```
| type | feel | use for |
|---|---|---|
| `whip-left/right/up/down` | fast pan with motion blur (+ whip sfx) | energetic step changes, "next" |
| `zoom` | punch through the cut, radial blur (+ whoosh) | reveals, "here's the trick" |
| `flash` | white flash | beat drops, before/after |
| `dip` | dip to black | time jump, serious beat, end of a section |
| `blur` | defocus out and in | dreamy, memory, softer change |
| `leak` | warm film light leak sweeping across | lifestyle, travel, warm stories |
| `glitch` | RGB split + slices (+ glitch sfx) | tech, AI, "error" jokes |
| `shake` | impact camera shake after the hit (+ impact) | punchlines, bold claims |

B-roll entrances and exits: `"in"` / `"out"` on a b-roll entry: `fade`, `slide-left/right/up/down`
(eased 0.35 s), `whip-left/...` (0.18 s, the speaker blurs the same way), `flash`, `dip`:
```jsonc
{"path": "broll/app.mp4", "start": 5.6, "dur": 2.0, "in": "whip-right", "out": "fade", "nat": -18}
```
`"grain": 4-10` on a b-roll entry adds film grain to that clip (blends clean or AI footage into phone footage);
EDL-level `"grain": 3-6` gives the whole video a subtle film texture under the captions.
`review` knows these are designed, so it doesn't flag their luma jumps as flash frames. Check a frame at the
peak of each (`editor frames out.mp4 --at <t>`). Record a favourite: `editor style note ... --set reel.transition=whip-left`.

## Motion graphics, three engines (pick per animation)
1. **Built in, no setup** (`editor/graphics.py`, Pillow → transparent ProRes 4444):
   ```bash
   python3 -m editor graphic counter     -o projects/<n>/broll/dau.mov --to 3000 --label "daily active users" --y 0.56
   python3 -m editor graphic lower-third -o projects/<n>/broll/name.mov --name "Aiden" --title "Founder, Curate"
   python3 -m editor graphic checklist   -o projects/<n>/broll/steps.mov --title "The workflow" --items Hook "Rough cut" Music --at 0.3 2.0 3.6
   python3 -m editor graphic title       -o projects/<n>/broll/hook.mov --text "Claude Code edits my reels" --highlight claude code
   python3 -m editor graphic cta         -o projects/<n>/broll/cta.mov --text "Comment GUIDE" --sub "(nothing will happen)"
   ```
   Add as `{"path": "broll/dau.mov", "start": S, "dur": D, "mode": "overlay"}`. Time the reveal so it
   *lands* on the spoken payoff word (start = word time - reveal time).
2. **claude-video-studio skill** (HyperFrames + GSAP, 21 studio looks): render with a transparent
   background (`--format mov`), lay it out for 1080x1920, then add it as an `overlay`. Needs Node 22+.
3. **manim-video skill**: diagrams, equations, data stories, rendered and added the same way.
Spawn one sub-agent per animation, in parallel (video-use rule); each brief is self-contained: output path,
size/fps, palette, font, frame-by-frame timeline, "do not ask questions".
Placement: never over the face. `review` flags overlays that hide it. Chest height (y 0.45-0.65) is the safe band.

## Remotion (optional)
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
