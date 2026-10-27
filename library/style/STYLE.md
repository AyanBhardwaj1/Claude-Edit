# Editing style (learned)

Read this before drafting. Confident preferences are applied to first drafts automatically
(`editor style apply`, and `editor auto` for any flag you don't pass). Tentative ones are hints.
Update it with `editor style note` (what the user says) and `editor style learn` (what they approve).

## kind:launch
- `launch.format` = **16:9**  (applied, confidence 86%) — aspect ratio (16:9, 9:16, 1:1, 4:5)
- `launch.length` = **45.2**  (tentative, confidence 12%) — total length, seconds
- `launch.look` = **default**  (tentative, confidence 12%) — default or clean
- `launch.mix.sfx` = **0.8**  (tentative, confidence 12%) — sound-effects level
- `launch.music.bpm` = **96.0**  (tentative, confidence 12%) — music tempo
- `launch.music.gain` = **0.6**  (tentative, confidence 12%) — music level
- `launch.music.key` = **-2.0**  (tentative, confidence 12%) — music transpose (semitones)
- `launch.serif_accents` = **True**  (applied, confidence 86%) — serif-italic accent words (_like this_)
- `launch.style` = **kinetic**  (tentative, confidence 12%) — kinetic or app-ad
- `launch.text_dur` = **2.37**  (tentative, confidence 12%) — average text-scene length, seconds
- `launch.theme.accent_use` = **sparing**  (applied, confidence 86%) — accent usage: sparing or bold (solid accent scenes)
- `launch.variants` = **one**  (applied, confidence 75%) — how many formats to deliver (one, both)
- `launch.voice` = **none**  (applied, confidence 86%) — voiceover: none or voiced

## brand:youbank
- `launch.format` = **16:9**  (tentative, confidence 12%) — aspect ratio (16:9, 9:16, 1:1, 4:5)
- `launch.length` = **45.2**  (tentative, confidence 12%) — total length, seconds
- `launch.look` = **default**  (tentative, confidence 12%) — default or clean
- `launch.mix.sfx` = **0.8**  (tentative, confidence 12%) — sound-effects level
- `launch.music.bpm` = **96.0**  (tentative, confidence 12%) — music tempo
- `launch.music.gain` = **0.6**  (tentative, confidence 12%) — music level
- `launch.music.key` = **-2.0**  (tentative, confidence 12%) — music transpose (semitones)
- `launch.serif_accents` = **True**  (tentative, confidence 12%) — serif-italic accent words (_like this_)
- `launch.style` = **kinetic**  (tentative, confidence 12%) — kinetic or app-ad
- `launch.text_dur` = **2.37**  (tentative, confidence 12%) — average text-scene length, seconds
- `launch.theme.accent_use` = **sparing**  (tentative, confidence 12%) — accent usage: sparing or bold (solid accent scenes)
- `launch.theme.dark` = **#07080a**  (tentative, confidence 12%) — dark background colour
- `launch.voice` = **none**  (tentative, confidence 12%) — voiceover: none or voiced

## What the user has said
- [kind:launch] One 16:9 video only; don't make a vertical version unless asked  `074328e8` (2026-10-27)
- [kind:launch] No voiceover: music and sound effects only, mixed at full quality (AAC 320k, about -14 LUFS)  `414f8f4d` (2026-10-27)
- [kind:launch] Premium, professional feel: near-black backgrounds, accent colour used sparingly, serif-italic accent words  `f3cee412` (2026-10-27)
- [kind:launch] Show the real product UI and only true, sourced claims (cite the source on screen for any price or statistic); paint out dev artifacts like debug badges and personal emails  `653924f7` (2026-10-27)
- [brand:youbank] Audience: small hedge funds; position YouBank as a cheaper alternative to a Bloomberg terminal, with a non-affiliation line  `76c6e66b` (2026-10-27)
- [global] Never ask the user to paste API keys into chat; keys go in .env  `4ee0214e` (2026-10-27)
