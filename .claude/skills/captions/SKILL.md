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
| `bold` (default) | 1-3 UPPERCASE words, heavy font, thick outline, active word yellow + pop | tips, talking-head reels |
| `beast` | 2 huge words, active word green, bigger pop | hype, challenges, fast edits |
| `clean` | sentence case, up to ~6 words, soft shadow | educational, B2B, YouTube |
| `minimal` | lowercase, small, no highlight | aesthetic, vlog, voiceover |

## Rules
- **Emphasis**: 3-8 words per minute max (numbers, money, the key noun, the
  surprising word). Put them in the EDL `"emphasis"` list. Overuse kills it.
- **Title / hook text**: <= 6 words, readable in 1 s, adds to the spoken hook
  rather than repeating it. Set `"title"` in the EDL or pass `--title`.
- **Placement**: `low` (70% height) clears Instagram/TikTok bottom UI. Use
  `middle` if the speaker's face is low in frame, `high` for screen recordings with
  content at the bottom. Check the contact sheet: captions must never cover the mouth.
- **Fonts**: Montserrat Black/ExtraBold from `assets/fonts/` (installed by
  `./setup.sh`), else Inter Black, else Arial Black. To use a brand font, drop the
  .ttf into `assets/fonts/` and change `fonts` in `editor/captions.py` STYLES.
- Profanity/brand-names spelled wrong by Whisper: fix the `text` in
  `cut_words.json` and rebuild captions (no need to re-cut).
- Colours live in `STYLES` in `editor/captions.py` (hex). Keep contrast high:
  white text with a black outline, highlight in one saturated accent.
