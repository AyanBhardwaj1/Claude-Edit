---
name: reel-script
description: Write a short-form video script (Instagram Reel, TikTok, YouTube Short) before recording — hook options, beat-by-beat body, CTA, on-screen text, B-roll list and a recording checklist that makes the edit easy. Use when the user wants to plan, script or brainstorm a reel, asks for hooks, or says "what should I say".
---

# Script a reel that edits itself

Ask (or infer from context) the topic, audience, the ONE takeaway, and target
length (default 30-45 s; about 2.5 spoken words per second, so 75-110 words).

Hook rules (from Reel Studio's script writer, MIT): no throat clearing ("hey guys", "so", "today I want to"), start
mid-thought; open a curiosity gap; one idea a 10-year-old gets, in 10 words or fewer; be specific (a number, a date,
a name: "45 days ago" beats "a while back"); struggle beats success (a confession relates, a brag alienates); lead
with the words people search. Shapes: exact method ("Here's exactly how I..."), the only one, numbered ("3 things I
wish I knew before..."), time collapse, contrarian ("Everyone tells you X. It's wrong."), transformation, confession,
curiosity question, identity call-out, story cold open, comparison. More in `library/hooks.md`.
Body: the hook's promise is paid off in full; one point; texting cadence; never invent facts about the user: leave a
bracketed blank like [how much you spent]; say keywords out loud; end on one takeaway or a calm moment, not a summary;
the call to action is optional, one specific ask at most. On-screen text: 2-5 words each, the first one ADDS context
to the spoken hook (never repeats it), numbers as digits.

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

Longer than a reel (a 1-5 min demo, launch or hackathon video with skits, voice-overs and app demos)? Plan it as a
production brief with the user: `.claude/skills/brief-production/brief_template.md`.
