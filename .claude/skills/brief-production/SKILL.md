---
name: brief-production
description: Produce a finished 1-5 minute video from a written production brief - a script plus an effects/edit plan plus the team's recordings (live-action skits, on-camera lines, voice-overs, phone or screen recordings) and app demos to capture - such as hackathon demo videos, product demos, pitch videos and explainers. Builds the timeline from the real recordings, captures app screens, renders a designed overlay track (captions, model/feature tags, counters, checklists, lower thirds, end card), composes or picks music, mixes, and delivers drafts fast. Use when the user hands over a brief/script/"effects file" with scenes and timestamps, says "hackathon video", "demo video", "make the video from this script", or attaches many scene clips plus a plan.
---

# Video from a production brief

The brief is the plan; the recordings are the truth. Edit to what was actually said and filmed, keep every number
honest, and get a watchable draft to the user early. Read first:
- `.claude/skills/edit-reel/lessons.md` (the Walk-Free production: what worked, what broke, what the user loved)
- `.claude/skills/edit-reel/effort.md` if there's any deadline ("we have 20 minutes") or a quality ask
- `library/style/STYLE.md` (brand notes: e.g. `brand:walk-free` has the approved demo look)
- the whole brief, twice: once for the story, once for rules (length cap, numbers, labels, captions)

## 1. Estimate, then inventory (first 2-4 minutes)
- Deadline? `python3 -m editor effort show --length <final seconds> --budget <min> --stages transcribe capture pieces overlay mix composite`.
  If asked "how long?", answer with that number and what you'd drop, before doing anything.
- Copy uploads into `projects/<name>/raw/` with plain names (`scene1.mov`, `scene5.m4a`); never modify raw.
- `python3 -m editor inventory projects/<name>/raw` (lengths, sizes, sound, a contact sheet per clip, what is said;
  writes `work/inventory/inventory.md` and per-clip `<clip>.words.json` for captions). Read it and the sheets. Offline
  Vosk mishears names and other languages: correct from the script and from on-screen text.
- Write the **asset map**: brief name → file → what it really contains (takes, angles, language, what was said vs the
  script). List what's missing or different and tell the user in one short message, then continue with the closest
  honest substitute unless it changes the story.

## 2. The timeline table
Start from a draft: `python3 -m editor produce init projects/<name>/raw -o projects/<name>/produce.json`
(clips trimmed to their speech, voice-overs over placeholders, captions from word times, a composed bed, an end
card, and a `todo` list). Then reorder and refine it into the story; `--plan` prints the table below.
Brief times are targets. From the real word times build a table: piece, source, in/out, speed, output start/end.
Rebalance so the total hits the brief's length exactly (pad with breathing room on demos, never on dialogue).
Every overlay, caption, SFX and music cue derives its time from this table (`out = src + offset`), so a re-time is
one number. Captions: what was actually said, one card per line, ≤ 2 lines × 42 chars.

## 3. Parallel work (one message, hard deadlines in every brief, "partial beats late")
- **App demos**: capture per the brief's steps. Live site blocked or needs keys → run the app from its repo
  (`add_repo` with the user's yes). Turn the brief's steps into a shot list and run it once
  (broll-library skill has the format); it works for software-rendered WebGL with no GPU:
  `python3 -m editor capture shots demo_shots.json -o projects/<n>/broll/app [--record]`, e.g.
  `{"base": "http://localhost:5173", "shots": [{"name": "route", "url": "/demo?tab=route", "wait": 40,
  "do": [{"click": "Quickest"}], "read": {"eta": "text=min walk"}}]}`. Read `shots_sheet.jpg`, quote numbers from
  `shots.json` `read`, re-run only what failed. Animate stills with camera moves (lessons.md); a choppy `--record`
  → `capture stills-from`. Real model output only; scripted runs get a "scripted demo" label.
- **Music**: a licensed track the user owns, else an original bed: `python3 -m editor compose bed --length <s>
  --bpm 100 --end-chord-at <end card start>` (music-library skill), plus `compose sfx`/`ambience`.
- **Graphics**: write the overlay spec yourself (you own the timeline) and render it once:
  `python3 -m editor overlay spec.json overlay.mov -j 3` (element types, theme and examples:
  `editor/overlay/README.md`; broll-motion skill).
- Meanwhile you: grade and trim live action, clean voices (`highpass=80, afftdn, light compression`).

## 4. Assemble with one spec: `editor produce`
Write `projects/<name>/produce.json` (the whole video: pieces, audio, overlay, extras) and run it. A worked,
complete example is the Walk-Free rebuild: `editor/produce.py` docstring + [example.md](example.md).
```bash
python3 -m editor produce projects/<name>/produce.json --plan      # timeline table, total vs target, overlay check
python3 -m editor produce projects/<name>/produce.json --preview   # pieces -> overlay -> mix -> composite -> extras
python3 -m editor produce projects/<name>/produce.json --only mix  # after an audio note (then --only composite)
```
- **Pieces** (in order; cached by content, so a note re-renders only the shots it touches):
  `video` (src, in/out, speed, grade hot|cool|neutral|warm|punchy|bw or a raw filter, crop_y, z0/z1 Ken Burns,
  push [at,dur,zoom,fx,fy] for a push-in transition, fade_in/fade_out [s,"white"],
  `ramp_waits` {"speed": 6, "label": "thinking…"} speeds through spinners and AI waits with a shimmer: never hold a
  spinner more than 1 s), `framed` (app screen or photo
  on the rounded, shadowed backdrop; z0/z1, fx/fy, punch [t,zoom,fx,fy], flash for a shutter), `still` (full frame),
  `sequence` (stills cross-blended: a time-lapse from screenshots), `freeze` (last frame of another piece, blur and
  darken for an end card), `color`.
- **Times are references**, so a re-time is one number: `"s3"`, `"s3+1.2"`, `"s3.end-0.5"`, and `"@v3:2.01"` (where
  source second 2.01 of voice v3 lands): anchor captions and pills on real word times from the transcript.
- **Audio**: `voices` (cleaned and summed; music ducks under them), `music` (a file, or `{"compose": {...}}` for an
  original bed fitted to the length; `automation` [[t, dB], ...] for hard stops and dips under dialogue), `sfx`
  (built-in names like whoosh, pop, shutter, or files), `beds` (ambience and app audio that don't duck the music).
  Mastered to the output `lufs` (default −14) and `tp`.
- **Captions** from word times: `"captions": {"voices": {"v3": "work/inventory/scene3.words.json"}}`. When the
  brief has the script (it usually does), give each voice its lines: `{"v3": {"words": "...words.json", "lines":
  ["He asked out loud, in Spanish.", "..."]}}`: one card per line, the brief's exact words, timed by aligning them
  onto what the recogniser heard (so Vosk's "met his muse" still lands as "Meta's Muse"). `"script": "..."` does the
  same but lets the cards break automatically.
- **Overlay**: the overlay spec inline (or a path); every time in it may be a reference.
- **Extras**: a crop, e.g. `{"name": "square", "from": "s3q", "to": "s4a", "size": [1080, 1080]}`, or a social cut of
  a 16:9 video that keeps the whole frame: `{"name": "vertical", "kind": "band", "size": [1080, 1920], "title": "..."}`
  (the frame as a band over its own blur, a title above). Add `"ranges": [["s3q", "s3ans.end"], ["d7b", "d7c"]]` for
  a highlight reel of several moments back to back.

## 5. Look, then deliver drafts
`editor produce` ends with a review (`work/produce/review/review.md`): length vs target, loudness, caption coverage
of every voice (a voice under 60% is flagged: the Walk-Free draft missed the app's spoken Spanish answer), late
graphics, a contact sheet and a frame at every graphic. With `"brief": "BRIEF.md"` in the spec it also flags any
number on screen that isn't in the brief; list numbers you read off the app's screen in `"numbers_from_screen"`. Read all of it, then look further yourself:
Contact sheet every ~5 s and frames at every graphic; Read them. Fix overlaps, unreadable text, covered faces, wrong
numbers. Send a 720p preview (`crf 24`) as soon as a complete draft exists, with a short list of what you changed or
couldn't do (and why), then iterate on notes with the smallest re-render. Final: the named export plus any extra
cuts the brief asks for (e.g. a 1080×1080 of the key segment: `crop=1080:1080`).

Before sending the first draft at standard or polish effort, spawn one critic sub-agent with
[critic.md](critic.md) (files, not your opinion), fix what it finds that's real, then send.

Notes loop: change the spec (the smallest edit: one piece, one gain, one caption), re-render with
`editor produce produce.json --preview --note "<the user's note>"` (only changed pieces re-render; each note is
saved as out/versions/<name>.vN.mp4 with the spec and a line in project.md; `--versions` lists them). Record any
preference in the note with `editor style note`, and `editor style learn produce.json` when they approve.

## 6. Rules
- Never fake model output, app features or numbers; label scripted demos; tag a model only where it produced the moment.
- Numbers exactly as in the brief or read off the recorded screen (write them down when you capture).
- Captions on every spoken line; nothing over the length cap; no spinner on screen > 1 s.
- You can't hear: report LUFS/peaks and ask the user to listen, especially dialogue over music.
- Remember: `editor style note` for what the user said, `editor lessons add` (a few lines), `editor effort record` for the
  stages you timed.
