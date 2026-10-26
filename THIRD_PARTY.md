# Third-party material

| Path | Source | Licence | Changes |
|---|---|---|---|
| `.claude/skills/claude-video-studio/` | [ItsssssJack/claude-video-2](https://github.com/ItsssssJack/claude-video-2) @ `18891e4` | MIT | Description notes it is vendored and how it feeds edit-reel overlays; a step to fetch the gallery videos (`scripts/fetch_gallery.sh`) because the ~60 MB of previews are not committed here. |
| `.claude/skills/video-use/` | [browser-use/video-use](https://github.com/browser-use/video-use) @ `43cfc56` | MIT | Description routes short-form reels to edit-reel; Manim path points at the sibling skill. Its `helpers/timeline_view.py` powers `editor inspect`. |
| `.claude/skills/manim-video/` | video-use's bundled `skills/manim-video` | MIT | none |
| `.claude/skills/launch-video/` | Keeran's launch-video skill ([keeran.ai](https://keeran-ai.beehiiv.com)), zip shared by the repo owner | No licence file; the author confirmed to the repo owner (Oct 2026) that publishing it in this public repo is fine | Marked `claude-edit` in the code: Playwright-Chromium fallback in `engine/render.mjs`; espeak-ng/flite draft voice and Vosk word-timing fallback in `vo.py`; portrait fit-to-width for `chips` rows in `engine/player.js`; a Claude-Edit note at the top of SKILL.md. |
| Vosk model `vosk-model-small-en-us-0.15` (downloaded to `library/models/`, not committed) | [alphacephei.com/vosk](https://alphacephei.com/vosk/models), or the copy inside the npm package `transcribe2texts` | Apache-2.0 | none |

Ideas adopted into `editor/` from video-use: 30 ms fades at every cut, subtitles last, per-source transcript
cache, phrase view broken on 0.5 s silence or speaker change, ≥0.35 s caption cues, Scribe as an engine,
self-review at every cut with a 3-pass cap, critic sub-agent, `project.md` memory, SFX timing rules,
`neutral_punch` / `warm_cinematic` grades. From claude-video-studio: the motion ban list (cubic easing, nothing
scales from zero, one accent, no glow) used by `editor/graphics.py`.
