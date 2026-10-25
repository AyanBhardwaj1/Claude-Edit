---
name: music-library
description: Pick, add and organise background music in the shared mood-tagged library (library/music, grouped Hype / Uplifting / Emotional / Tense-Dark / Cool-Fun with tags, stars, tempo and loudness). Use for step 4 of a reel edit, when the user pastes a song/reel link to use as music, asks for music that fits, or wants to organise their tracks.
---

# Music library

```bash
python3 -m editor music list [--mood hype]          # library/music/LIBRARY.md, grouped by mood, ★ = favourite
python3 -m editor music add <file-or-url> --mood cool-fun --tags bouncy playful mischievous [--title ...] [--star]
python3 -m editor music tag <id> [--mood ...] [--tags ...] [--star|--unstar] [--notes "..."]
```
Links are downloaded with yt-dlp (audio extracted to m4a). Each track gets an
estimated BPM, loudness and duration. That's how you judge energy, since you
can't listen.

## Picking a track (step 4)
1. Name the video's emotional arc in a few words (e.g. "playful flex, ends on a joke").
2. Map it to a mood:
   - **Hype**: wins, launches, fast tutorials, challenges
   - **Uplifting**: growth stories, motivation, milestones
   - **Emotional**: personal stories, setbacks, gratitude
   - **Tense/Dark**: warnings, mistakes, "nobody tells you", reveals
   - **Cool/Fun**: tech demos, behind-the-scenes, lighthearted, self-deprecating humour
3. Within the mood prefer ★ tracks, then tags that match the vibe, then BPM:
   ~120-150 for fast-cut talking heads, 80-110 for stories.
4. Write it to the EDL: `"music": {"track": "<id>", "db": -20, "start": 0}`.
   `start` skips a slow intro (seconds into the track). `db` from -18 (energetic)
   to -24 (dense talking). The voice is ducked over automatically.
5. Tell the user which track and why. If nothing fits, say so and suggest a mood to add.

## Adding music
- Ask for (or infer) mood and 2-4 vibe tags when adding. Tags are what make picking work.
- Only add music the user owns or has a licence for. For Instagram/TikTok, platform
  trending sounds are best added **in the app** at upload (licensed there). Our mix
  can then go without music, or with a quiet bed.
- After adding a track, show the user its LIBRARY.md line.
