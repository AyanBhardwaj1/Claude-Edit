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
- One contact sheet per clip (`ffmpeg -vf "fps=8/<dur>,scale=480:-2,tile=4x2"`) and Read them; transcribe every clip
  (`editor auto --to transcribe` per clip project, or the transcribe module; Vosk offline mishears names and other
  languages, so correct from the script and from on-screen text).
- Write the **asset map**: brief name → file → what it really contains (takes, angles, language, what was said vs the
  script). List what's missing or different and tell the user in one short message, then continue with the closest
  honest substitute unless it changes the story.

## 2. The timeline table
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

## 4. Assemble
1. **Pieces** (one mp4 each, same codec/size/fps, rendered 4 at a time): live clips (grade, speed ramps, push-ins),
   app shots on the framed backdrop (`editor.overlay.frame`: 92% scale, rounded corners, soft shadow, Ken Burns,
   punch-in on the thing being said), photos with a white shutter flash, the end-card freeze (blur + darken).
2. `concat` the pieces → `base.mp4` (check the total duration to the frame).
3. **Mix**: voices at their table times; music under it with `sidechaincompress` keyed by the voice bus (pad the bus
   with `apad=whole_dur=<total>`), much lower under on-camera dialogue than under voice-over; SFX only on visible
   events; ambience low; `loudnorm I=-14 TP=-1.5`.
4. **Composite**: base + overlay + mix, H.264 16 Mbps, AAC 320k, faststart. Audio-only fixes later are a remux
   (`-map 0:v -c:v copy`).

## 5. Look, then deliver drafts
Contact sheet every ~5 s and frames at every graphic; Read them. Fix overlaps, unreadable text, covered faces, wrong
numbers. Send a 720p preview (`crf 24`) as soon as a complete draft exists, with a short list of what you changed or
couldn't do (and why), then iterate on notes with the smallest re-render. Final: the named export plus any extra
cuts the brief asks for (e.g. a 1080×1080 of the key segment: `crop=1080:1080`).

## 6. Rules
- Never fake model output, app features or numbers; label scripted demos; tag a model only where it produced the moment.
- Numbers exactly as in the brief or read off the recorded screen (write them down when you capture).
- Captions on every spoken line; nothing over the length cap; no spinner on screen > 1 s.
- You can't hear: report LUFS/peaks and ask the user to listen, especially dialogue over music.
- Remember: `editor style note` for what the user said, a few lines in lessons.md, `editor effort record` for the
  stages you timed.
