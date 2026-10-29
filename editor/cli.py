"""Command-line entry point: `python3 -m editor <command> ...`  (run `--help` on any command)."""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

from .util import EditorError, load_json, log, save_json

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
    p.add_argument("--style", choices=["bold", "beast", "clean", "white", "minimal"], default="bold")
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

    p = sub.add_parser("triage", help="classify raw/ clips: a-roll (founder-to-camera) vs reusable / one-off b-roll")
    p.add_argument("project")

    p = sub.add_parser("capture", help="make b-roll: web page screenshots/scrolls, iPhone Simulator, Android")
    csub = p.add_subparsers(dest="capture_cmd", required=True)
    q = csub.add_parser("web", help="Playwright screenshot or scroll recording of a URL")
    q.add_argument("url")
    q.add_argument("-o", "--out", required=True)
    q.add_argument("--desktop", action="store_true", help="desktop viewport instead of iPhone")
    q.add_argument("--full-page", action="store_true")
    q.add_argument("--video", type=float, default=0.0, help="record N seconds (smooth scroll) instead of a screenshot")
    q.add_argument("--no-scroll", action="store_true")
    q.add_argument("--dark", action="store_true")
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
    p.add_argument("kind", choices=["counter", "lower-third", "checklist", "title", "cta"])
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
    p.add_argument("--at", type=float, nargs="*", help="checklist item times")

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

    p = sub.add_parser("timeline", help="print the cut's words on the OUTPUT timeline (for placing zooms/b-roll)")
    p.add_argument("work_dir")

    p = sub.add_parser("auto", help="run the whole pipeline on a project folder")
    p.add_argument("project", help="projects/<name> (clips in raw/, played in filename order)")
    p.add_argument("--from", dest="from_stage", choices=STAGES, default="transcribe")
    p.add_argument("--to", dest="to_stage", choices=STAGES, default="check")
    p.add_argument("--model", default="small")
    p.add_argument("--language")
    p.add_argument("--engine", choices=["auto", "whisperx", "faster-whisper", "scribe", "vosk"], default="auto",
                   help="auto tries whisperx, faster-whisper, scribe (ELEVENLABS_API_KEY), vosk (offline)")
    # flags left unset fall back to the learned style (editor style show --kind reel), then built-in defaults
    p.add_argument("--fillers", choices=["none", "standard", "aggressive"])
    p.add_argument("--max-gap", type=float)
    p.add_argument("--speed", type=float)
    p.add_argument("--audio-preset", choices=["clean", "phone", "noisy", "studio", "podcast"])
    p.add_argument("--no-room-tone", action="store_true", help="don't lay room tone under the cuts")
    p.add_argument("--font", help="caption font by name (editor fonts list)")
    p.add_argument("--music", help="music file or library id (default: EDL \"music\", else <project>/music/)")
    p.add_argument("--music-db", type=float)
    p.add_argument("--style", choices=["bold", "beast", "clean", "white", "minimal", "none"])
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
    print(f"{'ok ' if node else 'optional'} node (HyperFrames / Remotion graphics)")
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
    meta = load_json(work / "cut_meta.json") if (work / "cut_meta.json").exists() else {}
    build(args.words, args.out, width=w, height=h, style=args.style, position=args.position,
          title=args.title or edl.get("title"), title_dur=args.title_dur,
          emphasis=args.emphasis or edl.get("emphasis", []), chapters=edl.get("chapters"),
          duration=meta.get("duration"), look=_caption_look(edl, args.font))


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
    broll = [_resolve_broll(b, edl_path) for b in edl.get("broll", [])]
    broll += [_parse_broll(s) for s in args.broll]

    def default(value, name):
        if value:
            return value
        return str(work / name) if (work / name).exists() else None

    captions = None if args.no_captions else default(args.captions, "captions.ass")
    render(work, args.out, preset=args.preset, audio=default(args.audio, "voice.wav"), captions=captions,
           track=default(args.track, "track.json"), punch_in=args.punch_in, grade=args.grade, lut=args.lut,
           sharpen=args.sharpen, fit=args.fit, broll=broll, crf=args.crf, auto_color=args.auto_color,
           sfx=not args.no_sfx)


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


def cmd_triage(args):
    from .triage import triage
    triage(args.project)


def cmd_capture(args):
    from . import capture
    if args.capture_cmd == "web":
        capture.web(args.url, args.out, mobile=not args.desktop, full_page=args.full_page, video=args.video,
                    scroll=not args.no_scroll, dark=args.dark)
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
          preset=args.preset)


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


def cmd_timeline(args):
    from .captions import _groups
    from .util import fmt_ts
    work = Path(args.work_dir)
    meta = load_json(work / "cut_meta.json")
    words = load_json(work / "cut_words.json")["words"]
    print(f"# output duration {meta['duration']:.2f}s, {len(meta['timeline'])} segments")
    for seg in meta["timeline"]:
        print(f"## segment {seg['index']}  {fmt_ts(seg['start'])}-{fmt_ts(seg['end'])}  "
              f"(src {seg['src']} {fmt_ts(seg['src_start'])}-{fmt_ts(seg['src_end'])}, speed {seg['speed']})")
        seg_words = [w for w in words if w["segment"] == seg["index"]]
        for g in _groups(seg_words, 8, 60):
            print(f"  {fmt_ts(g[0]['start'])}-{fmt_ts(g[-1]['end'])}  {' '.join(w['text'] for w in g)}")


def cmd_auto(args):
    project = Path(args.project)
    raw, work, out_dir = project / "raw", project / "work", project / "out"
    work.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    stages = STAGES[STAGES.index(args.from_stage):STAGES.index(args.to_stage) + 1]
    brand, settings = _resolve_style(args, work)
    _record_settings(work, brand, settings)
    out_file = out_dir / f"{project.name}_{args.preset}.mp4"
    music = args.music
    if not music and (project / "music").exists():
        music = next((str(p) for p in sorted((project / "music").iterdir()) if p.is_file()), None)

    from .render import PRESETS
    for stage in stages:
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
            edl_music = load_json(work / "edl.json").get("music") or {}
            track = args.music or edl_music.get("track") or music
            fill = None
            if not args.no_room_tone:
                from .audio import room_tone_fill
                fill = room_tone_fill(work)
            master(work / "cut.mkv", work / "voice.wav", preset=args.audio_preset, fill=fill,
                   music=str(music_path(track)) if track else None,
                   music_db=args.music_db if args.music else float(edl_music.get("db", args.music_db)),
                   music_start=float(edl_music.get("start", 0.0)))
        elif stage == "track":
            if args.fit == "crop":
                from .track import track
                try:
                    track(work / "cut.mkv", work / "track.json")
                except EditorError as e:
                    log(f"track skipped, reframing will centre-crop: {e}")
        elif stage == "captions":
            if args.style != "none" and (work / "cut_words.json").exists():
                from .captions import build
                edl = load_json(work / "edl.json")
                w, h = PRESETS[args.preset]["size"]
                build(work / "cut_words.json", work / "captions.ass", width=w, height=h, style=args.style,
                      position=args.position, title=args.title or edl.get("title"),
                      emphasis=edl.get("emphasis", []), chapters=edl.get("chapters"),
                      duration=load_json(work / "cut_meta.json")["duration"], look=_caption_look(edl, args.font))
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
            write_report(check(out_file, preset=args.preset), out_dir / "qa.json")
            sheet(out_file, out_dir / "contact_sheet.png")
            from .review import review
            review(out_file, work, out_dir / "review")
            from .cover import cover
            edl = load_json(work / "edl.json")
            cover(out_file, out_dir / "cover.jpg", title=args.title or edl.get("title", ""),
                  highlight=edl.get("emphasis"), work=work, preset=args.preset)
    log(f"done: {', '.join(stages)}" + (f" -> {out_file}" if "render" in stages else ""))


def _parse_broll(spec: str) -> dict:
    try:
        path, rest = spec.rsplit("@", 1)
        start, dur = rest.split(":")
        return {"path": path, "start": float(start), "dur": float(dur), "mode": "full"}
    except ValueError as e:
        raise EditorError(f"bad --broll '{spec}', expected PATH@START:DUR") from e


def _resolve_broll(b: dict, edl_path: Path) -> dict:
    from .library import broll_path
    b = dict(b)
    p = Path(b["path"])
    for cand in (p, edl_path.parent / p, edl_path.parent.parent / p, broll_path(b["path"])):
        if cand.exists():
            b["path"] = str(cand)
            return b
    raise EditorError(f"b-roll not found: {b['path']}")


COMMANDS = {name[4:]: fn for name, fn in globals().items() if name.startswith("cmd_")}

if __name__ == "__main__":
    sys.exit(main())
