"""Build a synthetic project for testing the pipeline without a Whisper model.

Creates <project>/raw/clip.mp4 (landscape test pattern + flite TTS speech with
long pauses, an "um", and a false-start retake) and <project>/work/transcript.json
with word timings derived from the generated speech, so every stage after
`transcribe` can run: python3 -m editor auto <project> --from plan
"""
from __future__ import annotations

import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from editor.transcribe import write_transcript  # noqa: E402
from editor.util import probe, run  # noqa: E402

SCRIPT = [  # (text, pause after in seconds)
    ("Here are three tools that will change how you edit videos.", 1.2),
    ("um", 0.5),
    ("The first one is", 0.7),                                   # false start
    ("The first one is Claude Code, and it edits for you.", 0.9),
    ("Number two is a free captioning tool.", 0.25),
    ("And number three makes your audio sound professional.", 1.0),
]


def make(project: Path, width: int = 1920, height: int = 1080, fps: str = "30000/1001", face: bool = False) -> Path:
    raw, work = project / "raw", project / "work"
    raw.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    pieces, words, phrases, t = [], [], [], 0.25
    lead = tmp / "lead.wav"
    run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "0.25", lead])
    pieces.append(lead)
    for i, (text, pause) in enumerate(SCRIPT):
        speech = tmp / f"p{i}.wav"
        safe = text.replace(",", "\\,").replace("'", "")
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"flite=text='{safe}':voice=slt", "-af",
             "silenceremove=start_periods=1:start_threshold=-50dB,areverse,"
             "silenceremove=start_periods=1:start_threshold=-50dB,areverse,aresample=48000", speech])
        dur = probe(speech)["duration"]
        tokens = text.split()
        weights = [len(w) + 2 for w in tokens]
        total, acc, phrase_words = sum(weights), 0.0, []
        for tok, wgt in zip(tokens, weights):
            s = t + dur * acc / total
            acc += wgt
            e = t + dur * acc / total
            w = {"src": 0, "start": round(s, 3), "end": round(e - 0.02, 3), "text": tok, "prob": 0.99}
            words.append(w)
            phrase_words.append(w)
        phrases.append({"src": 0, "start": phrase_words[0]["start"], "end": phrase_words[-1]["end"], "text": text})
        gap = tmp / f"g{i}.wav"
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", str(pause), gap])
        pieces += [speech, gap]
        t += dur + pause
    concat = tmp / "list.txt"
    concat.write_text("".join(f"file '{p}'\n" for p in pieces))
    voice = tmp / "voice.wav"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-af",
         "volume=-6dB,aresample=48000", "-c:a", "pcm_s16le", voice])
    # add a little room noise so the denoiser has something to do
    clip = raw / "clip.mp4"
    video_in = ["-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate={fps}"]
    vgraph = "[0:v]null[v]"
    if face:
        # a real face photo drifting across the wide frame, so 9:16 reframing has to follow it
        import cv2
        from skimage.data import astronaut
        img = tmp / "face.png"
        cv2.imwrite(str(img), cv2.cvtColor(astronaut(), cv2.COLOR_RGB2BGR))
        video_in += ["-loop", "1", "-i", str(img)]
        vgraph = (f"[3:v]scale=600:600,format=yuv420p[f];"
                  f"[0:v][f]overlay=x='100+(W-800)*t/{t:.2f}':y=(H-h)/2:shortest=1[v]")
    run(["ffmpeg", "-y", *video_in[:4], "-i", voice,
         "-f", "lavfi", "-i", "anoisesrc=color=pink:amplitude=0.004:r=48000", *video_in[4:],
         "-filter_complex", f"[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a];{vgraph}",
         "-map", "[v]", "-map", "[a]", "-t", f"{t:.3f}", "-shortest", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18",
         "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", clip])
    duration = probe(clip)["duration"]
    write_transcript(work, [{"path": str(clip.resolve()), "duration": duration, "language": "en"}], words, phrases)
    return clip


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    print(make(Path(args[0] if args else "projects/demo"), face="--face" in sys.argv))
