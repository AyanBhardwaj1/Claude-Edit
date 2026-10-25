---
name: edit-reel
description: Edit raw talking-head / creator footage (files, a folder, or a pasted link) into a finished, production-quality Instagram Reel, TikTok, YouTube Short or YouTube video. Five steps (hook, rough cut, subtitles, music, B-roll), then motion graphics, sound design, a self-review of every cut, and a cover. Use whenever the user drops footage in projects/, pastes a video link, says "edit this", "make a reel", "cut this video", or types /edit-reel, even if they only name a file.
---

# Edit a reel end to end

You are the editor. `python3 -m editor <cmd>` does the deterministic work; you make the
editorial decisions between steps and you **look** at the result before calling it done.
Never modify files in `raw/`. Shared assets in `library/` (hooks, music, B-roll, models,
SFX) get better with every reel.

Process (from video-use): **inventory → propose a plan → confirm → execute → self-review → iterate → remember.**
Rules that are correctness, not taste: never cut inside a word; 30 ms fades at every cut (built in);
subtitles last, over every overlay (built in); never cover a face; cached transcripts are never redone.

## 0. Footage in, and memory
- **Desktop app (local):** the user's folder or files: `python3 -m editor new <name>` and copy clips into `raw/`.
- **A link:** `python3 -m editor fetch "<url>" --project projects/<name>` (yt-dlp; Instagram/TikTok may need
  `--cookies-from-browser chrome`). Direct file links work too.
- **Cloud session:** footage must arrive in the repo (committed to the branch, under 100 MB per file) or
  from an allowed host. The Google Drive connector returns base64 text, so only small assets
  (screenshots, logos, short audio) go that way. If footage can't reach you, say so and suggest the desktop app.
- Read `projects/<name>/project.md` if it exists and sum up the last session in one line before continuing.
```bash
python3 -m editor doctor                      # first run on a machine
python3 -m editor triage projects/<name>      # a-roll vs reusable / one-off b-roll (broll-library skill)
```

## 1. Transcribe and inventory
```bash
python3 -m editor auto projects/<name> --to transcribe
```
Engines fall back automatically: WhisperX → faster-whisper → ElevenLabs Scribe (if `ELEVENLABS_API_KEY`;
verbatim fillers, speakers, `(laughs)`) → Vosk (offline, always available via `python3 -m editor models vosk`).
Put names and brand terms in `library/glossary.txt` (one per line) so they're spelled right.
Read `work/transcript.txt` in full. If the engine was **vosk** (no punctuation or casing), or a name came
out wrong, write a corrected copy of transcript.txt (keep the `[src] mm:ss-mm:ss` prefixes) and run
`python3 -m editor retext projects/<name>/work corrected.txt`. If the user gave a script, retext it.

## 2. Propose the plan, and wait for a yes
In 4-8 plain sentences: the hook (from the **hooks** skill, using `library/hooks.md`), the shape
(e.g. HOOK → PROBLEM → 3 STEPS → CTA), which takes and what gets cut, length, caption style, music mood,
B-roll and graphics ideas, grade. Ask only what the material can't answer. **Don't cut until the user says
yes**, unless they told you to just do it.

## 3. Rough cut  (rough-cut skill)
```bash
python3 -m editor auto projects/<name> --from plan --to plan [--speed 1.1]
```
Read `work/rough_cut_viz.png` and `work/edl.json`: audit `removed`, move the hook first, cut tangents,
set `"title"`, `"emphasis"` and `"chapters"`. Use `python3 -m editor inspect <raw clip> <start> <end> -o x.png
--transcript projects/<name>/work/transcript.json` at ambiguous cut points. Many takes of the same beat:
brief a sub-agent with video-use's editor brief (`.claude/skills/video-use/SKILL.md`, "Editor sub-agent brief").
```bash
python3 -m editor auto projects/<name> --from cut --to track
```

## 4. Subtitles, music  (captions, music-library skills)
Default `--style white` (creator look) or `bold` (Hormozi pop). Pick a library track by mood and put it in
`"music"`. No good fit → no music.

## 5. B-roll, graphics, sound  (broll-library, broll-motion skills)
```bash
python3 -m editor timeline projects/<name>/work          # output-timeline times for everything below
```
- B-roll: library clips by id, `broll/` files, or captures (`capture web`, `capture sim|android`).
- App screens with no simulator: any screen recording or screenshot as `"mode": "card", "frame": "phone"`.
- Motion graphics, fastest: `python3 -m editor graphic counter|lower-third|checklist|title|cta ...` →
  `"mode": "overlay"`. Richer: the **claude-video-studio** skill (21 HyperFrames looks) or **manim-video**
  (diagrams). Spawn one sub-agent per animation, in parallel.
- Sound: `"sfx": "auto"` (default) puts a whoosh/pop/click on visible events only, capped. Set `"none"` for calm pieces.
- Optional `"progress_bar": true` for long tips reels.

## 6. Render, then self-review (cap: 3 passes)
```bash
python3 -m editor auto projects/<name> --from captions --to check --style white
```
`check` (spec + loudness) and `review` (every cut: clicks, flash frames, mid-word cuts, **faces covered by
cards/overlays/pills**) run automatically, then a cover is made. Read `out/contact_sheet.png`, every
`out/review/review_*.png`, and `out/cover.jpg`. Spot-check frames at each card and graphic. Fix in the EDL and
re-run from the earliest stage. After 3 passes, report what's left instead of looping. You can't hear: report
LUFS/peak numbers, never "it sounds good".
For anything that will be published, spawn one **critic sub-agent** with the render path, the EDL and the
sheets: "roast it, don't praise it: a verdict, ranked problems with timecodes, the 5 fixes to do first."

## 7. Deliver and remember
Report the path, runtime, hook, cuts, music, B-roll, graphics, check and review results, and the cover.
Offer other formats (`--preset youtube|feed|square|tiktok|shorts`) and the `.srt`. Append to
`projects/<name>/project.md`:
```
## Session N, YYYY-MM-DD
Strategy: ... / Decisions: ... / Reasoning: ... / Outstanding: ...
```

| change | re-run from |
|---|---|
| transcript text (retext) | `--from plan` |
| segments, speed | `--from cut` |
| music | `--from audio` |
| captions, title, emphasis, chapters | `--from captions` |
| zooms, b-roll, graphics, sfx, grade, progress bar | `--from render` |
