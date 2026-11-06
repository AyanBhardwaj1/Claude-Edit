# Changelog

## 2026-11-06 · overnight, after the Walk-Free demo (PRs #20–#40)

The night started from the Walk-Free hackathon video (drafts 1–6, a vertical highlight reel), and turned what it
taught into tools for both the editing workflow and Cutmind.

### Editing workflow (`python3 -m editor`, skills)
- **Speed vs quality**: rush / standard / polish everywhere (`editor auto --effort|--budget`, `editor effort show`),
  timings learned per machine (`library/style/timings.json`), and only from real work (shortcut runs are skipped).
- **`editor produce`**: one JSON spec is the whole video (pieces, transitions, overlay, mix, captions, extras, post
  kit, review). `init --brief` drafts it from a footage folder and links the brief; `captions-from-brief` gives each
  caption line to the voice that says it (ties go to the voice nearest the line's time).
- **Notes, fast and exact** (new **video-notes** skill):
  - `produce --at 1:23` / `timeline <work> --at 0:12`: what's on screen and in the mix at a moment (`1m23s`, `83s` work).
  - `produce --changes` / `version --changes`: what an edit really changed since the last version.
  - `produce --estimate`, and every render says its time first.
  - Sound-only notes keep the encoded picture and swap in the new mix. On the Walk-Free spec a music note went from 3m39s to
    28 s (measured); a reel render goes from 20 s to 1.2 s.
- **Honesty and privacy**: `"redact": "dev"` blurs the dev addresses `capture shots` found (it records where);
  speech the recogniser guessed isn't captioned but reported; brief lines nobody captioned are listed; script lines
  not heard in their voice are reported; `--plan` warns about an unlinked brief and a hot un-ducked music bed.
- **Self-improvement**: `editor lessons` (lessons.md, read before planning), style memory for productions, the critic
  sub-agent names each problem with `--at` and a spec fix.

### Cutmind (webapp/)
- **Film it here**: record takes with a teleprompter; the takes and the script go straight into the edit.
- **Notes you can trust**:
  - Notes can carry a time (the At button), be spoken (the mic, or M), and queue while the editor works.
  - Every version lists what really changed, measured, and clicking a change jumps to it.
  - Compare (C) plays the version before from the same word; Undo this goes back.
- **Learns your taste**: a change you make before exporting two videos is offered as a style rule; Settings shows the
  timings learned on this device.
- **Keep your videos**: back up and restore everything as one `.cutmind` file, a nudge when there's no recent backup,
  storage used and "Ask to keep my videos" (persistent storage).
- **Share…** to the phone's share sheet after export; Fast / Balanced / Best; Make music; Record my screen (waits sped
  up); framed screens; boxed captions; product demos in Motion Studio; a What's new panel; a keyboard shortcuts
  dialog (?).
- Checked every batch: unit tests, a build, the end-to-end test with mocked APIs, and axe (0 violations on all 17
  screens, light and dark).
