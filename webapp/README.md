# Cutmind

**The AI video editor.** A web app anyone can use: drop in raw talking-head takes, get a finished, captioned
vertical reel with a cover and a post caption, then change it by typing notes. Each person brings their own
**Anthropic** or **OpenAI** API key.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAyanBhardwaj1%2FClaude-Edit&root-directory=webapp&project-name=cutmind)

## Pages
- `/`: the landing page, with a live demo of the cut (Cutmind's real first-pass rules run on a take you type).
- `/login`: email and password sign-in and sign-up (no Google). With a database connected (`DATABASE_URL`), accounts live on
  the server and work on any device: a scrypt password hash, sessions in an httpOnly cookie, and the user's settings (never
  API keys), style rules and look synced (`app/api/account`, `lib/server/db.ts`, `lib/sync.ts`). Without one, accounts live in
  the browser (a salted PBKDF2 hash). Either way each account sees only its own videos, which stay in the browser.
- A **sample project** (a drawn presenter and a computer voice, with its first edit made) to try everything without footage.
- `/app`: the home dashboard (drop zone, numbers, setup checklist, recent videos, your editor, your style), My videos,
  New video, the editor, Write a script, My style and Settings.
- Five looks for the app, picked in the sidebar or Settings: **Studio** (dark), **Radiant** (bright), **Terminal**,
  **Ivory** and **Natural**. Each is a set of CSS tokens on `html[data-theme]` (`app/globals.css`, `lib/theme.ts`).

## What it does
1. **Takes in**: one or more raw takes (retakes and fumbles welcome), plus optional songs, pictures and clips.
   **Record my screen** captures an app demo (a tab, a window or the whole screen, optionally with the microphone) right
   in the browser, with a trim and "speed through waits" (frozen stretches play 6x faster), and adds it as a screen recording.
   A screen recording you upload (QuickTime, OBS, a phone) gets the same: its waits are found in the background after it's
   added (a muted 8-16x playback, about 13 s for 3 minutes), and "Edit it myself", Pictures has the switch for each clip.
2. **Listens**: a word-timed transcript through OpenAI (OpenAI key), or a speech model running in the browser (no key).
3. **Reads the takes**: retakes (keeps the last complete take), pauses, fillers, meta-talk, stutters; finds the face.
4. **First edit** by the AI editor (the user's Anthropic or OpenAI model), following the editing doctrine: the cut ("one red thread"), a hook
   title on screen from the first word, step labels, pictures on the words that name them (your library first,
   then licensed logos and photos found online, credited), zooms, music by measured mood, cover, and a post caption
   with exactly 5 hashtags.
5. **Live preview** in a phone frame: face-following 9:16 reframe, punch-in zooms, pictures placed clear of the
   eyes-to-chin zone (above the head, beside, in a phone, full screen, split view), captions in 5 styles
   (any Google Font), music set under the voice, dipping under words and lifting in pauses.
6. **Notes**: "music too loud at the start" makes Version 2. Lasting preferences are offered for **My style**
   ("Remember this for next time?") and apply to every future video.
7. **Edit it myself**: click words to cut or restore them, subtitle look, music and level, pictures, cover, caption.
8. **Export**: MP4 (WebM in browsers that can't record MP4) in four shapes (9:16 reel, 4:5 feed, 1:1 square, 16:9 wide),
   the cover, and the caption text.
9. **Write a script** before filming: hook, what to say, words on screen. **Paste your script** afterwards and the
   subtitles use its exact words (names, brands, punctuation) on the timing it heard; ad-libs are kept, the cut never
   moves, and "Use what it heard" undoes it (`lib/retext.ts`).
10. **Motion**: subtitle animations (pop, karaoke, bounce, word by word, typewriter, fade), highlighted numbers and
    keywords, transitions at every cut (punch-in, whip, flash, dip, glitch), colour looks (warm, cool, cinematic, black and
    white, vivid, film), picture entrances and slow push-ins, a progress bar; seven one-click styles (Punchy, Karaoke, Clean,
    Cinematic, Neon, Podcast, Film) plus your brand's.
11. **Animated cards** on the words that say them: a counting number, a ticking list, a before and after, growing bars.
12. **Motion Studio** (Animate): any text, or a link to a page, becomes an animated video: kinetic titles, statements,
    counters, lists, quotes, comparisons, bar charts, picture scenes (your photo or an AI picture) and a call to action, in
    six palettes or your brand's, five type families, calm / normal / hype pace, with music and an AI voiceover (OpenAI).
    Exports faster than real time with WebCodecs. Any video can also become an **animated recap**. **Product demos**: drop or
    paste a few screenshots of your app and each becomes a framed app screen (soft backdrop, rounded corners, a slow push,
    a punch-in on the part being talked about with a callout pointing at it), woven between the text scenes next to the
    sentence that mentions it (`lib/screenScene.ts`). Click a screenshot to choose the focus; with no pick it zooms in on
    the busiest part of the screen.
13. **Clips from long videos**: the AI ranks the moments that stand on their own; each becomes its own edited reel.
14. **Subtitles in 16 languages** and `.srt` files; **AI pictures** from a description (OpenAI), labelled.
15. **Hook ideas** (five new hook titles in one click) and a **reel check** (a 0-100 score with fixes), including
    "your voice is clearly heard": the song stays at least 12 dB under anyone talking (`lib/mix.ts`).
    A reel without a hook title gets a field in the Hook title panel to write one: it goes on screen from the first
    spoken words.
16. **Brand kit**: name, handle, colours, font, logo, an optional watermark, a brand style and brand animations.
17. **Make music**: no song? An original, royalty-free music bed composed in the browser (no key, no network): four moods
    (warm, uplifting, tense, lo-fi), tempo, key, as long as the edit, with sections on a bar grid and the final chord placed just
    before the video ends; an FM electric piano, detuned pads, sub bass, soft drums, sidechain pumping, reverb and a 1-3 kHz dip
    for the voice, mastered to about -16 LUFS (`lib/compose.ts`, `lib/loudness.ts`, a port of `editor/compose`).
18. **Pro editing**: a timeline, keyboard shortcuts (space, arrows, frame steps, Cmd/Ctrl+Z for versions), every shape in
    one export, and a Cmd/Ctrl+K command palette.
19. **Framed screens**: app screenshots and screen recordings are recognised at upload and shown on a rounded, shadowed
    backdrop with a slow push and a punch-in on what's being said; on reels they take a band above the speaker, never over
    the face (`lib/framed.ts`). **Boxed subtitles**: a whole phrase at a time in a soft dark box.
20. **Speed vs quality**: Fast, Balanced or Best quality for each video. Fast skips face finding and uses fewer pictures;
    Best adds a second pass where the AI reviews its own edit like a senior editor, starting from what the reel check
    measured (missing hook, long stretches without a change, music too close to the voice). Time estimates are learned from the
    videos made on each device (`lib/effort.ts`, `lib/timings.ts`).
21. **Film it here**: record takes with the camera right in Cutmind, the script on a teleprompter at the top of the
    picture (speed, size, mirror, pause with Space or a tap, a still script for reduced motion). The takes and the script
    go straight into the edit, so the subtitles are spelled like the script (`lib/camrec.ts`, `components/FilmRecorder.tsx`).
    Settings shows what Cutmind has learned about timings on this device, with a reset.
22. **Notes you can trust**: under each version, what really changed, measured by comparing the two edits (the
    length and the words cut or brought back, subtitle style, music and its dips, pictures added or removed, zooms, the
    hook title), next to the AI's own summary; "Nothing in the video changed" when a note didn't land
    (`lib/changes.ts`). A note with a time in it ("at 0:12 zoom in") gives the AI editor the words, pictures and zooms
    at that moment of the edited video, and the At button beside the note box adds where the player is (`lib/moments.ts`).
    Notes sent while the editor is still working wait their turn and are applied in order, each its own version.
    Or say the note: the mic beside the box writes it down with the listening you chose, for you to check and send.
23. **Learns from your exports**: Cutmind compares its first draft of each video with the version you export. A change
    you make in two different videos (bigger subtitles, fewer zooms, quieter music, tighter cuts...) is offered once as a
    style rule for next time; a no is remembered too (`lib/learn.ts`). The editor's keyboard shortcuts are one `?` away,
    and **Compare** (or C) plays the version before from the same word, to hear and see what a note changed.
24. **Share from your phone**: after an export, Share… opens the phone's share sheet with the video (Instagram, TikTok,
    Messages…) and copies the post caption to paste in; it only shows where the browser can share files.
25. **Back up your videos**: Settings, Your videos: one `.cutmind` file (a plain ZIP, no compression) with every video,
    its pictures and music, your Motion Studio animations and your style rules; restore it in another browser or after
    clearing site data. API keys are never in it; a video changed here more recently than the backup is kept
    (`lib/backup.ts`, `lib/zip.ts`).
26. **Attention map**: a lane under the timeline marks, second by second, where viewers may drift (the same picture for
    more than ~3 s, dead air, slow talking), and the Reel check lists the weakest spots with a fix; click one to go
    there (`lib/attention.ts`). A guide from what is on screen and said, not a forecast.
    **Add zooms there** fixes a same-picture spot in one click (a new version, so Undo works); **Ask your editor to fix
    these** sends the weak spots as one timed note.
27. **Show the app's buttons**: draws Reels, TikTok or Shorts UI over the 9:16 preview and says when its caption block
    covers your subtitles (`lib/safezones.ts`, the same zones as `editor safezone`).
28. **Your reels**: on the dashboard once you have two videos, your reel check scores over time (a trend line, the
    average, the change from your earlier reels, the average length, how many pass the scroll test) and what most often
    holds them back, with where to fix it (`lib/insights.ts`).
29. **Scroll test**: plays the first 3 seconds with the sound off, the way most people meet a reel, then says what a
    scroller got from them: a hook on screen, words to read, the picture moving, an opening that is the point, each
    with its fix (`lib/scrolltest.ts`). The speakers are muted; an export keeps its sound. **Loop test** plays the last
    2.5 seconds straight into the first 2, as the apps replay a reel, and flags dead air or a goodbye at the end (a call
    to action like "follow for more" is a choice, not flagged).
    Findings fix in one click where they can: **Cut “so um”** removes a warm-up opener (moving anything anchored
    there, like the hook title, onto the new first word), **Add a zoom there** moves a still opening, **Turn subtitles
    on**. Keys: T runs the scroll test, L the loop test.
30. **Raise them**: when the app's caption block covers the subtitles, one click moves them to the lowest spot all three
    platforms leave clear, as its own version (`clearPosition` in `lib/safezones.ts`).
31. **Cold open**: the scroll test also names your strongest line (a number, a strong word like "never" or
    "mistake", talking to "you", a question; never one that leans on what came before, like "Step two") and
    **Open with it** moves it to the front with the hook title, the rest in order after it (`lib/coldopen.ts`).
32. **Bleep**: strong swear words said in the reel show in a Strong language panel (mild ones are left alone); one
    click bleeps them all, a 1 kHz tone with the voice muted and subtitles showing "f***", in the preview and the
    export, or a note like "bleep the swearing" does it (`lib/bleep.ts`).
33. **Names you say**: apps, brands and products you name but never show (a capitalised name mid-sentence, with no
    picture on screen as it's said) are listed beside the video; **Show its logo** finds the open-licence logo
    (Simple Icons, credited) and puts it above your head on those words, as its own version (`lib/names.ts`).
34. **Test other hooks**: after an export, type one or two other hook titles (Try 5 hooks fills them in) and export
    the same reel with each, one file per hook, to post as trial reels and keep the hook that holds people longest.
35. **Talking speed**: Edit it myself → Cut plays the takes at 1.1×, 1.2× or 1.3× with the voice's pitch kept
    (pictures and music play as they are), or a note like "speed it up 10%"; every word, subtitle and picture stays on
    its words (`speed` in the edit, `srcAt`/`outAt` in `lib/timeline.ts`).
36. **Before you post**: the export panel sums up the reel check, the scroll and loop tests, the app buttons, names
    not shown, strong language and the export's measured loudness (**Match loudness** sets a gain from it, so the
    next export lands near -14 LUFS), and says how many need a look. **Fix what I can** applies every fix that doesn't
    change what is said or shown as one version (subtitles on, the warm-up cut, zooms where the picture sits still,
    subtitles raised clear of the app buttons); bleeps, logos and a cold open stay your call (`lib/autofix.ts`).
37. **YouTube chapters**: a wide video over a minute gets "0:00 Intro, 1:12 …" lines (about one chapter a minute,
    at sentence starts, YouTube's rules kept: 3 or more, the first at 0:00, each 10 s or longer); **Name them** has
    the AI title them from what each part says; **Add to the post** puts them in the caption, and **Show on screen**
    shows each title at the top as its chapter starts (`lib/chapters.ts`).
38. **Make a copy**: a copy of a video (its versions too) to try something different, sharing the same footage;
    deleting either keeps what the other uses (`copyProject` in `lib/store.ts`).
39. **Pick a take**: Edit it myself → Cut lists each line you said more than once. Cutmind plays the last complete
    take; Hear 1 / Hear 2 play each take from the footage, and one click plays another take in its place (where the line was in the cut, its edge "um" left out)
    (`lib/takes.ts`).
40. **Words you say out of habit**: Edit it myself → Cut counts "basically", "literally", "honestly", "obviously",
    "you know," and "I mean," (and "actually" or "like" set off by commas) in what the cut plays; one click cuts them
    all. "Do you know", "it actually works" and "I like it" are left alone (`lib/crutch.ts`; the CLI's
    `editor habits`).
41. **Find in what you said**: a search box above the words in Edit it myself → Cut. It highlights every place a word or
    phrase is said (the last word can be a start: "sub" finds "subscribe"); Enter jumps to the first, and one click
    cuts them all or brings back the cut ones, keeping the cut's order (`findWords`, `restoreWords`). `/` jumps to it
    from anywhere in the editor. Talking speed says how fast you talk now (words a minute).
42. **Fit to a length**: Edit it myself → Cut offers Under 30/45/60/90 s (whichever are shorter than the video). It
    tightens the pauses first, then proposes cutting the lines that grip least: a line said again first, then the cold
    open's rules (a number, a strong word, "you", a question, a name all count for a line). The hook, the ending and
    list items ("the first one", "step 2") always stay, and three lines at least; the lines are listed before anything
    is cut (`lib/fit.ts`; the CLI's `editor fit`).
43. **Lines you say twice**: the Cut tab lists lines the cut plays twice (the same line said again later, not a dropped
    retake) with both times; one click cuts the later one (`repeats` in `lib/fit.ts`).
44. **Use your Claude or ChatGPT plan (no API key)**: Settings → AI editor → "Your Claude or ChatGPT plan". At each AI
    step (first edit, notes, hooks, chapter titles, clips, translations, scripts, animations) a window shows the exact
    request: copy it into a chat on claude.ai, chatgpt.com or any chat AI, paste the reply back, and Cutmind checks and
    applies it. Claude Pro/Max and ChatGPT Plus/Pro don't offer third-party apps a sign-in, so Cutmind never asks for
    the account; it sends nothing anywhere itself (`lib/relay.ts`, `components/Relay.tsx`). Voice-overs, OpenAI
    transcription and AI pictures still need an OpenAI key.
45. **Any AI account with a key**: besides Anthropic and OpenAI, an **OpenRouter** key (one key for Claude, GPT, Gemini,
    Llama, DeepSeek and more; pick the model in Settings) or a **Google Gemini** key. Check key verifies it and picks a
    good model; the answer's shape goes in the prompt and the reply is read the forgiving way, so any capable model works
    (`lib/keys.ts`: every provider's key is stored, kept for the tab, and stripped from sync in one place).
46. **Words I wasn't sure I heard**: Edit it myself → Subtitles lists the words the recogniser was least sure of in what
    the cut plays (names and jargon, where subtitles go wrong), each with the words around it and its time. Type the
    right word and Fix: it becomes a correction everywhere it's said; or Looks right (`lib/unsure.ts`).
47. **Search what you said**: My videos' search finds a video by its title or by anything said in it ("the one where I
    talked about Notion"), and the tile shows the words around the first place and how many more (`lib/search.ts`).
48. **Notes pinned to the moment**: a typed note that points at what's on screen ("cut this", "logo here", "too loud now")
    without a time gets the playhead's time, shown in the chat ("cut this (at 0:12.3)"), so the editor changes that moment
    (`pinToPlayhead` in `lib/moments.ts`).

## Privacy and keys
- Videos never leave the browser: they're processed on the user's computer and kept in IndexedDB.
- API keys go **straight from the browser to Anthropic, OpenAI, OpenRouter or Google**. This app's server never receives them.
  They're kept for the tab only, unless the user ticks "Remember my keys".
- With "Your Claude or ChatGPT plan" there is no key and no AI call at all: the user copies each request into their own
  chat and pastes the reply back. Cutmind never asks for a Claude or ChatGPT login (those plans have no sign-in for
  other apps, and using another app's login would break their terms).
- With a database connected it also keeps accounts (see Pages). `/api/read` reads a public web page's text when a user asks
  Motion Studio to animate a link (public addresses only, 2 MB, 8 s, text only).
- The server also searches for licensed pictures (Openverse, Wikimedia Commons, Simple Icons:
  CC0, public domain, CC BY, CC BY-SA only), and fetch those pictures from a fixed list of hosts so they can be drawn
  into the video.

## Deploy
Click the button above, or: Vercel → Add New Project → this repository → **Root Directory `webapp`** → Deploy.
No environment variables are needed: accounts then live in each browser.

**Accounts on any device (optional):** in the Vercel project, **Storage → Create Database → Neon (Postgres)** → connect it to
the project (this adds `DATABASE_URL`), then **Redeploy**. Cutmind creates its three tables (`cm_users`, `cm_sessions`,
`cm_data`) on first use. `POSTGRES_URL` works too. Accounts made in a browser before the database was added stay in that browser.

Locally:
```bash
cd webapp && npm install && npm run dev        # http://localhost:3000
npm run build && npm start                      # production
```

## How it's built
Next.js (App Router) and TypeScript. Vercel serverless functions can't run a video pipeline (size limits, short
timeouts, a ~4.5 MB request limit), so all media work runs client-side:

| file | does |
|---|---|
| `lib/transcribe.ts` | audio decode, OpenAI word timestamps, or an in-browser speech model (transformers.js from a CDN) |
| `lib/analyze.ts` | phrases, pauses, retake groups, meta-talk, stutters, the default cut |
| `lib/prompts.ts`, `lib/ai.ts` | the editing doctrine and the JSON edit schema; Anthropic Messages / OpenAI Chat Completions |
| `lib/edit.ts` | validates every AI answer before it touches the project; post caption with credits |
| `lib/timeline.ts`, `lib/text.ts` | cut ranges to segments with a gap cap; captions: corrections, numbers as digits, 2-3 word cues |
| `lib/face.ts` | MediaPipe face detector (wasm from a CDN) for the reframe and the protected face zone |
| `lib/compositor.ts` | draws each frame: reframe, zooms, the picture treatments, labels, captions |
| `lib/framed.ts` | the framed treatment for app screens (92% on a backdrop, rounded, shadow, Ken Burns, punch-in) and the screenshot check |
| `lib/screenrec.ts` | Record my screen: getDisplayMedia + MediaRecorder, wait detection (live, and findWaits for uploaded clips), the trim / waits time map the player follows |
| `lib/player.ts` | live playback with two video elements per take swapped at cuts, Web Audio mix, MediaRecorder export |
| `app/api/search`, `app/api/image` | licensed picture search and a fixed-host image fetch |
| `lib/auth.ts`, `lib/sync.ts` | email + password accounts (server or browser) and preference sync |
| `app/api/account`, `lib/server/` | server accounts: Postgres, scrypt, sessions, same-origin checks, a rate limit |
| `lib/theme.ts` | the five looks |
| `lib/demo.ts`, `scripts/make_demo.py` | the sample project (a drawn presenter, a computer voice) |
| `lib/motion.ts`, `lib/templates.ts` | looks, transitions, entrances; the one-click styles |
| `lib/studio.ts`, `lib/studioPlay.ts`, `lib/studioAi.ts`, `lib/fastExport.ts` | Motion Studio: scenes, renderer, player, AI planning and voice, WebCodecs export |
| `lib/screenScene.ts` | Motion Studio app screens: layout, punch-in and callout timing, the busy-region focus finder |
| `lib/clips.ts`, `lib/translate.ts`, `lib/hooks.ts`, `lib/score.ts`, `lib/brand.ts` | clips, translated subtitles and .srt, hook ideas, the reel check, the brand kit |
| `lib/livecut.ts` | the landing page's live demo of the first-pass cut |
| `lib/compose.ts`, `lib/loudness.ts`, `components/MusicMaker.tsx` | Make music: section plan, chords and notes, an OfflineAudioContext renderer, LUFS + peak limiting, WAV |

Everything is anchored to transcript word ids, so a re-cut never breaks a picture, a zoom or a music lift.

## Limits
- Export plays the edit through once in real time to record it: a 60 s reel takes about a minute. Keep the tab in front.
- MP4 export needs a recent Chrome, Edge or Safari; other browsers record WebM.
- Face tracking and the in-browser speech model load from jsDelivr, Google Storage and Hugging Face the first time. If they're
  blocked, the reframe centres the shot and listening needs the OpenAI key.
- Only use music and pictures you own or are licensed to use.

## Tests
```bash
npm test                                         # unit tests: timeline, analysis, caption text, AI-answer validation, live cut, passwords, composer, loudness
npm run build && npx next start -p 3200 &
python3 tests/e2e.py <take.mp4> <transcript.json> <out_dir>   # sign up, the whole workflow, every shape, the sample (APIs mocked)
npm run a11y -- 3370 <out_dir>    # accessibility audit (axe-core, WCAG 2.1 AA) of every screen, light and dark; app running on :3370
DATABASE_URL=postgres://... npx next start -p 3200 & python3 tests/accounts.py   # server accounts across two browsers
python3 tests/studio.py http://localhost:3200 <out> "Product launch" [Hype]   # Motion Studio end to end, incl. every shape
python3 tests/brand.py | cards.py | command.py | recap.py http://localhost:3200 <out>   # brand kit, animated cards, Cmd+K, recaps
```

The editing doctrine is adapted from Reel Studio's editor prompts (MIT, see `../THIRD_PARTY.md`).
