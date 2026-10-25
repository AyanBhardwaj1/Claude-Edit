---
name: edit-reel
description: Edit raw talking-head / creator footage (files or a pasted link) into a finished, high-quality Instagram Reel, TikTok, YouTube Short or YouTube video, the "Claude Code edits my reels" way. Five steps (hook, rough cut, subtitles, music, B-roll) then a final pass. Use whenever the user drops footage in projects/, pastes a video link, says "edit this", "make a reel", "cut this video", or types /edit-reel, even if they only name a file.
---

# Edit a reel end to end

You are the editor. The scripts in `editor/` do the deterministic work
(`python3 -m editor <cmd>`); you make the editorial decisions between them,
and you **look** at the result before calling it done. Never modify files in
`raw/`. Shared assets live in `library/` (hooks, music, B-roll) and get better
with every reel. Use them, and add to them.

Arguments: a project folder (`projects/<name>`), loose files, or a **link**.
Default platform `reels` (1080x1920). Ask only what you can't infer.

## 0. Get the footage
```bash
python3 -m editor new <name>                                  # projects/<name>/{raw,broll,music,work,out}
python3 -m editor fetch "<url>" --project projects/<name>     # link → raw/ (yt-dlp, best quality)
#   Instagram/TikTok may need: --cookies-from-browser chrome
python3 -m editor doctor                                      # first run on a machine
python3 -m editor triage projects/<name>                      # role of every raw clip
```
Read each sheet in `work/triage/` and confirm or fix `role` in `work/triage.json`
(**broll-library** skill): `a-roll` = founder-to-camera (gets transcribed and cut),
`broll-reusable` → `python3 -m editor broll add ...` into the library,
`broll-oneoff` → copy into the project's `broll/`.

## Step 1: the hook  (**hooks** skill)
```bash
python3 -m editor auto projects/<name> --to transcribe      # WhisperX if installed, else faster-whisper
```
Read `work/transcript.txt` in full. Then open `library/hooks.md`, shortlist 3-5
templates from different categories, adapt them with this video's specifics, and
pick one. It becomes the EDL `"title"` (on-screen hook text, max 6 words). If a
spoken line already works as a hook, open the edit on it (step 2). Tell the
user which hook you chose and the runner-up.

## Step 2: rough cut  (**rough-cut** skill)
```bash
python3 -m editor auto projects/<name> --from plan --to plan [--speed 1.1]
```
This writes `work/edl.json` and `work/rough_cut_viz.png`. **Read the PNG**: red
blocks are cuts (pauses, fillers, repeated lines; of two takes it keeps the
better one). Audit `removed`, move the hook line first, delete tangents, set
`"emphasis"`. For multi-step videos add `"chapters"` (the black step pills),
e.g. `[{"start": 2.7, "text": "1: The hook"}]`; get their times in step 5
from `timeline`. Report old → new runtime and the biggest cuts.
```bash
python3 -m editor auto projects/<name> --from cut --to cut
```

## Step 3: subtitles  (**captions** skill)
Word-synced from the transcript timings. Default `--style white` (bold white,
2-3 words, the creator look); `bold` for Hormozi-style yellow pop; `clean`
for educational. Built in step 6.

## Step 4: music  (**music-library** skill)
```bash
python3 -m editor music list
```
Pick a track whose mood and energy fit the topic (Hype, Uplifting, Emotional,
Tense/Dark, Cool/Fun) and set it in the EDL:
`"music": {"track": "<id>", "db": -20, "start": 0}`. If the user pasted a song
link, add it first with `music add "<url>" --mood ... --tags ...` (only music they
have rights to). No fitting track → no music, and say so.

## Step 5: B-roll  (**broll-library** + **broll-motion** skills)
```bash
python3 -m editor auto projects/<name> --from audio --to track
python3 -m editor timeline projects/<name>/work             # output-timeline times
python3 -m editor broll list                                # shared library
```
For each line that names something showable, place B-roll in the EDL `"broll"`:
library clips by id, project `broll/` files, or captures you make now:
- websites / tweets / docs: `python3 -m editor capture web "<url>" -o projects/<name>/broll/x.png` (or `--video 6`)
- the user's app: `capture sim` (iPhone Simulator, macOS) or `capture android`
- the rough-cut card itself: `work/rough_cut_viz.png`
Use `"mode": "card"` for screen recordings, code and screenshots (they float over the
chest, face stays visible) and `full` for cutaway footage. Add 1 emphasis zoom
every 4-8 s (`"zooms"`).

## Step 6: render, then the final pass  (**export-qa** skill)
```bash
python3 -m editor auto projects/<name> --from captions --to check --style white --grade natural
```
`check` must be all PASS. Then **Read `out/contact_sheet.png`**, plus frames at
every card, chapter and zoom (`python3 -m editor frames <out.mp4> -o out/frames --at ...`):
- hard cuts land on word boundaries, with no half words and no flash frames;
- face always visible (cards below it, captions below the cards);
- step pills match what's being said; B-roll lands on the right words;
- hook title readable in the first second.
Fix in `edl.json` and re-run from the earliest affected stage (table below).
You can't hear the result, so say that audio was checked by numbers (LUFS/peak) only.

## 7. Deliver
Report the output path, runtime, the hook used, what was cut, music and B-roll
choices, and QA results. Offer other formats (`--preset youtube|feed|square|tiktok|shorts`),
the `.srt`, and adding any new reusable B-roll or a winning hook to `library/`.

## Stage map
| change you made | re-run from |
|---|---|
| segments, speed | `--from cut` |
| music track / level | `--from audio` |
| captions style, title, emphasis, chapters | `--from captions` |
| zooms, b-roll, grade, preset | `--from render` |
