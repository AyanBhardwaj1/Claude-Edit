"""Make Cutmind's sample project (public/demo/): a drawn presenter reading a take with a computer voice, retakes and
fumbles included, so anyone can try the editor before filming. Nothing here is a real person or a real recording.

  python3 scripts/make_demo.py [out_dir]          # needs ffmpeg, flite (voice slt), Pillow, numpy; vosk optional

Writes take.mp4 (1080x1920, H.264 + AAC), loop.m4a (a music bed made here), card.png (a drawn picture), cover-art.png
and demo.json: word timings, face positions and the first edit (word-anchored, the same shape the AI editor returns).
"""
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
import tempfile
import wave
from difflib import SequenceMatcher
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "public" / "demo")
W, H, FPS, RATE = 1080, 1920, 30, 48000

SCRIPT = [  # (line, pause after)
    ("Okay so.", 0.8),
    ("Um, the one habit that doubled my posting is.", 0.7),
    ("Wait, let me try that again.", 1.1),
    ("The one habit that doubled my posting is batching.", 0.6),
    ("I film four videos every Sunday morning.", 0.55),
    ("Step one, I write every hook on a single page.", 0.6),
    ("Step two, I set up the camera once and I I never move it.", 0.6),
    ("Step three, I film each video twice and keep the better take.", 0.7),
    ("Then I drop the raw files in here, and the edit is done before lunch.", 0.6),
    ("Try it on your next video.", 0.9),
]


def sh(*cmd: str | Path) -> None:
    subprocess.run([str(c) for c in cmd], check=True, capture_output=True)


def read_wav(p: Path) -> np.ndarray:
    with wave.open(str(p)) as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        return x if w.getnchannels() == 1 else x.reshape(-1, w.getnchannels()).mean(1)


def bare(t: str) -> str:
    return re.sub(r"[^a-z0-9']", "", t.lower())


def vosk_words(wav16: Path):
    try:
        from vosk import KaldiRecognizer, Model, SetLogLevel
    except ImportError:
        return None
    models = sorted((Path(__file__).resolve().parents[2] / "library" / "models").glob("vosk-model*"))
    if not models:
        return None
    SetLogLevel(-1)
    rec = KaldiRecognizer(Model(str(models[0])), 16000)
    rec.SetWords(True)
    with wave.open(str(wav16)) as w:
        while True:
            d = w.readframes(4000)
            if not d:
                break
            rec.AcceptWaveform(d)
    return json.loads(rec.FinalResult()).get("result", [])


def time_words(tokens: list[str], dur: float, heard) -> list[tuple[float, float]]:
    """Each script word's start/end in a line: Vosk's timing where it heard the word, letter-weighted guesses between."""
    weights = [len(t) + 2 for t in tokens]
    total, acc, guess = sum(weights), 0.0, []
    for wgt in weights:
        guess.append([dur * acc / total, dur * (acc + wgt) / total - 0.02]); acc += wgt
    if heard:
        a, b = [bare(t) for t in tokens], [bare(h["word"]) for h in heard]
        for blk in SequenceMatcher(a=a, b=b, autojunk=False).get_matching_blocks():
            for k in range(blk.size):
                guess[blk.a + k] = [heard[blk.b + k]["start"], heard[blk.b + k]["end"]]
        for i in range(1, len(guess)):                       # keep them in order and non-overlapping
            guess[i][0] = max(guess[i][0], guess[i - 1][1] + 0.01)
            guess[i][1] = max(guess[i][1], guess[i][0] + 0.08)
    return [(max(0.0, s), min(dur, e)) for s, e in guess]


def voice(tmp: Path):
    words, lines, pieces, t = [], [], [], 0.35
    lead = tmp / "lead.wav"
    sh("ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono", "-t", "0.35", lead)
    pieces.append(lead)
    for i, (text, pause) in enumerate(SCRIPT):
        speech = tmp / f"p{i}.wav"
        safe = text.replace(",", "\\,").replace("'", "")
        sh("ffmpeg", "-y", "-f", "lavfi", "-i", f"flite=text='{safe}':voice=slt", "-af",
           "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,"
           f"areverse,atempo=0.94,aresample={RATE}", "-ac", "1", speech)
        x16 = tmp / f"p{i}_16k.wav"
        sh("ffmpeg", "-y", "-i", speech, "-ar", "16000", "-ac", "1", x16)
        dur = len(read_wav(speech)) / RATE
        tokens = text.split()
        for tok, (s, e) in zip(tokens, time_words(tokens, dur, vosk_words(x16))):
            words.append({"w": tok, "s": round(t + s, 3), "e": round(t + e, 3)})
        lines.append((t, t + dur))
        gap = tmp / f"g{i}.wav"
        sh("ffmpeg", "-y", "-f", "lavfi", "-i", f"anullsrc=r={RATE}:cl=mono", "-t", str(pause), gap)
        pieces += [speech, gap]
        t += dur + pause
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in pieces))
    out = tmp / "voice.wav"
    sh("ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", lst, "-af", "highpass=f=90,lowpass=f=7000", "-c:a", "pcm_s16le", out)
    return out, words, t


# ---------------------------------------------------------------- the presenter (flat drawing, no real person)

WALL, SHELF, BOOK = (47, 74, 79), (38, 58, 62), [(217, 164, 65), (196, 92, 62), (233, 226, 214), (120, 150, 120)]
SKIN, SKIN_D, HAIR, SHIRT, SHIRT_D = (201, 142, 107), (176, 118, 88), (43, 31, 27), (217, 164, 65), (190, 140, 52)
HEAD = (540, 880)                      # head centre at rest
HEAD_W, HEAD_H = 330, 400


def background() -> Image.Image:
    im = Image.new("RGB", (W, H), WALL)
    d = ImageDraw.Draw(im)
    d.rectangle((0, 1460, W, H), fill=(36, 54, 58))                      # desk
    for y in (360, 620):                                                 # shelves with books
        d.rectangle((640, y, 1040, y + 18), fill=SHELF)
        x = 660
        for k in range(7):
            bw, bh = 34 + (k * 13) % 22, 120 + (k * 37) % 70
            d.rectangle((x, y - bh, x + bw, y), fill=BOOK[k % 4]); x += bw + 6
    d.ellipse((60, 420, 300, 660), fill=(84, 122, 92)); d.ellipse((140, 360, 360, 600), fill=(96, 138, 104))   # plant
    d.rectangle((150, 640, 260, 780), fill=(196, 92, 62))
    d.rectangle((880, 1040, 1000, 1460), fill=(36, 54, 58)); d.ellipse((840, 940, 1040, 1080), fill=(233, 226, 214))  # lamp
    return im


def frame(bg: Image.Image, t: float, level: float, blink: bool) -> Image.Image:
    im = bg.copy()
    d = ImageDraw.Draw(im)
    bob = 6 * math.sin(t * 1.3) + 10 * level
    sway = 8 * math.sin(t * 0.7)
    cx, cy = HEAD[0] + sway, HEAD[1] + bob
    d.rounded_rectangle((cx - 300, cy + 300, cx + 300, H + 40), radius=150, fill=SHIRT)               # shoulders
    d.polygon([(cx - 70, cy + 300), (cx, cy + 400), (cx + 70, cy + 300)], fill=SHIRT_D)               # collar
    d.rectangle((cx - 62, cy + 170, cx + 62, cy + 320), fill=SKIN_D)                                  # neck
    d.ellipse((cx - HEAD_W / 2, cy - HEAD_H / 2, cx + HEAD_W / 2, cy + HEAD_H / 2), fill=SKIN)       # head
    d.ellipse((cx - HEAD_W / 2 - 22, cy - 10, cx - HEAD_W / 2 + 22, cy + 60), fill=SKIN_D)            # ears
    d.ellipse((cx + HEAD_W / 2 - 22, cy - 10, cx + HEAD_W / 2 + 22, cy + 60), fill=SKIN_D)
    d.chord((cx - HEAD_W / 2 - 14, cy - HEAD_H / 2 - 40, cx + HEAD_W / 2 + 14, cy + 40), 180, 360, fill=HAIR)  # hair
    d.ellipse((cx - HEAD_W / 2 - 14, cy - HEAD_H / 2 - 40, cx - HEAD_W / 2 + 60, cy + 30), fill=HAIR)
    ey = cy - 20
    for ex in (cx - 70, cx + 70):
        d.rounded_rectangle((ex - 34, ey - 62, ex + 34, ey - 50), radius=6, fill=HAIR)                # brows
        if blink:
            d.rounded_rectangle((ex - 22, ey - 3, ex + 22, ey + 3), radius=3, fill=(60, 40, 34))
        else:
            d.ellipse((ex - 22, ey - 18, ex + 22, ey + 18), fill=(250, 246, 240))
            d.ellipse((ex - 11, ey - 11, ex + 11, ey + 11), fill=(48, 34, 30))
    d.polygon([(cx, cy + 10), (cx - 16, cy + 62), (cx + 6, cy + 66)], fill=SKIN_D)                     # nose
    mh = 8 + 46 * min(1.0, level)                                                                       # mouth opens with the voice
    d.rounded_rectangle((cx - 48, cy + 108 - mh / 2, cx + 48, cy + 108 + mh / 2), radius=int(min(48, mh / 2)), fill=(110, 44, 40))
    return im


def video(voice_wav: Path, dur: float, tmp: Path) -> tuple[Path, list[dict]]:
    x = read_wav(voice_wav)
    hop = RATE // FPS
    env = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) if i < len(x) else 0 for i in range(0, int(dur * RATE), hop)])
    env = np.convolve(env / max(1e-6, env.max()), np.ones(3) / 3, mode="same")
    bg = background()
    raw = tmp / "take_noaudio.mp4"
    p = subprocess.Popen(["ffmpeg", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                          "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", str(raw)],
                         stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    faces = []
    n = len(env)
    for i in range(n):
        t = i / FPS
        level = min(1.0, float(env[i]) * 1.6)
        blink = (t % 3.7) < 0.12
        p.stdin.write(frame(bg, t, level, blink).tobytes())
        if i % (FPS // 2) == 3:
            bob = 6 * math.sin(t * 1.3) + 10 * level
            cx, cy = HEAD[0] + 8 * math.sin(t * 0.7), HEAD[1] + bob
            faces.append({"src": 0, "t": round(t, 2), "cx": round(cx / W, 4), "cy": round(cy / H, 4), "w": round(HEAD_W / W, 4),
                          "h": round(HEAD_H / H, 4), "eyesY": round((cy - 20) / H, 4), "mouthY": round((cy + 108) / H, 4)})
    p.stdin.close(); p.wait()
    return raw, faces


def music(dur: float, out: Path) -> None:
    """A soft four-chord pad and a light pulse, made here (no third-party recording)."""
    chords = [(220.0, 277.18, 329.63), (196.0, 246.94, 293.66), (174.61, 220.0, 261.63), (196.0, 246.94, 311.13)]
    bar = 2.4
    expr = []
    for k, ch in enumerate(chords):
        on = f"between(mod(t,{4 * bar}),{k * bar},{(k + 1) * bar})"
        tone = "+".join(f"sin(2*PI*{f}*t)+0.3*sin(4*PI*{f}*t)" for f in ch)
        expr.append(f"{on}*({tone})")
    pad = "(" + "+".join(expr) + ")*0.045"
    pulse = "0.05*sin(2*PI*55*t)*exp(-8*mod(t,0.6))"
    sh("ffmpeg", "-y", "-f", "lavfi", "-i", f"aevalsrc='{pad}+{pulse}':s={RATE}:d={dur + 4:.2f}", "-af",
       "lowpass=f=2400,aecho=0.6:0.5:120:0.25,afade=t=in:d=1.5", "-ac", "2", "-c:a", "aac", "-b:a", "160k", out)


def card(out: Path) -> None:
    """A drawn picture for "a single page": the hook list on paper."""
    im = Image.new("RGB", (1200, 900), (233, 226, 214))
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 54)
        s = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 40)
    except OSError:
        f = s = ImageFont.load_default()
    d.rectangle((80, 70, 1120, 830), fill=(250, 248, 243))
    d.text((140, 120), "Hooks for Sunday", font=f, fill=(30, 30, 30))
    for k, line in enumerate(["The habit that doubled my posts", "4 videos, 1 morning", "Film it twice, keep one",
                              "Done before lunch"]):
        y = 260 + k * 130
        d.rectangle((140, y + 6, 180, y + 46), outline=(30, 30, 30), width=4)
        if k < 3:
            d.line((146, y + 26, 158, y + 40, 176, y + 10), fill=(196, 92, 62), width=7)
        d.text((210, y), line, font=s, fill=(40, 40, 40))
    im.save(out)


def ids_for(words: list[dict], phrase: str, after: int = 0) -> tuple[str, str]:
    toks = [bare(t) for t in phrase.split()]
    bw = [bare(w["w"]) for w in words]
    for i in range(after, len(bw) - len(toks) + 1):
        if bw[i:i + len(toks)] == toks:
            return f"w{i}", f"w{i + len(toks) - 1}"
    raise ValueError(f"not in the take: {phrase}")


def first_edit(words: list[dict]) -> dict:
    """The sample's first edit, in the AI editor's answer format (lib/edit.ts AiEdit). Asset keys are local names."""
    r = lambda phrase, after=0: dict(zip(("from", "to"), ids_for(words, phrase, after)))  # noqa: E731
    keep_lines = ["The one habit that doubled my posting is batching.", "I film four videos every Sunday morning.",
                  "Step one, I write every hook on a single page.", "Step two, I set up the camera once and",
                  "I never move it.", "Step three, I film each video twice and keep the better take.",
                  "Then I drop the raw files in here, and the edit is done before lunch.", "Try it on your next video."]
    keep, after = [], 0
    for line in keep_lines:
        rng = r(line, after)
        keep.append(rng); after = int(rng["to"][1:]) + 1
    return {
        "summary": "I kept your last full take of the opening, cut the restart and the doubled \"I\", and added a hook title, three "
                   "step labels, your hook list as a picture and a soft music bed. This is a sample: add your key to change it with notes.",
        "keep": keep, "gapCap": 0.14,
        "hook": {"text": "The habit that doubled my posting", **r("The one habit that doubled my posting is batching.")},
        "labels": [
            {"text": "1: Write the hooks", **r("Step one, I write every hook"), "style": "label"},
            {"text": "2: Set up once", **r("Step two, I set up the camera once"), "style": "label"},
            {"text": "3: Film it twice", **r("Step three, I film each video twice"), "style": "label"},
            {"text": "4 videos", **r("I film four videos"), "style": "pop"},
        ],
        "broll": [{"asset": "card", **r("on a single page."), "treatment": "card-above-head"}],
        "zooms": [{**r("every Sunday morning."), "scale": 1.12}, {**r("and keep the better take."), "scale": 1.1},
                  {**r("the edit is done before lunch."), "scale": 1.12}],
        "music": {"asset": "song", "level": "under-voice", "automation": [{**r("Try it on your next video."), "db": 3}]},
        "cover": {"word": ids_for(words, "batching.")[0], "text": "Batch it"},
        "post": {"caption": "Batching doubled my posting: 4 videos every Sunday morning. Write the hooks on one page, set up once, "
                            "film each video twice and keep the better take.",
                 "hashtags": ["#batchingcontent", "#contentworkflow", "#reelstips", "#talkingheadvideo", "#creatorhabits"],
                 "keywords": ["batching", "posting", "hooks", "film"]},
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    vo, words, dur = voice(tmp)
    vid, faces = video(vo, dur, tmp)
    take = OUT / "take.mp4"
    sh("ffmpeg", "-y", "-i", vid, "-i", vo, "-f", "lavfi", "-i", f"anoisesrc=color=pink:amplitude=0.003:r={RATE}",
       "-filter_complex", "[1:a][2:a]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-18:TP=-2,aresample=48000[a]",
       "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", take)
    music(dur, OUT / "loop.m4a")
    card(OUT / "card.png")
    sh("ffmpeg", "-y", "-ss", "4", "-i", take, "-frames:v", "1", "-vf", "scale=540:-2", OUT / "poster.jpg")
    out = {
        "title": "Sample: the batching habit",
        "about": "A drawn presenter and a computer voice, so you can try Cutmind before you film. Not a real person.",
        "source": {"name": "sample take.mp4", "width": W, "height": H, "duration": round(dur, 3)},
        "words": words, "faces": faces,
        "library": [{"key": "card", "file": "card.png", "name": "hook list.png", "kind": "image", "width": 1200, "height": 900},
                    {"key": "song", "file": "loop.m4a", "name": "sunday pad.m4a", "kind": "music"}],
        "edit": first_edit(words),
    }
    (OUT / "demo.json").write_text(json.dumps(out, indent=1))
    print(f"{take} {dur:.1f}s, {len(words)} words, {len(faces)} face samples")


if __name__ == "__main__":
    main()
