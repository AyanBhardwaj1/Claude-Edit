# Claude Video 2.0 (free skill)

Make studio-quality motion graphics with Claude Code. Pick a look from a gallery of real videos,
answer 5 questions, and get your MP4. Free, on the normal Claude Pro plan.

**Download:** [REPO LINK GOES HERE]

---

## What it is

A skill is a folder of instructions and tools that Claude Code reads. This one turns Claude into a
small motion studio. You talk to it in plain words. It writes the video as code, renders it to an MP4,
and checks its own work by looking at the frames.

It does two things:

**Motion graphics from code.** Titles, stats, diagrams, logo stings, loops. No footage needed.

**Graphics with real media.** The same designs with your own photos and clips inside them. It can also turn
a photo into a short moving clip with Higgsfield AI. Before it spends a single credit, it shows you a
storyboard and the cost, and waits for your "yes".

---

## How it works

**A. Pick a look.** A gallery opens in your browser with 21 looks, each playing as a real video.
Flip a tile to "With media" to see it with real footage. Press **Use this style** and paste the name into
Claude Code. Or paste 1 to 3 links or images of your own reference.

**B. Answer 5 questions** (one message, each with a default):

1. What is it for? (YouTube intro, Short, launch, explainer, ad) and how long? [12 s, 16:9]
2. What should it say? (the words on screen) [I'll write it from your topic]
3. Does it loop? [no]
4. Your brand: colours, fonts, logo? [use the style's]
5. Real media? Your photos or clips, AI clips from Higgsfield, or none (pure graphics) [none]

**C. Build.** A storyboard (every shot, its timing and what it uses), 3 stills for you to approve, the render,
then two automatic checks: pacing (no dead gap longer than 1 second, nothing on screen for less than 0.3 seconds)
and, for loops, a pixel check that the last frame equals the first.

---

## The 5 hacks

**1. Pick one style first, and stick to it.**
Leave the look open and every AI drifts to the same default (dark background, glow, purple gradient).
A style spec fixes the colours, fonts, easing and a ban list for the whole piece.
Source: https://github.com/NovusEdge/motion-lab

**2. Real references beat adjectives.**
"Sleek and modern" means nothing. A real frame means a lot. Then say how it was made (masked text,
slow camera, long holds), not just how it feels.
Find references on https://savee.com , https://godly.website , https://mobbin.com , and in launch films
from Linear, Apple and Cursor.
Source: https://impractical.ai/launch-videos/linear-agent

**3. Write the brief in numbers.**
Length in seconds. Colours in hex. Easing as numbers (for example expo.out over 0.6 s). One hero move
per shot. A ban list: no hue-shifting gradients, no glow, bloom or lens flares, no linear easing on
things your eye follows, no centred-everything.
Source: https://aiartimind.com/how-to-make-motion-graphics-with-claude-opus-5-5/

**4. Loops: one clock, last frame = first frame.**
Drive every move from one clock, so the end of the video is exactly the start. Then prove it:
render the first and last frame and compare the pixels. If they differ, it fails.
Sources: https://github.com/NovusEdge/motion-lab and https://hyperframes.heygen.com

**5. Check frames, not code.**
Before the full render, look at 3 stills at the shot changes. After the render, run the pacing check.
Sources: https://aiartimind.com/how-to-make-motion-graphics-with-claude-opus-5-5/ and https://github.com/NovusEdge/motion-lab

---

## Install in 3 steps

1. Download the folder and copy it into `~/.claude/skills/`
   (so the file `~/.claude/skills/claude-video-studio/SKILL.md` exists).
2. Only if you want AI clips: get a key at https://console.higgsfield.ai and add this line to a file called
   `.env` in your project folder:
   `HIGGSFIELD_API_KEY=your_key_id:your_key_secret`
   Never paste your key into the chat.
3. Open Claude Code and say: **make me a motion graphic**

**You also need:** Node 22 or newer (https://nodejs.org) and ffmpeg (`brew install ffmpeg`).
Not sure? Claude checks for you and gives you the one command to run.

---

Built on HyperFrames (https://hyperframes.heygen.com) and GSAP (https://gsap.com). All fonts are free. MIT licence.
