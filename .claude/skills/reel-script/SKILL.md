---
name: reel-script
description: Write a short-form video script (Instagram Reel, TikTok, YouTube Short) before recording — hook options, beat-by-beat body, CTA, on-screen text, B-roll list and a recording checklist that makes the edit easy. Use when the user wants to plan, script or brainstorm a reel, asks for hooks, or says "what should I say".
---

# Script a reel that edits itself

Ask (or infer from context) the topic, audience, the ONE takeaway, and target
length (default 30-45 s; about 2.5 spoken words per second, so 75-110 words).

## Output format (write to `projects/<name>/script.md`)
1. **5 hook options**, each <= 12 words, of different kinds: bold claim, result-first,
   question, mistake/"stop doing X", curiosity gap. Mark your pick.
2. **Script** as short lines, one breath each, with beats:
   - `HOOK` (0-3 s) → `CONTEXT` (why care, 1 line) → `BODY` (3-5 beats, one point each)
     → `PAYOFF` → `CTA` (one line: follow / comment a keyword / save).
   - Write how people talk: contractions, no lists of adjectives, no "in today's video".
3. **On-screen text**: the hook title (<= 6 words) and 3-8 emphasis words.
   These go straight into the EDL `title` / `emphasis`.
4. **B-roll / screenshots list** per beat, so the user can capture them before
   editing (they go in `projects/<name>/broll/`).

## Recording checklist (include at the end)
- Phone at eye level, 4K 30 fps (vertical crops from landscape need the pixels),
  window light in front of you, lav mic or phone close if no mic.
- Say each line, pause one beat, and **if you flub, just restart the line**: the
  rough cut keeps the last take automatically.
- Record a 2 s silent pause at the start (room tone) and don't stop the camera
  between lines; one long clip edits faster than many.
- Then: `python3 -m editor new <name>`, drop clips in `raw/`, and run `/edit-reel projects/<name>`.
