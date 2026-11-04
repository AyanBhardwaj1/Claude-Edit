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
9. **Write a script** before filming: hook, what to say, words on screen.

## Privacy and keys
- Videos never leave the browser: they're processed on the user's computer and kept in IndexedDB.
- API keys go **straight from the browser to Anthropic or OpenAI**. This app's server never receives them.
  They're kept for the tab only, unless the user ticks "Remember my keys".
- The server does two small things: search for licensed pictures (Openverse, Wikimedia Commons, Simple Icons:
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
| `lib/player.ts` | live playback with two video elements per take swapped at cuts, Web Audio mix, MediaRecorder export |
| `app/api/search`, `app/api/image` | licensed picture search and a fixed-host image fetch |
| `lib/auth.ts`, `lib/sync.ts` | email + password accounts (server or browser) and preference sync |
| `app/api/account`, `lib/server/` | server accounts: Postgres, scrypt, sessions, same-origin checks, a rate limit |
| `lib/theme.ts` | the five looks |
| `lib/demo.ts`, `scripts/make_demo.py` | the sample project (a drawn presenter, a computer voice) |
| `lib/livecut.ts` | the landing page's live demo of the first-pass cut |

Everything is anchored to transcript word ids, so a re-cut never breaks a picture, a zoom or a music lift.

## Limits
- Export plays the edit through once in real time to record it: a 60 s reel takes about a minute. Keep the tab in front.
- MP4 export needs a recent Chrome, Edge or Safari; other browsers record WebM.
- Face tracking and the in-browser speech model load from jsDelivr, Google Storage and Hugging Face the first time. If they're
  blocked, the reframe centres the shot and listening needs the OpenAI key.
- Only use music and pictures you own or are licensed to use.

## Tests
```bash
npm test                                         # unit tests: timeline, analysis, caption text, AI-answer validation, live cut, passwords
npm run build && npx next start -p 3200 &
python3 tests/e2e.py <take.mp4> <transcript.json> <out_dir>   # sign up, the whole workflow, every shape, the sample (APIs mocked)
DATABASE_URL=postgres://... npx next start -p 3200 & python3 tests/accounts.py   # server accounts across two browsers
```

The editing doctrine is adapted from Reel Studio's editor prompts (MIT, see `../THIRD_PARTY.md`).
