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
    p.add_argument("--preset", choices=["clean", "phone", "noisy"], default="phone")
    p.add_argument("--lufs", type=float, default=-14.0)
    p.add_argument("--music")
    p.add_argument("--music-db", type=float, default=-20.0)
    p.add_argument("--no-duck", action="store_true")
    p.add_argument("--rnnoise-model", help="path to an RNNoise .rnnn model for arnndn")

    p = sub.add_parser("track", help="face tracking for smart reframing")
    p.add_argument("input")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--yunet-model", help="optional face_detection_yunet .onnx for better detection")

    p = sub.add_parser("captions", help="word-synced animated captions (.ass + .srt)")
    p.add_argument("words")
    p.add_argument("-o", "--out", required=True)
    p.add_argument("--preset", default="reels", help="output preset (sets caption canvas size)")
    p.add_argument("--style", choices=["bold", "beast", "clean", "minimal"], default="bold")
    p.add_argument("--position", choices=["low", "middle", "high"], default="low")
    p.add_argument("--title", help="hook text shown at the top for the first seconds")
    p.add_argument("--title-dur", type=float, default=3.0)
    p.add_argument("--emphasis", nargs="*", default=[], help="words to colour as emphasis")

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

    p = sub.add_parser("timeline", help="print the cut's words on the OUTPUT timeline (for placing zooms/b-roll)")
    p.add_argument("work_dir")

    p = sub.add_parser("auto", help="run the whole pipeline on a project folder")
    p.add_argument("project", help="projects/<name> (clips in raw/, played in filename order)")
    p.add_argument("--from", dest="from_stage", choices=STAGES, default="transcribe")
    p.add_argument("--to", dest="to_stage", choices=STAGES, default="check")
    p.add_argument("--model", default="small")
    p.add_argument("--language")
    p.add_argument("--fillers", choices=["none", "standard", "aggressive"], default="standard")
    p.add_argument("--max-gap", type=float, default=0.30)
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--audio-preset", choices=["clean", "phone", "noisy"], default="phone")
    p.add_argument("--music", help="music file (default: first file in <project>/music/ if any)")
    p.add_argument("--music-db", type=float, default=-20.0)
    p.add_argument("--style", choices=["bold", "beast", "clean", "minimal", "none"], default="bold")
    p.add_argument("--position", choices=["low", "middle", "high"], default="low")
    p.add_argument("--title")
    _render_args(p)

    args = ap.parse_args(argv)
    try:
        return COMMANDS[args.cmd](args) or 0
    except EditorError as e:
        log(f"ERROR: {e}")
        return 1


def _render_args(p):
    p.add_argument("--preset", default="reels", help="reels|tiktok|shorts|feed|square|youtube|youtube4k")
    p.add_argument("--audio", help="mastered audio (default: work/voice.wav if present)")
    p.add_argument("--captions", help="captions .ass (default: work/captions.ass if present)")
    p.add_argument("--no-captions", action="store_true")
    p.add_argument("--track", help="track.json (default: work/track.json if present)")
    p.add_argument("--grade", choices=["none", "natural", "punchy", "warm", "cinematic", "bw"], default="natural")
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
    for mod in ("faster_whisper", "cv2", "numpy"):
        try:
            __import__(mod)
            print(f"ok  python {mod}")
        except ImportError:
            print(f"MISSING python {mod}  (pip install -r requirements.txt)")
            ok = False
    from .captions import STYLES, resolve_font
    print(f"ok  caption font (bold): {resolve_font(STYLES['bold']['fonts'])}")
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
    transcribe(args.inputs, args.out_dir, model=args.model, language=args.language)


def cmd_plan(args):
    from .plan import plan
    plan(args.transcript, args.out, max_gap=args.max_gap, pad_before=args.pad_before, pad_after=args.pad_after,
         fillers=args.fillers, retakes=not args.no_retakes, speed=args.speed)


def cmd_cut(args):
    from .cut import cut
    cut(args.edl, args.out_dir or Path(args.edl).parent, transcript=args.transcript)


def cmd_audio(args):
    from .audio import master
    master(args.input, args.out, preset=args.preset, target_lufs=args.lufs, music=args.music,
           music_db=args.music_db, duck=not args.no_duck, rnnoise_model=args.rnnoise_model)


def cmd_track(args):
    from .track import track
    track(args.input, args.out, yunet_model=args.yunet_model)


def cmd_captions(args):
    from .captions import build
    from .render import PRESETS
    w, h = PRESETS[args.preset]["size"]
    build(args.words, args.out, width=w, height=h, style=args.style, position=args.position, title=args.title,
          title_dur=args.title_dur, emphasis=args.emphasis)


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
           sharpen=args.sharpen, fit=args.fit, broll=broll, crf=args.crf)


def cmd_check(args):
    from .qa import check
    return 0 if check(args.input, preset=args.preset, target_lufs=args.lufs)["passed"] else 2


def cmd_sheet(args):
    from .qa import sheet
    sheet(args.input, args.out, count=args.count)


def cmd_frames(args):
    from .qa import frames
    frames(args.input, args.out_dir, args.at)


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
    out_file = out_dir / f"{project.name}_{args.preset}.mp4"
    music = args.music
    if not music and (project / "music").exists():
        music = next((str(p) for p in sorted((project / "music").iterdir()) if p.is_file()), None)

    from .render import PRESETS
    for stage in stages:
        log(f"=== {stage} ===")
        if stage == "transcribe":
            inputs = sorted(str(p) for p in raw.iterdir() if p.suffix.lower() in VIDEO_EXT) if raw.exists() else []
            if not inputs:
                raise EditorError(f"no video files in {raw}")
            from .transcribe import transcribe
            transcribe(inputs, work, model=args.model, language=args.language)
        elif stage == "plan":
            from .plan import plan
            plan(work / "transcript.json", work / "edl.json", max_gap=args.max_gap, fillers=args.fillers,
                 speed=args.speed)
        elif stage == "cut":
            from .cut import cut
            cut(work / "edl.json", work)
        elif stage == "audio":
            from .audio import master
            master(work / "cut.mkv", work / "voice.wav", preset=args.audio_preset, music=music,
                   music_db=args.music_db)
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
                      emphasis=edl.get("emphasis", []))
        elif stage == "render":
            ns = argparse.Namespace(**vars(args), work_dir=str(work), out=str(out_file))
            ns.no_captions = args.style == "none"
            cmd_render(ns)
        elif stage == "check":
            from .qa import check, sheet, write_report
            write_report(check(out_file, preset=args.preset), out_dir / "qa.json")
            sheet(out_file, out_dir / "contact_sheet.png")
    log(f"done: {', '.join(stages)}" + (f" -> {out_file}" if "render" in stages else ""))


def _parse_broll(spec: str) -> dict:
    try:
        path, rest = spec.rsplit("@", 1)
        start, dur = rest.split(":")
        return {"path": path, "start": float(start), "dur": float(dur), "mode": "full"}
    except ValueError as e:
        raise EditorError(f"bad --broll '{spec}', expected PATH@START:DUR") from e


def _resolve_broll(b: dict, edl_path: Path) -> dict:
    b = dict(b)
    p = Path(b["path"])
    for cand in (p, edl_path.parent / p, edl_path.parent.parent / p):
        if cand.exists():
            b["path"] = str(cand)
            return b
    raise EditorError(f"b-roll not found: {b['path']}")


COMMANDS = {name[4:]: fn for name, fn in globals().items() if name.startswith("cmd_")}

if __name__ == "__main__":
    sys.exit(main())
