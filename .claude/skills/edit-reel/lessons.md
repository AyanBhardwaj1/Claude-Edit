# Lessons from real productions

Read this before planning any non-trivial edit. After every video, append 1-5 lessons here (what cost time, what
broke, what the user loved or rejected), newest first, one line each, under a dated heading. Preferences go to
style memory (`editor style note`), timings to `editor effort record`; this file is for craft and process.

## 2026-11-05 Walk-Free hackathon demo (2:56, 16:9, brief-driven, rush effort, about 35 min)
What the user loved (draft 4: "wow that's really good"): app screens on an ivory frame at 92% with rounded corners
and a soft shadow, slow push-ins and punch-ins on what's being said, small model-name pills, captions in a dark box,
a competitor-chips → "built for students" checklist, counters and a big statement card, a logo sting, the hot
(orange) to cool (teal) grade shift, an end card over a blurred freeze-frame, original music.

**Briefs and assets**
- The brief's file names won't match the uploads (`Scene01_campus_wide` vs `scene_1.mov`; three angles described,
  one take delivered). Make an asset map first (contact sheet per clip + transcript) and say what's missing early.
- Brief timestamps are targets. Build the timeline from real word times, then rebalance segment lengths to hit the
  total exactly (2:56 here). Keep a table of piece → start/end; every overlay time derives from it.
- Captions follow what was actually said, not the script (the question said "Gregory Gym", the script "Jester").
  Read on-screen text to confirm (the phone showed "hacia Gregory Gym"). Flag lines you couldn't hear clearly.
- A phone recording of the live app with real model output beats a perfect-looking local replay. Use it.

**Honesty (non-negotiable, and it saved the user here)**
- No AI key → no model output. Never draw masks, answers or photos and present them as the model's. Use the app's
  scripted demo with a "scripted demo" label, or ask the user to record it on the live site (give exact steps).
- If the app doesn't have a feature the user describes ("recognise where we are from a photo"), say so before
  building it: a judge can open the live link.
- Only tag a model name on a moment that model actually produced.

**Screen demos on a cloud machine (no GPU)**
- WebGL apps (Three.js maps) render a few frames a second in software: `Page.startScreencast` gave 0 frames,
  screenshots stalled during interactions, Playwright `click` timed out. What worked: wait for the page to settle,
  click from inside the page (`element.click()` in `page.evaluate`), wait 6-10 s, then CDP `Page.captureScreenshot`.
  Budget ~60-90 s per screenshot. Next time also try headed Chromium under `xvfb-run` + ffmpeg `x11grab`.
- Choppy recordings still have value: `mpdecimate` extracts the unique frames as clean stills.
- Stills + Ken Burns + punch-ins on the framed backdrop read as a deliberate style, not a fallback.
- Live sites are often blocked from the sandbox: run the app from its repo. A newer Node than the machine's: `npm
  pack node-linux-x64@<version>`, unpack, put its `bin` first on PATH.
- Guest/demo modes hide the features that need auth or keys (no chat input, no mic). Check before promising a shot.

**Graphics, audio, assembly**
- One designed overlay track (`editor overlay`, ~23 element types, frame dedupe) rendered once for the whole
  timeline (176 s in 166 s) beat dozens of per-element ffmpeg overlays. Compose the base picture separately.
- `sidechaincompress` stops at the shorter input: `apad=whole_dur=<total>` the sidechain voice bus.
- Music under on-camera dialogue/skits must sit far lower than under voice-over: the user couldn't hear the skit at
  lo-fi −5 dB. What worked: music ~−16 dB from its −16 LUFS file, ambience ~−30 LUFS, voices +4-5 dB.
- To land a music bed's final chord on the end card: `editor compose bed --end-chord-at <t>` (built for this); for a
  licensed track, repeat bars (bar-aligned crossfade) rather than time-stretch.
- `editor compose` makes original royalty-free beds/SFX when no licensed track exists; say a human must listen.
- Vosk (offline) mangles names and Spanish; correct from the script and the screen, and say which lines are guesses.

**Afterwards (2026-11-06)**: the whole video was rebuilt from one `editor produce` spec
(`projects/walkfree/produce.json`) in 7.5 min on the same 4-CPU machine, square cut included. Next brief: inventory,
write the spec, `--plan`, render; notes are one-line spec edits that re-render only what changed.

**Process under a deadline**
- Parallel agents with hard deadlines worked for graphics and music; the demo-recording agents failed together on the
  same root cause (no GPU). When one agent's approach fails, change the approach, don't re-run it.
- Send a draft as soon as one exists (draft 1 at ~30 min), then improve in small re-renders: audio-only fixes are a
  remux (`-c:v copy`), one segment is pieces + concat + composite (~3 min).
- When asked "how long?", answer before doing anything.
