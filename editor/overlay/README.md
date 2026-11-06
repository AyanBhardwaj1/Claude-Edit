# editor overlay: a designed overlay track from a JSON spec

```bash
python3 -m editor overlay SPEC.json OUT.mov [--from S --to S] [-j 3] [--check] [--no-fetch-fonts]
python3 -m editor overlay frame OUT_DIR [--size 1920x1080 --scale 0.92 --radius 18 --backdrop "#f4f1e6"]
python3 -m editor overlay still SRC OUT.mp4 [--dur 4] [--z0 1 --z1 1.07 --fx .5 --fy .5] [--punch T Z X Y]
# same without the CLI wiring: python3 -m editor.overlay ...
```

One transparent MOV (`png` codec, `rgba`) for a whole timeline of designed graphics: captions in a custom box,
model/feature tags, chips, counters, checklists, callouts, lower thirds, a URL band, a logo sting, an end card.
Built for the Walk-Free hackathon video (70 elements over 176 s: 5280 frames in 166 s, 82% deduped, `-j 3`).
Use it for demo, launch and explainer videos where the graphics follow a script; for one-off reel graphics
use `editor graphic` (no Node needed).

- **How:** `page.html` draws every element from the time alone (`seek(t)`), headless Chromium (Node Playwright)
  screenshots it over a transparent background, ffmpeg packs the PNGs into a MOV.
- **Speed:** each frame returns a state key; an unchanged key reuses the previous PNG, the empty frame is captured
  once, and `-j N` renders N chunks in parallel (global frame indices, so chunks join seamlessly).
- **Range:** output t=0 is `--from`; the default range is 0..`duration` (or the last element's end).
- **Needs:** Node with `playwright` (`npm i -g playwright && npx playwright install chromium`; the Python
  playwright package's bundled copy is used as a fallback) and ffmpeg. `--check` validates without rendering.

## Composite
```bash
ffmpeg -i base.mp4 -i OUT.mov -filter_complex "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]" \
       -map "[v]" -map 0:a? -c:v libx264 -crf 16 -preset medium -c:a copy final.mp4
```
Render with `--from A --to B` and add `-itsoffset A` before `-i OUT.mov` to cover only part of a long base. In a
reel EDL the MOV is an ordinary `{"path": "...", "start": S, "dur": D, "mode": "overlay"}` b-roll entry.

## Spec
```jsonc
{
  "duration": 20,                       // optional; default = last element end
  "theme": {                            // optional; every key has a default (the Walk-Free look)
    "colors": {"bg": "#f4f1e6", "ink": "#2f4a33", "accent": "#d7772d", "accent2": "#2f6577", "dark": "#1f241c"},
    "fonts": {"display": "Playfair Display", "text": "DM Sans"},
    "width": 1920, "height": 1080, "fps": 30
  },
  "elements": [
    {"type": "caption", "text": "It's 104 degrees and I have to walk back.", "t_in": 0.2, "t_out": 3.0},
    {"type": "meta_tag", "text": "Muse Voice Transcribe", "t_in": 0.3, "x": 80, "y": 80},
    {"type": "chip", "text": "112°F feels-like", "t_in": 0.6, "t_out": 3, "x": 1840, "y": 80, "color": "accent", "anchor": "tr"}
  ]
}
```
Seconds are on the spec timeline. Positions and sizes are **pixels of the layout** (= output pixels unless you set
`scale`). Every element fades out over 250 ms before `t_out`. Full example with every type:
[`example_spec.json`](example_spec.json) (20 s).

### Theme
| key | default | what it is |
|---|---|---|
| `colors.bg` | `#f4f1e6` (ivory) | light surface: cards, chips, light pills, logo sting, big_stat / end_card text |
| `colors.ink` | `#2f4a33` (deep green) | dark brand colour: pills, checklist, lower third, text on cards |
| `colors.accent` | `#d7772d` (heat orange) | checkmarks, stamp, marker, glow box, lower-third bar, url band bar |
| `colors.accent2` | `#2f6577` (shade teal) | second accent (chips, counter lines) |
| `colors.dark` | `#1f241c` (off-black) | caption box colour (at `box_opacity`, default 0.6) |
| `colors.box` | `dark` at 0.6 | caption box, any CSS colour (overrides dark + box_opacity) |
| `colors.text` | `#ffffff` | caption text |
| `colors.muted` / `muted_ink` / `muted_label` | `#e4e2da` / `#5b5f57` / `#8a8d84` | chips_compete chips, text, label |
| `colors.highlight` | `#fffdf5` | trace line, shimmer band |
| `colors.flash` / `shadow` | `#ffffff` / `#101810` | flash colour; drop shadows and the big_stat vignette |
| `fonts.display` | `Playfair Display` | numbers, headings, wordmarks (weights 400/600/700) |
| `fonts.text` | `DM Sans` | everything else (weights 400/600/700) |
| `width`, `height`, `fps` | 1920, 1080, 30 | output size (any: 1080x1920 for reels) and frame rate (also accepted top level) |
| `scale` | 1 | layout pixels per output pixel: `"width": 3840, "height": 2160, "scale": 2` keeps a 1080p layout at 4K |

Colour fields on elements (`color`, counter line `color`) take a role (`ink`, `accent`, `accent2`, `bg`), the old
Walk-Free names `green` / `heat` / `shade` / `ivory` (aliases of ink / accent / accent2 / bg), or any CSS colour.
The same aliases work as keys inside `theme.colors`.

Fonts are found by family name in `assets/fonts/` (the repo's font folder, `editor fonts list`) and loaded with
`@font-face` from `file://`. A missing family is downloaded from Google Fonts with `editor fonts add` (pass
`--no-fetch-fonts` to skip); if that fails the page uses a system font of that name, then Georgia/serif and
Arial/sans-serif, and the render log warns. Only regular (upright) weights are installed; italics are synthesized.

Layout defaults that follow the frame size (W x H): caption box bottom H-70, max width min(760, W-160); counter
bottom-right (W-110, H-150); checklist x W-630, y 300; chips_compete row centre y H-320; lower_third y H-280;
pills_row y H-180; url_band centre y H-380. On a 1080x1920 reel, check rows of chips fit the width.

### Element types
| type | fields | notes |
|---|---|---|
| `caption` | text, sub?, t_in, t_out, bottom?, max_w? | bottom centre box, 2 lines max (sub italic), 80 ms cut in/out |
| `meta_tag` | text, t_in, x, y, dur? / t_out? | ink pill, (x,y) = top-left; lives 3.5 s unless dur / t_out |
| `tag` | text, t_in, t_out, x, y, style `green`/`ivory`/`small` | (x,y) = top-left; green = ink pill, ivory = bg pill |
| `chip` | text, t_in, t_out, x, y, color, anchor `tl`/`tr`, icon? | bg card with icon: accent=sun, accent2=leaf, else dot; `icon`: sun/leaf/dot/none. tr: x = right edge |
| `big_stat` | from?, to, prefix?, suffix?, count_dur?, label?, source?, t_in, t_out | centred count-up over a vignette; decimals follow from/to |
| `big_caption` | text, sub?, t_in, t_out | centred bg card, display font 96 px |
| `counter` | lines [{text, t, color}], x?, y?, t_out | card, (x,y) = top-left, default bottom-right; a leading number is set in the display font at 56 px, the rest text font |
| `callout` | text, t_in, t_out, tx, ty, side `right`/`left`/`top`/`bottom`, dist? | dot on the target, line to a pill `dist` (120) px away |
| `ring` | x, y, r?, t_in, t_out | pulsing ring, (x,y) = centre |
| `glow_box` | x, y, w, h, t_in, t_out, color? | pulsing accent outline, top-left + size |
| `trace` | points [[x,y], ...], t_in, t_out, draw_dur? | glowing line drawn along the points with a moving head |
| `chips_compete` | items, times, t_out, t_column?, label?, row_y?, col_x?, col_y? | muted chips pop into a centred row, then (t_column) stack into a left column with the label |
| `checklist` | heading, items, times, t_in, t_out, x?, y?, w? | ink card, items tick at their times; default x W-630, y 300, w 520 |
| `lower_third` | name, role?, side `left`/`right`, t_in, t_out, y?, margin? | ink bar with accent edge; y H-280, 110 px margin |
| `shimmer` | t_in, t_out, label?, y? | sweeping light band + "thinking..." pill at top centre (trailing "..."/"…" animates) |
| `marker` | x, y, w, h, t_in, t_out, draw_dur?, color? | highlighter swipe (accent at 40%), top-left + size |
| `stamp` | text, x, y, t_in, t_out, color?, rotate? | rubber stamp slam, (x,y) = centre, -6° |
| `pills_row` | items, times, t_out, y? | ink pills pop in one by one, final row centred; y = top (H-180) |
| `url_band` | text, t_in, t_out, y? | full-width bg band wipes in, display font 84 px; y = band centre (H-380) |
| `logo_sting` | t_in, dur?, text?, image?, image_size?, mark?, size?, color?, background? | opaque full frame for [t_in, t_in+dur) (2.5 s): logo `image` (path relative to the spec) or `mark: "sun_tree"` scales in, wordmark `text` rises |
| `end_card` | lines, t_in, t_out, color? | centred: line 1 display 110 px, line 2 display 54 px, the rest text 28 px |
| `wipe_labels` | left, right, t_in, t_out, margin? | before/after pills in the bottom corners (56 px) |
| `flash` | t_in, dur?, color? | full-frame flash fading over dur (0.3 s) |

## Screen recordings and screenshots on a backdrop (`frame.py`)
`editor overlay frame OUT_DIR` writes `frame_bg.png` (backdrop colour plus a soft shadow: 24 px down, blur 30,
18% black, scaled with the short side) and `frame_mask.png` (the picture's rounded-rect alpha mask, antialiased).
The picture is `scale` (0.92) of the frame, centred, even-sized: 1766x994 at 77,43 for 1920x1080.

`editor overlay still SRC OUT.mp4` puts an image or a video into that frame: cover-fit, 2x oversampled, a slow Ken
Burns from `--z0` to `--z1` around focus `--fx/--fy`, and an optional `--punch T ZOOM X Y` that eases (0.35 s
smoothstep) at T s to ZOOM centred on X/Y. Images need `--dur`; videos use the rest of the clip after `--start`
(`--audio` keeps its sound). Output is H.264 yuv420p at the frame size, ready to cut into the timeline.
From Python: `frame.assets(out_dir, w, h, scale, radius, backdrop)` and
`frame.composite(src, out, dur, start, w, h, fps, z0, z1, fx, fy, punch=(t, z, x, y), ...)`.
