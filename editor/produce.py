"""Produce a finished video from one JSON spec: pieces -> base picture, a designed overlay track, a mix, a composite.

This is the brief-production workflow as a tool (it replaces the hand-written build/mix scripts of the Walk-Free
demo). One spec holds the whole timeline:

  {"output": {"width": 1920, "height": 1080, "fps": 30, "file": "out/demo.mp4", "duration": 176},
   "pieces": [ {"name": "s1", "type": "video", "src": "raw/scene1.mov", "in": 0.4, "out": 13.4, "grade": "hot"},
               {"name": "d1", "type": "framed", "src": "demos/route.png", "dur": 4.5, "punch": [0.6, 1.6, 0.1, 0.2]},
               {"name": "end", "type": "freeze", "from": "s9", "dur": 6, "blur": 12, "darken": 0.3} ],
   "audio": {"voices": [{"name": "v1", "src": "raw/scene1.mov", "in": 0.4, "out": 13.4, "at": "s1", "gain": 4}],
             "music":  [{"src": {"compose": {"mood": "warm", "bpm": 100}}, "at": 13, "gain": -3, "duck": true}],
             "sfx":    [{"src": "whoosh", "at": "s1+12.5", "gain": -3}],
             "beds":   [{"src": {"ambience": "birdsong"}, "at": "s9", "dur": 21, "gain": -18}]},
   "overlay": {"elements": [{"type": "meta_tag", "text": "Muse Spark", "t_in": "@v1:3.7", "x": 105, "y": 71}]},
   "captions": {"voices": {"v1": "work/inventory/scene1.words.json"}, "replace": {"walk free": "Walk-Free"}},
   "extras": [{"name": "square", "from": "s3", "to": "s4", "size": [1080, 1080]}]}

Times anywhere (audio `at`, overlay `t_in`/`t_out`/`t`/`times`/`t_column`, extras) can be numbers or references:
  "s3"        the output start of piece s3          "s3+1.2"   1.2 s after it        "s3.end-0.5"
  "@v1:2.01"  where source second 2.01 of voice v1 lands in the output (anchor captions on real word times)
Pieces are cached by content, so a note that changes one shot re-renders only that shot. A screen recording with
waits (spinners, an AI thinking) can speed through them: "ramp_waits": {"speed": 6, "label": "thinking…"}.

  editor produce spec.json                 # everything
  editor produce spec.json --plan          # the timeline table, total length, resolved times; renders nothing
  editor produce spec.json --only pieces|overlay|mix|composite|extras
  editor produce spec.json --preview       # also a 720p preview for sending to a phone
"""
from __future__ import annotations

import hashlib
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .util import EditorError, log, probe, run

GRADES = {
    "none": "",
    "neutral": "colorbalance=rs=0.02:bs=-0.02,eq=contrast=1.04:saturation=1.06",
    "hot": ("colorbalance=rs=0.07:gs=0.01:bs=-0.09:rm=0.06:bm=-0.07:rh=0.05:bh=-0.06,"
            "eq=contrast=1.10:saturation=1.18:brightness=0.025:gamma=0.98"),
    "cool": ("colorbalance=rs=-0.05:gs=0.03:bs=0.05:rm=-0.04:gm=0.04:bm=0.01:rh=-0.02:gh=0.01:bh=0.02,"
             "eq=contrast=0.95:saturation=1.04:brightness=0.01"),
    "warm": "colorbalance=rs=0.04:bs=-0.04:rm=0.03:bm=-0.03,eq=contrast=1.05:saturation=1.08",
    "punchy": "eq=contrast=1.12:saturation=1.15:gamma=0.97",
    "bw": "hue=s=0,eq=contrast=1.1",
}
BLOOM = {"hot": 0.16}                  # a soft glow over the hot grade (screen blend of a blurred copy)
VOICE_CLEAN = "highpass=f=80,afftdn=nr=10:nf=-45,acompressor=threshold=-20dB:ratio=3:attack=8:release=120:makeup=3dB"
ENC = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-an"]
REF = re.compile(r"^\s*(@(?P<voice>[\w.-]+):(?P<src>-?[\d.]+)|(?P<piece>[A-Za-z_][\w-]*)(?P<end>\.end)?)"
                 r"\s*(?P<off>[+-]\s*[\d.]+)?\s*$")
TIME_KEYS = {"t_in", "t_out", "t", "t_column", "at"}


# ---------------------------------------------------------------- spec and timeline

class Spec:
    def __init__(self, path: str | Path):
        self.path = Path(path).resolve()
        self.root = self.path.parent
        self.data = json.loads(self.path.read_text())
        o = self.data.get("output", {})
        self.w, self.h, self.fps = int(o.get("width", 1920)), int(o.get("height", 1080)), int(o.get("fps", 30))
        self.file = self.p(o.get("file", "out/produce.mp4"))
        self.work = self.p(o.get("work", "work/produce"))
        self.pieces = self.data.get("pieces", [])
        if not self.pieces:
            raise EditorError("the spec has no pieces")
        names = [pc.get("name") for pc in self.pieces]
        if None in names or len(set(names)) != len(names):
            raise EditorError("every piece needs a unique name")
        self.starts, t = {}, 0.0
        for pc in self.pieces:
            pc["_dur"] = self.piece_dur(pc)
            self.starts[pc["name"]] = (t, t + pc["_dur"])
            t += pc["_dur"]
        self.total = t
        self.voices = {v["name"]: v for v in self.data.get("audio", {}).get("voices", []) if v.get("name")}

    def p(self, rel) -> Path:
        q = Path(rel)
        return q if q.is_absolute() else self.root / q

    def piece_dur(self, pc: dict) -> float:
        kind = pc.get("type", "video")
        if "dur" in pc:
            return float(pc["dur"])
        if kind == "video":
            if "out" not in pc:
                src = self.p(pc["src"])
                pc["out"] = float(probe(src)["duration"])
            if pc.get("ramp_waits"):
                pc["_ramps"] = ramp_plan(self, pc)
                return sum((b - a) / sp for a, b, sp in pc["_ramps"])
            return (float(pc["out"]) - float(pc.get("in", 0))) / float(pc.get("speed", 1.0))
        raise EditorError(f"piece {pc.get('name')}: {kind} needs a dur")

    def t(self, ref) -> float:
        """A time: a number, or a piece / voice reference (see module docstring)."""
        if isinstance(ref, (int, float)):
            return float(ref)
        m = REF.match(str(ref))
        if not m:
            raise EditorError(f"not a time or reference: {ref!r}")
        off = float(m["off"].replace(" ", "")) if m["off"] else 0.0
        if m["voice"]:
            v = self.voices.get(m["voice"])
            if not v:
                raise EditorError(f"no voice named {m['voice']!r} (give voices a name to anchor on them)")
            return self.t(v.get("at", 0)) + (float(m["src"]) - float(v.get("in", 0))) + off
        if m["piece"] not in self.starts:
            raise EditorError(f"no piece named {m['piece']!r}")
        a, b = self.starts[m["piece"]]
        return (b if m["end"] else a) + off

    def resolve(self, node):
        """Resolve every time reference inside an overlay spec / list in place (returns a copy)."""
        if isinstance(node, list):
            return [self.resolve(x) for x in node]
        if isinstance(node, dict):
            out = {}
            for k, v in node.items():
                if k in TIME_KEYS and isinstance(v, (str, int, float)) and not isinstance(v, bool):
                    out[k] = round(self.t(v), 3)
                elif k == "times" and isinstance(v, list):
                    out[k] = [round(self.t(x), 3) for x in v]
                else:
                    out[k] = self.resolve(v)
            return out
        return node

    def table(self) -> str:
        rows = [f"{'piece':<12} {'type':<8} {'start':>7} {'end':>7} {'dur':>6}  source"]
        for pc in self.pieces:
            a, b = self.starts[pc["name"]]
            src = pc.get("src") or pc.get("from") or ", ".join(pc.get("srcs", []))[:40]
            rows.append(f"{pc['name']:<12} {pc.get('type', 'video'):<8} {a:7.2f} {b:7.2f} {b - a:6.2f}  {src}")
        want = self.data.get("output", {}).get("duration")
        rows.append(f"total {self.total:.2f} s" + (f" (target {want} s, {self.total - float(want):+.2f})" if want else ""))
        return "\n".join(rows)


def _hash(*parts) -> str:
    h = hashlib.sha1()
    for x in parts:
        h.update(json.dumps(x, sort_keys=True, default=str).encode())
    return h.hexdigest()[:12]


def _mtime(p: Path) -> float:
    return p.stat().st_mtime if p.exists() else 0.0


# ---------------------------------------------------------------- waits in screen recordings

def find_waits(src: Path, a: float, b: float, min_dur: float = 1.0, noise: str = "-50dB") -> list[tuple[float, float]]:
    """Stretches where the picture doesn't change (spinners, AI thinking, page loads): (start, end) relative to a."""
    import subprocess
    r = subprocess.run(["ffmpeg", "-hide_banner", "-ss", f"{a}", "-to", f"{b}", "-i", str(src), "-vf",
                        f"scale=480:-2,freezedetect=n={noise}:d={min_dur}", "-an", "-f", "null", "-"],
                       capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"freeze_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"freeze_end: ([\d.]+)", r.stderr)]
    if len(ends) < len(starts):
        ends.append(b - a)
    return list(zip(starts, ends))


def ramp_plan(spec: "Spec", pc: dict) -> list[tuple[float, float, float]]:
    """(start, end, speed) runs covering [in, out) relative to `in`: waits sped up, the rest at the piece's speed.
    Each wait keeps `keep` s at normal speed on both sides so the viewer sees it start and end. Cached."""
    r = pc["ramp_waits"] if isinstance(pc["ramp_waits"], dict) else {}
    a, b = float(pc.get("in", 0)), float(pc["out"])
    base, fast = float(pc.get("speed", 1.0)), float(r.get("speed", 6.0))
    keep, min_dur = float(r.get("keep", 0.3)), float(r.get("min", 1.0))
    src = spec.p(pc["src"])
    cache = spec.work / "waits" / f"{_hash(str(src), _mtime(src), a, b, min_dur, r.get('noise'))}.json"
    if cache.exists():
        waits = [tuple(x) for x in json.loads(cache.read_text())]
    else:
        waits = find_waits(src, a, b, min_dur, r.get("noise", "-50dB"))
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(waits))
    runs, t = [], 0.0
    for w0, w1 in waits:
        w0, w1 = w0 + keep, w1 - keep
        if w1 - w0 < 0.2:
            continue
        if w0 > t:
            runs.append((t, w0, base))
        runs.append((w0, w1, fast))
        t = w1
    if t < b - a:
        runs.append((t, b - a, base))
    return runs


def ramp_shimmers(spec: "Spec") -> list[dict]:
    """A "thinking…" shimmer over every sped-up wait whose piece asks for a label."""
    out = []
    for pc in spec.pieces:
        r = pc.get("ramp_waits")
        if not (isinstance(r, dict) and r.get("label") and pc.get("_ramps")):
            continue
        t = spec.starts[pc["name"]][0]
        for a, b, sp in pc["_ramps"]:
            d = (b - a) / sp
            if sp > float(pc.get("speed", 1.0)):
                out.append({"type": "shimmer", "t_in": round(t, 3), "t_out": round(t + d, 3), "label": r["label"]})
            t += d
    return out


# ---------------------------------------------------------------- pieces

def _video_filter(spec: Spec, pc: dict, n: int) -> str:
    W, H, fps = spec.w, spec.h, spec.fps
    speed = float(pc.get("speed", 1.0))
    fit = pc.get("fit", "cover")
    cy = float(pc.get("crop_y", 0.5))
    ramps = pc.get("_ramps")
    chain = [f"fps={fps}"] if ramps else [f"setpts=(PTS-STARTPTS)/{speed}", f"fps={fps}"]
    if fit == "contain":
        chain += [f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos",
                  f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={pc.get('pad', 'black')}"]
    else:
        chain += [f"scale={W}:{H}:force_original_aspect_ratio=increase:flags=lanczos",
                  f"crop={W}:{H}:(iw-{W})/2:(ih-{H})*{cy}"]
    chain.append("setsar=1")
    grade = pc.get("grade", "none")
    g = GRADES.get(grade, grade)                       # a name, or a raw ffmpeg filter chain
    if g:
        chain.append(g)
    if ramps:
        parts = "".join(f"[r{i}]" for i in range(len(ramps)))
        pre = (f"[0:v]split={len(ramps)}" + parts + ";" if len(ramps) > 1 else "[0:v]null[r0];") + ";".join(
            f"[r{i}]trim={a_}:{b_},setpts=(PTS-STARTPTS)/{sp}[q{i}]" for i, (a_, b_, sp) in enumerate(ramps))
        pre += ";" + "".join(f"[q{i}]" for i in range(len(ramps))) + f"concat=n={len(ramps)}:v=1:a=0[rr];"
        head = pre + "[rr]" + ",".join(chain)
    else:
        head = "[0:v]" + ",".join(chain)
    if BLOOM.get(grade) and pc.get("bloom", True):
        head += (f",split[a][b];[b]gblur=sigma=22[g];[a][g]blend=all_mode=screen:all_opacity={BLOOM[grade]}")
    zoom = []
    z0, z1 = float(pc.get("z0", 1.0)), float(pc.get("z1", 1.0))
    push = pc.get("push")                              # [at, dur, zoom, fx, fy]: an accelerating push-in (a transition)
    if z0 != 1.0 or z1 != 1.0 or push:
        fx, fy = pc.get("fx", 0.5), pc.get("fy", 0.5)
        z = f"({z0}+({z1}-{z0})*on/{max(1, n)})"
        if push:
            at, d, pz, px, py = push
            z = f"if(gte(on/{fps},{at}),{z}*(1+pow((on/{fps}-{at})/{d},2)*({pz}-1)),{z})"
            fx, fy = px, py
        zoom.append(f"zoompan=z='{z}':x='{fx}*(iw-iw/zoom)':y='{fy}*(ih-ih/zoom)':d=1:s={W}x{H}:fps={fps}")
    for kind in ("fade_in", "fade_out"):
        f = pc.get(kind)
        if f:
            d, color = (f, "black") if isinstance(f, (int, float)) else (f[0], f[1])
            st = 0 if kind == "fade_in" else max(0.0, pc["_dur"] - float(d))
            zoom.append(f"fade=t={'in' if kind == 'fade_in' else 'out'}:st={st}:d={d}:color={color}")
    tail = ("," + ",".join(zoom)) if zoom else ""
    return head + tail + ",format=yuv420p[v]"


def _render_piece(spec: Spec, pc: dict, out: Path) -> None:
    from .overlay import frame
    kind, dur, fps = pc.get("type", "video"), pc["_dur"], spec.fps
    n = max(1, int(round(dur * fps)))
    if kind == "video":
        src = spec.p(pc["src"])
        a, b = float(pc.get("in", 0)), float(pc.get("out"))
        run(["ffmpeg", "-y", "-ss", f"{a}", "-to", f"{b}", "-i", str(src), "-filter_complex",
             _video_filter(spec, pc, n), "-map", "[v]", "-frames:v", str(n), *ENC, str(out)])
    elif kind in ("framed", "still"):
        src = spec.p(pc["src"])
        punch = tuple(pc["punch"]) if pc.get("punch") else None
        fr = spec.data.get("frame", {})
        scale = float(pc.get("scale", fr.get("scale", 0.92) if kind == "framed" else 1.0))
        frame.composite(src, out, dur=dur, start=float(pc.get("in", 0)), width=spec.w, height=spec.h, fps=fps,
                        z0=float(pc.get("z0", 1.0)), z1=float(pc.get("z1", 1.06)), fx=pc.get("fx", 0.5),
                        fy=pc.get("fy", 0.5), punch=punch, scale=scale,
                        radius=int(pc.get("radius", fr.get("radius", 18) if kind == "framed" else 0)),
                        backdrop=pc.get("backdrop", fr.get("backdrop", frame.DEFAULT_BACKDROP)))
        if pc.get("flash"):                         # a camera-shutter white flash on the first frames
            tmp = out.with_suffix(".flash.mp4")
            run(["ffmpeg", "-y", "-i", str(out), "-vf", f"fade=t=in:st=0:d={pc['flash']}:color=white", *ENC, str(tmp)])
            tmp.replace(out)
    elif kind == "sequence":                        # stills cross-blended in order (a time-lapse from screenshots)
        srcs = [spec.p(s) for s in pc["srcs"]]
        lst = out.with_suffix(".txt")
        each = dur / len(srcs)
        lst.write_text("".join(f"file '{s}'\nduration {each:.3f}\n" for s in srcs) + f"file '{srcs[-1]}'\n")
        raw = out.with_suffix(".raw.mp4")
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-vf",
             f"scale={spec.w}:{spec.h}:force_original_aspect_ratio=increase,crop={spec.w}:{spec.h},"
             f"framerate=fps={fps}:interp_start=0:interp_end=255:scene=100,format=yuv420p",
             "-frames:v", str(n), *ENC, str(raw)])
        if pc.get("framed", True):
            fr = spec.data.get("frame", {})
            frame.composite(raw, out, dur=dur, width=spec.w, height=spec.h, fps=fps, z0=1.0,
                            z1=float(pc.get("z1", 1.04)), scale=float(fr.get("scale", 0.92)),
                            radius=int(fr.get("radius", 18)), backdrop=fr.get("backdrop", frame.DEFAULT_BACKDROP))
            raw.unlink(missing_ok=True)
        else:
            raw.replace(out)
        lst.unlink(missing_ok=True)
    elif kind == "freeze":                          # the last frame of another piece, held (end cards go over it)
        src = _piece_path(spec, next(x for x in spec.pieces if x["name"] == pc["from"]))
        still = out.with_suffix(".png")
        run(["ffmpeg", "-y", "-sseof", "-0.1", "-i", str(src), "-frames:v", "1", str(still)])
        vf = []
        if pc.get("blur"):
            vf.append(f"gblur=sigma={pc['blur']}:enable='gte(t,{pc.get('blur_at', 0.5)})'")
        if pc.get("darken"):
            vf.append(f"lutyuv=y='val*{1 - float(pc['darken'])}':enable='gte(t,{pc.get('blur_at', 0.5)})'")
        if pc.get("fade_out"):
            vf.append(f"fade=t=out:st={dur - float(pc['fade_out'])}:d={pc['fade_out']}")
        run(["ffmpeg", "-y", "-loop", "1", "-framerate", str(fps), "-t", f"{dur}", "-i", str(still),
             *(["-vf", ",".join(vf)] if vf else []), "-frames:v", str(n), *ENC, str(out)])
        still.unlink(missing_ok=True)
    elif kind == "color":
        run(["ffmpeg", "-y", "-f", "lavfi", "-i", f"color=c={pc.get('color', 'black')}:s={spec.w}x{spec.h}:r={fps}",
             "-frames:v", str(n), *ENC, str(out)])
    else:
        raise EditorError(f"piece {pc['name']}: unknown type {kind!r} (video, framed, still, sequence, freeze, color)")


def _piece_key(spec: Spec, pc: dict) -> str:
    srcs = [pc.get("src")] + list(pc.get("srcs", []))
    deps = [_mtime(spec.p(s)) for s in srcs if isinstance(s, str)]
    if pc.get("type") == "freeze":
        deps.append(_piece_key(spec, next(x for x in spec.pieces if x["name"] == pc["from"])))
    clean = {k: v for k, v in pc.items() if not k.startswith("_")}
    return _hash(clean, deps, spec.w, spec.h, spec.fps, spec.data.get("frame"))


def _piece_path(spec: Spec, pc: dict) -> Path:
    return spec.work / "pieces" / f"{pc['name']}.{_piece_key(spec, pc)}.mp4"


def pieces(spec: Spec, jobs: int = 4) -> Path:
    (spec.work / "pieces").mkdir(parents=True, exist_ok=True)
    todo = [pc for pc in spec.pieces if not _piece_path(spec, pc).exists()]
    later = [pc for pc in todo if pc.get("type") == "freeze"]
    first = [pc for pc in todo if pc.get("type") != "freeze"]

    def one(pc):
        out = _piece_path(spec, pc)
        tmp = out.with_suffix(".part.mp4")
        _render_piece(spec, pc, tmp)
        tmp.replace(out)
        log(f"produce: piece {pc['name']} ({pc['_dur']:.2f} s)")

    with ThreadPoolExecutor(max(1, jobs)) as ex:
        list(ex.map(one, first))
    for pc in later:
        one(pc)
    log(f"produce: {len(todo)} piece(s) rendered, {len(spec.pieces) - len(todo)} cached")
    lst = spec.work / "pieces.txt"
    lst.write_text("".join(f"file '{_piece_path(spec, pc)}'\n" for pc in spec.pieces))
    base = spec.work / "base.mp4"
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(base)])
    got = float(probe(base)["duration"])
    if abs(got - spec.total) > 1.5 / spec.fps:
        log(f"produce: base is {got:.3f} s, the plan says {spec.total:.3f} s (check piece durations)")
    return base


# ---------------------------------------------------------------- captions from word times

def caption_cards(words: list[dict], voice: str, src_in: float, src_out: float, max_chars: int = 42,
                  lines: int = 2, gap: float = 0.6, replace: dict | None = None) -> list[dict]:
    """Phrase-at-a-time caption cards from timed words (start/end/text in the voice's source seconds), anchored on
    the voice with `@voice:<src>` references. A card ends at a long pause, at . ? !, or when it would need more
    than `lines` x `max_chars`."""
    ws = [w for w in words if src_in <= float(w["start"]) < src_out]
    cards, cur = [], []

    def flush():
        if cur:
            text = " ".join(str(w.get("text", w.get("word", ""))).strip() for w in cur).strip()
            for k, v in (replace or {}).items():
                text = re.sub(rf"(?i)\b{re.escape(k)}\b", v, text)
            if text:
                text = text[0].upper() + text[1:]
                end = min(float(cur[-1]["end"]) + 0.15, src_out)
                cards.append({"type": "caption", "text": text, "t_in": f"@{voice}:{float(cur[0]['start']):.2f}",
                              "t_out": f"@{voice}:{end:.2f}"})
            cur.clear()

    for w in ws:
        t = str(w.get("text", w.get("word", ""))).strip()
        if cur and (float(w["start"]) - float(cur[-1]["end"]) > gap or
                    len(" ".join(str(x.get("text", x.get("word", ""))) for x in cur)) + 1 + len(t) > max_chars * lines):
            flush()
        cur.append(w)
        if t.endswith((".", "?", "!")):
            flush()
    flush()
    for a_, b_ in zip(cards, cards[1:]):           # never overlap the next card
        a_["t_out"] = min(a_["t_out"], b_["t_in"], key=lambda r: float(r.split(":")[1]))
    return cards


def auto_captions(spec: Spec) -> list[dict]:
    c = spec.data.get("captions")
    if not c:
        return []
    out = []
    for name, path in c.get("voices", {}).items():
        v = spec.voices.get(name)
        if not v:
            raise EditorError(f"captions: no voice named {name!r}")
        data = json.loads(spec.p(path).read_text())
        words = data["words"] if isinstance(data, dict) else data
        out += caption_cards(words, name, float(v.get("in", 0)), float(v.get("out", 1e9)),
                             int(c.get("max_chars", 42)), int(c.get("lines", 2)), float(c.get("gap", 0.6)),
                             c.get("replace"))
    return out


# ---------------------------------------------------------------- overlay

def overlay(spec: Spec, jobs: int = 3) -> Path | None:
    ov = spec.data.get("overlay")
    auto = auto_captions(spec)
    if not ov and not auto and not ramp_shimmers(spec):
        return None
    if isinstance(ov, str):
        ov = json.loads(spec.p(ov).read_text())
    ov = dict(ov or {"elements": []})
    ov["elements"] = list(ov.get("elements", [])) + auto + ramp_shimmers(spec)
    ov = spec.resolve(ov)
    ov.setdefault("duration", spec.total)
    th = ov.setdefault("theme", {})
    th.setdefault("width", spec.w)
    th.setdefault("height", spec.h)
    th.setdefault("fps", spec.fps)
    key = _hash(ov)
    out = spec.work / f"overlay.{key}.mov"
    resolved = spec.work / "overlay.resolved.json"
    resolved.write_text(json.dumps(ov, indent=1, ensure_ascii=False))
    if not out.exists():
        from .overlay import render
        tmp = spec.work / f"overlay.{key}.part.mov"
        render(resolved, tmp, jobs=jobs)
        tmp.replace(out)
    else:
        log("produce: overlay cached")
    return out


# ---------------------------------------------------------------- audio

def _audio_src(spec: Spec, src, length: float, cache: Path) -> Path:
    """A file path, a built-in sound name (compose sfx), or {"compose": {...}} / {"ambience": kind} / {"lofi": {...}}."""
    from . import compose
    cache.mkdir(parents=True, exist_ok=True)
    if isinstance(src, str):
        p = spec.p(src)
        if p.exists():
            return p
        out = cache / f"sfx_{src}.wav"
        if not out.exists():
            compose.sfx(src, out)
        return out
    if "compose" in src:
        params = dict(src["compose"])
        params.setdefault("length", length)
        out = cache / f"bed_{_hash(params)}.wav"
        if not out.exists():
            compose.bed(out=out, **params)
        return out
    if "lofi" in src:
        params = dict(src["lofi"] or {})
        params.setdefault("length", length)
        out = cache / f"lofi_{_hash(params)}.wav"
        if not out.exists():
            compose.lofi(out=out, **params)
        return out
    if "ambience" in src:
        out = cache / f"amb_{src['ambience']}_{length:.1f}.wav"
        if not out.exists():
            compose.ambience(src["ambience"], length=length, out=out)
        return out
    raise EditorError(f"unknown audio source {src!r}")


def mix(spec: Spec) -> Path:
    a = spec.data.get("audio", {})
    total = spec.total
    cache = spec.work / "audio"
    ins, graph = [], []

    def add(item: dict, label: str, default_len: float, clean: bool = False) -> str:
        at = spec.t(item.get("at", 0))
        t0 = float(item.get("in", 0))
        if "out" in item:
            dur = float(item["out"]) - t0
        elif "dur" in item:
            dur = float(item["dur"])
        elif isinstance(item["src"], str) and spec.p(item["src"]).exists():
            dur = min(default_len, float(probe(spec.p(item["src"]))["duration"]) - t0) if default_len else \
                float(probe(spec.p(item["src"]))["duration"]) - t0
        else:
            dur = default_len
        path = _audio_src(spec, item["src"], dur if not isinstance(item["src"], str) else default_len, cache)
        ins.extend(["-i", str(path)])
        i = len(ins) // 2 - 1
        chain = [f"atrim={t0}:{t0 + dur}", "asetpts=N/SR/TB", "aresample=48000",
                 "aformat=sample_fmts=fltp:channel_layouts=stereo"]
        if clean or item.get("clean"):
            chain.append(VOICE_CLEAN)
        chain.append(f"volume={float(item.get('gain', 0))}dB")
        if item.get("automation"):                 # [[t, dB], ...] in output seconds (or references), linear between
            pts = [(spec.t(t) - at, float(db)) for t, db in item["automation"]]
            expr = _ramp_expr(pts)
            chain.append(f"volume='{expr}':eval=frame")
        if item.get("fade_in"):
            chain.append(f"afade=t=in:d={item['fade_in']}")
        if item.get("fade_out"):
            chain.append(f"afade=t=out:st={max(0.0, dur - float(item['fade_out']))}:d={item['fade_out']}")
        chain.append(f"adelay={int(round(at * 1000))}:all=1")
        lab = f"{label}{i}"
        graph.append(f"[{i}:a]{','.join(chain)}[{lab}]")
        return lab

    voices = [add(v, "v", 0, clean=v.get("clean", True)) for v in a.get("voices", [])]
    music = [add(m, "m", total - spec.t(m.get("at", 0))) for m in a.get("music", [])]
    duck = [m.get("duck", True) for m in a.get("music", [])]
    fx = [add(s, "s", 2.0) for s in a.get("sfx", [])] + [add(b, "b", total - spec.t(b.get("at", 0)))
                                                        for b in a.get("beds", [])]
    buses = []
    if voices:
        graph.append(f"{''.join(f'[{v}]' for v in voices)}amix=inputs={len(voices)}:normalize=0,"
                     f"apad=whole_dur={total},asplit=2[vox][vsc]")
        buses.append("[vox]")
    ducked = [m for m, d in zip(music, duck) if d]
    free = [m for m, d in zip(music, duck) if not d]
    if ducked:
        d = a.get("duck", {})
        graph.append(f"{''.join(f'[{m}]' for m in ducked)}amix=inputs={len(ducked)}:normalize=0,"
                     f"apad=whole_dur={total}[mus]")
        if voices:
            graph.append(f"[mus][vsc]sidechaincompress=threshold={d.get('threshold', 0.015)}:ratio={d.get('ratio', 10)}"
                         f":attack={d.get('attack', 150)}:release={d.get('release', 400)}:makeup=1[mduck]")
            buses.append("[mduck]")
        else:
            buses.append("[mus]")
    elif voices:
        graph.append("[vsc]anullsink")
    buses += [f"[{x}]" for x in free + fx]
    if not buses:
        raise EditorError("the spec has no audio")
    graph.append(f"{''.join(buses)}amix=inputs={len(buses)}:normalize=0,apad=whole_dur={total},atrim=0:{total},"
                 f"alimiter=limit=0.95[pre]")
    pre = spec.work / "mix_pre.wav"
    run(["ffmpeg", "-y", *ins, "-filter_complex", ";".join(graph), "-map", "[pre]", "-ar", "48000", "-ac", "2",
         "-c:a", "pcm_s24le", str(pre)])
    o = spec.data.get("output", {})
    out = spec.work / "mix.wav"
    _loudnorm(pre, out, float(o.get("lufs", -14)), float(o.get("tp", -1.5)))
    return out


def _ramp_expr(pts: list[tuple[float, float]]) -> str:
    """Piecewise-linear gain in dB over time -> an ffmpeg volume expression (linear factor)."""
    pts = sorted(pts)
    if len(pts) == 1:
        return f"{10 ** (pts[0][1] / 20):.5f}"
    expr = f"{10 ** (pts[-1][1] / 20):.5f}"
    for (t0, d0), (t1, d1) in reversed(list(zip(pts, pts[1:]))):
        seg = f"pow(10,({d0}+({d1}-({d0}))*(t-{t0})/{max(1e-3, t1 - t0)})/20)"
        expr = f"if(lt(t,{t1}),{seg},{expr})"
    return f"if(lt(t,{pts[0][0]}),{10 ** (pts[0][1] / 20):.5f},{expr})"


def _loudnorm(src: Path, out: Path, lufs: float, tp: float) -> None:
    import subprocess
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(src), "-af",
                        f"loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    if not m:
        run(["ffmpeg", "-y", "-i", str(src), "-af", f"loudnorm=I={lufs}:TP={tp}:LRA=11", "-ar", "48000", str(out)])
        return
    j = json.loads(m.group(0))
    run(["ffmpeg", "-y", "-i", str(src), "-af",
         f"loudnorm=I={lufs}:TP={tp}:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:"
         f"measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true",
         "-ar", "48000", str(out)])


# ---------------------------------------------------------------- composite, extras

def composite(spec: Spec, base: Path, ov: Path | None, audio: Path, out: Path | None = None) -> Path:
    o = spec.data.get("output", {})
    out = out or spec.file
    out.parent.mkdir(parents=True, exist_ok=True)
    br = o.get("bitrate", "16M")
    vf = (["-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]"] if ov
          else ["-map", "0:v"])
    run(["ffmpeg", "-y", "-i", str(base), *(["-i", str(ov)] if ov else []), "-i", str(audio), *vf,
         "-map", f"{2 if ov else 1}:a", "-t", f"{spec.total}", "-c:v", "libx264", "-preset", o.get("preset", "veryfast"),
         "-b:v", br, "-maxrate", o.get("maxrate", "20M"), "-bufsize", o.get("bufsize", "32M"), "-r", str(spec.fps),
         "-c:a", "aac", "-b:a", o.get("audio_bitrate", "320k"), "-movflags", "+faststart", str(out)])
    return out


def extras(spec: Spec, final: Path) -> list[Path]:
    made = []
    for x in spec.data.get("extras", []):
        a, b = spec.t(x.get("from", 0)), spec.t(x.get("to", spec.total))
        w, h = x.get("size", [spec.w, spec.h])
        out = spec.p(x.get("file", f"{final.with_suffix('')}_{x['name']}.mp4"))
        vf = (f"crop='min(iw,ih*{w}/{h})':'min(ih,iw*{h}/{w})':(iw-ow)*{x.get('x', 0.5)}:(ih-oh)*{x.get('y', 0.5)},"
              f"scale={w}:{h}:flags=lanczos")
        run(["ffmpeg", "-y", "-ss", f"{a}", "-to", f"{b}", "-i", str(final), "-vf", vf, "-c:v", "libx264", "-preset",
             "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)])
        made.append(out)
    return made


def preview(final: Path) -> Path:
    out = final.with_name(final.stem + "_preview720.mp4")
    run(["ffmpeg", "-y", "-i", str(final), "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "24", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)])
    return out


# ---------------------------------------------------------------- review

def review(spec: Spec, final: Path | None = None) -> dict:
    """What a human checks before sending a draft: length vs target, loudness, captions on every spoken line,
    graphics ending inside the video, and a frame at every graphic (sheets to Read)."""
    import subprocess
    from .qa import sheet
    final = final or spec.file
    if not final.exists():
        raise EditorError(f"{final} doesn't exist yet: produce it first")
    out = spec.work / "review"
    out.mkdir(parents=True, exist_ok=True)
    issues, rep = [], {"file": str(final)}
    dur = float(probe(final)["duration"])
    rep["duration"] = round(dur, 2)
    want = spec.data.get("output", {}).get("duration")
    if want and abs(dur - float(want)) > 0.1:
        issues.append(f"length {dur:.2f} s, the target is {want} s")
    if spec.data.get("output", {}).get("max_duration") and dur > float(spec.data["output"]["max_duration"]):
        issues.append(f"over the limit: {dur:.2f} s > {spec.data['output']['max_duration']} s")
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(final), "-af", "ebur128=peak=true", "-f", "null", "-"],
                       capture_output=True, text=True)
    i_ = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
    p_ = re.findall(r"Peak:\s+(-?[\d.]+) dBFS", r.stderr)
    rep["lufs"] = float(i_[-1]) if i_ else None
    rep["peak"] = float(p_[-1]) if p_ else None
    target = float(spec.data.get("output", {}).get("lufs", -14))
    if rep["lufs"] is not None and abs(rep["lufs"] - target) > 1.0:
        issues.append(f"loudness {rep['lufs']} LUFS, the target is {target}")
    # captions on every spoken line
    ov = spec.data.get("overlay") or {}
    ov = json.loads(spec.p(ov).read_text()) if isinstance(ov, str) else ov
    els = spec.resolve({**ov, "elements": list(ov.get("elements", [])) + auto_captions(spec)}).get("elements", [])
    caps = sorted((float(e["t_in"]), float(e["t_out"])) for e in els if e.get("type") == "caption")
    cover = []
    for name, v in spec.voices.items():
        a = spec.t(v.get("at", 0))
        d = float(v.get("out", a)) - float(v.get("in", 0)) if "out" in v else float(v.get("dur", 0))
        if d <= 0.5 or v.get("captions") is False:
            continue
        hit = sum(max(0.0, min(b_, a + d) - max(a_, a)) for a_, b_ in caps)
        pct = round(100 * hit / d)
        cover.append({"voice": name, "covered_pct": pct})
        if pct < 60:
            issues.append(f"voice {name} ({a:.1f}-{a + d:.1f} s) has captions on only {pct}% of it")
    rep["captions"] = cover
    for (a1, b1), (a2, b2) in zip(caps, caps[1:]):
        if a2 < b1 - 0.05:
            issues.append(f"captions overlap at {a2:.2f} s")
    late = [e for e in els if float(e.get("t_out", e.get("t_in", 0)) or 0) > dur + 0.05]
    if late:
        issues.append(f"{len(late)} overlay element(s) end after the video")
    # frames at every graphic (not captions), deduped to one per second
    times, seen = [], set()
    for e in sorted(els, key=lambda x: float(x.get("t_in", 0) or 0)):
        if e.get("type") in ("caption", "flash"):
            continue
        t0 = float(e.get("t_in", 0) or 0)
        t1 = float(e.get("t_out", t0 + 3.5) or t0 + 3.5)
        t = min(t0 + 0.9, (t0 + t1) / 2, dur - 0.05)
        if int(t) not in seen:
            seen.add(int(t))
            times.append(t)
    sheets = []
    for k in range(0, len(times), 12):
        chunk = times[k:k + 12]
        sel = "+".join(f"between(t,{t:.3f},{t + 0.03:.3f})" for t in chunk)
        path = out / f"graphics_{k // 12 + 1}.jpg"
        run(["ffmpeg", "-y", "-i", str(final), "-vf", f"select='{sel}',scale=480:-2,tile=4x3", "-frames:v", "1",
             "-vsync", "0", "-q:v", "4", str(path)])
        sheets.append(str(path))
    rep["graphics_sheets"] = sheets
    rep["contact_sheet"] = str(sheet(final, out / "contact_sheet.png", count=24, cols=6))
    rep["issues"] = issues
    (out / "review.json").write_text(json.dumps(rep, indent=1))
    lines = [f"# Review of {final.name}", "", f"- length {rep['duration']} s, {rep['lufs']} LUFS, peak {rep['peak']} dBFS",
             *[f"- captions on {c['voice']}: {c['covered_pct']}%" for c in cover], "",
             "## Issues" if issues else "No automatic issues found.", *[f"- {x}" for x in issues], "",
             "Read: " + ", ".join(Path(x).name for x in [rep["contact_sheet"], *sheets]),
             "Still yours to check: every frame of each sheet (overlaps, readability, faces), and say you can't hear it."]
    (out / "review.md").write_text("\n".join(lines) + "\n")
    return rep


# ---------------------------------------------------------------- driver

def produce(spec_path: str | Path, only: str | None = None, jobs: int = 4, want_preview: bool = False,
            effort: str = "standard") -> dict:
    from . import effort as eff
    spec = Spec(spec_path)
    spec.work.mkdir(parents=True, exist_ok=True)
    stages = [only] if only else ["pieces", "overlay", "mix", "composite", "extras", "review"]
    res, timing = {"total": spec.total}, {}
    base, ov, audio = spec.work / "base.mp4", None, spec.work / "mix.wav"
    for st in stages:
        t0 = time.monotonic()
        if st == "pieces":
            base = pieces(spec, jobs)
        elif st == "overlay":
            ov = overlay(spec, max(1, jobs - 1))
        elif st == "mix":
            audio = mix(spec)
        elif st == "composite":
            if ov is None and spec.data.get("overlay"):
                ov = overlay(spec, max(1, jobs - 1))         # cached: cheap when already rendered
            for need in (base, audio):
                if not need.exists():
                    raise EditorError(f"{need.name} is missing: run without --only first")
            res["file"] = str(composite(spec, base, ov, audio))
            if want_preview:
                res["preview"] = str(preview(Path(res["file"])))
        elif st == "extras":
            if spec.file.exists():
                res["extras"] = [str(p) for p in extras(spec, spec.file)]
        elif st == "review":
            res["review"] = review(spec)
        else:
            raise EditorError(f"unknown stage {st!r} (pieces, overlay, mix, composite, extras, review)")
        timing[st] = round(time.monotonic() - t0, 1)
        stage = {"pieces": "pieces", "overlay": "overlay", "mix": "mix", "composite": "composite"}.get(st)
        if stage and timing[st] > 2:                        # cached stages teach nothing
            try:
                eff.record(stage, effort, timing[st], spec.total)
            except EditorError:
                pass
        log(f"produce: {st} {timing[st]} s")
    res["timing"] = timing
    return res


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="editor produce", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--plan", action="store_true", help="print the timeline and resolved overlay times; render nothing")
    ap.add_argument("--only", choices=["pieces", "overlay", "mix", "composite", "extras", "review"])
    ap.add_argument("-j", "--jobs", type=int, default=4)
    ap.add_argument("--preview", action="store_true", help="also write a 720p preview")
    ap.add_argument("--effort", default="standard", help="for the learned timings (rush, standard, polish)")
    a = ap.parse_args(argv)
    spec = Spec(a.spec)
    if a.plan:
        print(spec.table())
        ov = spec.data.get("overlay")
        auto = auto_captions(spec)
        for card in spec.resolve(auto):
            print(f"  caption {card['t_in']:7.2f}-{card['t_out']:7.2f}  {card['text']}")
        if ov or auto:
            ov = (json.loads(spec.p(ov).read_text()) if isinstance(ov, str) else ov) or {}
            els = spec.resolve({**ov, "elements": list(ov.get("elements", [])) + auto}).get("elements", [])
            late = [e for e in els if float(e.get("t_out", e.get("t_in", 0)) or 0) > spec.total + 0.01]
            print(f"overlay: {len(els)} elements" + (f", {len(late)} end after the video" if late else ""))
        return 0
    res = produce(a.spec, a.only, a.jobs, a.preview, a.effort)
    print(json.dumps(res, indent=1))
    return 0
