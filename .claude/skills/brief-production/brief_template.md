# <Product>: production brief for a <length> <kind of video>

Use this to plan a production with the user before recording (it follows the structure of the Walk-Free brief that
produced a video the user loved). Every section maps onto `editor produce`: segments → pieces, assets → inventory,
captions → `captions.voices.<v>.lines`, Meta/feature tags → overlay `meta_tag`, rules → the review's checks.

**What you're making:** one video, **<m:ss> long** (hard limit <m:ss>), <1920×1080 | 1080×1920>, 30 fps, H.264, burned-in
captions, for <where it's shown: hackathon judges, launch on X, App Store preview...>.

## Part 1 · What the product is (background)
<two paragraphs: what it does, for whom, the one thing that's different>
| technology / feature | what it does in the video |
|---|---|
| <feature or model> | <the visible moment that proves it> |

## Part 2 · Creative direction
- **Story shape:** <e.g. bookends: a funny problem skit → demos → the same people, problem solved>
- **Tone:** <warm, confident, playful in skits, clear and fast in demos>
- **Colour story:** <e.g. opening graded hot, closing graded cool: the visual thesis>
- **Palette:** <hex values with roles: card backgrounds, text and tags, hot numbers, cool numbers, caption boxes>
- **Type:** <display font for titles and big numbers; text font for tags, chips, lower thirds, captions>
- **Tags:** <a small pill the first time each technology appears: style, position, timing>
- **Screen recordings:** on a <backdrop> at 92%, rounded corners, soft shadow, slow push-ins, punch-ins on what's said
- **Pacing:** never a spinner on screen for more than 1 s (`ramp_waits`), something new on screen at least every 5-7 s

## Part 3 · Assets the team records
| file (name it exactly this) | what it is | used in |
|---|---|---|
| `Scene01_<...>` | <who, where, what's said; best take marked _best> | Segment 1 |
| `Scene02_vo` | <voice-over: who says what> | Segment 2 |
| `P1` | <a photo: what it must show> | Segment <n> |
Recording notes: phone audio for speech (never the camera's), a clap at the start of each take, quiet room for VOs,
2 s of silence before and after each line, landscape, eye level.

## Part 4 · Demos to capture
For each: the URL, the exact clicks, what must be visible, the numbers to write down, how long to hold. Say which
need a signed-in account or live AI keys (record those on the live site; Claude can't fake model output).

## Part 5 · The edit, segment by segment
### Segment 1 · "<name>" · 0:00-0:<ss>
- **Purpose:** <one line>
- **Picture:** <pieces in order with times>
- **Voice:** <whose lines>
- **Graphics:** <tags, counters, chips, callouts, with the words they land on>
- **Music / sound:** <bed, level under dialogue, effects on visible events only>
- **Transition out:** <cut, push-in, dissolve, dip to white>

## Part 6 · Captions (every spoken line)
```
0:02 <line as it will be said>
0:05 <next line>
```

## Part 7 · Sound and export
- −14 LUFS, −1 dBTP; music well under on-camera dialogue (much lower than under voice-over); one bed, ducked
- Exports: <main file name>, <square / vertical cut of the key segment>, subtitles .srt, chapters, cover

## Part 8 · Rules that must not be broken
1. Length cap. 2. Numbers exactly as written here or read off the recorded screen. 3. Honest labels on every AI or
scripted moment. 4. Competitors named neutrally, no claims. 5. Captions on every spoken line. 6. No dev URLs or
private data on screen.

## Part 9 · The timeline as data (optional)
A JSON outline of the segments; Claude turns it into `produce.json`.
