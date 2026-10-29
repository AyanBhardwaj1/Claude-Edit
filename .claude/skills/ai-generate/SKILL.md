---
name: ai-generate
description: Generate realistic AI content for an edit, only when the user asks for it - photoreal B-roll video (Veo, Kling, Seedance via Google, fal or Replicate), images (gpt-image, Flux), sound effects, original music beds and voiceover (ElevenLabs) - matched to the real footage and labelled as AI. Use when the user says "generate", "AI b-roll", "make a shot of...", "I don't have footage of...", "AI video", "Veo", "Kling", "Sora-style", "make a sound effect", "make music for this", "AI voiceover", or a reel needs a visual nobody filmed.
---

# AI-generated content (when asked)

Real footage first. Generate only when the user asks, or offer it in one line when a reel needs a shot
nobody filmed ("I can generate a 4 s shot of a trading floor with Veo, about $X on your fal account; want it?").
Never generate silently: it costs the user money and changes what the video claims.

## 0. Keys and cost
- Keys live in `.env` at the repo root (`FAL_KEY`, `REPLICATE_API_TOKEN`, `GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `ELEVENLABS_API_KEY`). `python3 -m editor gen models` shows which are set. **Never ask for a key in chat**;
  tell the user which line to add to `.env`.
- Before any real call: write the shot list (prompt, model, length, aspect per shot), run each with `--dry-run`
  (prints the exact request, spends nothing), tell the user the count and that pricing is on the provider's
  model page, and wait for a yes. Batch only after the first clip looks right.
- Cloud sessions: the provider hosts must be allowed by the environment's network policy; if a call can't
  connect, say so and suggest the desktop app.

## 1. Video B-roll that passes for real
```bash
python3 -m editor gen video "<prompt>" -o projects/<n>/broll/ai/trading-floor.mp4 --aspect 9:16 --dur 4 \
    [--model veo|veo-fast|kling|veo-fal|...] [--image projects/<n>/work/frame.png] [--library office] [--dry-run]
```
Prompt like a cinematographer, not a hype account. One shot per clip, 3-6 s:
**subject + action, setting, camera (lens, height, movement), light, texture, what it's shot on.**
> Handheld close-up, 35mm, eye level: a trader's hand scrolling a candlestick chart on a laptop in a dim office at
> dusk, monitor glow on the knuckles, shallow depth of field, slight motion blur, natural skin texture, shot on an
> iPhone, no text on screen.

Realism rules:
- Match the a-roll: same aspect (`--aspect`), similar light (warm/cool, time of day), same lens feel. "Shot on an
  iPhone" / "documentary handheld" beats "cinematic 8K masterpiece", which looks like AI.
- Image-to-video for consistency: grab a real frame (`editor frames`) or a generated still (`gen image`) and pass
  `--image`; the clip starts from it.
- Avoid what models still get wrong: readable text/screens (use real captures from `editor capture` instead),
  hands doing fine work in close-up, crowds of faces, logos. Keep people mid-shot or from behind.
- In the EDL, blend it: `"grain": 6` on the b-roll entry gives it the phone footage's texture (AI clips are too
  clean), keep clips short (1-3 s on screen), cut on motion, and add `"nat": -18` to use the model's generated
  ambience (Veo makes sound) under the voice. Example:
  `{"path": "broll/ai/trading-floor.mp4", "start": 6.2, "dur": 2.0, "in": "whip-left", "grain": 6, "nat": -18}`
- Check it like footage: Read 3 frames (start, middle, end) for melted hands, warped text, flicker. Regenerate
  instead of using a bad take; never ship a clip you haven't looked at.

## 2. Images, sound effects, music, voice
```bash
python3 -m editor gen image "<prompt>" -o projects/<n>/broll/ai/desk.png --aspect 9:16      # stills, first frames
python3 -m editor gen sfx   "deep cinematic whoosh, close mic, no music" --type whoosh --dur 1.2   # -> library/sfx/whoosh/
python3 -m editor gen sfx   "city street ambience at night, distant traffic" -o projects/<n>/broll/ai/street.mp3 --dur 8
python3 -m editor gen music "warm lo-fi hip hop, 90 bpm, soft keys, no vocals" -o projects/<n>/music/bed.mp3 --dur 45 --mood cool-fun
python3 -m editor gen voice "<script>" -o projects/<n>/work/vo.mp3 --voice <voice id>
```
- SFX filed with `--type` (whoosh, whip, impact, pop, click, riser, ding, glitch) replace the synthesized ones in
  every future edit (sfx rotates through variants). Generate 3-4 variants of the types you use.
- Music from `gen music` is the user's to use under ElevenLabs' terms; tag it `ai-generated` in the library.
- Voice: only the user's own cloned voice or a stock voice they're licensed for. Never clone someone else.

## 3. Ethics and labels (hard rules)
- No realistic depictions of real, identifiable people (including the user, unless they ask and it's theirs),
  no fake events, fake news footage, fake testimonials or fake product results, nothing that could mislead
  viewers about what happened or what a product does.
- Every generated file gets a `<file>.gen.json` sidecar (provider, model, prompt, date). When delivering, list the
  AI shots and tell the user to switch on the platform's AI label when it's realistic content: Instagram "AI info",
  TikTok "AI-generated content", YouTube "altered or synthetic content".
- Record what the user liked in their style memory (`editor style note "prefers handheld iPhone-look AI b-roll"`).
