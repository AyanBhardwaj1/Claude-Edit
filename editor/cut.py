"""Render an EDL to a frame-accurate intermediate (cut.mkv) and remap word timings.

Each segment is encoded on its own (in parallel, cached by content hash) and the
pieces are joined with the concat demuxer, so memory stays flat for long edits and
re-cutting after a small EDL change only re-encodes the segments that changed.
Outputs:
  cut.mkv        near-lossless H.264 + PCM, constant frame rate, SDR bt709
  cut_words.json transcript words on the cut timeline (feeds captions)
  cut_meta.json  fps, size and cut boundaries (feeds reframing / punch-ins)
"""
from __future__ import annotations

import hashlib
import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .util import EditorError, load_json, log, normalize_fps, probe, run, save_json

TONEMAP = ("zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,"
           "zscale=t=bt709:m=bt709:r=tv,format=yuv420p")
FADE = 0.03  # 30 ms audio fade at every cut: no pops (video-use hard rule), no audible dip



LAST_CACHED = False

def cut(edl_path: str | Path, out_dir: str | Path, transcript: str | Path | None = None) -> Path:
    edl_path = Path(edl_path)
    out_dir = Path(out_dir)
    edl = load_json(edl_path)
    segments = edl["segments"]
    if not segments:
        raise EditorError("EDL has no segments")
    for k, seg in enumerate(segments):     # checked before merging: a backwards piece must not hide in a merge
        if seg["end"] - seg["start"] <= 0:
            raise EditorError(f"EDL segment {k} has non-positive duration: {seg}")
    sources = [probe(s["path"]) for s in edl["sources"]]
    for s, info in zip(edl["sources"], sources):   # front-camera selfies: "mirror": true flips the picture back
        info["mirror"] = bool(s.get("mirror", edl.get("mirror", False)))
    for s in sources:
        if not s["has_video"]:
            raise EditorError(f"{s['path']} has no video stream")
    v0 = sources[0]["video"]
    fps = normalize_fps(v0["fps"])
    width, height = v0["width"] - v0["width"] % 2, v0["height"] - v0["height"] % 2
    global_speed = float(edl.get("speed", 1.0))

    # pieces of one take that touch (end == next start) play as one: cut apart they'd get a fade at the seam (a dip in
    # the voice), a punch-in change and a transition, a hard cut where nothing was cut. The plan's "meet in the
    # middle" and the takes / habits / fit / coldopen rewrites all write such pairs.
    # Each merged piece remembers the EDL segments it came from ("edl"), so `editor timeline` and `--at` still name
    # the EDL entry to change.
    merged: list[dict] = []
    edl_of: list[list[int]] = []
    for k, seg in enumerate(segments):
        last = merged[-1] if merged else None
        if (last and last["src"] == seg["src"] and abs(last["end"] - seg["start"]) < 1e-3
                and float(last.get("speed", global_speed)) == float(seg.get("speed", global_speed))):
            merged[-1] = {**last, "end": seg["end"]}
            edl_of[-1].append(k)
        else:
            merged.append(dict(seg))
            edl_of.append([k])
    segments = merged

    seg_dir = out_dir / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)
    jobs, timeline, t = [], [], 0.0
    for k, seg in enumerate(segments):
        speed = float(seg.get("speed", global_speed))
        dur = seg["end"] - seg["start"]
        if dur <= 0:
            raise EditorError(f"segment {k} has non-positive duration: {seg}")
        frames = max(1, round(dur / speed * float(fps)))
        out_dur = frames / float(fps)
        src = sources[seg["src"]]
        key = json.dumps([src["path"], os.path.getmtime(src["path"]), seg["start"], seg["end"], speed,
                          str(fps), width, height, src["mirror"]], sort_keys=True)
        seg_file = seg_dir / f"seg_{hashlib.sha1(key.encode()).hexdigest()[:16]}.mkv"
        jobs.append((src, seg, speed, frames, out_dur, seg_file))
        timeline.append({"index": k, "edl": edl_of[k], "src": seg["src"], "src_start": seg["start"], "src_end": seg["end"],
                         "speed": speed, "start": round(t, 4), "end": round(t + out_dur, 4)})
        t += out_dur

    # one encode per distinct file: a range used twice (a cold open repeating a line) shares its cache file, and two
    # jobs writing it at once collided on the temp file
    todo = list({j[-1]: j for j in jobs if not j[-1].exists()}.values())
    global LAST_CACHED
    LAST_CACHED = not todo              # every segment reused: this run says nothing about how fast cutting is
    log(f"cut: {len(jobs)} segments ({len(jobs) - len(todo)} cached), {t:.2f}s at {fps} fps, {width}x{height}")
    workers = max(1, (os.cpu_count() or 2) // 2)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for f in [pool.submit(_encode_segment, *j, fps=fps, width=width, height=height) for j in todo]:
            f.result()

    list_file = out_dir / "concat.txt"
    list_file.write_text("".join(f"file '{j[-1].resolve()}'\n" for j in jobs))
    cut_path = out_dir / "cut.mkv"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c", "copy", cut_path])

    save_json(out_dir / "cut_meta.json", {"fps": float(fps), "fps_str": f"{fps.numerator}/{fps.denominator}",
                                          "width": width, "height": height, "duration": round(t, 4),
                                          "timeline": timeline, "edl": str(edl_path.resolve())})
    transcript = Path(transcript) if transcript else edl_path.parent / "transcript.json"
    if transcript.exists():
        _remap_words(load_json(transcript), timeline, edl, out_dir / "cut_words.json")
    else:
        log(f"no transcript at {transcript}; skipping cut_words.json (captions need it)")
    log(f"wrote {cut_path}")
    return cut_path


def _encode_segment(src, seg, speed, frames, out_dur, seg_file, *, fps, width, height):
    v = src["video"]
    vf = [TONEMAP] if v.get("hdr") else []
    if src.get("mirror"):
        vf.append("hflip")
    vf += [f"scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos",
           f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2", "setsar=1",
           f"setpts=(PTS-STARTPTS)/{speed}", f"fps={fps.numerator}/{fps.denominator}",
           "tpad=stop_mode=clone:stop_duration=1", "format=yuv420p"]
    af = ["aresample=48000", "aformat=sample_fmts=fltp:channel_layouts=stereo"]
    af += _atempo(speed)
    af += ["apad", f"atrim=0:{out_dur:.6f}", f"afade=t=in:d={FADE}",
           f"afade=t=out:st={max(out_dur - FADE, 0):.6f}:d={FADE}"]
    dur = seg["end"] - seg["start"]
    cmd = ["ffmpeg", "-y", "-ss", f"{seg['start']:.4f}", "-t", f"{dur:.4f}", "-i", src["path"]]
    if src["has_audio"]:
        audio_in = "0:a:0"
    else:
        cmd += ["-f", "lavfi", "-t", f"{out_dur:.4f}", "-i", "anullsrc=r=48000:cl=stereo"]
        audio_in = "1:a"
    fc = f"[0:v:0]{','.join(vf)}[v];[{audio_in}]{','.join(af)}[a]"
    tmp = seg_file.with_suffix(".tmp.mkv")
    cmd += ["-filter_complex", fc, "-map", "[v]", "-map", "[a]", "-frames:v", str(frames),
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-c:a", "pcm_s16le", tmp]
    run(cmd)
    tmp.rename(seg_file)


def _atempo(speed: float) -> list[str]:
    if abs(speed - 1.0) < 1e-6:
        return []
    chain, s = [], speed
    while s > 2.0:
        chain.append("atempo=2.0")
        s /= 2.0
    while s < 0.5:
        chain.append("atempo=0.5")
        s /= 0.5
    chain.append(f"atempo={s:.6f}")
    return chain


def _remap_words(tr: dict, timeline: list[dict], edl: dict, out: Path) -> None:
    emphasis = {w.lower() for w in edl.get("emphasis", [])}
    words = []
    for seg in timeline:
        for i, w in enumerate(tr["words"]):
            if w["src"] != seg["src"]:
                continue
            mid = (w["start"] + w["end"]) / 2
            if not (seg["src_start"] <= mid <= seg["src_end"]):
                continue
            s = seg["start"] + (max(w["start"], seg["src_start"]) - seg["src_start"]) / seg["speed"]
            e = seg["start"] + (min(w["end"], seg["src_end"]) - seg["src_start"]) / seg["speed"]
            bare = "".join(ch for ch in w["text"].lower() if ch.isalnum() or ch == "'")
            words.append({"id": f"w{i}", "start": round(s, 3), "end": round(min(e, seg["end"]), 3),
                          "text": w["text"], "segment": seg["index"], "emph": bare in emphasis,
                          "prob": w.get("prob", 1.0)})
    save_json(out, {"words": words})
    log(f"wrote {out} ({len(words)} words)")
