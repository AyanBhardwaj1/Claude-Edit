# Effort: speed vs quality, on purpose

The user decides how to trade time for quality. Read their words, pick an effort, say what it costs and what it
buys, and stick to it. The same three efforts exist everywhere: `editor auto --effort`, these skills, and
Cutmind's **Fast / Balanced / Best** picker.

| effort | say it as | what changes |
|---|---|---|
| **rush** (fast) | "we have 10 minutes", "hurry", "quick", "just get it out", a hard deadline | base transcription model, light face tracking, `veryfast` encode, no draft renders, check + contact sheet only (no per-cut review, no cover), 1 fix pass, parallel sub-agents with hard deadlines, deliver a draft at the deadline no matter what |
| **standard** (balanced) | nothing said | the full edit-reel workflow: 2 drafts max, 3 fix passes, review of every cut, cover |
| **polish** (best) | "take your time", "best quality", "this has to win", "no rush" | bigger transcription model, finer tracking, `slower` encode, a critic sub-agent roast, every frame at every graphic checked, a second listen-proxy pass on the mix numbers |

```bash
python3 -m editor effort show --length <seconds of footage> [--budget <minutes>]   # estimates on THIS machine
python3 -m editor auto projects/<name> --effort rush|standard|polish              # or --budget 10
python3 -m editor effort record overlay 166 --media 176                          # log a hand-run stage
```
`editor auto` records how long every stage really took (`library/style/timings.json`, per machine, a moving
average), so estimates get better with every video. A learned `reel.effort` (style memory) becomes the default
when the user always asks for the same thing.

## When the user gives a time limit
1. **Answer first if they ask "how long?"** Run `editor effort show --budget N` (and add hand-run production
   stages with `--stages`), then give one honest number and what you'd drop to meet it. Don't start until they say
   go if they asked for the estimate first.
2. **Plan to 85% of the budget.** The rest is for looking at the result and one fix.
3. **Cut in this order** (lowest value per minute first) until the estimate fits:
   1. extra formats (square cut, vertical version), cover candidates
   2. per-cut review and the critic agent (keep `check` and the contact sheet: never skip looking)
   3. draft renders (render the final directly)
   4. decorative motion (shimmer, heat haze, traces) and nice-to-have graphics
   5. extra demo shots: use screenshots with camera moves instead of screen recordings
   6. never cut: captions on every spoken line, correct numbers, honest labels, audible dialogue, the length limit
4. **Run independent work in parallel** (sub-agents: capture, graphics, music; and ffmpeg jobs 3-4 at a time),
   each with a hard deadline in its brief and "partial is better than late".
5. **Checkpoint:** have a complete, watchable draft at about 70% of the budget, even if parts are placeholders, and
   send it. Improve until the deadline, then send what you have with a list of what's missing.
6. **Say when it won't fit.** If even rush is over budget, say so before starting, with the number, and offer the
   cut list. Never claim a time you haven't estimated.
7. After delivery, `editor effort record` any hand-run stage you timed and add a line to [lessons.md](lessons.md)
   if something took much longer than planned.

## When the user asks for more quality
Spend it where it shows: the hook, pacing, the first frame of every shot, readable graphics, music level under
dialogue, a critic pass. Don't spend it on invisible things (a slower encode of a 720p preview).
