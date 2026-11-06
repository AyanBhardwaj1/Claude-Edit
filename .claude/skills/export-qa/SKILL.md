---
name: export-qa
description: Export platform-ready files (Instagram Reels, TikTok, YouTube Shorts, YouTube, feed 4:5, square) at maximum upload quality and verify them before delivery — specs, loudness, colour, and a visual review of frames via contact sheets. Use when exporting, when the user asks for another format/aspect ratio, says the upload looks blurry/washed out, or before telling the user an edit is finished.
---

# Export and QA

## Presets (`--preset`)
| preset | size | notes |
|---|---|---|
| `reels` | 1080x1920 | Instagram Reels, up to 3 min |
| `tiktok` | 1080x1920 | |
| `shorts` | 1080x1920 | YouTube Shorts, up to 3 min |
| `feed` | 1080x1350 | Instagram/LinkedIn 4:5 feed |
| `square` | 1080x1080 | |
| `youtube` | 1920x1080 | long-form; use `--fit blur` for vertical sources |
| `youtube4k` | 3840x2160 | only if the source is 4K |

Encoding: H.264 High 4.2, CRF 16-17 (`--crf` to override), `-preset slow`,
aq-mode 3, 2 s GOP, yuv420p bt709 tagged, AAC 256k 48 kHz, faststart. Platforms
re-encode every upload; giving them a clean, high-bitrate master is what
keeps the result sharp. The frame rate follows the source (24-60 fps).

Other aspect ratios from the same edit only need a re-render:
```bash
python3 -m editor captions projects/<n>/work/cut_words.json -o projects/<n>/work/captions_yt.ass --preset youtube --style clean
python3 -m editor render projects/<n>/work -o projects/<n>/out/<n>_youtube.mp4 --preset youtube --captions projects/<n>/work/captions_yt.ass
```

## QA — required before saying "done"
1. `python3 -m editor check <file> --preset <p>`. Every line must be PASS.
2. `python3 -m editor sheet <file> -o <dir>/contact_sheet.png` and **Read the PNG**.
   Look for: face cut off, captions over the mouth or off-screen, black/frozen
   frames, B-roll on the wrong word, colour too saturated or skin too orange.
3. `python3 -m editor review <file> projects/<n>/work` checks every cut (audio click, flash frame,
   mid-word cut) and every card/overlay/pill (face covered), and writes `review/review_*.png`. Read them.
4. `python3 -m editor cover <file> -o out/cover.jpg --title "..." --work projects/<n>/work` makes the cover
   from a clean frame (no captions/overlays), plus `cover_grid.jpg`, the 4:5 crop the profile grid shows.
5. Spot-check exact moments with `python3 -m editor frames <file> -o <dir> --at <t> ...`.
5b. `python3 -m editor pacing projects/<n>/work`: bare face over 4.5 s, over 10 s with zooms only, more than 10
   zooms a minute, more than 2 big word cards, visuals under 1.2 s, names said but never shown, and too few b-roll
   moments for the length, the first second (speech starting after 0.6 s, a warm-up opener like "so" / "um" / "today", no hook title to read, or one
   up too briefly to read: about 0.4 s + 0.25 s a word, and a later line that grips more than the opening, as a
   cold-open idea: an editorial call, propose it rather than apply it) and the loop seam
   (reels replay on their own: over 0.6 s of nothing after the last word, or a goodbye like "thanks for watching" in
   the last 3 s (a CTA is a choice, not flagged); end the cut on the last real point). `check` also fails black stretches of 0.5 s or more.
5c. Vertical posts: `python3 -m editor safezone <file> --work projects/<n>/work` measures the captions from
   captions.ass against Reels / TikTok / Shorts UI (right-side buttons, the caption/username block at the bottom,
   the top bar) and writes `<file>_safezone_<platform>.png` with the zones drawn over real frames: Read one. A hit
   means move the captions (`--position middle` on `editor auto` / `editor captions`) or the graphic; zones are
   approximate, so look before changing.
6. Report what you checked. If something can't be verified (e.g. how it sounds),
   say so plainly instead of implying it was checked.

## Versions, post kit, export, phone
```bash
python3 -m editor version projects/<n> --note "music quieter"     # versions/vN: export.mp4, cover, edl.json, notes.md
python3 -m editor version projects/<n> --list | --restore 2
python3 -m editor post projects/<n> --caption "..." --hashtags a b c d e --keywords "..."   # exactly 5 hashtags
python3 -m editor export projects/<n> [--version 2]   # out/export/<Title> - Version N.mp4 + cover + caption.txt
python3 -m editor share "<exported mp4>" --caption projects/<n>/out/post.txt   # QR code, 15-minute link on the home Wi-Fi
```
`share` runs until the link expires (start it in the background) and saves the QR code as a PNG next to the video:
show it to the user. Phone and computer must be on the same Wi-Fi (desktop app only); if their network blocks it,
suggest AirDrop or iCloud/Google Drive. There is no direct posting: they upload from their phone.

## Common upload problems
- **Washed out / grey on iPhone footage**: the source was HDR (HLG). The cut
  stage tone-maps HDR automatically; confirm `check` shows `transfer=bt709`.
- **Blurry after upload**: the source was below 1080p or zoomed beyond 1.35x. Lower
  zoom scales, record at 4K for vertical crops from landscape.
- **Instagram "upload in high quality"** must be on in the app settings; mention it.
