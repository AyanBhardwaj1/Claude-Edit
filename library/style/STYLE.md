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

## kind:production
- `production.end.dur` = **7.5**  (tentative, confidence 12%) — end card length, seconds
- `production.extras` = **square**  (tentative, confidence 12%) — extra cuts delivered (none, square, vertical...)
- `production.frame.backdrop` = **#f4f1e6**  (tentative, confidence 12%) — backdrop colour behind framed app screens
- `production.frame.scale` = **0.92**  (tentative, confidence 12%) — framed screen size (share of the frame)
- `production.lufs` = **-14.0**  (tentative, confidence 12%) — final loudness, LUFS
- `production.music.gain` = **-3.0**  (tentative, confidence 12%) — music bed level before ducking, dB
- `production.music.mood` = **warm**  (tentative, confidence 12%) — composed bed mood (warm, uplifting, tense, lofi)
- `production.ramp_waits` = **False**  (tentative, confidence 12%) — speed through waits in screen recordings
- `production.size` = **1920x1080**  (tentative, confidence 12%) — frame size, e.g. 1920x1080 or 1080x1920

## brand:walk-free
- `production.end.dur` = **7.5**  (tentative, confidence 12%) — end card length, seconds
- `production.extras` = **square**  (tentative, confidence 12%) — extra cuts delivered (none, square, vertical...)
- `production.frame.backdrop` = **#f4f1e6**  (tentative, confidence 12%) — backdrop colour behind framed app screens
- `production.frame.scale` = **0.92**  (tentative, confidence 12%) — framed screen size (share of the frame)
- `production.lufs` = **-14.0**  (tentative, confidence 12%) — final loudness, LUFS
- `production.music.gain` = **-3.0**  (tentative, confidence 12%) — music bed level before ducking, dB
- `production.music.mood` = **warm**  (tentative, confidence 12%) — composed bed mood (warm, uplifting, tense, lofi)
- `production.ramp_waits` = **False**  (tentative, confidence 12%) — speed through waits in screen recordings
- `production.size` = **1920x1080**  (tentative, confidence 12%) — frame size, e.g. 1920x1080 or 1080x1920

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
- [brand:youbank] Use the live site youbank-nu.vercel.app: real UI recorded from it, its address in the browser bar and on the end card  `bf7d5d7c` (2026-10-30)
- [brand:youbank] YouBank videos: show the app in its Lavender UI style (light, violet accent #7c3aed) with a matching lavender-light video look and violet logo; not the amber-on-black Terminal style  `b42fab30` (2026-10-30)
- [brand:youbank] Investor (VC fundraising) videos: dark cinematic, near-black with violet glow, Lavender product UI inside, sourced market figures; no invented traction  `b4822aff` (2026-10-31)
- [global] Music and ambience must sit well under on-camera dialogue and skits; we have to hear ourselves clearly  `c4828fe9` (2026-11-06)
- [global] When we're short on time, do it fast and send a draft; when asked, spend more time for better quality  `f5139933` (2026-11-06)
- [brand:walk-free] Walk-Free demo look (approved): app screens on an ivory frame with rounded corners and soft shadow, push-ins and punch-ins, small Meta model pills, captions in a dark box, checklist and chips graphics, logo sting, hot-to-cool grade, end card over a blurred freeze-frame  `c7bc67a0` (2026-11-06)
