---
name: rough-cut
description: Editorial judgement for the transcript-driven rough cut — reviewing and editing work/edl.json so a talking-head video gets a strong hook, tight pacing, the best takes and no tangents. Use after `editor plan` runs, when the user says the cut is too long/slow/boring, asks to "tighten", "find the hook", "make it under 60s", or wants a different take used.
---

# Rough cut: from auto plan to a watchable edit

`editor plan` handles the mechanical part (pauses > 0.30 s, fillers, repeated
takes). Your job is the part a human editor does. Work from
`work/transcript.txt` (source times) and `work/edl.json`.

## EDL fields you edit
```jsonc
{
  "speed": 1.1,                       // global; a segment may override with "speed"
  "segments": [                       // played in THIS order — reorder freely
    {"src": 0, "start": 12.40, "end": 15.88, "text": "..."}   // source-clip seconds
  ],
  "title": "3 tools that edit for you",  // on-screen hook text (first ~3 s)
  "emphasis": ["free", "claude"],        // caption words coloured as emphasis
  "zooms": [], "auto_punch_in": 1.12, "broll": [],   // output-timeline visuals (broll-motion skill)
  "removed": [...]                       // informational; cut ignores it
}
```
Times inside `segments` are **source** seconds; take them from transcript.txt or
`removed`. Keep about 0.06 s before the first word and 0.10 s after the last
word so consonants aren't clipped.

## Checklist (do all of it)
1. **Audit `removed`.** Retakes keep the *last* take. If an earlier take was
   clearly better (more energy, fewer stumbles), swap the segment times. If a
   "filler" was meaningful ("like" used as a verb with `--fillers aggressive`), restore it.
2. **Hook in the first 1-3 s.** Use a bold claim, a result, a question or a
   pattern interrupt. Cut "Hey guys / so / today I want to". If the best line is
   mid-video, move that segment to the front (a "cold open") and keep the rest in order.
3. **One idea per reel.** Delete tangents, repeated explanations and
   "as I said before". When two segments say the same thing, keep the tighter one.
4. **Pacing.** Reels should feel like no breath is wasted: the gap cut is 0.30 s
   by default. Go down to `--max-gap 0.2` for hype content; keep 0.4-0.5 for
   storytelling or emotional beats. Speed 1.05-1.15 for talking heads; never
   above 1.25 (voices chipmunk).
5. **Length.** Reels/Shorts/TikTok: 20-45 s performs best for tips; up to 90 s
   for tutorials. If asked for "under N seconds", sum `(end-start)/speed` and cut
   the weakest segments until it fits.
6. **Ending.** End on the payoff or a one-line CTA. Cut trailing "so yeah,
   that's it" and the reach for the stop button.
7. **Never cut mid-word.** If a boundary lands inside a word, snap it to the
   nearest word edge from transcript.json.

Then write a short summary for the user: old → new runtime, the hook you chose,
and the 3-5 biggest cuts.
