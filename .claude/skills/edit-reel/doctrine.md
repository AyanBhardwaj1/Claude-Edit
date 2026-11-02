# Editing doctrine (what a hand edit does)

Adapted from Reel Studio's editor prompts (MIT, Copyright (c) 2026 Reel Studio contributors, licence in
LICENSE-reel-studio.txt; github.com/AidenJohnston/reel-studio-app; its cut method follows
Mino Lee's Minimum Viable Editing Strategy). Read it before the first draft and before applying notes.
Priority: **pacing > b-roll > captions > effects.** A tight video with no b-roll beats a beautiful one that drags.

## Talking to the user
Plain, warm, short, like a friend who edits for them. No jargon (LUFS, ducking, dB, render, EDL, word ids, tool
names), no em dashes. Say what you did and why it helps ("I cut the long pauses so it moves faster"). Never
contradict what they see: say where every picture came from (their library, the web, made by you).

## The cut: one red thread
- One take per beat. People redo a line until it lands, so the **last complete, clean take** usually wins; pick an
  earlier one only when it is clearly better. If the whole script was recorded twice, use the last complete run;
  don't mix runs for one extra ad-lib.
- Drop false starts, mid-sentence restarts, stutters, doubles, edge fillers, and meta-talk aimed at the camera
  ("let me try that again", "wait", "okay so" as a reset, "one more time", counting in, "is this recording").
- Keep the real content: opinions, asides and jokes ARE the video. Anything said only once stays. When unsure, keep it.
- Keep the hook (its best take, even if recorded last) and the speaker's beat order. Prefer whole sentences; never
  cut inside a word; leave tiny slips alone.
- A spoken edit direction that lands as a joke ("okay, cut it here") can be the ending.
- Length is never a defect by itself: cut a beat because it is boring or repeated, never to hit a length.

## Pacing
- Kill dead air: about 0.10-0.15 s between words (`--max-gap 0.15`), 0.25-0.4 s only for slow, heartfelt delivery.
- Never flatten a deliberate pause (the beat before a punchline, the silence after a confession).
- End right after the last word.

## The hook (first 2 seconds)
- The topic is on screen from the first word: a `text-pop` with `"style": "label"`, `"tilt": 0`, 3-7 words in
  sentence case built from the speaker's own words, anchored from the first kept word to the end of the hook
  sentence (2-4 s). It states the claim or question ("why every gym feels the same", never "wait for it").
- Nothing else competes in the first ~5 s; the first picture comes right after the hook title (or instead of it
  when the hook points at something: "look at this"). Face readable in the first ~3 s; no full-frame over the
  hook's first ~1.5 s unless the hook IS the visual.

## Captions
- 2-3 words a chunk, one line, uniform size, under the chin (style `studio` is the proven default; `bold`,
  `white`, `beast` when the video wants energy). Never under ~80 px at 1080 wide.
- Captions transcribe; they never paraphrase. Numbers show as digits (automatic).
- Proofread: `editor words <work> --unsure 0.6` marks unsure words (?). Fix a sound-alike only when the topic
  makes it certain ("sink" -> "sync" in a line about files, "pay pal" -> PayPal); EDL
  `"captions": {"corrections": [{"from": "pay pal", "to": "PayPal"}]}`. Slang, filler and names you don't
  recognise stay as said. A wrong correction is worse than none.

## B-roll: show the point
- Cadence: the screen changes every 3-5 s (a picture, a text pop or a zoom). Never more than ~4 s of plain face,
  including the last 10 s. Hand edits that perform carry **12-20 b-roll moments plus 4-8 zooms in 60-90 s**; a
  first draft with 5 visuals reads as unedited. Fewer pictures on intimate lines, where eye contact is the content.
- Face-hiding treatments (full-frame, split-top, post-wall) cover at most about half the runtime, in short bursts.
- Put the visual ON its words (`"on": "the phrase"`). A card with text stays about 2 s or more; a quick list can
  flash 1-2 s per item. Don't start the next visual less than ~1.5 s after one.
- Show the POINT, not the literal word: "my coach texted me at 5 am to run in the rain" wants the run in the rain,
  not a phone. Finish the sentence "while they say ___, the viewer sees ___, which shows ___"; if the last blank
  isn't the point, use a zoom instead. Generic pictures of incidental words are decoration.
- Best first: (1) the actual thing or proof (named place, product, person, screenshot, the user's own clip);
  (2) a spoken list: one picture per item on its word, or a checklist graphic; (3) a number that matters:
  `counter` / `price-tag`; a line someone said: `quote`; (4) a `text-pop` with 1-4 key words; (5) a zoom.
- Named things are the easiest honest pictures: every brand, app, tool, product, show or place named gets
  something on screen (`editor images search "<name>" --logo`, `"<place> photo"`, `editor capture web` for an
  app's real screen). `editor pacing` lists names said but not shown.
- Text pops are seasoning: never two plain-word pops in a row, at most 2 big word cards a video, only for a
  number or name to remember or the punchline. Numbered steps get a `label` pop "2: Editing" on the word that names it.
- Source order: the user's library > a real picture from the web (licensed, credited) > a graphic. Never a made-up
  stand-in. Never let a stranger stand in for a specific real person (their mom, a friend): use their photo, a
  public figure's real photo, a text pop with the name, or a zoom, and say their own photo would fit there.
- Use each asset once. Every number, price or claim on screen matches the spoken words exactly. Never invent.
- Outside full-frame, keep eyes, nose and mouth clear (eyebrows to chin); hair, forehead and the sides of the head
  may be covered. The treatments place cards that way and fall back to beside-the-face, then a split view.
- A website screenshot belongs to its owner: say which ones you used ("a screenshot of example.com, used as commentary").

## Music
- By mood and energy, not by trend: `editor music list` shows each song's measured feel (gentle / steady /
  upbeat / driving / hype), tone and tempo. Heartfelt: gentle. Comedy: upbeat, light. Explainer or day story:
  upbeat, steady groove. Rant, hot take, hype: driving, hype. Prefer a song whose instrument or genre fits the topic.
- One song. Level `under-voice` by default, `quiet` for intimate talk, `loud-intro` only when the opening is built on
  the music. The voice always wins. Leave `start` out: the song enters a bar before its first big hit.
- Lift gently on the payoff (+2 to +4 dB) and dip under dense or soft lines (-4 to -8) with word-anchored
  `"automation"`. It ends with the last word: a short fade, never a long one under the final line.

## Zooms
4-8 a minute, never two back to back, each over one whole line (1-3 s), scale 1.08-1.15. They are the honest fill
for a face-only stretch: put one in the middle of any bare stretch over ~4 s. No zoom under a full-frame moment.

## Cover
A clear, expressive frame from the take: eyes open, a real expression, mouth at rest, never mid-blink.
`editor cover <video> -o out/cover.jpg --work work --candidates <3-4 strong moments>`, look, then `--at` the best.
Optional text: 1-3 big words carrying the hook's key word, never the whole hook sentence.

## Post kit
`editor post`: a hook line of 60-80 characters that leads with the words someone would search and makes a small
promise; one or two sentences of context or payoff; at most one specific ask (never "follow along to see the
journey"). EXACTLY 5 hashtags, specific to the video and its audience, niche plus mid-size, no giant generic tags.
3-8 keywords actually said in the video. The user's voice (I or we), casual, no em dashes, no claims the video doesn't make.

## Look at the draft (in this order; fix only real problems)
1. The opening: face on screen and readable, first frame sharp, the visual matches the spoken hook.
2. Face covered: anything over eyes or mouth other than an intended full-frame.
3. Wrong word: each visual appears while its thing is said and never contradicts the words.
4. Wrong facts: every number, price, name and claim on screen matches what is said.
5. Unreadable text: too small, cut off, overlapping, gone before it can be read.
6. Captions: hidden, over the face, or a misheard word.
7. Broken frames: black, blank, frozen, missing or stretched pictures.
8. Clutter: two dense things at once, a repeated asset, a packed stretch then an empty one.
9. Mirrored take: text really in the room (a poster, a shirt, a screen) reads backwards -> `"mirror": true` on that
   source, and tell the user in one line. Judge only real text in the room, never captions, faces or hands.
At most two draft passes (`--draft`) unless something is broken. Every change is a chance to break something else.

## Notes (each one makes a new version)
- Change only what the note asks, the smallest change that satisfies it; if unclear, take the most reasonable
  reading and say what you did. Common notes: music too loud at the start -> automation -6 on those words; too loud
  overall -> level quiet; different / sadder / more upbeat song -> pick by measured feel; put the price on "20 bucks"
  -> `price-tag` on those words; show X when I say X -> find it, anchor on X; wrong place / bigger / move it ->
  change treatment or anchor; cut the part about X -> drop those words; too slow -> tighter gap; it cut my joke ->
  restore the words; caption says X but I said Y -> a correction; zoom in when I say X -> a zoom on those words;
  it's mirrored / backwards -> mirror; different cover -> new candidates.
- A file the user attaches goes where the note says (`editor attach`, then anchor it on the words named): "over my
  face" / "instead of me" = full-frame, "next to me" = side-card, "above my head" = card-above-head; a meme with no
  place given = full-frame, a screenshot or photo of a thing = card-above-head. Clips play silently. If the note
  doesn't say WHEN, ask "Which words should it show on?" instead of guessing.
- Then `editor version <project> --note "<the note>"` and tell the user in one warm sentence what changed.
- Lasting preference? If the note would still make sense on a video that doesn't exist yet, ask
  "Remember this for next time?" and on a yes record it with `editor style note` as one general sentence under
  ~15 words ("Keep music quieter under talking"), no times, words or file names from this video. Save without
  asking only when the user said "always", "from now on", "remember", "every video" or "next time".
