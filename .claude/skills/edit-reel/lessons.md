# Lessons from real productions

Read this before planning any non-trivial edit. After every video, append 1-5 lessons here (what cost time, what
broke, what the user loved or rejected), newest first, one line each, under a dated heading. Preferences go to
style memory (`editor style note`), timings to `editor effort record`; this file is for craft and process.

## 2026-11-06 Notes
- [process] Insert CSS after a whole rule found by its text, never at a line number: a sed line insert landed inside a two-line rule and silently dropped a button style.
- [process] An editorial heuristic (strongest line, hook pick) has to be tried on a real transcript before it ships: the first cold-open pick was "Step two, ...", which makes no sense said first.
- [process] Anything awaiting playback to end (an export) must also end on pause, dispose or a version change, or it hangs: give it a stop path and test 'start a test, then export'.
- [process] Every new playback/export path needs the plain case re-run too (play, then Export): a guard added for a scroll test made Export-while-playing fail, and only an independent review caught it.
- [process] Check a test run's exit code, not a tail of its output: a piped 'pytest | tail -1' printed '1 failed' and the commit went ahead.
- [craft] A cut where nothing is cut still shows: two touching pieces of one take got a fade, a punch-in change and a transition at the seam. Anything that splits segments must leave them merged (editor cut now merges them).
- [process] Have an independent reviewer read each new feature within the hour: the last three rounds today found 12 real bugs the tests missed (anchors lost on a take swap, a bleep that stopped bleeping, words reordered).
- [process] Anything that stores, syncs or strips secrets reads one list of key fields (webapp lib/keys.ts): adding a provider then can't leak a key by being forgotten in one place.
- [process] Compare stored objects by value with keys in a fixed order: Postgres jsonb reorders keys, so JSON.stringify equality broke 'this video wears your look' after a sync.

## 2026-11-06 Afternoon bug hunt
- [process] Before committing web code, stage every new file it imports (git status shows them as ??): a commit with Editor.tsx but not the new lib/safezones.ts it imported left the branch unbuildable until the next commit.
- [process] After a merge call, confirm the PR's commits are in origin/main (git merge-base --is-ancestor) before resetting the branch: a merge that timed out wasn't merged, the reset + force-push emptied the branch and GitHub closed the PR (recovered from the reflog, reopened, merged).

## 2026-11-06 Walk-Free demo (audit)
- [process] Link the brief in the spec ("brief": "BRIEF.md", or produce init --brief): without it the numbers-on-screen and caption-line checks silently don't run. The Walk-Free spec shipped without it.
- [captions] Captions follow what was said, not the script: in skits the actors improvise, so the review's 'brief line not captioned' entries are checked by ear, not fixed by pasting the script.

## 2026-11-06 Overnight tooling
- [process] Gate every commit on the tests in the same command (pytest ... | grep -q passed && git commit): a ';' let a failing test get committed once
- [audio] loudnorm can drop the tail of short mixes: pad the mastered mix to the exact length
- [audio] produce init now levels every voice to -16 LUFS and dips the bed 10 dB under on-camera dialogue: a zero-touch draft had skit music only 4 dB under the voices
- [process] Test new ffmpeg graphs on the real project, not only synthetic colour pieces: xfade broke on real pieces (mixed timebases after a plain cut) while the unit test passed
- [process] A sound-only note (music level) on the 3-min Walk-Free spec went from 3m39s to 28s: produce now reuses the joined picture (77 s with transitions) and remuxes the new mix onto the encoded video (122 s -> 9 s). Say so when a note is audio-only; --estimate predicted 28 s.
- [process] A cache key must leave out everything that doesn't change its output: edl.settings recorded music.db, so the reel picture key never matched and the remux silently never fired. Test a cache by changing only what it should ignore.
- [process] Learned timings must only learn from real work: remuxes (1 s) recorded as renders dragged render:rush to 84 and composite:rush to 17 s/min. Skip shortcut runs when recording.

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
  Budget ~60-90 s per screenshot. All of this is now `editor capture shots` (shot list JSON); its `--record`
  (headed Chromium on Xvfb + `x11grab`) does capture WebGL motion, but only as fast as the page renders.
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

**Caught after delivery by the critic (2026-11-06)**: the proposal-letter still showed `http://localhost:5173/...`
(the app ran locally) for 8 s, and the app's spoken Spanish answer had no caption. Now `capture shots` flags dev
addresses on screen, `produce` review flags uncaptioned voices, and a critic sub-agent runs before the first draft.
Blur dev URLs in stills (or capture the deployed site) before they go in a video.

**Afterwards (2026-11-06)**: the whole video was rebuilt from one `editor produce` spec
(`projects/walkfree/produce.json`) in 7.5 min on the same 4-CPU machine, square cut included. Next brief: inventory,
write the spec, `--plan`, render; notes are one-line spec edits that re-render only what changed.

**Process under a deadline**
- Parallel agents with hard deadlines worked for graphics and music; the demo-recording agents failed together on the
  same root cause (no GPU). When one agent's approach fails, change the approach, don't re-run it.
- Send a draft as soon as one exists (draft 1 at ~30 min), then improve in small re-renders: audio-only fixes are a
  remux (`-c:v copy`), one segment is pieces + concat + composite (~3 min).
- When asked "how long?", answer before doing anything.
