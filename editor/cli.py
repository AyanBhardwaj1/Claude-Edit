"""Command-line entry point: `python3 -m editor <command> ...`  (run `--help` on any command)."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

from .util import EditorError, fmt_ts, load_json, log, save_json

VIDEO_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts"}
STAGES = ["transcribe", "plan", "cut", "audio", "track", "captions", "render", "check"]
ROOT = Path(__file__).resolve().parent.parent


def main(argv=None):
    ap = argparse.ArgumentParser(prog="editor", description="Claude Code reel/video editing toolkit")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("doctor", help="check ffmpeg, filters, python packages and fonts")

    p = sub.add_parser("new", help="create a project folder (raw/ broll/ music/ work/ out/)")
    p.add_argument("name")

    p = sub.add_parser("transcribe", help="word-level transcript of one or more clips (in order)")
    p.add_argument("inputs", nargs="+")
    p.add_argument("-o", "--out-dir", required=True)
    p.add_argument("--model", default="small", help="tiny|base|small|medium|large-v3|distil-large-v3")
    p.add_argument("--language")
    p.add_argument("--engine", choices=["auto", "whisperx", "faster-whisper", "scribe", "vosk"], default="auto",
                   help="auto tries whisperx, faster-whisper, scribe (ELEVENLABS_API_KEY), vosk (offline)")

    for sp in (sub.choices["transcribe"],):
        sp.add_argument("--glossary", nargs="*", default=[], help="names/terms to spell right (also library/glossary.txt)")
        sp.add_argument("--num-speakers", type=int)

    p = sub.add_parser("retext", help="re-time corrected text (edited transcript.txt or a script) onto the words")
    p.add_argument("work_dir")
    p.add_argument("text", help="edited copy of transcript.txt, or plain text / script")

    p = sub.add_parser("models", help="offline speech models (no huggingface needed)")
    p.add_argument("which", choices=["vosk", "vosk-large", "rnnoise"], help="rnnoise: neural speech denoiser")

    p = sub.add_parser("plan", help="auto rough cut: transcript.json -> edl.json")
    p.add_argument("transcript")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--max-gap", type=float, default=0.30, help="pauses longer than this are cut (s)")
    p.add_argument("--pad-before", type=float, default=0.06)
    p.add_argument("--pad-after", type=float, default=0.10)
    p.add_argument("--fillers", choices=["none", "standard", "aggressive"], default="standard")
    p.add_argument("--no-retakes", action="store_true", help="keep repeated takes")
    p.add_argument("--speed", type=float, default=1.0, help="global playback speed, e.g. 1.1")

    p = sub.add_parser("cut", help="render edl.json -> work/cut.mkv + cut_words.json + cut_meta.json")
    p.add_argument("edl")
    p.add_argument("-o", "--out-dir")
    p.add_argument("--transcript")

    p = sub.add_parser("audio", help="master voice (+ optional ducked music) to platform loudness")
    p.add_argument("input")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--preset", choices=["clean", "phone", "noisy", "studio", "podcast"], default="phone")
    p.add_argument("--lufs", type=float, default=-14.0)
    p.add_argument("--music")
    p.add_argument("--music-db", type=float, default=-20.0)
    p.add_argument("--no-duck", action="store_true")
    p.add_argument("--rnnoise-model", help="path to an RNNoise .rnnn model for arnndn")
    p.add_argument("--music-start", type=float, default=0.0, help="start the track N s in (skip a slow intro)")
    p.add_argument("--room-tone", action="store_true",
                   help="lay room tone from the takes under every cut (input must be work/cut.mkv)")

    p = sub.add_parser("track", help="face tracking for smart reframing")
    p.add_argument("input")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--yunet-model", help="optional face_detection_yunet .onnx for better detection")

    p = sub.add_parser("captions", help="word-synced animated captions (.ass + .srt)")
    p.add_argument("words")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--preset", default="reels", help="output preset (sets caption canvas size)")
    p.add_argument("--style", choices=["bold", "beast", "clean", "white", "studio", "boxed", "minimal"], default="bold")
    p.add_argument("--position", choices=["low", "middle", "high"], default="low")
    p.add_argument("--title", help="hook text shown at the top for the first seconds")
    p.add_argument("--title-dur", type=float, default=3.0)
    p.add_argument("--emphasis", nargs="*", default=[], help="words to colour as emphasis")
    p.add_argument("--font", help="caption font by name (editor fonts list); overrides EDL captions.font")

    p = sub.add_parser("fonts", help="caption fonts: add a Google Font by name or your own .ttf/.otf")
    fsub = p.add_subparsers(dest="fonts_cmd", required=True)
    q = fsub.add_parser("add", help='a Google Fonts family ("Bebas Neue") or a font file')
    q.add_argument("source")
    q.add_argument("--weights", type=int, nargs="*", help="Google weights, e.g. 700 900 (default 400 700 800 900)")
    fsub.add_parser("list", help="fonts you can use for captions")
    fsub.add_parser("sync", help="re-download the Google fonts in assets/fonts/fonts.json")

    p = sub.add_parser("gen", help="AI-generated b-roll, images, sfx, music, voice (only when asked: costs money)")
    gsub = p.add_subparsers(dest="gen_cmd", required=True)
    for kind in ("video", "image"):
        q = gsub.add_parser(kind, help=f"realistic {kind} from a prompt (fal, replicate, " +
                            ("gemini Veo)" if kind == "video" else "openai)"))
        q.add_argument("prompt")
        q.add_argument("-o", "--out", required=True)
        q.add_argument("--aspect", default="9:16", help="9:16 | 16:9 | 1:1 | 4:5")
        q.add_argument("--provider", choices=["fal", "replicate", "gemini", "openai"])
        q.add_argument("--model", help="alias (editor gen models) or provider:model-id")
        q.add_argument("--param", nargs="*", default=[], metavar="KEY=VALUE", help="extra/override model inputs")
        q.add_argument("--library", metavar="CATEGORY", help="also add it to the b-roll library")
        q.add_argument("--dry-run", action="store_true", help="print the request, spend nothing")
        if kind == "video":
            q.add_argument("--dur", type=float, default=5.0)
            q.add_argument("--image", help="first frame (image-to-video: a real frame keeps it consistent)")
            q.add_argument("--no-audio", action="store_true", help="no generated sound (models that make it)")
    q = gsub.add_parser("sfx", help="a realistic sound effect (ElevenLabs)")
    q.add_argument("prompt")
    q.add_argument("-o", "--out", help="default with --type: library/sfx/<type>/<prompt>.mp3")
    q.add_argument("--type", help="file it as this sfx type so auto sound design uses it (whoosh, impact, ...)")
    q.add_argument("--dur", type=float)
    q.add_argument("--dry-run", action="store_true")
    q = gsub.add_parser("music", help="an original music bed (ElevenLabs Music)")
    q.add_argument("prompt")
    q.add_argument("-o", "--out", required=True)
    q.add_argument("--dur", type=float, default=30.0)
    q.add_argument("--mood", choices=["hype", "uplifting", "emotional", "tense-dark", "cool-fun"],
                   help="also add it to the music library")
    q.add_argument("--dry-run", action="store_true")
    q = gsub.add_parser("voice", help="voiceover from text (ElevenLabs; the user's own or a licensed voice)")
    q.add_argument("text")
    q.add_argument("-o", "--out", required=True)
    q.add_argument("--voice", required=True, help="ElevenLabs voice id")
    q.add_argument("--model", default="eleven_multilingual_v2")
    q.add_argument("--dry-run", action="store_true")
    gsub.add_parser("models", help="providers, which keys are set, model aliases")

    p = sub.add_parser("render", help="final render from a work dir")
    p.add_argument("work_dir")
    p.add_argument("-o", "--out", required=True)
    _render_args(p)

    p = sub.add_parser("check", help="verify an export against a platform preset")
    p.add_argument("input")
    p.add_argument("--preset", default="reels")
    p.add_argument("--lufs", type=float, default=-14.0)

    p = sub.add_parser("sheet", help="contact sheet PNG for visual review")
    p.add_argument("input")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--count", type=int, default=12)

    p = sub.add_parser("frames", help="extract full-res frames at given times")
    p.add_argument("input")
    p.add_argument("-o", "--out-dir", required=True)
    p.add_argument("--at", type=float, nargs="+", required=True)

    p = sub.add_parser("fetch", help="download a video/audio link (Instagram, TikTok, YouTube, Drive...) with yt-dlp")
    p.add_argument("url")
    p.add_argument("--project", help="projects/<name>: saves into its raw/ (or --dest)")
    p.add_argument("--dest", default="raw", help="raw | broll | music | any folder path")
    p.add_argument("--audio-only", action="store_true")
    p.add_argument("--cookies-from-browser", help="chrome | safari | firefox (for Instagram/TikTok logins)")

    p = sub.add_parser("music", help="mood-tagged music library shared by every reel")
    msub = p.add_subparsers(dest="music_cmd", required=True)
    q = msub.add_parser("add", help="add a file or a link (audio is extracted)")
    q.add_argument("source")
    q.add_argument("--mood", required=True, choices=["hype", "uplifting", "emotional", "tense-dark", "cool-fun"])
    q.add_argument("--tags", nargs="*", default=[])
    q.add_argument("--title")
    q.add_argument("--star", action="store_true")
    q.add_argument("--notes", default="")
    q.add_argument("--cookies-from-browser")
    q = msub.add_parser("list", help="print the library grouped by mood")
    q.add_argument("--mood")
    q = msub.add_parser("tag", help="change mood / tags / star / notes of a track")
    q.add_argument("id")
    q.add_argument("--mood")
    q.add_argument("--tags", nargs="*")
    q.add_argument("--star", action="store_true", default=None)
    q.add_argument("--unstar", action="store_true")
    q.add_argument("--notes")

    p = sub.add_parser("broll", help="reusable b-roll library shared by every reel")
    bsub = p.add_subparsers(dest="broll_cmd", required=True)
    q = bsub.add_parser("add", help="copy clips/images into the library")
    q.add_argument("files", nargs="+")
    q.add_argument("--category", required=True, help="e.g. campus, app-demo, workspace, screenshots")
    q.add_argument("--tags", nargs="*", default=[])
    q.add_argument("--desc", default="", help="what is on screen; Claude matches b-roll to script lines with this")
    q = bsub.add_parser("list", help="list clips, optionally filtered")
    q.add_argument("query", nargs="?")

    p = sub.add_parser("attach", help="a picture, GIF or clip from a note -> <project>/broll/attached/ (GIF -> clip)")
    p.add_argument("file")
    p.add_argument("--project", required=True)
    p.add_argument("--name")

    p = sub.add_parser("pacing", help="draft checks: bare face > 4.5 s, zooms only > 10 s, flashes, names not shown")
    p.add_argument("work_dir")
    p.add_argument("--fix", action="store_true", help="add word-anchored zooms where the face is bare for over 4.5 s "
                   "(the safe fix; re-run from render after)")

    p = sub.add_parser("version", help="save the current render as vN with the note that made it; list; restore")
    p.add_argument("project")
    p.add_argument("--note", default="")
    p.add_argument("--list", action="store_true")
    p.add_argument("--restore", type=int)
    p.add_argument("--changes", nargs="?", const=0, type=int, metavar="N",
                   help="what the EDL changed since the last saved version (or vN), in plain words")

    p = sub.add_parser("post", help="the post caption (hook line, context, one ask) + exactly 5 hashtags -> out/post.txt")
    p.add_argument("project")
    p.add_argument("--caption", required=True)
    p.add_argument("--hashtags", nargs=5, required=True)
    p.add_argument("--keywords", nargs="*", default=[])

    p = sub.add_parser("export", help="out/export/<Title> - Version N.mp4 + cover + caption.txt")
    p.add_argument("project")
    p.add_argument("--version", type=int)

    p = sub.add_parser("share", help="send a video to your phone: QR code for a private 15-minute link on your Wi-Fi")
    p.add_argument("video")
    p.add_argument("--caption", help="a post.txt to show with a Copy button")

    p = sub.add_parser("images", help="free licensed pictures: brand logos (Simple Icons) and photos (Openverse, Wikimedia)")
    isub = p.add_subparsers(dest="images_cmd", required=True)
    q = isub.add_parser("search", help="numbered results with licence and source")
    q.add_argument("query")
    q.add_argument("--logo", action="store_true", help="a brand's logo (Simple Icons, CC0)")
    q.add_argument("-n", type=int, default=8)
    q = isub.add_parser("fetch", help="download a result number (or an image link) into <project>/broll/web/")
    q.add_argument("which", help="result number from the last search, or an image URL")
    q.add_argument("--project", required=True)
    q.add_argument("--name")

    p = sub.add_parser("names", help="apps and brands said but never shown; --logos fetches their logos (Simple Icons)")
    p.add_argument("work_dir")
    p.add_argument("--logos", action="store_true", help="download each name's logo into <project>/broll/web/ and print an EDL entry")
    p.add_argument("--apply", action="store_true", help="with --logos: add those entries to edl.json (card above the head)")

    p = sub.add_parser("variants", help="the same reel with other hook titles, one file each (for trial reels)")
    p.add_argument("project")
    p.add_argument("--hooks", nargs="+", required=True, help="the other hook titles, e.g. --hooks \"Stop filming daily\" \"One hour, a week of videos\"")
    p.add_argument("--preset", default="reels")
    p.add_argument("--auto-args", default="", help="the rest of your usual `editor auto` flags, in quotes (style, music...)")

    p = sub.add_parser("chapters", help="suggest chapters (about one a minute, at sentence starts) for a cut over a minute")
    p.add_argument("work_dir")
    p.add_argument("--apply", action="store_true", help="write them to edl.json (on-screen chapter pills, and the "
                   "YouTube timestamps in the post); re-run from captions")

    p = sub.add_parser("coldopen", help="open on the reel's strongest line (pacing suggests it): move it to the front")
    p.add_argument("work_dir")
    p.add_argument("--words", help="the line's words instead, e.g. w40-w48 (editor words <work>)")
    p.add_argument("--apply", action="store_true", help="write the new segment order to edl.json; re-run from cut")

    p = sub.add_parser("takes", help="lines said more than once: which take plays, and play another one instead")
    p.add_argument("work_dir")
    p.add_argument("--use", metavar="LINE:TAKE", help="play this take of this line (numbers as listed, e.g. 2:1)")
    p.add_argument("--clips", action="store_true", help="write each take as a short clip to work/takes/ to watch them")
    p.add_argument("--apply", action="store_true", help="write the segments to edl.json; re-run from cut")

    p = sub.add_parser("correct", help="fix a misheard word or phrase in the captions everywhere it's said (EDL captions.corrections)")
    p.add_argument("work_dir")
    p.add_argument("wrong", nargs="?", help='what the captions show, e.g. "Clawed" or "pay pal"')
    p.add_argument("right", nargs="?", help='what was said, e.g. "Claude" or "PayPal"')
    p.add_argument("--list", action="store_true", help="show the corrections")
    p.add_argument("--remove", metavar="WRONG", help="drop the correction for this")

    p = sub.add_parser("habits", help="words said out of habit (basically, literally, 'you know,'): count them, cut them")
    p.add_argument("work_dir")
    p.add_argument("--only", help="cut only these, comma-separated (e.g. basically,you know)")
    p.add_argument("--apply", action="store_true", help="cut them from edl.json's segments; re-run from cut")

    p = sub.add_parser("fit", help="fit the cut to a length: cut the lines that grip least (hook and ending stay)")
    p.add_argument("work_dir")
    p.add_argument("--under", type=float, required=True, help="seconds, e.g. 60")
    p.add_argument("--apply", action="store_true", help="write the segments to edl.json; re-run from cut")

    p = sub.add_parser("triage", help="classify raw/ clips: a-roll (founder-to-camera) vs reusable / one-off b-roll")
    p.add_argument("project")

    p = sub.add_parser("capture", help="make b-roll: web page screenshots/scrolls, app shot lists, stills from "
                                       "recordings, iPhone Simulator, Android")
    csub = p.add_subparsers(dest="capture_cmd", required=True)
    q = csub.add_parser("web", help="Playwright screenshot or scroll recording of a URL")
    q.add_argument("url")
    q.add_argument("-o", "--out", required=True)
    q.add_argument("--desktop", action="store_true", help="desktop viewport instead of iPhone")
    q.add_argument("--full-page", action="store_true")
    q.add_argument("--video", type=float, default=0.0, help="record N seconds (smooth scroll) instead of a screenshot")
    q.add_argument("--no-scroll", action="store_true")
    q.add_argument("--dark", action="store_true")
    q = csub.add_parser("shots", help="app screenshots from a JSON shot list (clicks, typing, sliders done in-page; "
                                      "works for heavy WebGL pages without a GPU)")
    q.add_argument("shotlist", help="shot list JSON (format: pydoc editor.shots)")
    q.add_argument("-o", "--out", required=True, help="output folder: <name>.png, shots.json, shots_sheet.jpg")
    q.add_argument("--base", help="override the shot list's base URL")
    q.add_argument("--record", action="store_true",
                   help="also record the whole run as shots.mp4 (headed Chromium on Xvfb + ffmpeg x11grab)")
    q.add_argument("--headed", action="store_true", help="show the browser (needs a display)")
    q = csub.add_parser("stills-from", help="distinct frames of a choppy screen recording as clean stills (mpdecimate)")
    q.add_argument("video")
    q.add_argument("out_dir")
    q.add_argument("--min-gap", type=float, default=0.0, help="at most one still per N seconds (default: all)")
    q.add_argument("--max", type=int, help="keep at most N stills, spread evenly")
    q = csub.add_parser("sim", help="record or screenshot the booted iOS Simulator (macOS + Xcode)")
    q.add_argument("-o", "--out", required=True)
    q.add_argument("--seconds", type=float, default=8.0)
    q.add_argument("--url", help="deep link or URL to open first")
    q.add_argument("--device", default="booted")
    q.add_argument("--screenshot", action="store_true")
    q = csub.add_parser("android", help="record or screenshot an Android device/emulator via adb")
    q.add_argument("-o", "--out", required=True)
    q.add_argument("--seconds", type=float, default=8.0)
    q.add_argument("--screenshot", action="store_true")

    p = sub.add_parser("viz", help="before/after rough-cut card (PNG): raw take vs cut, silence stats")
    p.add_argument("work_dir")
    p.add_argument("-o", "--out")
    p.add_argument("--title")

    p = sub.add_parser("graphic", help="built-in motion graphics -> transparent ProRes 4444 overlay (.mov)")
    p.add_argument("kind", choices=["counter", "lower-third", "checklist", "title", "cta", "quote", "logo-pop",
                                    "price-tag", "typing"])
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--preset", default="reels")
    p.add_argument("--fps", type=int, default=30)
    p.add_argument("--dur", type=float)
    p.add_argument("--accent", help="hex colour, e.g. #FF5A00")
    p.add_argument("--y", type=float, help="vertical position (fraction of height)")
    p.add_argument("--text", help="title / cta text")
    p.add_argument("--sub", help="cta sub-line")
    p.add_argument("--highlight", nargs="*", help="title words in the accent colour")
    p.add_argument("--start", type=float, help="counter start value")
    p.add_argument("--to", type=float, help="counter end value")
    p.add_argument("--prefix", help="counter prefix, e.g. $")
    p.add_argument("--suffix", help="counter suffix, e.g. %%")
    p.add_argument("--label", help="counter label")
    p.add_argument("--name", help="lower-third name")
    p.add_argument("--title", dest="lt_title", help="lower-third title / checklist heading")
    p.add_argument("--items", nargs="*", help="checklist items")
    p.add_argument("--at", type=float, nargs="*", help="checklist item / quote word times (seconds into the graphic)")
    p.add_argument("--image", help="logo-pop: the logo file")
    p.add_argument("--value", help="price-tag: the price as said, e.g. $20")
    p.add_argument("--old", help="price-tag: an old price to strike through")
    p.add_argument("--author", help="quote: who said it")
    p.add_argument("--response", help="typing: the reply shown after the typed text")
    p.add_argument("--chat", action="store_true", help="typing: a chat bubble instead of a terminal")

    p = sub.add_parser("inspect", help="filmstrip + waveform + words for a time range (video-use timeline_view)")
    p.add_argument("video")
    p.add_argument("start", type=float)
    p.add_argument("end", type=float)
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--transcript", help="words json (cut_words.json for renders, transcript.json for sources)")
    p.add_argument("--n-frames", type=int, default=10)

    p = sub.add_parser("review", help="self-review every cut of a render: clicks, flash frames, mid-word cuts")
    p.add_argument("video")
    p.add_argument("work_dir")
    p.add_argument("-o", "--out-dir")

    p = sub.add_parser("cover", help="cover/thumbnail: best frame + title")
    p.add_argument("video")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--title", default="")
    p.add_argument("--at", type=float, help="use this time instead of auto-picking")
    p.add_argument("--highlight", nargs="*")
    p.add_argument("--work", help="work dir: take frames from the clean cut (no captions/overlays)")
    p.add_argument("--candidates", type=float, nargs="*", help="output times to compare: the best frame near each, on one sheet")
    p.add_argument("--preset", default="reels")

    p = sub.add_parser("style", help="learned editing style: what this user likes, applied to first drafts")
    ssub = p.add_subparsers(dest="style_cmd", required=True)
    q = ssub.add_parser("show", help="the preferences that apply")
    q.add_argument("--kind", help="reel | launch")
    q.add_argument("--brand")
    q = ssub.add_parser("note", help="record what the user said (plus any key=value it implies)")
    q.add_argument("text")
    q.add_argument("--kind")
    q.add_argument("--brand")
    q.add_argument("--set", dest="sets", nargs="*", default=[], metavar="KEY=VALUE")
    q = ssub.add_parser("snapshot", help="save the first draft (edl.json or plan.json) to compare later")
    q.add_argument("file")
    q = ssub.add_parser("learn", help="fold the approved version's settings (and changes from the draft) in")
    q.add_argument("file")
    q.add_argument("--brand")
    q = ssub.add_parser("apply", help="fill a new draft's unset settings with confident learned values")
    q.add_argument("file")
    q.add_argument("--brand")
    q = ssub.add_parser("check", help="list where a draft differs from the learned preferences")
    q.add_argument("file")
    q.add_argument("--brand")
    q = ssub.add_parser("forget", help="drop a note id or a learned key")
    q.add_argument("target")
    ssub.add_parser("keys", help="every key the style memory tracks")

    p = sub.add_parser("words", help="the kept words with ids (w12) and output times, for word-anchored EDL entries")
    p.add_argument("work_dir")
    p.add_argument("--find", help="where a phrase is said: its word ids and times")
    p.add_argument("--unsure", type=float, default=0.5, help="mark words the recogniser was less sure of with (?)")

    p = sub.add_parser("timeline", help="print the cut's words on the OUTPUT timeline (for placing zooms/b-roll)")
    p.add_argument("work_dir")
    p.add_argument("--at", nargs="+", metavar="TIME", help="what the reel has at these moments (0:12 or 12.5): "
                   "segment and source second, words with ids, b-roll, zooms, music dips, chapter (for timed notes)")

    p = sub.add_parser("compose", help="original music + SFX synthesized from scratch (royalty-free): "
                                       "bed, lofi, riser, sfx, ambience, list")
    from .compose import add_arguments as _compose_arguments   # import-light: argparse only
    _compose_arguments(p)

    p = sub.add_parser("lessons", add_help=False, prefix_chars="+",
                       help="what each production taught: add one line after a video, show them before planning")
    p.add_argument("lessons_args", nargs=argparse.REMAINDER)

    p = sub.add_parser("inventory", add_help=False, prefix_chars="+",
                       help="what's in a folder of footage: lengths, sizes, sound, contact sheets, what is said")
    p.add_argument("inventory_args", nargs=argparse.REMAINDER)

    p = sub.add_parser("produce", add_help=False, prefix_chars="+",
                       help="a finished video from one JSON spec: pieces, overlay track, mix, composite, extras "
                            "(brief-production skill)")
    p.add_argument("produce_args", nargs=argparse.REMAINDER)

    p = sub.add_parser("safezone", add_help=False, prefix_chars="+",
                       help="captions under Reels / TikTok / Shorts UI? measured from captions.ass, plus a zones sheet")
    p.add_argument("safezone_args", nargs=argparse.REMAINDER)

    p = sub.add_parser("overlay", add_help=False, prefix_chars="+",
                       help="designed overlay track: JSON spec -> transparent PNG-in-MOV (Node Playwright); "
                            "also `overlay frame OUT_DIR` / `overlay still SRC OUT` (screens on a rounded backdrop)")
    p.add_argument("overlay_args", nargs=argparse.REMAINDER)

    p = sub.add_parser("effort", help="speed vs quality: what rush/standard/polish do, how long they take here")
    esub = p.add_subparsers(dest="effort_cmd", required=True)
    q = esub.add_parser("show", help="estimates for each effort, from timings learned on this machine")
    q.add_argument("--length", type=float, default=60.0, help="media length, seconds")
    q.add_argument("--budget", type=float, metavar="MIN", help="mark the effort that fits this many minutes")
    q.add_argument("--stages", nargs="*", help="stages to count (default: the editor auto stages; productions: "
                                               "capture pieces overlay mix composite)")
    q = esub.add_parser("record", help="log how long a hand-run stage took, so the next plan is better")
    q.add_argument("stage")
    q.add_argument("seconds", type=float)
    q.add_argument("--media", type=float, required=True, help="seconds of media the stage worked on")
    q.add_argument("--effort", default="standard")
    q = esub.add_parser("timings", help="the learned seconds-per-minute rates on this machine")

    p = sub.add_parser("auto", help="run the whole pipeline on a project folder")
    p.add_argument("project", help="projects/<name> (clips in raw/, played in filename order)")
    p.add_argument("--from", dest="from_stage", choices=STAGES, default="transcribe")
    p.add_argument("--to", dest="to_stage", choices=STAGES, default="check")
    p.add_argument("--model", help="whisper model (default: from --effort: base, small or medium)")
    p.add_argument("--language")
    p.add_argument("--engine", choices=["auto", "whisperx", "faster-whisper", "scribe", "vosk"], default="auto",
                   help="auto tries whisperx, faster-whisper, scribe (ELEVENLABS_API_KEY), vosk (offline)")
    p.add_argument("--effort", help="rush | standard | polish (or fast | balanced | best): trade time for quality "
                                    "(default: learned reel.effort, else standard)")
    p.add_argument("--budget", type=float, metavar="MIN",
                   help="time budget in minutes: picks the best effort whose learned estimate fits")
    # flags left unset fall back to the learned style (editor style show --kind reel), then built-in defaults
    p.add_argument("--fillers", choices=["none", "standard", "aggressive"])
    p.add_argument("--max-gap", type=float)
    p.add_argument("--speed", type=float)
    p.add_argument("--audio-preset", choices=["clean", "phone", "noisy", "studio", "podcast"])
    p.add_argument("--no-room-tone", action="store_true", help="don't lay room tone under the cuts")
    p.add_argument("--font", help="caption font by name (editor fonts list)")
    p.add_argument("--music", help="music file or library id (default: EDL \"music\", else <project>/music/)")
    p.add_argument("--music-db", type=float)
    p.add_argument("--style", choices=["bold", "beast", "clean", "white", "studio", "boxed", "minimal", "none"])
    p.add_argument("--position", choices=["low", "middle", "high"])
    p.add_argument("--title")
    p.add_argument("--brand", help="brand scope for learned style (default: EDL \"brand\")")
    p.add_argument("--no-learned-style", action="store_true", help="ignore library/style for this run")
    _render_args(p, auto=True)

    args = ap.parse_args(argv)
    try:
        return COMMANDS[args.cmd](args) or 0
    except EditorError as e:
        log(f"ERROR: {e}")
        return 1


def _render_args(p, auto=False):
    p.add_argument("--preset", default=None if auto else "reels", help="reels|tiktok|shorts|feed|square|youtube|youtube4k")
    p.add_argument("--audio", help="mastered audio (default: work/voice.wav if present)")
    p.add_argument("--captions", help="captions .ass (default: work/captions.ass if present)")
    p.add_argument("--no-captions", action="store_true")
    p.add_argument("--track", help="track.json (default: work/track.json if present)")
    p.add_argument("--grade", choices=["none", "natural", "punchy", "warm", "cinematic", "bw", "neutral_punch",
                                       "warm_cinematic"], default=None if auto else "natural")
    p.add_argument("--auto-color", type=float, default=0.5, help="match takes: per-segment WB/exposure nudge (0 = off)")
    p.add_argument("--no-sfx", action="store_true", help="skip sound effects (EDL \"sfx\")")
    p.add_argument("--lut", help=".cube LUT applied before the grade's YUV stage")
    p.add_argument("--sharpen", type=float, default=0.35, help="0 disables contrast-adaptive sharpening")
    p.add_argument("--fit", choices=["crop", "blur"], default="crop",
                   help="crop: face-follow crop; blur: whole frame over blurred fill (screen recordings)")
    p.add_argument("--punch-in", type=float, help="alternate zoom on every other cut (EDL auto_punch_in)")
    p.add_argument("--broll", nargs="*", default=[], metavar="PATH@START:DUR",
                   help="cutaway clips/images, e.g. broll/app.mp4@4.2:2.5 (appended to EDL broll)")
    p.add_argument("--crf", type=int)
    p.add_argument("--draft", action="store_true", help="fast half-size preview (check the edit, then render for real)")


def cmd_doctor(_):
    import subprocess
    ok = True
    for b in ("ffmpeg", "ffprobe"):
        found = shutil.which(b)
        print(f"{'ok ' if found else 'MISSING'} {b} {found or ''}")
        ok &= bool(found)
    if shutil.which("ffmpeg"):
        filters = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True).stdout
        encoders = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
        for f in ("ass", "loudnorm", "afftdn", "deesser", "acompressor", "sidechaincompress", "zscale",
                  "tonemap", "vibrance", "cas", "lut3d", "colortemperature"):
            found = f" {f} " in filters
            print(f"{'ok ' if found else 'MISSING'} filter {f}")
            ok &= found
        found = "libx264" in encoders
        print(f"{'ok ' if found else 'MISSING'} encoder libx264")
        ok &= found
    for mod in ("faster_whisper", "cv2", "numpy", "PIL", "yt_dlp"):
        try:
            __import__(mod)
            print(f"ok  python {mod}")
        except ImportError:
            print(f"MISSING python {mod}  (pip install -r requirements.txt)")
            ok = False
    for mod, why in (("whisperx", "tighter word timestamps (WHISPERX=1 ./setup.sh)"),
                     ("playwright", "web b-roll capture")):
        try:
            __import__(mod)
            print(f"ok  python {mod}")
        except ImportError:
            print(f"optional python {mod}: {why}")
    print(f"{'ok ' if shutil.which('xcrun') else 'optional'} xcrun (iPhone Simulator capture, macOS)")
    print(f"{'ok ' if shutil.which('xvfb-run') else 'optional'} xvfb-run (capture shots --record, Linux)")
    try:
        import vosk  # noqa: F401
        from .models import MODELS_DIR
        have = any(MODELS_DIR.glob("vosk-model-*"))
        print(f"{'ok ' if have else 'optional'} vosk offline ASR{'' if have else ' (model: python3 -m editor models vosk)'}")
    except ImportError:
        print("optional vosk offline ASR: pip install vosk")
    from .transcribe import _api_key
    print(f"{'ok ' if _api_key('ELEVENLABS_API_KEY') else 'optional'} ElevenLabs Scribe key (hosted ASR)")
    node = shutil.which("node")
    print(f"{'ok ' if node else 'optional'} node (HyperFrames / Remotion graphics, editor overlay, capture shots)")
    try:
        from .overlay import available
        ov = available()
        ov_ok = ov[0] if isinstance(ov, tuple) else bool(ov)
        print(f"{'ok ' if ov_ok else 'optional'} overlay renderer (node + Playwright + Chromium: editor overlay, "
              "produce overlays)" + ("" if ov_ok else f": {ov[1] if isinstance(ov, tuple) else 'not available'}"))
    except Exception as e:  # noqa: BLE001
        print(f"optional overlay renderer: {e}")
    try:
        import scipy  # noqa: F401
        print("ok  python scipy (editor compose: original music and SFX)")
    except ImportError:
        print("optional python scipy: editor compose (pip install scipy)")
    from . import effort as _eff
    learned = _eff.load().get("machines", {}).get(_eff.machine(), {})
    import math as _m
    odd = [k for k, v in learned.items() if not isinstance(v, dict) or not isinstance(v.get("rate"), (int, float))
           or not _m.isfinite(v["rate"]) or not 0 < v["rate"] < 36000]
    if odd:
        print(f"!!  effort timings: {', '.join(odd)} look broken (not a real rate): estimates for those stages are "
              f"off; delete them from {_eff._path()} and they'll be learned again")
    else:
        print(f"ok  effort timings: {len(learned)} stage rate(s) learned on {_eff.machine()} (editor effort show)")
    from .captions import STYLES, resolve_font
    print(f"ok  caption font (bold): {resolve_font(STYLES['bold']['fonts'])}")
    from .fonts import installed
    print(f"ok  custom caption fonts: {len(installed())} names in assets/fonts (editor fonts add/list/sync)")
    from .models import rnnoise_model
    have = rnnoise_model(download=False)
    print(f"{'ok ' if have else 'optional'} RNNoise neural denoise{'' if have else ' (python3 -m editor models rnnoise)'}")
    from .genai import KEYS, key_for
    keys = [p for p in KEYS if key_for(p)]
    print(f"{'ok ' if keys else 'optional'} AI generation keys: {', '.join(keys) or 'none'} (editor gen models)")
    try:
        import ctranslate2
        print(f"ok  CUDA GPUs for whisper: {ctranslate2.get_cuda_device_count()}")
    except Exception:
        pass
    print("doctor:", "all good" if ok else "fix the MISSING items (./setup.sh)")
    return 0 if ok else 1


def cmd_new(args):
    root = ROOT / "projects" / args.name
    for d in ("raw", "broll", "music", "work", "out"):
        (root / d).mkdir(parents=True, exist_ok=True)
    print(root)


def cmd_transcribe(args):
    from .transcribe import transcribe
    transcribe(args.inputs, args.out_dir, model=args.model, language=args.language, engine=args.engine,
               glossary=_glossary(args.glossary), num_speakers=args.num_speakers)


def cmd_plan(args):
    from .plan import plan
    plan(args.transcript, args.out, max_gap=args.max_gap, pad_before=args.pad_before, pad_after=args.pad_after,
         fillers=args.fillers, retakes=not args.no_retakes, speed=args.speed)


def cmd_cut(args):
    from .cut import cut
    cut(args.edl, args.out_dir or Path(args.edl).parent, transcript=args.transcript)


def cmd_audio(args):
    from .audio import master
    from .library import music_path
    fill = None
    if args.room_tone:
        from .audio import room_tone_fill
        fill = room_tone_fill(Path(args.input).parent)
    master(args.input, args.out, preset=args.preset, target_lufs=args.lufs,
           music=str(music_path(args.music)) if args.music else None, music_db=args.music_db,
           duck=not args.no_duck, rnnoise_model=args.rnnoise_model, music_start=args.music_start, fill=fill)


def cmd_track(args):
    from .track import track
    track(args.input, args.out, yunet_model=args.yunet_model)


def cmd_captions(args):
    from .captions import build
    from .render import PRESETS
    w, h = PRESETS[args.preset]["size"]
    work = Path(args.words).parent  # title / emphasis / chapters default to the EDL next to the words
    edl = load_json(work / "edl.json") if (work / "edl.json").exists() else {}
    from .anchors import resolve_work
    edl = resolve_work(edl, work)
    meta = load_json(work / "cut_meta.json") if (work / "cut_meta.json").exists() else {}
    build(args.words, args.out, width=w, height=h, style=args.style, position=args.position,
          title=args.title or edl.get("title"), title_dur=args.title_dur,
          emphasis=args.emphasis or edl.get("emphasis", []), chapters=edl.get("chapters"),
          duration=meta.get("duration"), look=_caption_look(edl, args.font))


def _first_word(work: Path) -> float:
    p = work / "cut_words.json"
    words = load_json(p)["words"] if p.exists() else []
    return float(words[0]["start"]) if words else 0.0


def _caption_look(edl: dict, font: str | None) -> dict:
    look = dict(edl.get("captions") or {})
    if font:
        look["font"] = font
    return look


def cmd_fonts(args):
    from . import fonts
    if args.fonts_cmd == "add":
        for n in fonts.add(args.source, args.weights):
            print(n)
    elif args.fonts_cmd == "list":
        print(fonts.listing())
    else:
        fonts.sync()


def cmd_gen(args):
    from . import genai
    c = args.gen_cmd
    if c == "models":
        print(genai.models())
        return
    if c in ("video", "image"):
        kw = dict(aspect=args.aspect, provider=args.provider, model=args.model, params=args.param,
                  dry_run=args.dry_run)
        if c == "video":
            kw.update(dur=args.dur, image=args.image, audio=not args.no_audio)
        out = getattr(genai, c)(args.prompt, args.out, **kw)
        if args.library and not args.dry_run:
            from .library import broll_add
            broll_add([str(out)], args.library, tags=["ai-generated"], description=args.prompt,
                      source=f"ai:{genai.provenance(out)['model']}")
    elif c == "sfx":
        out = args.out
        if not out:
            if not args.type:
                raise EditorError("give -o, or --type to file it in library/sfx/<type>/")
            from .library import _slug
            from .sfx import CACHE
            out = CACHE / args.type / f"{_slug(args.prompt)[:40]}.mp3"
        out = genai.sfx(args.prompt, out, dur=args.dur, dry_run=args.dry_run)
    elif c == "music":
        out = genai.music(args.prompt, args.out, dur=args.dur, dry_run=args.dry_run)
        if args.mood and not args.dry_run:
            from .library import music_add
            music_add(str(out), args.mood, tags=["ai-generated"], notes=args.prompt)
    else:
        out = genai.voice(args.text, args.out, args.voice, model=args.model, dry_run=args.dry_run)
    if not args.dry_run:
        print(out)


def cmd_render(args):
    from .render import render
    work = Path(args.work_dir)
    meta = load_json(work / "cut_meta.json")
    edl_path = Path(meta["edl"])
    edl = load_json(edl_path) if edl_path.exists() else {}
    from .anchors import resolve_work
    edl = resolve_work(edl, work)
    broll = [_resolve_broll(b, edl_path) for b in edl.get("broll", [])]
    broll += [_parse_broll(s) for s in args.broll]

    def default(value, name):
        if value:
            return value
        return str(work / name) if (work / name).exists() else None

    captions = None if args.no_captions else default(args.captions, "captions.ass")
    render(work, args.out, preset=args.preset, audio=default(args.audio, "voice.wav"), captions=captions,
           track=default(args.track, "track.json"), punch_in=args.punch_in, grade=args.grade, lut=args.lut,
           sharpen=args.sharpen, fit=args.fit, broll=broll, crf=args.crf, auto_color=args.auto_color, draft=args.draft,
           sfx=not args.no_sfx, speed=getattr(args, "encode_speed", None))


def cmd_check(args):
    from .qa import check
    return 0 if check(args.input, preset=args.preset, target_lufs=args.lufs)["passed"] else 2


def cmd_sheet(args):
    from .qa import sheet
    sheet(args.input, args.out, count=args.count)


def cmd_frames(args):
    from .qa import frames
    frames(args.input, args.out_dir, args.at)


def cmd_fetch(args):
    from .fetch import fetch
    if args.dest in ("raw", "broll", "music"):
        if not args.project:
            raise EditorError("--project is required with --dest raw|broll|music")
        dest = Path(args.project) / args.dest
    else:
        dest = Path(args.dest)
    for path in fetch(args.url, dest, audio_only=args.audio_only or args.dest == "music",
                      cookies_from_browser=args.cookies_from_browser):
        print(path)


def cmd_music(args):
    from . import library
    if args.music_cmd == "add":
        library.music_add(args.source, args.mood, tags=args.tags, title=args.title, starred=args.star,
                          notes=args.notes, cookies_from_browser=args.cookies_from_browser)
    elif args.music_cmd == "list":
        print(library.music_list(args.mood))
    elif args.music_cmd == "tag":
        star = False if args.unstar else args.star
        print(library.music_tag(args.id, mood=args.mood, tags=args.tags, star=star, notes=args.notes))


def cmd_broll(args):
    from . import library
    if args.broll_cmd == "add":
        library.broll_add(args.files, args.category, tags=args.tags, description=args.desc)
    else:
        for c in library.broll_list(args.query):
            print(f"{c['id']:<28} {c['category']:<14} {c['duration']:>6}s {c.get('width')}x{c.get('height')}  "
                  f"{', '.join(c['tags'])}  {c['description']}")


def cmd_attach(args):
    from .attach import attach
    print(attach(args.file, args.project, args.name)["path"])


def _bleeps(work: Path) -> list[tuple[float, float]]:
    """The EDL's "bleep" (true: every strong swear word; a list: those word ids) as output-time spans."""
    from .bleep import spans
    edl = load_json(work / "edl.json")
    if not edl.get("bleep") or not (work / "cut_words.json").exists():
        return []
    sp = spans(load_json(work / "cut_words.json")["words"], edl["bleep"])
    if sp:
        log(f"bleep: {len(sp)} word(s) bleeped")
    return sp


def cmd_pacing(args):
    from .anchors import load_words, resolve_work
    from .review import pacing, punch_cuts
    work = Path(args.work_dir)
    meta = load_json(work / "cut_meta.json")
    edl = resolve_work(load_json(meta["edl"]), work)
    rep = pacing(edl, load_words(work), meta["duration"], punch_cuts(edl, meta))
    for k, v in rep.items():
        print(f"{'!!' if v else 'ok'}  {k}: {v if v else '-'}")
    if getattr(args, "fix", False) and rep["face_only_over_4_5s"]:
        from .review import stillness_zooms
        room = int(float(meta["duration"]) / 6) - len(edl.get("zooms", []))     # 10 a minute at most, all told
        add = stillness_zooms(rep["face_only_over_4_5s"], load_words(work), limit=max(0, room))
        if add:
            raw = load_json(meta["edl"])
            raw.setdefault("zooms", []).extend(add)
            save_json(meta["edl"], raw)
            log(f"pacing --fix: {len(add)} zoom(s) added to {meta['edl']} on the words in the bare-face stretches: "
                f"re-run from render")


def cmd_version(args):
    from . import versions
    if args.changes is not None:
        print(versions.changes(args.project, args.changes or None))
    elif args.restore is not None:
        versions.restore(args.project, args.restore)
    elif args.list:
        if not Path(args.project).is_dir():
            raise EditorError(f"no project at {args.project}")
        for v in versions.versions(args.project):
            print(f"v{v['n']}  {v['note'].splitlines()[0] if v['note'] else ''}")
    else:
        print(versions.save_version(args.project, args.note))


def cmd_post(args):
    from .versions import write_post
    print(write_post(args.project, args.caption, args.hashtags, args.keywords))


def cmd_export(args):
    from .versions import export
    print(export(args.project, args.version))


def cmd_share(args):
    from .share import serve
    caption = Path(args.caption).read_text() if args.caption else ""
    serve(args.video, caption)


def cmd_images(args):
    from . import images
    if args.images_cmd == "search":
        for r in images.search(args.query, want_logo=args.logo, n=args.n):
            size = f"{r.get('w')}x{r.get('h')}" if r.get("w") else ""
            print(f"{r['n']:>2}. [{r['kind']}] {r['title'][:70]}  {size}  {r['license']}"
                  f"{' by ' + r['creator'][:40] if r.get('creator') else ''}  ({r['source']})")
    else:
        print(images.fetch(args.which, args.project, args.name)["path"])


def cmd_names(args):
    """Names said but never shown (the pacing check), with times and word anchors; --logos fetches each one's
    Simple Icons logo (CC0) and prints a broll entry; --apply adds the entries to the EDL."""
    import json
    from .anchors import load_words, resolve_work
    from .review import named_not_shown
    work = Path(args.work_dir)
    edl_path = work / "edl.json"
    edl = load_json(edl_path)
    names = named_not_shown(resolve_work(edl, work), load_words(work))
    if not names:
        print("every name you say is shown (or none is said)")
        return 0
    entries = []
    for n in names:
        line = f"{n['start']:6.1f}s  {n['name']}  (words {n['words']})"
        if args.logos:
            from . import images
            try:
                got = images.save_hit(images.logo(n["name"])[0], work.parent, n["name"])
                path = str(Path(got["path"]).relative_to(work.parent))
                if Path(path).suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
                    # an SVG left as SVG (no Playwright to convert it) would show for one frame in a render
                    line += f"  (logo saved as {path}: install Playwright to convert it, or use a PNG)"
                    print(line)
                    continue
                entry = {"path": path, "treatment": "card-above-head", "words": n["words"]}
                entries.append(entry)
                line += f"  ->  {json.dumps(entry)}"
            except EditorError as e:
                line += f"  (no logo: {e})"
        print(line)
    if args.apply and entries:
        edl.setdefault("broll", []).extend(entries)
        save_json(edl_path, edl)
        log(f"names: {len(entries)} logo card(s) added to {edl_path}: re-run from render")
    return 0


def cmd_variants(args):
    """Render the reel once per hook title (out/<name>_<preset> - hook B.mp4, ...), then put the EDL and captions back.
    The hook is the EDL "title", or a hook card (a plain text-pop label in the first second) when there is one."""
    import shlex
    project = Path(args.project)
    edl_path = project / "work" / "edl.json"
    original = edl_path.read_text()
    extra = shlex.split(args.auto_args)
    base = ["auto", str(project), "--preset", args.preset, *extra]
    out_dir = project / "out"
    made = []
    try:
        for k, hook in enumerate(args.hooks):
            edl = json.loads(original)
            # the hook card: a plain label on screen in the first second (anchors resolved to find when it starts)
            from .anchors import resolve_work
            first = next((b for b in resolve_work(json.loads(original), project / "work").get("broll", [])
                          if b.get("treatment") == "text-pop" and b.get("style") == "label" and float(b.get("start", 9)) < 1.0), None)
            card = next((b for b in edl.get("broll", []) if first and b.get("treatment") == "text-pop"
                         and b.get("text") == first.get("text")), None)
            if card is not None:
                card["text"] = hook
            else:
                edl["title"] = hook
            save_json(edl_path, edl)
            log(f"variants: hook {chr(66 + k)}: {hook!r}")
            src = out_dir / f"{project.name}_{args.preset}{'_draft' if '--draft' in extra else ''}.mp4"
            src.unlink(missing_ok=True)                 # never pass an earlier render off as this hook's
            if main([*base, "--from", "captions", "--to", "render"]) != 0 or not src.exists():
                raise EditorError(f"hook {chr(66 + k)} ({hook!r}) did not render: see the log above")
            dest = out_dir / f"{project.name}_{args.preset}{'_draft' if '--draft' in extra else ''} - hook {chr(66 + k)}.mp4"
            src.replace(dest)
            made.append(dest)
    finally:
        edl_path.write_text(original)                  # the reel's own hook back, captions and render to match
        main([*base, "--from", "captions", "--to", "render"])
    for k, (f, hook) in enumerate(zip(made, args.hooks)):
        print(f"hook {chr(66 + k)}: {f}  ({hook})")
    return 0


def cmd_chapters(args):
    from .anchors import load_words
    from .versions import suggest_chapters
    work = Path(args.work_dir)
    meta = load_json(work / "cut_meta.json")
    chs = suggest_chapters(load_words(work), float(meta["duration"]))
    if not chs:
        print("no chapters: a cut over a minute with sentences 10 s or more apart gets them")
        return 0
    for c in chs:
        print(f"{int(c['start']) // 60}:{int(c['start']) % 60:02d} {c['text']}  (words {c['words']})")
    if args.apply:
        edl = load_json(meta["edl"])
        edl["chapters"] = [{"words": c["words"], "text": c["text"]} for c in chs]
        save_json(meta["edl"], edl)
        log(f"chapters: {len(chs)} written to {meta['edl']}: re-run from captions (pills on screen, timestamps in the post)")
    return 0


def cmd_coldopen(args):
    """The cold open: the line's source range becomes the first segment and is cut out of where it was (the rest
    plays in order after it). Word-anchored b-roll, zooms and captions follow their words; anything placed by
    seconds doesn't, so check those after."""
    from .anchors import load_words
    from .review import strongest_line
    work = Path(args.work_dir)
    edl_path = work / "edl.json"
    edl, words = load_json(edl_path), load_words(work)
    if args.words:
        a, _, b = args.words.partition("-")
        ids = [w["id"] for w in words]
        if a not in ids or (b or a) not in ids:
            raise EditorError(f"{args.words}: those words aren't in the cut (editor words {work})")
        i, j = ids.index(a), ids.index(b or a)
        line = {"ids": ids[min(i, j):max(i, j) + 1], "text": " ".join(w["text"] for w in words[min(i, j):max(i, j) + 1])}
    else:
        line = strongest_line(words)
        if not line:
            print("no line grips more than the opening: it already opens strong")
            return 0
    tr = load_json(work / "transcript.json")["words"]
    src_words = [tr[int(x[1:])] for x in line["ids"] if x and x[1:].isdigit() and int(x[1:]) < len(tr)]
    if not src_words or len({w.get("src", 0) for w in src_words}) > 1:
        raise EditorError("that line spans two takes: pick its words with --words")
    src = src_words[0].get("src", 0)
    lo, hi = min(w["start"] for w in src_words), max(w["end"] for w in src_words)
    # pad into silence only: never into the word before or after (fluent speech has ~80 ms between words)
    before = max((w["end"] for w in tr if w.get("src", 0) == src and w["end"] <= lo + 1e-3), default=0.0)
    after = min((w["start"] for w in tr if w.get("src", 0) == src and w["start"] >= hi - 1e-3), default=float("inf"))
    a, b = max(0.0, before, lo - 0.05), min(hi + 0.15, after)
    rest, front = [], []
    for seg in edl.get("segments", []):
        if seg.get("src", 0) != src or seg["end"] <= a or seg["start"] >= b:
            rest.append(seg)
            continue
        keep = {k: v for k, v in seg.items() if k != "text"}
        # the kept part of the line moves up front (a pause the cut removed stays removed)...
        x, y = max(seg["start"], a), min(seg["end"], b)
        if y - x >= 0.05:
            front.append({**keep, "start": round(x, 3), "end": round(y, 3)})
        for x, y in ((seg["start"], a), (b, seg["end"])):          # ...and what's left either side stays in place
            if y - x >= 0.05:
                rest.append({**keep, "start": round(x, 3), "end": round(y, 3)})
    if not front:
        raise EditorError("that line isn't in the cut's segments")
    front[0]["text"] = line["text"]
    print(f"open with: {line['text']!r} (take {src}, {a:.2f}-{b:.2f}s), then the rest in order")
    if args.apply:
        edl["segments"] = [*front, *rest]
        save_json(edl_path, edl)
        log(f"coldopen: {edl_path} now opens on that line: re-run from cut; check the hook title still opens it")
    return 0


def cmd_takes(args):
    """Pick a take: list each line said more than once (the plan keeps one take), or play another take in its place."""
    from .takes import take_lines, with_take
    work = Path(args.work_dir)
    edl_path = work / "edl.json"
    edl = load_json(edl_path)
    words = load_json(work / "transcript.json")["words"]
    lines = take_lines(words, edl.get("segments", []))
    if not lines:
        print("no line was said more than once")
        return 0
    if args.clips:
        from .util import run
        out = work / "takes"
        out.mkdir(exist_ok=True)
        sources = edl.get("sources", [])
        for n, L in enumerate(lines, 1):
            for k, t in enumerate(L["takes"], 1):
                if t["src"] >= len(sources):
                    continue
                a, b = max(0.0, t["start"] - 0.15), t["end"] + 0.25
                dest = out / f"line{n}_take{k}.mp4"
                run(["ffmpeg", "-y", "-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", sources[t["src"]]["path"],
                     "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac",
                     "-movflags", "+faststart", str(dest)])
        log(f"takes: each take as a clip in {out} (line<N>_take<K>.mp4) to watch before picking")
    if not args.use:
        for n, L in enumerate(lines, 1):
            print(f"line {n}:")
            for k, t in enumerate(L["takes"], 1):
                mark = "*" if k - 1 == L["playing"] else " "
                print(f"  {mark} take {k}  src {t['src']} {fmt_ts(t['start'])}  {t['text'][:70]!r}")
        print("* plays now. Play another: editor takes <work> --use LINE:TAKE --apply")
        return 0
    try:
        n, k = (int(x) for x in args.use.split(":"))
        line, take = lines[n - 1], lines[n - 1]["takes"][k - 1]
        if n < 1 or k < 1:
            raise IndexError
    except (ValueError, IndexError):
        raise EditorError(f"--use {args.use}: give LINE:TAKE as listed by `editor takes {work}`")
    if k - 1 == line["playing"]:
        print(f"take {k} of line {n} already plays")
        return 0
    segs = with_take(edl.get("segments", []), line, k - 1)
    print(f"line {n} now plays take {k}: {take['text']!r}")
    if args.apply:
        edl["segments"] = segs
        save_json(edl_path, edl)
        log(f"takes: {edl_path} updated: re-run from cut; check anything placed by seconds")
    return 0


def cmd_correct(args):
    """Caption corrections (applied at the captions stage, longest phrase first; see editor/wordfix.py)."""
    from .wordfix import _bare
    work = Path(args.work_dir)
    edl_path = work / "edl.json"
    edl = load_json(edl_path)
    look = edl.setdefault("captions", {}) if isinstance(edl.get("captions", {}), dict) else {}
    fixes = look.setdefault("corrections", [])
    key = lambda t: " ".join(_bare(x) for x in str(t).split() if _bare(x))  # noqa: E731
    if args.remove:
        before = len(fixes)
        fixes[:] = [c for c in fixes if key(c.get("from", "")) != key(args.remove)]
        if len(fixes) == before:
            raise EditorError(f"no correction for {args.remove!r} (editor correct {work} --list)")
    elif args.wrong and args.right:
        if not key(args.wrong):
            raise EditorError("give the wrong word or phrase as the captions show it")
        fixes[:] = [c for c in fixes if key(c.get("from", "")) != key(args.wrong)] + [{"from": args.wrong.strip(), "to": args.right.strip()}]
    elif not args.list:
        raise EditorError('give WRONG and RIGHT ("Clawed" "Claude"), or --list, or --remove WRONG')
    if not args.list:
        save_json(edl_path, edl)
        log(f"correct: {len(fixes)} correction(s) in {edl_path}: re-run from captions")
    for c in fixes:
        print(f"  {c['from']!r} -> {c['to']!r}")
    if not fixes:
        print("no corrections")
    return 0


def cmd_habits(args):
    """Words said out of habit, in what the cut plays: listed, or cut (--apply) from the segments in their order."""
    from .habits import cut, find
    work = Path(args.work_dir)
    edl_path = work / "edl.json"
    edl = load_json(edl_path)
    words = load_json(work / "transcript.json")["words"]
    found = find(words, edl.get("segments", []))
    if args.only:
        want = {x.strip().lower() for x in args.only.split(",") if x.strip()}
        found = [f for f in found if f["name"].lower() in want]
    if not found:
        print("no words said out of habit in the cut")
        return 0
    for f in found:
        n = len(f["hits"])
        print(f"  {f['name']!r}: {'once' if n == 1 else f'{n} times'}")
    if not args.apply:
        print("cut them: editor habits <work> --apply (or --only basically,literally)")
        return 0
    from .fit import _duration
    speed = float(edl.get("speed", 1.0) or 1.0)
    before = _duration(edl.get("segments", []), speed)
    segs = cut(edl.get("segments", []), words, [h for f in found for h in f["hits"]])
    after = _duration(segs, speed)
    if not segs or after < 0.5:   # a take that is nothing but "you know, like": cutting it leaves no video
        raise EditorError("habits: cutting those would leave almost nothing of the video, so the EDL is unchanged: "
                          "use --only to pick the words to cut")
    edl["segments"] = segs
    save_json(edl_path, edl)
    log(f"habits: cut {sum(len(f['hits']) for f in found)} ({before - after:.1f} s) from {edl_path}: re-run from cut")
    return 0


def cmd_fit(args):
    """Fit to a length: list the lines that grip least until the cut fits (--apply cuts them)."""
    from .anchors import load_words
    from .fit import plan_fit
    work = Path(args.work_dir)
    edl_path = work / "edl.json"
    edl = load_json(edl_path)
    plan = plan_fit(edl, load_words(work), load_json(work / "transcript.json")["words"], args.under)
    if not plan["drop"]:
        print(f"it's {plan['now']:.1f} s: " + ("already under that" if plan["reached"] else
              "no line can go (the hook, the ending, list items and three lines stay): re-plan with a smaller --max-gap, "
              "or --speed 1.1, or pick a line to cut yourself"))
        return 0
    print(f"{plan['now']:.1f} s -> {plan['after']:.1f} s by cutting the {'lines that grip' if len(plan['drop']) > 1 else 'line that grips'} least:")
    for d in plan["drop"]:
        print(f"  {fmt_ts(d['start'])} ({d['seconds']:.1f} s, {d['ids']}) {d['text'][:80]!r}")
    if not plan["reached"]:
        print("  still over: hook, ending and three lines stay. A smaller --max-gap or --speed 1.1 can do the rest.")
    if args.apply:
        edl["segments"] = plan["segments"]
        save_json(edl_path, edl)
        log(f"fit: {edl_path} updated: re-run from cut; anything placed by seconds may need moving")
    else:
        print("cut them: editor fit <work> --under N --apply (it's an editorial call: offer it)")
    return 0


def cmd_triage(args):
    from .triage import triage
    triage(args.project)


def cmd_capture(args):
    from . import capture
    if args.capture_cmd == "web":
        capture.web(args.url, args.out, mobile=not args.desktop, full_page=args.full_page, video=args.video,
                    scroll=not args.no_scroll, dark=args.dark)
    elif args.capture_cmd == "shots":
        from . import shots
        report = shots.shots(args.shotlist, args.out, record=args.record, headed=args.headed, base=args.base)
        print(Path(args.out) / "shots.json")
        if report["failures"]:
            print(f"{report['failures']} step(s) failed: see the log above / shots.json")
    elif args.capture_cmd == "stills-from":
        from . import shots
        stills = shots.stills_from(args.video, args.out_dir, min_gap=args.min_gap, max_stills=args.max)
        print(f"{len(stills)} stills -> {args.out_dir} (stills_sheet.jpg)")
    elif args.capture_cmd == "sim":
        capture.sim(args.out, seconds=args.seconds, url=args.url, device=args.device, screenshot=args.screenshot)
    else:
        capture.android(args.out, seconds=args.seconds, screenshot=args.screenshot)


def cmd_viz(args):
    from .viz import render_viz
    render_viz(args.work_dir, args.out, title=args.title)


def _glossary(extra: list[str]) -> list[str]:
    path = ROOT / "library" / "glossary.txt"
    words = [ln.strip() for ln in path.read_text().splitlines() if ln.strip() and not ln.startswith("#")] \
        if path.exists() else []
    return words + list(extra)


def cmd_retext(args):
    from .retext import retext
    retext(args.work_dir, args.text)


def cmd_models(args):
    from .models import rnnoise_model, vosk_model
    if args.which == "rnnoise":
        print(rnnoise_model())
        return
    print(vosk_model("vosk-model-en-us-0.22-lgraph" if args.which == "vosk-large" else "vosk-model-small-en-us-0.15"))


def cmd_graphic(args):
    from .graphics import make
    from .render import PRESETS
    w, h = PRESETS[args.preset]["size"]
    kw = dict(w=w, h=h, fps=args.fps, dur=args.dur, accent=args.accent, y=args.y)
    if args.kind == "counter":
        kw.update(start=args.start, to=args.to, prefix=args.prefix, suffix=args.suffix, label=args.label)
    elif args.kind == "lower-third":
        kw.update(name=args.name, title=args.lt_title)
    elif args.kind == "checklist":
        if not args.items:
            raise EditorError("--items is required for a checklist")
        kw.update(items=args.items, title=args.lt_title, at=args.at)
    elif args.kind == "title":
        if not args.text:
            raise EditorError("--text is required for a title")
        kw.update(text=args.text, highlight=args.highlight)
    elif args.kind == "cta":
        kw.update(text=args.text, sub=args.sub)
    elif args.kind == "quote":
        kw.pop("y") if args.y is None else None
        kw.update(text=args.text, at=args.at, highlight=args.highlight, author=args.author)
    elif args.kind == "logo-pop":
        if not args.image:
            raise EditorError("--image is required for logo-pop")
        kw.pop("accent")
        kw.update(image=args.image, label=args.label or args.text)
    elif args.kind == "price-tag":
        if not args.value:
            raise EditorError("--value is required for price-tag")
        kw.update(value=args.value, old=args.old, label=args.label or args.text)
    elif args.kind == "typing":
        kw.pop("accent")
        kw.update(text=args.text, response=args.response, style="chat" if args.chat else "terminal")
    if args.kind in ("quote", "typing") and not args.text:
        raise EditorError(f"--text is required for {args.kind}")
    print(make(args.kind, args.out, **kw))


def cmd_inspect(args):
    from .review import inspect
    inspect(args.video, args.start, args.end, args.out, transcript=args.transcript, n_frames=args.n_frames)


def cmd_review(args):
    from .review import review
    return 0 if review(args.video, args.work_dir, args.out_dir)["passed"] else 2


def cmd_cover(args):
    from .cover import cover
    cover(args.video, args.out, title=args.title, at=args.at, highlight=args.highlight, work=args.work,
          preset=args.preset, near=args.candidates)


def cmd_style(args):
    from . import style
    c = args.style_cmd
    if c == "show":
        print(style.show(args.kind, args.brand))
    elif c == "note":
        e = style.note(args.text, kind=args.kind, brand=args.brand, sets=args.sets)
        print(f"noted [{e['scope']}] {e['text']}  ({e['id']})")
    elif c == "snapshot":
        style.snapshot(args.file)
    elif c == "learn":
        style.learn(args.file, brand=args.brand)
    elif c == "apply":
        style.apply(args.file, brand=args.brand)
    elif c == "check":
        style.check(args.file, brand=args.brand)
    elif c == "forget":
        print(f"removed {style.forget(args.target)}")
    elif c == "keys":
        for k, (t, d) in sorted(style.KEYS.items()):
            print(f"{k:<28} {t:<5} {d}")


AUTO_STYLE = {  # auto flag -> (style key, built-in default)
    "speed": ("reel.speed", 1.0), "max_gap": ("reel.max_gap", 0.30), "fillers": ("reel.fillers", "standard"),
    "style": ("reel.captions.style", "bold"), "position": ("reel.captions.position", "low"),
    "audio_preset": ("reel.audio_preset", "phone"), "music_db": ("reel.music.db", -20.0),
    "preset": ("reel.preset", "reels"), "grade": ("reel.grade", "natural"),
    "font": ("reel.captions.font", None),
}


def _resolve_style(args, work: Path) -> tuple[str | None, dict]:
    """Explicit flag > this project's EDL "settings" > learned style (brand > reel > global) > built-in default.
    Returns (brand, settings)."""
    from . import style
    edl = load_json(work / "edl.json") if (work / "edl.json").exists() else {}
    brand = args.brand or (edl.get("brand") if isinstance(edl.get("brand"), str) else None)
    profile = None if args.no_learned_style else style.load()
    project = edl.get("settings") or {}
    settings, used = {}, []
    for attr, (key, builtin) in AUTO_STYLE.items():
        val = getattr(args, attr)
        if val is None and key[len("reel."):] in project:
            val = project[key[len("reel."):]]
            setattr(args, attr, val)
        if val is None:
            learned = style.resolve(key, "reel", brand, profile) if profile else None
            if learned is not None:
                val = float(learned) if isinstance(builtin, float) else learned
                used.append(f"{key}={val}")
            else:
                val = builtin
            setattr(args, attr, val)
        if val is not None:
            settings[key[len("reel."):]] = val
    if used:
        log(f"style: using your learned defaults: {', '.join(used)}")
    return brand, settings


def _record_settings(work: Path, brand: str | None, settings: dict) -> None:
    p = work / "edl.json"
    if not p.exists():
        return
    edl = load_json(p)
    edl.setdefault("settings", {}).update(settings)
    if brand:
        edl["brand"] = brand
    save_json(p, edl)


def cmd_words(args):
    from .anchors import listing
    print(listing(args.work_dir, find_phrase=args.find, unsure=args.unsure))


def cmd_timeline(args):
    from .captions import _groups
    from .util import fmt_ts
    work = Path(args.work_dir)
    if getattr(args, "at", None):
        from .anchors import moment
        print("\n".join(moment(work, x) for x in args.at))
        return
    from .anchors import _edl_name
    meta = load_json(work / "cut_meta.json")
    words = load_json(work / "cut_words.json")["words"]
    numbered = "numbered as in edl.json" if all("edl" in sg for sg in meta["timeline"]) else \
        "numbered by cut piece: re-run cut to number them as in edl.json"
    print(f"# output duration {meta['duration']:.2f}s, {len(meta['timeline'])} segments ({numbered})")
    for seg in meta["timeline"]:
        print(f"## segment {_edl_name(seg)}  {fmt_ts(seg['start'])}-{fmt_ts(seg['end'])}  "
              f"(src {seg['src']} {fmt_ts(seg['src_start'])}-{fmt_ts(seg['src_end'])}, speed {seg['speed']})")
        seg_words = [w for w in words if w["segment"] == seg["index"]]
        for g in _groups(seg_words, 8, 60):
            print(f"  {fmt_ts(g[0]['start'])}-{fmt_ts(g[-1]['end'])}  {' '.join(w['text'] for w in g)}")


def cmd_compose(args):
    from .compose import run
    return run(args)


def cmd_lessons(args):
    from .lessons import main as lessons_main
    return lessons_main(args.lessons_args)


def cmd_inventory(args):
    from .inventory import main as inventory_main
    return inventory_main(args.inventory_args)


def cmd_safezone(args):
    from .safezone import main as safezone_main
    return safezone_main(args.safezone_args)


def cmd_produce(args):
    from .produce import main as produce_main
    return produce_main(args.produce_args)


def cmd_overlay(args):
    from .overlay import main as overlay_main
    return overlay_main(args.overlay_args)


def cmd_effort(args):
    from . import effort as eff
    if args.effort_cmd == "show":
        print(eff.table(args.length, args.stages, args.budget))
    elif args.effort_cmd == "record":
        r = eff.record(args.stage, args.effort, args.seconds, args.media)
        print(f"{args.stage} at {eff.normalise(args.effort)}: now {r:.1f} s per media minute on {eff.machine()}")
    else:
        data = eff.load().get("machines", {}).get(eff.machine(), {})
        if not data:
            print(f"nothing learned yet on {eff.machine()} (built-in guesses are used)")
        for k, v in sorted(data.items()):
            print(f"{k:<24} {v['rate']:>8.1f} s/min  ({v['runs']} runs, last {v.get('last', '?')})")


def cmd_auto(args):
    project = Path(args.project)
    raw, work, out_dir = project / "raw", project / "work", project / "out"
    work.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    stages = STAGES[STAGES.index(args.from_stage):STAGES.index(args.to_stage) + 1]
    given_db = args.music_db is not None
    brand, settings = _resolve_style(args, work)
    _record_settings(work, brand, settings)
    effort, prof, media = _resolve_effort(args, project, raw, work, brand, stages)
    if args.model is None:
        args.model = prof["model"]
    args.encode_speed = prof["encode"]
    if args.crf is None and prof["crf_delta"] and not args.draft:
        from .render import PRESETS as _P
        args.crf = _P[args.preset]["crf"] + prof["crf_delta"]
    args.music_db_given = given_db or args.music_db != AUTO_STYLE["music_db"][1]   # explicit or learned level wins
    out_file = out_dir / f"{project.name}_{args.preset}{'_draft' if args.draft else ''}.mp4"
    music = args.music
    if not music and (project / "music").exists():
        music = next((str(p) for p in sorted((project / "music").iterdir()) if p.is_file()), None)

    from .render import PRESETS
    from . import effort as eff
    import time as _time
    for stage in stages:
        t0 = _time.monotonic()
        if stage == "check" and args.draft:
            log("=== check === skipped for a draft (render without --draft to deliver)")
            continue
        log(f"=== {stage} ===")
        if stage == "transcribe":
            from .triage import a_roll
            triaged = a_roll(project)
            if triaged is not None:
                inputs = [str(p) for p in triaged]
                log(f"using {len(inputs)} a-roll clip(s) from work/triage.json")
            else:
                inputs = sorted(str(p) for p in raw.iterdir() if p.suffix.lower() in VIDEO_EXT) if raw.exists() else []
            if not inputs:
                raise EditorError(f"no a-roll video files in {raw}")
            from .transcribe import transcribe
            transcribe(inputs, work, model=args.model, language=args.language, engine=args.engine,
                       glossary=_glossary([]))
        elif stage == "plan":
            from .plan import plan
            plan(work / "transcript.json", work / "edl.json", max_gap=args.max_gap, fillers=args.fillers,
                 speed=args.speed)
            _record_settings(work, brand, settings)
            if not args.no_learned_style:   # EDL-level habits: punch-ins, sfx, progress bar
                from . import style
                edl = load_json(work / "edl.json")
                for key, field in (("reel.punch_in", "auto_punch_in"), ("reel.sfx", "sfx"),
                                   ("reel.progress_bar", "progress_bar")):
                    v = style.resolve(key, "reel", brand)
                    if v is not None and (field != "auto_punch_in" or args.punch_in is None):
                        edl[field] = v
                        log(f"style: {field} = {v} (learned)")
                save_json(work / "edl.json", edl)
            from .viz import render_viz
            render_viz(work)
        elif stage == "cut":
            from .cut import cut
            cut(work / "edl.json", work)
        elif stage == "audio":
            from .audio import master
            from .library import music_path
            from .anchors import resolve_work
            edl_music = resolve_work(load_json(work / "edl.json"), work).get("music") or {}
            track = args.music or edl_music.get("track") or music
            fill = None
            if not args.no_room_tone:
                from .audio import room_tone_fill
                fill = room_tone_fill(work)
            master(work / "cut.mkv", work / "voice.wav", preset=args.audio_preset, fill=fill,
                   music=str(music_path(track)) if track else None,
                   music_db=args.music_db if args.music else float(edl_music.get("db", args.music_db)),
                   music_start=edl_music.get("start", "auto"), automation=edl_music.get("automation"),
                   fade_out=float(edl_music.get("fade_out", 0.6)),
                   level=None if (args.music_db_given or "db" in edl_music) else edl_music.get("level", "under-voice"),
                   first_word=_first_word(work), bleeps=_bleeps(work))
        elif stage == "track":
            if args.fit == "crop":
                from .track import track
                try:
                    track(work / "cut.mkv", work / "track.json", sample_fps=prof["track_fps"])
                except EditorError as e:
                    log(f"track skipped, reframing will centre-crop: {e}")
        elif stage == "captions":
            if args.style != "none" and (work / "cut_words.json").exists():
                from .anchors import resolve_work
                from .captions import build
                edl = resolve_work(load_json(work / "edl.json"), work)
                w, h = PRESETS[args.preset]["size"]
                build(work / "cut_words.json", work / "captions.ass", width=w, height=h, style=args.style,
                      position=args.position, title=args.title or edl.get("title"),
                      emphasis=edl.get("emphasis", []), chapters=edl.get("chapters"),
                      duration=load_json(work / "cut_meta.json")["duration"], look=_caption_look(edl, args.font),
                      bleep=edl.get("bleep"))
        elif stage == "render":
            ns = argparse.Namespace(**vars(args), work_dir=str(work), out=str(out_file))
            ns.no_captions = args.style == "none"
            cmd_render(ns)
            from . import style
            snap = style._snap_path(work / "edl.json")
            if not snap.exists():          # the first render of a project is its first draft
                style.snapshot(work / "edl.json")
        elif stage == "check":
            from .qa import check, sheet, write_report
            qa_report = check(out_file, preset=args.preset)
            write_report(qa_report, out_dir / "qa.json")
            sheet(out_file, out_dir / "contact_sheet.png")
            safe_hits = None
            if PRESETS[args.preset]["size"][1] > PRESETS[args.preset]["size"][0] and (work / "captions.ass").exists():
                from .safezone import check as safe_check     # captions under Reels / TikTok / Shorts UI?
                try:
                    safe_hits = safe_check(out_file, work, sheets=False)["hits"]
                    for h in safe_hits:
                        log(f"safezone: {h['platform']} {h['from']:.1f}-{h['to']:.1f} s: captions under the {h['zone']} "
                            f"(editor safezone {out_file} for the sheet)")
                except EditorError as e:
                    log(f"safezone: not checked ({e})")
            _before_post(work, out_dir, qa_report, safe_hits, title=args.title)
            if prof["review"]:
                from .review import review
                review(out_file, work, out_dir / "review")
            else:
                log(f"effort {effort}: per-cut review skipped (run editor review, or --effort standard, when there's time)")
            if prof["cover"]:
                from .cover import cover
                edl = load_json(work / "edl.json")
                cover(out_file, out_dir / "cover.jpg", title=args.title or edl.get("title", ""),
                      highlight=edl.get("emphasis"), work=work, preset=args.preset)
        took = _time.monotonic() - t0
        from . import render as _render_mod
        from . import cut as _cut_mod, transcribe as _tr_mod
        if stage == "render" and _render_mod.LAST_REMUX:
            log("timings: render only swapped in new sound, not recorded")
        elif (stage == "transcribe" and _tr_mod.LAST_CACHED) or (stage == "cut" and _cut_mod.LAST_CACHED):
            log(f"timings: {stage} came from its cache, not recorded")
        elif not args.draft or stage not in ("render", "check"):
            seconds_of = media["source"] if stage in ("transcribe", "plan", "cut") else _output_seconds(work, media)
            try:
                eff.record(stage, effort, took, seconds_of)
            except EditorError as e:
                log(f"timings not recorded for {stage}: {e}")
        log(f"--- {stage}: {took:.1f} s")
    log(f"done: {', '.join(stages)} (effort {effort})" + (f" -> {out_file}" if "render" in stages else ""))


def _before_post(work: Path, out_dir: Path, qa_report: dict, safe_hits: list | None, title: str | None = None) -> dict:
    """Every check of a finished render in one block (and out/before_post.json): the file (qa), the edit (pacing:
    pace, first second, loop, names, strong language) and the app UI (safezone). What's flagged is to look at, not
    to fix blindly: strong language and cold opens are the user's call."""
    items = [{"what": f"file {r['check']}", "ok": r["ok"], "detail": r["detail"]} for r in qa_report.get("checks", [])
             if not r["ok"]]
    try:
        from .anchors import load_words, resolve_work
        from .review import pacing, punch_cuts
        meta = load_json(work / "cut_meta.json")
        edl = resolve_work(load_json(meta["edl"]), work)
        if title:                                      # auto --title sets the hook the captions draw
            edl["title"] = title
        for k, v in pacing(edl, load_words(work), meta["duration"], punch_cuts(edl, meta)).items():
            if v:
                items.append({"what": k.replace("4_5s", "4.5 s").replace("10s", "10 s").replace("_", " "), "ok": False, "detail": v})
    except EditorError as e:
        items.append({"what": "pacing", "ok": False, "detail": f"not checked: {e}"})
    post = out_dir / "post.txt"
    if post.exists():                                  # the post kit against each app's limits
        from .versions import post_fit
        for warn in post_fit(post.read_text()):
            items.append({"what": "post", "ok": False, "detail": warn})
    if safe_hits:
        items.append({"what": "captions under app UI", "ok": False,
                      "detail": "; ".join(f"{h['platform']} {h['from']:.1f}-{h['to']:.1f}s ({h['zone']})" for h in safe_hits[:4])})
    report = {"to_look_at": len(items), "items": items}
    save_json(out_dir / "before_post.json", report)
    log(f"before you post: {len(items) or 'nothing'} to look at" + (" (out/before_post.json)" if items else ""))
    for it in items:
        log(f"  !! {it['what']}: {it['detail']}")
    return report


def _output_seconds(work: Path, media: dict) -> float:
    meta = work / "cut_meta.json"
    return float(load_json(meta)["duration"]) if meta.exists() else media["source"] * 0.8


def _resolve_effort(args, project: Path, raw: Path, work: Path, brand: str | None, stages: list[str]):
    """Explicit --effort > --budget (best effort that fits) > learned reel.effort > standard."""
    from . import effort as eff
    from .util import probe
    source = 0.0
    if raw.exists():
        for f in sorted(raw.iterdir()):
            if f.suffix.lower() in VIDEO_EXT:
                try:
                    source += float(probe(f)["duration"])
                except (EditorError, KeyError, ValueError, TypeError):
                    pass
    media = {"source": source or 60.0}
    chosen = eff.normalise(args.effort)
    if chosen is None and args.budget:
        chosen, ests, fits = eff.choose(args.budget, media["source"], stages)
        msg = ", ".join(f"{e['effort']} ~{eff.fmt_secs(e['seconds'])}" for e in ests)
        log(f"effort: budget {args.budget:g} min -> {chosen} ({msg})")
        if not fits:
            log("effort: even rush is estimated over budget: deliver a --draft first, skip optional b-roll and "
                "graphics, and say what was dropped")
    if chosen is None and not args.no_learned_style:
        from . import style
        learned = style.resolve("reel.effort", "reel", brand)
        chosen = eff.normalise(learned) if learned else None
        if chosen:
            log(f"effort: {chosen} (learned)")
    chosen = chosen or "standard"
    est = eff.estimate(chosen, media["source"], stages)
    log(f"effort: {chosen}, about {eff.fmt_secs(est['seconds'])} for these stages "
        f"({'learned' if est['learned'] else 'guessed'}): {eff.PROFILE[chosen]['what']}")
    return chosen, eff.PROFILE[chosen], media


def _parse_broll(spec: str) -> dict:
    try:
        path, rest = spec.rsplit("@", 1)
        start, dur = rest.split(":")
        return {"path": path, "start": float(start), "dur": float(dur), "mode": "full"}
    except ValueError as e:
        raise EditorError(f"bad --broll '{spec}', expected PATH@START:DUR") from e


def _resolve_broll(b: dict, edl_path: Path) -> dict:
    from .library import broll_path

    def find(path: str) -> str:
        p = Path(path)
        for cand in (p, edl_path.parent / p, edl_path.parent.parent / p, broll_path(path)):
            if cand.exists():
                return str(cand)
        raise EditorError(f"b-roll not found: {path}")

    b = dict(b)
    if b.get("path"):
        b["path"] = find(b["path"])
    if b.get("items"):                       # walls: a list of pictures
        b["items"] = [find(i) for i in b["items"]]
        b.setdefault("path", b["items"][0])
    if not b.get("path") and b.get("treatment") != "text-pop":
        raise EditorError(f"b-roll entry needs a path: {b}")
    return b


COMMANDS = {name[4:]: fn for name, fn in globals().items() if name.startswith("cmd_")}

if __name__ == "__main__":
    sys.exit(main())
