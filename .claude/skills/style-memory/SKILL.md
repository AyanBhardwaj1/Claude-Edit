---
name: style-memory
description: Learn how this user likes their videos edited and use it on every first draft. Reads the learned style (library/style/STYLE.md) before drafting, records every piece of feedback the user gives, snapshots each first draft and learns from what they changed before approving it. Use at the start and end of every edit-reel or launch-video job, whenever the user gives editing feedback ("captions smaller", "less music", "always 16:9", "I hate zooms"), says "remember this", "from now on", "that's how I like it", asks what you've learned about their style, or asks you to forget a preference.
---

# Style memory

The user shouldn't have to repeat themselves. Every video teaches the next first draft a little more about how
they like things: caption style, pacing, music level, formats, voice or no voice, the look. `editor style` keeps
that taste in `library/style/` (committed, so the desktop app and cloud sessions share it).

How it learns (slowly, on purpose):
| signal | when | weight |
|---|---|---|
| **note** | the user said it | 3 |
| **change** | a first-draft setting was changed before the user approved | 2 |
| **keep** | a first-draft setting survived to the approved version | 0.5 |

Each new observation decays the old evidence for that key (x0.9), so taste can move. A preference is **applied**
once it has weight 2+ and, for choices, a 60% lead; below that it is **tentative** (a hint you weigh, not a rule).
Scopes: `brand:<name>` beats `kind:reel|launch` beats `global`. Brand colours stay in their brand.

## Before the first draft
1. Read `library/style/STYLE.md` (or `python3 -m editor style show --kind reel|launch --brand <name>`). Its
   notes are the user's own words: follow them, including the ones no key captures (tone, claims, audience).
2. Reels: `python3 -m editor auto` already uses learned defaults for every flag you don't pass (speed, max gap,
   fillers, caption style and position, audio preset, music level, platform preset, grade; plus punch-ins, SFX
   and the progress bar after planning). Pass `--brand <name>` for a brand's own style; `--no-learned-style` to
   ignore it. An explicit flag or this project's EDL `settings` always wins.
3. Launch videos: after writing `plan.json`, run `python3 -m editor style apply launches/<name>/plan.json`
   (fills only what the plan leaves unset, never overwrites) and `python3 -m editor style check <plan.json>`;
   reconcile each drift line: match the preference, or keep the difference if this brief asks for it.
4. Ask fewer questions: skip brief questions the style already answers confidently, and say so in one line
   ("Going 16:9, no voiceover, music and SFX only, from your style; tell me if this one is different.").
5. In the plan you propose, name the learned defaults you used in one line.

## While editing
- **Every** time the user gives feedback that is a preference (not a one-off fix of this video's content),
  record it in their words, with the key it implies when there is one (`python3 -m editor style keys`):
  ```bash
  python3 -m editor style note "Captions lower and cleaner" --kind reel --set reel.captions.style=clean reel.captions.position=low
  python3 -m editor style note "Never use a zoom on the hook" --kind reel
  python3 -m editor style note "Acme videos stay on their navy" --kind launch --brand Acme --set launch.theme.dark=#0b1630
  ```
  Scope it as narrowly as the user meant it: one brand's thing goes under `--brand`; "always" / "every video"
  goes under the kind or global. If unsure whether it's a habit or a one-off, record it under the brand.
- `editor auto` snapshots the first render's EDL automatically. For launch videos, snapshot the plan when you
  first show a render: `python3 -m editor style snapshot launches/<name>/plan.json`.

## When the user approves
```bash
python3 -m editor style learn projects/<name>/work/edl.json      # reels
python3 -m editor style learn launches/<name>/plan.json          # launch videos
```
It compares the approved file with the first-draft snapshot: changed settings count as changes, the rest as
keeps. Tell the user in one line what was learned ("Learned: you keep music at -24 dB and prefer clean captions.").

## Questions and corrections
- "What have you learned about my style?": `python3 -m editor style show` and summarise it in plain English.
- "Forget that" / "that was a one-off": `python3 -m editor style forget <note id or key>`.
- Never store secrets, API keys, personal data or anything private in notes: the profile is committed to the repo.
