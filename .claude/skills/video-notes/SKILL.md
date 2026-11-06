---
name: video-notes
description: Apply a user's notes on a video draft fast and exactly - "at 1:23 the music drowns him out", "cut the part about my cat", "the logo covers my face at 0:40", "captions bigger", "make it snappier", "how long will this take?" - on a reel (edit-reel EDL), a production (editor produce spec) or a Cutmind project. Finds the exact moment and entry, makes the smallest change, says how long the re-render takes before starting, re-renders only what changed, checks what really changed, saves a version, and remembers lasting preferences. Use whenever the user gives feedback on a draft, a version, or a delivered video, with or without a timestamp.
---

# Notes on a draft

A note is the user telling you what is wrong with something they watched. The job: change exactly that, fast, and
say plainly what changed. Read [the doctrine's notes section](../edit-reel/doctrine.md) and `library/style/STYLE.md`
first; the user's past preferences decide ambiguous notes.

## 1. Find the moment (never guess from the clock)
| the video is | the note says a time | the note names words / a thing |
|---|---|---|
| a reel (`projects/<name>/work/edl.json`) | `python3 -m editor timeline projects/<name>/work --at 0:12` | `python3 -m editor words projects/<name>/work --find "my cat"` |
| a production (`produce.json`) | `python3 -m editor produce produce.json --at 1:23` | `--plan` (the piece table, every caption and graphic time) |

`--at` lists the piece / segment and its source second, the words then (with ids), and the b-roll, graphics, zooms,
music dips, effects and chapter on screen or in the mix at that moment. Anchor the fix on those words or that piece,
never on a raw output time: times move when anything before them changes.

Times in a note are the user's times in the video they watched (the version they were sent), give or take a second.

## 2. The smallest change that does it
| note | change |
|---|---|
| music too loud (at X / under someone) | an automation dip on those words or that piece (-6 dB; under on-camera dialogue far more than under voice-over); the whole bed only if they say "overall" |
| can't hear someone | that voice's gain +3-5 dB or the music down under it; check `review` music-under-voice after |
| cut X / that's too long | remove those words' range (reel: the segment; production: the piece's `in`/`out`) |
| graphic / logo / b-roll covers my face | move it (a face-aware treatment: card-above-head, side-card) or shorten it; never just shrink it |
| a dev address / someone's private data on screen | production: `"redact": "dev"` or a box on that piece; reel: blur that b-roll |
| captions bigger / higher / another style | the captions block only |
| snappier / slower | gaps first (`gapCap` / segment trims), then speed 1.05-1.1; never cut words the user didn't name |
| wrong word in a caption | a correction (reel `corrections`, production `captions.replace` or the line text) |

If a note is unclear, take the most reasonable reading, do it, and say which reading you took. If it would change
something that can't change silently (a number on screen, a claim, a name, the length limit), ask first.

## 3. Say how long, then render only what changed
- Production: `python3 -m editor produce produce.json --estimate [--effort rush]` gives the time left on this machine.
  Cached pieces, an unchanged overlay and an unchanged picture cost nothing. A sound-only note (a level, a dip, a new
  bed) re-uses the encoded picture and swaps in the new mix: on the 3-minute Walk-Free spec that took 28 s, not
  3m39s. Say the number before starting when the user is short of time (they asked "how long?" before, every time).
- Production, a quick look first: `--range <piece> <piece>.end` (720p, seconds).
- Reel: re-run from the earliest affected stage (`editor auto ... --from audio|captions|render`). A sound-only note
  (music level, a dip, effects) keeps the encoded picture there too: the render remuxes the new sound (a fixture reel:
  20 s -> 1.2 s).

## 4. Check what really changed, then save
- Production: `python3 -m editor produce produce.json --changes`; reel: `python3 -m editor version <project> --changes`.
  The list must match the note and nothing else. Anything extra is a mistake: undo it before rendering.
- Look at the frames at the moment of the note (contact sheet or a frame grab) before saying it's fixed. You can't
  hear audio: for sound notes, quote the measured numbers (`review` music-under-voice gap, LUFS) and say so.
- Save: production `--note "<the note>"` on the render; reel `editor version <project> --note "<the note>"`.
- Tell the user in one or two warm sentences what changed, using the `--changes` lines, and where to look ("at
  1:23 the music now sits 12 dB under Ayan"). Send the file.

## 5. Remember what lasts
If the note would still make sense on a video that doesn't exist yet ("captions always bigger", "never cover my
face"), ask "Remember this for next time?" and on a yes record it with `python3 -m editor style note "<their words>"`.
Never record a one-off fix as a preference, and never in words they didn't say. A note that took much longer than
planned is a lesson: `python3 -m editor lessons add "<what and why>" --tag process`.

## Cutmind (the web app)
The same loop is built in: notes with a time ("at 0:12 …", "1m23s", the At button adds the player's position) give
the AI editor the words and pictures at that moment; a note can be spoken (the mic beside the box; "cut this part"
gets the player's time); notes sent while it works wait their turn; every version lists what really changed,
measured, and each change you can see jumps the player there; Compare (C) plays the version before from the same
word; Undo this goes back a version; a change the user makes before exporting two videos is offered as a style rule.
Before a note even arrives, the Reel check's attention map marks where viewers may drift (the same picture for more
than ~3 s, dead air, slow talking): "Add zooms there" fixes a same-picture spot in one click, "Ask your editor to fix
these" sends the spots as one timed note. "Show the app's buttons" draws Reels / TikTok / Shorts UI over the preview
and says when it covers the subtitles.

## A note about the platform UI ("TikTok's buttons cover my caption")
Run `python3 -m editor safezone <file> --work <work>`: it measures the captions from captions.ass against each
platform's zones and draws them over real frames. Move the captions (`--position middle`) or the graphic, re-render
from captions, check again.
