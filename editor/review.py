"""Self-review of a render, before anyone else sees it (video-use's self-eval step).

inspect  filmstrip + waveform + word labels for any time range. Uses video-use's own
         timeline_view.py helper (vendored in .claude/skills/video-use/helpers/).
review   checks every cut boundary of the rendered output:
           - audio click: sample-to-sample jump at the cut far above the local level
           - flash / black frame: one frame whose brightness jumps away from both neighbours
           - mid-word cut: the boundary falls inside a transcript word
         and writes review sheets (frame before | frame after | waveform per cut) for Claude to
         read, plus review.json with every issue and its timecode.
Cap: if issues remain after 3 fix-and-rerender passes, report them instead of looping.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

from .util import fmt_ts, load_json, log, probe, run, save_json

TIMELINE_VIEW = Path(__file__).resolve().parent.parent / ".claude" / "skills" / "video-use" / "helpers" / "timeline_view.py"


def inspect(video: str | Path, start: float, end: float, out: str | Path, transcript: str | Path | None = None,
            n_frames: int = 10) -> Path:
    cmd = [sys.executable, str(TIMELINE_VIEW), str(video), f"{start}", f"{end}", "-o", str(out),
           "--n-frames", str(n_frames)]
    if transcript:
        cmd += ["--transcript", str(transcript)]
    run(cmd)
    log(f"timeline view {fmt_ts(start)}-{fmt_ts(end)} -> {out}")
    return Path(out)


def _audio(path: Path, sr: int = 48000) -> np.ndarray:
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1", "-ar", str(sr),
                           "-f", "f32le", "-"], capture_output=True)
    return np.frombuffer(proc.stdout, np.float32)


def _luma_series(path: Path, fps: float) -> np.ndarray:
    proc = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-vf", "scale=64:-2,format=gray",
                           "-f", "rawvideo", "-"], capture_output=True)
    info = probe(path)["video"]
    h = int(round(64 * info["height"] / info["width"] / 2) * 2)
    n = len(proc.stdout) // (64 * h)
    return np.frombuffer(proc.stdout[:n * 64 * h], np.uint8).reshape(n, h * 64).mean(axis=1)


def _covered_faces(video: Path, work: Path, meta: dict) -> list[dict]:
    """Hard rule from both vendored skills: never cover a face. For every card/overlay window and
    step pill, if the speaker's face is visible in the clean reframed frame but not in the render,
    something is sitting on it."""
    try:
        import cv2
    except ImportError:
        return []
    if not hasattr(cv2, "CascadeClassifier") or not (work / "track.json").exists():
        return []
    from .render import still
    edl = load_json(meta["edl"]) if Path(meta["edl"]).exists() else {}
    from .anchors import resolve_work
    edl = resolve_work(edl, work)
    det = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml")
    v = probe(video)["video"]
    preset = next((k for k, pr in __import__("editor.render", fromlist=["PRESETS"]).PRESETS.items()
                   if tuple(pr["size"]) == (v["width"], v["height"])), "reels")
    checks = [(float(b["start"]) + float(b["dur"]) / 2, f"{b.get('mode', 'full')} {Path(b['path']).name}")
              for b in edl.get("broll", []) if b.get("mode") in ("card", "overlay")]
    checks += [(float(c["start"]) + 0.6, f"pill '{c['text']}'") for c in edl.get("chapters", []) or []]

    def faces(img):
        g = cv2.cvtColor(cv2.resize(img, (img.shape[1] // 3, img.shape[0] // 3)), cv2.COLOR_BGR2GRAY)
        return len(det.detectMultiScale(cv2.equalizeHist(g), 1.1, 4, minSize=(g.shape[1] // 12,) * 2))
    out = []
    for t, what in checks:
        if t >= meta["duration"]:
            continue
        clean = still(work, t, preset)
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(video), "-frames:v", "1",
                              "-f", "rawvideo", "-pix_fmt", "bgr24", "-"], capture_output=True).stdout
        if len(raw) < v["width"] * v["height"] * 3:
            continue
        rendered = np.frombuffer(raw[:v["width"] * v["height"] * 3], np.uint8).reshape(v["height"], v["width"], 3)
        if faces(clean) and not faces(rendered):
            out.append({"t": round(t, 3), "kind": "face-covered", "detail": f"{what} hides the speaker's face"})
    return out


def review(video: str | Path, work_dir: str | Path, out_dir: str | Path | None = None) -> dict:
    from PIL import Image, ImageDraw
    from .viz import _font
    video, work = Path(video), Path(work_dir)
    out_dir = Path(out_dir or video.parent / "review")
    out_dir.mkdir(parents=True, exist_ok=True)
    meta = load_json(work / "cut_meta.json")
    fps = meta["fps"]
    cuts = [seg["start"] for seg in meta["timeline"][1:]]
    sr = 48000
    audio = _audio(video, sr)
    luma = _luma_series(video, fps)
    words = load_json(work / "cut_words.json")["words"] if (work / "cut_words.json").exists() else []
    issues, rows = [], []
    from .transitions import expand
    edl = load_json(meta["edl"]) if Path(meta["edl"]).exists() else {}
    from .anchors import resolve_work
    edl = resolve_work(edl, work)
    designed = [(tr["at"] - tr["dur"] / 2 - 0.05, tr["at"] + tr["dur"] / 2 + 0.05)
                for tr in expand(edl, meta["duration"], meta["timeline"])]
    for b in edl.get("broll", []):     # b-roll that whips or slides in/out jumps on purpose
        for side, at in (("in", float(b["start"])), ("out", float(b["start"]) + float(b["dur"]))):
            if b.get(side):
                designed.append((at - 0.25, at + 0.4))
    for t in cuts:
        i = int(t * sr)
        win = audio[max(0, i - int(0.02 * sr)):i + int(0.02 * sr)]
        ctx = audio[max(0, i - int(0.3 * sr)):i + int(0.3 * sr)]
        jump = float(np.max(np.abs(np.diff(win)))) if len(win) > 2 else 0.0
        typical = float(np.percentile(np.abs(np.diff(ctx)), 99.5)) if len(ctx) > 2 else 0.0
        if jump > 0.05 and jump > 3 * typical:
            issues.append({"t": round(t, 3), "kind": "audio-click", "detail": f"jump {jump:.3f} vs {typical:.3f}"})
        f = int(round(t * fps))
        for k in (f - 1, f, f + 1):
            if 1 <= k < len(luma) - 1:
                d = min(abs(luma[k] - luma[k - 1]), abs(luma[k] - luma[k + 1]))
                if d > 40 and not any(lo <= k / fps <= hi for lo, hi in designed):
                    issues.append({"t": round(k / fps, 3), "kind": "flash-frame", "detail": f"luma jump {d:.0f}"})
        inside = [w for w in words if w["start"] + 0.04 < t < w["end"] - 0.04]
        if inside:
            issues.append({"t": round(t, 3), "kind": "mid-word", "detail": f"cut inside '{inside[0]['text']}'"})
        rows.append(t)

    issues += _covered_faces(video, work, meta)

    # review sheets: per cut, the frame before, the frame after, and the waveform around it
    tw, th = 270, int(270 * probe(video)["video"]["height"] / probe(video)["video"]["width"])
    per_sheet, sheets = 6, []
    font = _font(20, False)
    for s0 in range(0, len(rows), per_sheet):
        chunk = rows[s0:s0 + per_sheet]
        sheet = Image.new("RGB", (tw * 2 + 520, len(chunk) * (th + 12) + 12), (20, 20, 24))
        d = ImageDraw.Draw(sheet)
        with tempfile.TemporaryDirectory() as tmp:
            for r, t in enumerate(chunk):
                y = 12 + r * (th + 12)
                for c, tt in enumerate((max(t - 1 / fps, 0), t + 0.5 / fps)):
                    png = Path(tmp) / f"{r}_{c}.png"
                    run(["ffmpeg", "-y", "-ss", f"{tt:.3f}", "-i", str(video), "-frames:v", "1", "-vf",
                         f"scale={tw}:{th}", str(png)])
                    sheet.paste(Image.open(png).convert("RGB"), (c * tw, y))
                seg = audio[max(0, int((t - 1.0) * sr)):int((t + 1.0) * sr)]
                x0, wv = tw * 2 + 12, 496
                if len(seg):
                    step = max(1, len(seg) // wv)
                    env = np.abs(seg[:step * wv].reshape(-1, step)).max(axis=1)
                    for k, v in enumerate(env):
                        hh = v * (th - 40) / 2
                        d.line((x0 + k, y + th / 2 - hh, x0 + k, y + th / 2 + hh), fill=(120, 170, 255))
                d.line((x0 + wv / 2, y, x0 + wv / 2, y + th), fill=(255, 90, 0), width=2)
                bad = [i for i in issues if abs(i["t"] - t) < 0.06]
                d.text((x0, y + 4), f"cut {s0 + r + 1} @ {fmt_ts(t)}" + (f"  !! {bad[0]['kind']}" if bad else "  ok"),
                       font=font, fill=(255, 90, 90) if bad else (200, 200, 205))
        path = out_dir / f"review_{s0 // per_sheet + 1}.png"
        sheet.save(path)
        sheets.append(str(path))
    pace = pacing(edl, words, meta["duration"], punch_cuts(edl, meta))
    report = {"video": str(video), "cuts": len(cuts), "issues": issues, "sheets": sheets,
              "passed": not issues, "pacing": pace}
    save_json(out_dir / "review.json", report)
    log(f"review: {len(cuts)} cuts, {len(issues)} issue(s); read {', '.join(Path(s).name for s in sheets) or 'no sheets'}")
    for i in issues:
        log(f"  {fmt_ts(i['t'])}  {i['kind']}: {i['detail']}")
    for k, v in pace.items():
        if v:
            log(f"  pacing {k}: {v}")
    return report


STOPWORDS = {"i", "i'm", "i've", "i'll", "i'd", "the", "a", "and", "so", "but", "if", "it", "this", "that", "my", "you",
             "we", "when", "what", "okay", "ok", "yeah", "hey", "monday", "tuesday", "wednesday", "thursday",
             "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july",
             "august", "september", "october", "november", "december"}


_NUMBER = re.compile(r"\d|[$£€%]|\b(two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty|hundred|thousand|"
                     r"million|billion|half|double|twice|triple)\b", re.I)
_STRONG = {"never", "always", "only", "biggest", "best", "worst", "mistake", "mistakes", "secret", "stop", "nobody",
           "everyone", "free", "wrong", "truth", "problem", "hack", "quit", "fired", "broke", "lost", "doubled",
           "tripled", "nothing"}
_LEANS = re.compile(r"^(step|tip|part|number|first(ly)?|second(ly)?|third(ly)?|next|then|and|but|so|also|finally|plus|or|"
                    r"because|which|that|this|it|he|she|they|same|another)\b", re.I)


def stronger_opening(words: list[dict]) -> str | None:
    """A later line that grips more than the one the cut opens with (a number, a strong word, "you", a question,
    short), as a cold-open suggestion; lines that lean on what came before ("Step two", "Then") never count. The
    same rule as Cutmind's lib/coldopen.ts."""
    lines, cur, prev = [], [], None
    for w in words:
        t = str(w.get("text", "")).strip()
        if not t:
            continue
        if cur and prev is not None and float(w["start"]) - prev > 0.7:
            lines.append(cur)
            cur = []
        cur.append(w)
        prev = float(w["end"])
        if re.search(r"[.!?][\"')]*$", t):
            lines.append(cur)
            cur = []
    if cur:
        lines.append(cur)

    def score(line: list[dict]) -> tuple[int, list[str]]:
        text = " ".join(str(w["text"]).strip() for w in line)
        why, sc = [], 0
        if _NUMBER.search(text):
            sc, why = sc + 2, why + ["a number"]
        strong = next((x for x in re.sub(r"[^a-z' ]", " ", text.lower()).split() if x in _STRONG), None)
        if strong:
            sc, why = sc + 2, why + [f'a strong word ("{strong}")']
        if re.search(r"\byou(r|'re|'ll)?\b", text, re.I):
            sc, why = sc + 1, why + ['it talks to "you"']
        if re.search(r"\?[\"')]*$", text):
            sc, why = sc + 1, why + ["a question"]
        return sc + (1 if len(line) <= 12 else 0), why
    if len(lines) < 2:
        return None
    opener, _ = score(lines[0])
    best = None
    for line in lines[1:]:
        text = " ".join(str(w["text"]).strip() for w in line)
        if not 4 <= len(line) <= 16 or _LEANS.match(re.sub(r"^[^A-Za-z]+", "", text)):
            continue
        sc, why = score(line)
        if sc >= 3 and sc > opener and (best is None or sc > best[0]):
            best = (sc, text, float(line[0]["start"]), why)
    return f'"{best[1]}" at {best[2]:.1f}s ({", ".join(best[3])}) grips more than the opening: a cold open?' if best else None


def punch_cuts(edl: dict, meta: dict) -> list[float]:
    """Output times of the cuts where the auto punch-in alternates the framing (a visible change, like a zoom)."""
    if float(edl.get("auto_punch_in", 1.0)) <= 1.0:
        return []
    return [float(s["start"]) for s in meta.get("timeline", [])[1:]]


def _strong(words: list[dict], edl: dict) -> str | None:
    """Strong swear words said and not bleeped: brands and ad rules care; bleep only if the user wants it."""
    from .bleep import chosen, is_swear, mask
    bleeped = {w.get("id") for w in chosen(words, edl.get("bleep"))}
    said = [w for w in words if is_swear(w.get("text", "")) and w.get("id") not in bleeped]
    if not said:
        return None
    first = ", ".join(f"{mask(str(w['text']).strip())} at {float(w['start']):.1f}s" for w in said[:3])
    return f"{len(said)} strong word(s) ({first}): if the user wants it brand-safe, EDL \"bleep\": true"


def stillness_zooms(gaps: list[str], words: list[dict], every: float = 6.0) -> list[dict]:
    """Word-anchored zooms for the bare-face stretches pacing reports ("1.0-9.0s"): one about every 6 s (the doctrine's
    one emphasis zoom every 4-8 s, and no more than 10 a minute), on the word being said there and held ~1.5 s,
    alternating 1.15 / 1.25. A long bare stretch still wants b-roll: zooms alone don't carry it."""
    spoken = [w for w in words if str(w.get("text", "")).strip() and w.get("id")]
    out, k = [], 0
    for g in gaps:
        a, b = (float(x) for x in g.rstrip("s").split("-"))
        t = a + min(2.0, (b - a) / 3)              # into the stretch, not at its first frame
        while t < b - 0.5:
            first = next((w for w in spoken if float(w["start"]) >= t), None)
            if first is None or float(first["start"]) > b - 0.3:
                break
            last = [w for w in spoken if float(first["start"]) <= float(w["start"]) and float(w["end"]) <= float(first["start"]) + 1.6]
            last = last[-1] if last else first
            out.append({"words": f"{first['id']}-{last['id']}", "scale": 1.15 if k % 2 == 0 else 1.25, "ease": 0.3})
            k += 1
            t = float(first["start"]) + every
    return out


def named_not_shown(edl: dict, words: list[dict]) -> list[dict]:
    """Names said but never shown: a capitalised word mid-sentence (or a run, "Claude Code") that isn't a common word,
    with no picture on screen as it's said (a text card counts only if it spells the name), at any of its mentions.
    [{name, start, words: "w12-w13"}] at the first mention; the same rule as Cutmind's lib/names.ts."""
    def core(t):     # curly apostrophes read as straight: "I’m" is a common word, not a name
        return str(t).strip().replace("’", "'").replace("‘", "'").replace("ʼ", "'").strip(".,!?;:\"'()“”")

    def capital(t):
        c = core(t)
        return len(c) > 1 and c[:1].isupper() and c.lower() not in STOPWORDS
    on = [(float(b["start"]) - 0.3, float(b["start"]) + float(b["dur"]) + 0.3, bool(b.get("path")) and b.get("treatment") != "text-pop",
           str(b.get("text", "")).lower()) for b in edl.get("broll", []) if "start" in b and "dur" in b]
    spoken = [w for w in words if str(w.get("text", "")).strip()]
    mentions, i = [], 0
    while i < len(spoken):
        w, prev = spoken[i], spoken[i - 1] if i else None
        start = prev is None or str(prev["text"]).rstrip().endswith((".", "!", "?")) or float(w["start"]) - float(prev["end"]) > 1.0
        if start or not capital(w["text"]):
            i += 1
            continue
        run = [w]
        while i + 1 < len(spoken) and capital(spoken[i + 1]["text"]) and not str(run[-1]["text"]).rstrip().endswith((".", "!", "?", ",", ";", ":")):
            i += 1
            run.append(spoken[i])
        name, t = " ".join(core(x["text"]) for x in run), float(run[0]["start"])
        covered = any(a <= t <= b and (pic or name.lower() in text) for a, b, pic, text in on)
        mentions.append({"name": name, "start": round(t, 2), "words": f"{run[0].get('id', '')}-{run[-1].get('id', '')}", "covered": covered})
        i += 1
    covered = {m["name"].lower() for m in mentions if m["covered"]}
    out, seen = [], set()
    for m in mentions:
        if m["name"].lower() in covered or m["name"].lower() in seen:
            continue
        seen.add(m["name"].lower())
        out.append({k: m[k] for k in ("name", "start", "words")})
    return out


def pacing(edl: dict, words: list[dict], duration: float, cuts: list[float] | None = None) -> dict:
    """What a hand edit would fix (from Reel Studio's draft checks): bare face over 4.5 s, over 10 s with zooms
    only, too many zooms, visuals that flash by, big word cards over budget, names said but never shown,
    and too few b-roll moments for the length (hand edits carry about one per 6 s); the first second: speech
    starting after 0.6 s, an opener like "so" / "um" / "today", or no hook title on screen (`cuts`: punch-in cuts, which count as a change of picture for
    the bare-face check); and the loop (reels replay on their own): dead air over 0.6 s
    after the last word, or a sign-off in the last 3 s."""
    broll = [b for b in edl.get("broll", []) if "start" in b and "dur" in b]
    zooms = [z for z in edl.get("zooms", []) if "start" in z and "end" in z]
    hook = lambda b: b.get("treatment") == "text-pop" and b.get("style") == "label" and float(b["start"]) < 1.0  # noqa: E731
    vis = sorted([(float(b["start"]), float(b["start"]) + float(b["dur"])) for b in broll if not hook(b)] +
                 [(float(z["start"]), float(z["end"])) for z in zooms] + [(c, c) for c in cuts or []])
    gaps, t = [], 0.0
    for a, b in vis + [(duration, duration)]:
        if a - t > 4.5:
            gaps.append(f"{t:.1f}-{a:.1f}s")
        t = max(t, b)
    pics = sorted((float(b["start"]), float(b["start"]) + float(b["dur"])) for b in broll)
    zoom_only, t = [], 0.0
    for a, b in pics + [(duration, duration)]:
        if a - t > 10:
            zoom_only.append(f"{t:.1f}-{a:.1f}s")
        t = max(t, b)
    too_short = [f"{Path(str(b.get('path', b.get('text', '?')))).name} at {float(b['start']):.1f}s"
                 for b in broll if float(b["dur"]) < 1.2 and b.get("treatment") not in ("post-wall", "icon-wall")]
    pops = [b for b in broll if b.get("treatment") == "text-pop" and b.get("style", "pop") == "pop"]
    shown = [(float(b["start"]) - 0.3, float(b["start"]) + float(b["dur"]) + 0.3) for b in broll]
    names = [n["name"] for n in named_not_shown(edl, words)]
    per_min = len(zooms) / max(duration / 60, 1e-6)
    want = 0.75 * duration / 6
    # the first second decides: speech from the first frames, and something to read before the first word lands
    first = next((w for w in words if str(w.get("text", "")).strip()), None)
    late = f"{first['start']:.1f}s" if first and float(first["start"]) > 0.6 else None
    weak = {"so", "um", "uh", "okay", "ok", "hey", "hi", "hello", "today", "alright", "well", "like"}
    opener = re.sub(r"[^a-z']", "", str(first["text"]).lower()) if first else ""
    warm = (f"opens with \"{str(first['text']).strip()}\": a warm-up, not the point; drop it from the first segment"
            if opener in weak else None)
    has_title = bool(edl.get("title")) or any(hook(b) for b in broll)
    # the hook has to be read before it goes: ~0.4 s to notice it, then ~4 words a second
    need = lambda text: 0.4 + 0.25 * len(str(text).split())  # noqa: E731
    shown = [(b.get("text", ""), float(b["dur"])) for b in broll if hook(b)]
    if edl.get("title"):
        shown.append((edl["title"], 3.0))                       # captions' title_dur (the CLI's --title-dur default)
    quick = next((f"\"{t}\" is up {d:.1f}s; {len(str(t).split())} words need about {need(t):.1f}s"
                  for t, d in shown if d < need(t)), None)
    spoken = [w for w in words if str(w.get("text", "")).strip()]
    air = duration - float(spoken[-1]["end"]) if spoken else 0.0
    tail = " ".join(str(w["text"]).strip() for w in spoken if float(w["start"]) >= duration - 3)
    bye = re.search(r"\b(bye|see you|thanks for watching|that's it|peace out)\b", tail, re.I)   # a CTA is a choice
    loop = (f"ends on \"{bye.group(0)}\": a sign-off tells people to swipe instead of watching again" if bye else
            f"{air:.1f}s of nothing after the last word before it replays" if air > 0.6 else None)
    return {"face_only_over_4_5s": gaps, "zooms_only_over_10s": zoom_only,
            "zooms_per_minute_over_10": round(per_min, 1) if per_min > 10 and len(zooms) > 2 else None,   # 2 in a short reel isn't many
            "big_word_cards_over_2": len(pops) if len(pops) > 2 else None,
            "visuals_under_1_2s": too_short, "named_not_shown": names[:20],
            "broll_moments": None if len(broll) >= want else f"{len(broll)} (hand edits carry about {round(duration / 6)})",
            "first_word_after_0_6s": late, "no_hook_title": None if has_title else "nothing to read in the first second",
            "strong_language": _strong(words, edl),
            "opens_with_warm_up": warm, "stronger_line_for_a_cold_open": stronger_opening(words), "hook_too_quick_to_read": quick, "loop_seam": loop}
