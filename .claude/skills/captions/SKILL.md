---
name: captions
description: Choose and tune word-synced animated captions (Hormozi-style bold pop, beast, clean, minimal), hook title text, emphasis words and placement for reels, Shorts, TikTok and YouTube. Use when the user asks for subtitles/captions, a caption style, "make the captions pop", different fonts/colours, or captions are hard to read in QA.
---

# Captions

Built from `work/cut_words.json` (word timings already remapped to the cut),
burned in at render time by libass. A `.srt` is written next to the `.ass`
for platforms that accept closed captions (YouTube, LinkedIn).

```bash
python3 -m editor captions projects/<n>/work/cut_words.json -o projects/<n>/work/captions.ass \
    --preset reels --style bold --position low --title "Hook text" --emphasis free claude
# or, inside the pipeline:  python3 -m editor auto projects/<n> --from captions --style bold
```

| style | look | use for |
|---|---|---|
| `white` | bold white, 2-3 words, no highlight colour: the classic creator look | default for "edits my reels" style |
| `bold` | 1-3 UPPERCASE words, heavy font, thick outline, active word yellow + pop | tips, Hormozi-style |
| `beast` | 2 huge words, active word green, bigger pop | hype, challenges, fast edits |
| `clean` | sentence case, up to ~6 words, soft shadow | educational, B2B, YouTube |
| `minimal` | lowercase, small, no highlight | aesthetic, vlog, voiceover |

## Step pills (chapters)
For numbered videos ("5 steps", "3 tools") add black rounded title pills at the top of frame:
```jsonc
"chapters": [{"start": 2.7, "text": "1: The hook"}, {"start": 9.4, "text": "2: Rough cut"}]
```
Each pill shows from its `start` (output seconds, from `timeline`) until the next one (or
`"end"`). Keep them 1-3 words after the number, and start each on the word that announces the step.

## Custom fonts and looks (when asked)
```bash
python3 -m editor fonts add "Bebas Neue"                # any Google Font by name (static weights)
python3 -m editor fonts add "Montserrat" --weights 800 900
python3 -m editor fonts add ~/Downloads/BrandSans-Bold.otf   # the user's own / brand font (not committed)
python3 -m editor fonts list                            # names to use
```
Then put the look on top of any style in the EDL and re-run `--from captions` (or `--font NAME` on `auto`/`captions`):
```jsonc
"captions": {"font": "Bebas Neue", "size": 1.15, "color": "#FFFFFF", "active": "#00E5FF", "emph": "#FF3B30",
             "outline": 1.4, "case": "upper", "max_words": 2, "box": "#000000", "box_opacity": 1.0,
             "spacing": 2, "pop": 1.1, "title_font": "Anton"}
```
- `size` / `outline` / `shadow` multiply the style's own; `"active": "none"` drops the word highlight; `box` puts an
  opaque box behind each line (TikTok look; keep `box_opacity` at 1, lower values show per-word overlaps).
- Pairings that read on a phone: Bebas Neue / Anton (tall condensed, `case: upper`, `size` 1.2-1.4), Montserrat
  ExtraBold (default), Poppins Bold (friendly), Inter SemiBold with `clean` (B2B). Avoid thin weights and scripts.
- Google fonts are recorded in `assets/fonts/fonts.json`, so a new machine gets them back with `editor fonts sync`
  (a missing one is fetched on first use). Own font files must be copied again on another machine.
- Record the user's pick: `editor style note "Bebas Neue captions" --kind reel --set reel.captions.font="Bebas Neue"`.

## Rules
- **Emphasis**: 3-8 words per minute max (numbers, money, the key noun, the
  surprising word). Put them in the EDL `"emphasis"` list. Overuse kills it.
- **Title / hook text**: <= 6 words, readable in 1 s, adds to the spoken hook
  rather than repeating it. Set `"title"` in the EDL or pass `--title`.
- **Placement**: `low` (73% height) clears Instagram/TikTok bottom UI. Use
  `middle` if the speaker's face is low in frame, `high` for screen recordings with
  content at the bottom. Check the contact sheet: captions must never cover the mouth.
- **Fonts**: Montserrat Black/ExtraBold from `assets/fonts/` (installed by
  `./setup.sh`), else Inter Black, else Arial Black. Any other font: see "Custom fonts and looks".
- Profanity/brand-names spelled wrong by Whisper: fix the `text` in
  `cut_words.json` and rebuild captions (no need to re-cut).
- Colours live in `STYLES` in `editor/captions.py` (hex). Keep contrast high:
  white text with a black outline, highlight in one saturated accent.
