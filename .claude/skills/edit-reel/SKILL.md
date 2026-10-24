---
name: edit-reel
description: Edit raw talking-head / creator footage into a finished, high-quality Instagram Reel, TikTok, YouTube Short or YouTube video. Transcript-driven rough cut (silences, filler words, retakes), editorial pass (hook, pacing), mastered audio, 9:16 face-follow reframe, punch-in zooms, word-synced animated captions, B-roll, colour grade, platform export and visual QA. Use whenever the user drops footage in projects/, says "edit this", "make a reel", "cut this video", or types /edit-reel, even if they only name a file.
---

# Edit a reel end to end

You are the editor. The scripts in `editor/` do the deterministic work
(`python3 -m editor <cmd>`); you make the editorial decisions in between, and you
**look** at the result before calling it done. Never modify files in `raw/`.

Arguments: a project folder (`projects/<name>`), or loose files (create the
project with `python3 -m editor new <name>` and copy the clips into `raw/`).
Clips play in filename order. Ask only if the platform is unclear and can't be
inferred (default: `reels`, 1080x1920).

## 0. Preflight
```bash
python3 -m editor doctor          # first time on a machine; fix anything MISSING with ./setup.sh
ls projects/<name>/raw projects/<name>/broll projects/<name>/music 2>/dev/null
```

## 1. Transcribe
```bash
python3 -m editor auto projects/<name> --to transcribe --model small   # large-v3 / distil-large-v3 on a GPU
```
Read `work/transcript.txt` in full. Note: the strongest single line (hook
candidate), retakes, tangents, dead intros ("hey guys, so today..."), weak outros.

## 2. Rough cut plan, then YOUR editorial pass
```bash
python3 -m editor auto projects/<name> --from plan --to plan [--speed 1.1] [--fillers aggressive]
```
Open `work/edl.json` and follow the **rough-cut** skill. In short:
- Check every `removed` item is right (the retake detector keeps the LAST take;
  restore a segment if the earlier take was better).
- Hook first: the first 1-3 seconds must earn the watch. Move the best line to
  the top or cut the throat-clearing intro.
- Delete tangents and repeated points; keep one idea per reel.
- Set `"title"` (on-screen hook text, <= 6 words) and `"emphasis"` (3-8 key words).
- Talking-head reels usually feel right at `"speed": 1.05-1.15`.

Tell the user the new runtime and what you cut, in a few bullets.

## 3. Cut, master audio, track faces
```bash
python3 -m editor auto projects/<name> --from cut --to track --audio-preset phone
```
- `--audio-preset`: `clean` (lav/shotgun mic), `phone` (default), `noisy` (street/fan).
- Music: put a file in `projects/<name>/music/` (auto-ducked under the voice) or pass `--music`.
- Screen recordings / slides: skip tracking, render later with `--fit blur`.

## 4. Visual beats (zooms, B-roll) on the OUTPUT timeline
```bash
python3 -m editor timeline projects/<name>/work
```
Use those times to add to `edl.json` (see **broll-motion** skill):
- `"zooms"`: 1 emphasis zoom every 4-8 s on the punchline words,
  e.g. `{"start": 3.2, "end": 4.6, "scale": 1.25, "ease": 0}` (ease 0 = snap punch).
- `"auto_punch_in"`: alternate zoom on every other cut hides jump cuts (default 1.12; 1.0 disables).
- `"broll"`: cutaways from `broll/` when the speaker mentions something showable.

## 5. Captions + render
```bash
python3 -m editor auto projects/<name> --from captions --to check \
    --style bold --grade natural --preset reels
```
Pick per the **captions** skill (`bold` default, `beast` hype, `clean` educational,
`minimal` aesthetic) and grade (`natural` default; `punchy`, `warm`, `cinematic`, `bw`;
`--lut file.cube` for a custom look).

## 6. QA, then look at it
`check` runs automatically (resolution, codec, fps, bt709, duration, -14 LUFS, true peak).
Then **Read `out/contact_sheet.png`** and verify:
- the face is in frame in every tile, nothing important cropped;
- captions readable, inside the safe zone, not covering the face/mouth, no orphan words;
- B-roll lands on the right words; hook title visible in the first tiles.
For any doubtful moment: `python3 -m editor frames <out.mp4> -o out/frames --at 3.2 7.9` and Read them.
Fix by editing `edl.json` and re-running from the earliest affected stage
(`--from cut` after segment changes — unchanged segments are cached; `--from captions`
for caption/zoom/b-roll changes).

## 7. Deliver
Report: output path, runtime, what was cut, look choices, QA results. Offer the
other aspect ratios (`--preset youtube|feed|square|shorts|tiktok`) and the
`.srt` (`work/captions.srt`) for platforms that take closed captions.

## Stage map
| change you made | re-run from |
|---|---|
| segments, speed | `--from cut` |
| music / audio preset | `--from audio` |
| captions style, title, emphasis | `--from captions` |
| zooms, b-roll, grade, preset | `--from render` |
