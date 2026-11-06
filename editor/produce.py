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
import os
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
        for pc in self.pieces:
            if pc.get("from_shot"):
                self._from_shot(pc)
            if pc.get("focus_from"):
                self._focus_from(pc)
        self.starts, t = {}, 0.0
        for pc in self.pieces:
            pc["_dur"] = self.piece_dur(pc)
            self.starts[pc["name"]] = (t, t + pc["_dur"])
            t += pc["_dur"]
        self.total = t
        self.voices = {v["name"]: v for v in self.data.get("audio", {}).get("voices", []) if v.get("name")}

    def _from_shot(self, pc: dict) -> None:
        """"from_shot": "caps/shots.json#route" on a video piece: that shot's stretch of the `capture shots --record`
        video (src, in, out filled in unless the piece sets them)."""
        ref = str(pc["from_shot"])
        path, _, name = ref.partition("#")
        data = json.loads(self.p(path).read_text())
        shot = next((x for x in data.get("shots", []) if x.get("name") == (name or pc["name"])), None)
        if not data.get("recording") or not shot or shot.get("rec_in") is None or shot.get("rec_out") is None:
            raise EditorError(f"piece {pc['name']}: {ref} has no recorded stretch (capture with --record)")
        rec = Path(path).parent / data["recording"]
        pc.setdefault("src", str(rec))
        pc.setdefault("in", round(float(shot["rec_in"]), 2))
        pc.setdefault("out", round(float(shot["rec_out"]), 2))
        pc.setdefault("type", "video")

    def _focus_from(self, pc: dict) -> None:
        """"focus_from": "shots/shots.json#route": aim the Ken Burns and a punch-in at the element `capture shots`
        recorded for that shot (its "focus"), unless the piece sets fx/fy/punch itself."""
        ref = str(pc["focus_from"])
        path, _, name = ref.partition("#")
        try:
            data = json.loads(self.p(path).read_text())
        except (OSError, ValueError) as e:
            raise EditorError(f"piece {pc['name']}: focus_from {ref}: {e}") from e
        shot = next((x for x in data.get("shots", []) if x.get("name") == (name or pc["name"])), None)
        f = (shot or {}).get("focus")
        if not f:
            raise EditorError(f"piece {pc['name']}: no recorded focus for shot {name or pc['name']!r} in {path} "
                              "(add \"focus\": \"text=...\" to that shot and capture again)")
        # zoompan keeps the anchor at the same relative place in view; to put the target in the middle of the view at
        # zoom z the anchor is (target - 0.5/z) / (1 - 1/z), clamped to the picture's edges
        anchor = lambda t, z: round(min(1.0, max(0.0, (t - 0.5 / z) / (1 - 1 / z))), 4) if z > 1.001 else t  # noqa: E731
        z1 = float(pc.get("z1", 1.06))
        pc.setdefault("fx", anchor(f["x"], z1))
        pc.setdefault("fy", anchor(f["y"], z1))
        if "punch" not in pc:
            dur = float(pc.get("dur", 4))
            zoom = round(max(1.3, min(2.0, 0.45 / max(f.get("w", 0.3), f.get("h", 0.3), 0.05))), 2)
            pc["punch"] = [round(min(1.2, dur * 0.35), 2), zoom, anchor(f["x"], zoom * z1), anchor(f["y"], zoom * z1)]

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


PIECE_KEYS = {
    "video": {"src", "in", "out", "speed", "fit", "pad", "crop_y", "grade", "bloom", "z0", "z1", "fx", "fy", "push",
              "fade_in", "fade_out", "ramp_waits", "from_shot"},
    "framed": {"src", "dur", "in", "z0", "z1", "fx", "fy", "punch", "flash", "scale", "radius", "backdrop", "focus_from"},
    "still": {"src", "dur", "in", "z0", "z1", "fx", "fy", "punch", "flash", "scale", "radius", "backdrop", "focus_from"},
    "sequence": {"srcs", "dur", "framed", "z1"},
    "freeze": {"from", "dur", "blur", "darken", "blur_at", "fade_out"},
    "color": {"color", "dur"},
}
COMMON_KEYS = {"name", "type", "chapter", "note", "notes", "todo", "label", "transition"}


def validate(spec: "Spec") -> tuple[list[str], list[str]]:
    """(errors, warnings) before anything renders: missing files, unknown fields (typos), bad references,
    malformed punches and overlay elements. Errors stop a render."""
    errors, warnings = [], []
    names = {pc["name"] for pc in spec.pieces}
    for pc in spec.pieces:
        kind, where = pc.get("type", "video"), f"piece {pc['name']}"
        allowed = PIECE_KEYS.get(kind)
        if allowed is None:
            errors.append(f"{where}: unknown type {kind!r} ({', '.join(PIECE_KEYS)})")
            continue
        extra = sorted(k for k in pc if not k.startswith("_") and k not in allowed | COMMON_KEYS)
        if extra:
            warnings.append(f"{where}: unknown field(s) {', '.join(extra)} (typo? see spec.md)")
        for src in ([pc["src"]] if isinstance(pc.get("src"), str) else []) + list(pc.get("srcs", [])):
            if not spec.p(src).exists():
                errors.append(f"{where}: file not found: {src}")
        for k, n in (("punch", 4), ("push", 5)):
            if pc.get(k) is not None and (not isinstance(pc[k], list) or len(pc[k]) != n):
                errors.append(f"{where}: {k} needs {n} numbers")
        tr = pc.get("transition")
        if tr:
            tk = tr.get("type") if isinstance(tr, dict) else str(tr)
            if tk not in TRANSITIONS and tk not in XFADE:
                errors.append(f"{where}: unknown transition {tk!r} ({', '.join(TRANSITIONS)}, or any ffmpeg xfade name)")
            if pc is spec.pieces[0]:
                warnings.append(f"{where}: the first piece has nothing to transition from")
        if kind == "freeze" and pc.get("from") not in names:
            errors.append(f"{where}: freezes {pc.get('from')!r}, which isn't a piece")
        if kind == "video" and "out" in pc and float(pc["out"]) <= float(pc.get("in", 0)):
            errors.append(f"{where}: out must be after in")
    from .compose import fx as _fx
    builtin = set(getattr(_fx, "SFX", {})) | {"whoosh", "whoosh_rev", "whip", "click", "pop", "thud", "shutter", "paper",
                                              "ding"}
    a = spec.data.get("audio", {})
    for group in ("voices", "music", "sfx", "beds"):
        for i, item in enumerate(a.get(group, [])):
            where = f"audio {group}[{i}]" + (f" ({item['name']})" if item.get("name") else "")
            src = item.get("src")
            if isinstance(src, str) and not spec.p(src).exists() and not (group == "sfx" and src in builtin):
                errors.append(f"{where}: file not found: {src}")
            try:
                at = spec.t(item.get("at", 0))
                if at > spec.total + 0.01:
                    warnings.append(f"{where}: starts at {at:.2f} s, after the video ends")
            except EditorError as e:
                errors.append(f"{where}: {e}")
            for t, _ in item.get("automation", []) or []:
                try:
                    spec.t(t)
                except EditorError as e:
                    errors.append(f"{where} automation: {e}")
    try:
        ov = spec.data.get("overlay")
        if ov:
            ov = json.loads(spec.p(ov).read_text()) if isinstance(ov, str) else ov
            ov = spec.resolve({**ov, "elements": list(ov.get("elements", [])) + auto_captions(spec)})
            from .overlay import validate as ov_validate
            e2, w2 = ov_validate(ov)
            errors += [f"overlay: {x}" for x in e2]
            warnings += [f"overlay: {x}" for x in w2]
    except EditorError as e:
        errors.append(f"overlay: {e}")
    for x in spec.data.get("extras", []):
        for k in ("from", "to"):
            if k in x:
                try:
                    spec.t(x[k])
                except EditorError as e:
                    errors.append(f"extras {x.get('name')}: {e}")
    if spec.data.get("brief") and not spec.p(spec.data["brief"]).exists():
        warnings.append(f"brief not found: {spec.data['brief']}")
    return errors, warnings


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


NOT_PICTURE = {"chapter", "note", "notes", "todo", "label"}     # piece fields that don't change its picture


def _piece_key(spec: Spec, pc: dict) -> str:
    srcs = [pc.get("src")] + list(pc.get("srcs", []))
    deps = [_mtime(spec.p(s)) for s in srcs if isinstance(s, str)]
    if pc.get("type") == "freeze":
        deps.append(_piece_key(spec, next(x for x in spec.pieces if x["name"] == pc["from"])))
    clean = {k: v for k, v in pc.items() if not k.startswith("_") and k not in NOT_PICTURE}
    return _hash(clean, deps, spec.w, spec.h, spec.fps, spec.data.get("frame"))


def _piece_path(spec: Spec, pc: dict) -> Path:
    return spec.work / "pieces" / f"{pc['name']}.{_piece_key(spec, pc)}.mp4"


XFADE = set("""fade wipeleft wiperight wipeup wipedown slideleft slideright slideup slidedown circlecrop rectcrop distance
fadeblack fadewhite radial smoothleft smoothright smoothup smoothdown circleopen circleclose vertopen vertclose horzopen
horzclose dissolve pixelize diagtl diagtr diagbl diagbr hlslice hrslice vuslice vdslice hblur fadegrays wipetl wipetr wipebl
wipebr squeezeh squeezev zoomin fadefast fadeslow""".split())
TRANSITIONS = {"dissolve": "fade", "cross": "fade", "whip": "smoothleft", "whip_right": "smoothright",
               "swipe_up": "slideup", "swipe_left": "slideleft", "dip_white": "fadewhite", "dip_black": "fadeblack",
               "zoom": "zoomin", "blur": "hblur", "wipe": "wipeleft"}


def _join_with_transitions(spec: Spec, base: Path) -> None:
    """Join the pieces with xfade transitions INTO the pieces that ask for one ("transition": {"type", "dur"}).
    The outgoing piece holds its last frame for the transition's length, so every piece still starts on time."""
    ins, graph = [], []
    for i, pc in enumerate(spec.pieces):
        ins += ["-i", str(_piece_path(spec, pc))]
        graph.append(f"[{i}:v]fps={spec.fps},format=yuv420p,setsar=1,settb=AVTB[p{i}]")   # one timebase for xfade
    cur, t = "p0", spec.pieces[0]["_dur"]
    for i, pc in enumerate(spec.pieces[1:], 1):
        tr = pc.get("transition")
        if tr:
            kind = tr["type"] if isinstance(tr, dict) else str(tr)
            d = float(tr.get("dur", 0.3)) if isinstance(tr, dict) else 0.3
            name = TRANSITIONS.get(kind, kind)
            graph.append(f"[{cur}]tpad=stop_mode=clone:stop_duration={d}[h{i}]")
            graph.append(f"[h{i}][p{i}]xfade=transition={name}:duration={d}:offset={t:.4f}[j{i}]")
            # the frame held is consumed by the overlap: total length is unchanged
        else:
            graph.append(f"[{cur}][p{i}]concat=n=2:v=1:a=0,settb=AVTB[j{i}]")
        cur = f"j{i}"
        t += pc["_dur"]
    run(["ffmpeg", "-y", *ins, "-filter_complex", ";".join(graph), "-map", f"[{cur}]", "-r", str(spec.fps),
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", "-an", str(base)])


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
    if any(pc.get("transition") for pc in spec.pieces[1:]):
        _join_with_transitions(spec, base)
    else:
        run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(base)])
    got = float(probe(base)["duration"])
    if abs(got - spec.total) > 1.5 / spec.fps:
        log(f"produce: base is {got:.3f} s, the plan says {spec.total:.3f} s (check piece durations)")
    return base


# ---------------------------------------------------------------- captions from word times

def caption_cards(words: list[dict], voice: str, src_in: float, src_out: float, max_chars: int = 42,
                  lines: int = 2, gap: float = 0.6, replace: dict | None = None, max_dur: float = 3.5) -> list[dict]:
    """Phrase-at-a-time caption cards from timed words (start/end/text in the voice's source seconds), anchored on
    the voice with `@voice:<src>` references. A card ends at a long pause, at . ? !, or when it would need more
    than `lines` x `max_chars`, or would stay up longer than `max_dur` (unpunctuated offline transcripts)."""
    ws = [w for w in words if src_in <= float(w["start"]) < src_out]
    cards, cur = [], []

    def flush():
        if cur:
            text = " ".join(str(w.get("text", w.get("word", ""))).strip() for w in cur).strip()
            for k, v in (replace or {}).items():
                text = re.sub(rf"(?i)\b{re.escape(k)}\b", v, text)
            end = min(float(cur[-1]["end"]) + 0.15, src_out)
            if text and end - float(cur[0]["start"]) >= 0.25:
                text = text[0].upper() + text[1:]
                cards.append({"type": "caption", "text": text, "t_in": f"@{voice}:{float(cur[0]['start']):.2f}",
                              "t_out": f"@{voice}:{end:.2f}"})
            cur.clear()

    for w in ws:
        t = str(w.get("text", w.get("word", ""))).strip()
        if cur and (float(w["start"]) - float(cur[-1]["end"]) > gap or
                    float(w["end"]) - float(cur[0]["start"]) > max_dur or
                    len(" ".join(str(x.get("text", x.get("word", ""))) for x in cur)) + 1 + len(t) > max_chars * lines):
            flush()
        cur.append(w)
        if t.endswith((".", "?", "!")):
            flush()
    flush()
    for a_, b_ in zip(cards, cards[1:]):           # never overlap the next card
        a_["t_out"] = min(a_["t_out"], b_["t_in"], key=lambda r: float(r.split(":")[1]))
    return [c for c in cards if float(c["t_out"].split(":")[1]) - float(c["t_in"].split(":")[1]) >= 0.2]


def auto_captions(spec: Spec) -> list[dict]:
    c = spec.data.get("captions")
    if not c:
        return []
    out = []
    UNHEARD.clear()
    for name, src in c.get("voices", {}).items():
        v = spec.voices.get(name)
        if not v:
            raise EditorError(f"captions: no voice named {name!r}")
        cfg = src if isinstance(src, dict) else {"words": src}
        data = json.loads(spec.p(cfg["words"]).read_text())
        words = data["words"] if isinstance(data, dict) else data
        a, b = float(v.get("in", 0)), float(v.get("out", 1e9))
        if cfg.get("lines"):                  # the script, one caption card per line, timed on the recognised words
            out += script_cards(words, name, a, b, cfg["lines"])
            continue
        if cfg.get("script"):                 # the script as text: its words, the recogniser's timing
            words = scripted_words(words, a, b, cfg["script"])
        out += caption_cards(words, name, a, b, int(c.get("max_chars", 42)), int(c.get("lines", 2)),
                             float(c.get("gap", 0.6)), c.get("replace"), float(c.get("max_dur", 3.5)))
    return out


def scripted_words(words: list[dict], a: float, b: float, script: str) -> list[dict]:
    """Align what was meant (the script) to what was heard (timed words), keeping the timings (editor.retext)."""
    from .retext import align
    heard = [dict(w, text=str(w.get("text", w.get("word", "")))) for w in words if a <= float(w["start"]) < b]
    return align(heard, script.split()) if heard else []


UNHEARD: list[tuple[str, str]] = []   # (voice, line) script lines nothing in their voice matched


def script_cards(words: list[dict], voice: str, a: float, b: float, lines: list[str]) -> list[dict]:
    """One caption card per script line, timed by aligning the whole script onto the recognised words."""
    texts = [ln["text"] if isinstance(ln, dict) else str(ln) for ln in lines]
    subs = [ln.get("sub") if isinstance(ln, dict) else None for ln in lines]
    lines = texts
    tokens, owner = [], []
    for i, line in enumerate(lines):
        for t in str(line).split():
            tokens.append(t)
            owner.append(i)
    timed = scripted_words(words, a, b, " ".join(tokens))
    if len(timed) != len(tokens):
        raise EditorError(f"captions for {voice}: couldn't align the script ({len(timed)} of {len(tokens)} words)")
    cards = []
    for i, line in enumerate(lines):
        ws = [w for w, o in zip(timed, owner) if o == i]
        if not ws:
            continue
        if all(w.get("retext") for w in ws) and float(ws[-1]["end"]) - float(ws[0]["start"]) < 0.25 * len(ws):
            UNHEARD.append((voice, str(line).strip()))   # nothing of it was recognised in this voice: say so, don't hide it
            log(f"captions {voice}: line {i + 1} wasn't heard in this voice, dropped: {str(line).strip()!r} "
                "(give it to the voice that says it, or a hand-written caption)")
            continue
        t_in = float(ws[0]["start"])
        longest = 0.8 + 0.5 * len(ws)              # a reading pace cap: a misaligned short line can't hang for seconds
        t_out = min(float(ws[-1]["end"]) + 0.15, b, t_in + longest)
        if t_out - t_in < 0.25:
            continue
        card = {"type": "caption", "text": str(line).strip(), "t_in": f"@{voice}:{t_in:.2f}",
                "t_out": f"@{voice}:{t_out:.2f}"}
        if subs[i]:
            card["sub"] = subs[i]
        cards.append(card)
    for x, y in zip(cards, cards[1:]):
        x["t_out"] = min(x["t_out"], y["t_in"], key=lambda r: float(r.split(":")[1]))
    return [c for c in cards if float(c["t_out"].split(":")[1]) - float(c["t_in"].split(":")[1]) >= 0.2]


def brief_lines(text: str) -> list[dict]:
    """Caption lines from a brief: "0:31 ¿Cuál es...?" lines, with an indented "(translation)" line as its sub."""
    out = []
    for raw in text.splitlines():
        m = re.match(r"^\s*(\d{1,2}:\d{2})\s+(\S.*)$", raw)
        if m:
            out.append({"at": m.group(1), "text": m.group(2).strip()})
        elif out and re.match(r"^\s+\(.+\)\s*$", raw):
            out[-1]["sub"] = raw.strip()
    return out


STOP = set("a an the and or but to of in on at for with by from as is it its it's that this be are was were i you "
           "we he she they my our your his her their me us them so not no do does did just".split())


def _tokens(text: str, content: bool = False) -> list[str]:
    toks = [t for t in re.sub(r"[^\w' ]", " ", text.lower()).split() if t]
    return [t for t in toks if t not in STOP and len(t) > 2] if content else toks


def captions_from_brief(spec_path: str | Path, brief: str | Path) -> dict:
    """Give each voice its lines from the brief's caption list: each line goes to the voice whose recognised words
    share the most with it (in order), then `lines` makes one card per line timed on what was heard."""
    spec = Spec(spec_path)
    lines = brief_lines(Path(brief).read_text())
    caps = spec.data.setdefault("captions", {})
    vmap = caps.setdefault("voices", {})
    heard = {}
    for name, src in vmap.items():
        cfg = src if isinstance(src, dict) else {"words": src}
        data = json.loads(spec.p(cfg["words"]).read_text())
        ws = data["words"] if isinstance(data, dict) else data
        v = spec.voices.get(name, {})
        a, b = float(v.get("in", 0)), float(v.get("out", 1e9))
        heard[name] = (cfg["words"], set(_tokens(" ".join(str(w.get("text", w.get("word", "")))
                                                          for w in ws if a <= float(w["start"]) < b), content=True)))
    if not heard:
        raise EditorError("captions.voices is empty: map each voice to its words file first (produce init does)")
    assigned = {n: [] for n in heard}
    lost = []
    for ln in lines:
        toks = _tokens(ln["text"], content=True)
        if not toks:
            lost.append(ln)
            continue
        score, best = max(((sum(t in heard[n][1] for t in toks) / len(toks), n) for n in heard), default=(0, None))
        if best and score >= 0.5:
            assigned[best].append({k: ln[k] for k in ("text", "sub") if k in ln})
        else:
            lost.append(ln)
    for n, ls in assigned.items():
        if ls:
            vmap[n] = {"words": heard[n][0], "lines": ls}
    Path(spec_path).write_text(json.dumps(spec.data, indent=1, ensure_ascii=False) + "\n")
    report = {"assigned": {n: len(ls) for n, ls in assigned.items() if ls},
              "unmatched": [f"{ln['at']} {ln['text']}" for ln in lost]}
    log(f"produce: captions from the brief: {sum(report['assigned'].values())} line(s) placed, "
        f"{len(lost)} unmatched (write those as overlay captions by hand)")
    return report


# ---------------------------------------------------------------- overlay

def overlay(spec: Spec, jobs: int = 3, span: tuple[float, float] | None = None) -> Path | None:
    """The overlay track (cached by content). With `span` only that stretch is rendered (output t=0 = span start)."""
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
    key = _hash(ov, span)
    out = spec.work / (f"overlay.{key}.mov" if not span else f"range_overlay.{key}.mov")
    resolved = spec.work / "overlay.resolved.json"
    resolved.write_text(json.dumps(ov, indent=1, ensure_ascii=False))
    if not out.exists():
        from .overlay import render
        tmp = out.with_name(out.stem + ".part.mov")
        render(resolved, tmp, start=span[0] if span else None, end=span[1] if span else None, jobs=jobs)
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
                     f"apad=whole_dur={total},asplit=3[vox][vsc][vstem]")
        buses.append("[vox]")
    mstems = []
    ducked = [m for m, d in zip(music, duck) if d]
    free = [m for m, d in zip(music, duck) if not d]
    if ducked:
        d = a.get("duck", {})
        graph.append(f"{''.join(f'[{m}]' for m in ducked)}amix=inputs={len(ducked)}:normalize=0,"
                     f"apad=whole_dur={total}[mus]")
        if voices:
            graph.append(f"[mus][vsc]sidechaincompress=threshold={d.get('threshold', 0.015)}:ratio={d.get('ratio', 10)}"
                         f":attack={d.get('attack', 150)}:release={d.get('release', 400)}:makeup=1,asplit=2[mduck][ms0]")
            buses.append("[mduck]")
        else:
            graph.append("[mus]asplit=2[mus1][ms0]")
            buses.append("[mus1]")
        mstems.append("[ms0]")
    elif voices:
        graph.append("[vsc]anullsink")
    for i, m in enumerate(free):                    # music that doesn't duck still counts against the voice
        graph.append(f"[{m}]asplit=2[{m}a][ms{i + 1}]")
        mstems.append(f"[ms{i + 1}]")
    buses += [f"[{x}a]" for x in free] + [f"[{x}]" for x in fx]
    if not buses:
        raise EditorError("the spec has no audio")
    graph.append(f"{''.join(buses)}amix=inputs={len(buses)}:normalize=0,apad=whole_dur={total},atrim=0:{total},"
                 f"alimiter=limit=0.95[pre]")
    stems = []                                       # voice and music buses, for the review's "can we hear you" check
    if voices and mstems:
        graph.append(f"{''.join(mstems)}amix=inputs={len(mstems)}:normalize=0[mstem]")
        stems = ["-map", "[vstem]", "-ac", "1", "-ar", "16000", str(spec.work / "stem_voice.wav"),
                 "-map", "[mstem]", "-ac", "1", "-ar", "16000", str(spec.work / "stem_music.wav")]
    else:
        for x in ("[vstem]", *mstems):
            if voices or x != "[vstem]":
                graph.append(f"{x}anullsink")
        for f in ("stem_voice.wav", "stem_music.wav"):
            (spec.work / f).unlink(missing_ok=True)
    pre = spec.work / "mix_pre.wav"
    run(["ffmpeg", "-y", *ins, "-filter_complex", ";".join(graph), "-map", "[pre]", "-ar", "48000", "-ac", "2",
         "-c:a", "pcm_s24le", str(pre), *stems])
    o = spec.data.get("output", {})
    out = spec.work / "mix.wav"
    _loudnorm(pre, out, float(o.get("lufs", -14)), float(o.get("tp", -1.5)), total)
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


def _loudnorm(src: Path, out: Path, lufs: float, tp: float, total: float | None = None) -> None:
    import subprocess
    r = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(src), "-af",
                        f"loudnorm=I={lufs}:TP={tp}:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr, re.S)
    if not m:
        pad = f",apad=whole_dur={total},atrim=0:{total}" if total else ""
        run(["ffmpeg", "-y", "-i", str(src), "-af", f"loudnorm=I={lufs}:TP={tp}:LRA=11{pad}", "-ar", "48000", str(out)])
        return
    j = json.loads(m.group(0))
    run(["ffmpeg", "-y", "-i", str(src), "-af",
         f"loudnorm=I={lufs}:TP={tp}:LRA=11:measured_I={j['input_i']}:measured_TP={j['input_tp']}:"
         f"measured_LRA={j['input_lra']}:measured_thresh={j['input_thresh']}:offset={j['target_offset']}:linear=true"
         + (f",apad=whole_dur={total},atrim=0:{total}" if total else ""),     # loudnorm can drop the tail of short mixes
         "-ar", "48000", str(out)])


# ---------------------------------------------------------------- composite, extras

ENCODE = {"rush": "veryfast", "standard": "veryfast", "polish": "slow"}    # final composite x264 preset by effort


def composite(spec: Spec, base: Path, ov: Path | None, audio: Path, out: Path | None = None,
              effort: str = "standard") -> Path:
    o = spec.data.get("output", {})
    out = out or spec.file
    out.parent.mkdir(parents=True, exist_ok=True)
    br = o.get("bitrate", "16M")
    vf = (["-filter_complex", "[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v]", "-map", "[v]"] if ov
          else ["-map", "0:v"])
    run(["ffmpeg", "-y", "-i", str(base), *(["-i", str(ov)] if ov else []), "-i", str(audio), *vf,
         "-map", f"{2 if ov else 1}:a", "-t", f"{spec.total}", "-c:v", "libx264",
         "-preset", o.get("preset", ENCODE.get(effort, "veryfast")),
         "-b:v", br, "-maxrate", o.get("maxrate", "20M"), "-bufsize", o.get("bufsize", "32M"), "-r", str(spec.fps),
         "-c:a", "aac", "-b:a", o.get("audio_bitrate", "320k"), "-movflags", "+faststart", str(out)])
    return out


def extras(spec: Spec, final: Path) -> list[Path]:
    made = []
    for x in spec.data.get("extras", []):
        a, b = spec.t(x.get("from", 0)), spec.t(x.get("to", spec.total))
        w, h = x.get("size", [spec.w, spec.h])
        out = spec.p(x.get("file", f"{final.with_suffix('')}_{x['name']}.mp4"))
        if x.get("kind") == "band":            # a vertical/square social cut: the frame as a band over its own blur
            if x.get("ranges"):                  # a highlight reel: several moments, back to back
                made.append(_highlights(spec, final, out, int(w), int(h), x))
            else:
                made.append(_band(final, out, a, b, int(w), int(h), x))
            continue
        vf = (f"crop='min(iw,ih*{w}/{h})':'min(ih,iw*{h}/{w})':(iw-ow)*{x.get('x', 0.5)}:(ih-oh)*{x.get('y', 0.5)},"
              f"scale={w}:{h}:flags=lanczos")
        run(["ffmpeg", "-y", "-ss", f"{a}", "-to", f"{b}", "-i", str(final), "-vf", vf, "-c:v", "libx264", "-preset",
             "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)])
        made.append(out)
    return made


def _font(name: str | None) -> str | None:
    from .fonts import installed
    fonts = installed()
    hit = fonts.get(name or "DM Sans Bold") or fonts.get(name or "DM Sans")
    return str(hit) if hit else None             # None: ffmpeg's default font


def _fit_title(title: str, w: int, size: int, k: float = 0.56, room: float = 0.88) -> tuple[int, list[str]]:
    """(font size, lines): one line if it fits, else two balanced lines, shrinking until the longest fits."""
    fits = lambda s_, n: s_ * k * n <= w * room  # noqa: E731 - an average character is ~0.56 em wide
    if fits(size, len(title)):
        return size, [title]
    words = title.split()
    best = min(range(1, len(words)), key=lambda i: abs(len(" ".join(words[:i])) - len(" ".join(words[i:]))),
               default=None)
    lines = [" ".join(words[:best]), " ".join(words[best:])] if best else [title]
    longest = max(len(ln) for ln in lines)
    while size > 12 and not fits(size, longest):
        size -= 2
    return size, lines


def _band(final: Path, out: Path, a: float, b: float, w: int, h: int, x: dict) -> Path:
    """The finished frame scaled to the width, centred over a blurred, darkened copy filling the tall frame, with an
    optional title above it (for 9:16 and 1:1 posts of a 16:9 video)."""
    bw = w
    bh = int(round(bw * 9 / 16 / 2) * 2)
    y = int(x.get("band_y", (h - bh) / 2))
    vf = (f"[0:v]split[a][b];[a]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},"
          f"gblur=sigma={x.get('blur', 30)},eq=brightness={-float(x.get('darken', 0.25))}[bg];"
          f"[b]scale={bw}:{bh}:flags=lanczos[fg];[bg][fg]overlay=0:{y}")
    title = x.get("title")
    font = _font(x.get("font"))
    if title:
        lines = _fit_title(str(title), w, int(x.get("title_size", w * 0.075)))
        size = lines[0]
        ff = f":fontfile='{font}'" if font else ""
        top = max(40, y - size * (len(lines[1]) + 1) - size // 2)
        for k, ln in enumerate(lines[1]):
            safe = ln.replace("\\", "\\\\").replace("'", "\u2019").replace(":", "\\:").replace("%", "\\%")
            vf += (f",drawtext=text='{safe}'{ff}:fontsize={size}:fontcolor={x.get('title_color', 'white')}"
                   f":x=(w-text_w)/2:y={top + int(k * size * 1.15)}:shadowcolor=black@0.5:shadowx=0:shadowy=3")
    vf += ",format=yuv420p[v]"
    run(["ffmpeg", "-y", "-ss", f"{a}", "-to", f"{b}", "-i", str(final), "-filter_complex", vf, "-map", "[v]",
         "-map", "0:a?", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-c:a", "aac", "-b:a", "192k",
         "-movflags", "+faststart", str(out)])
    return out


def _highlights(spec: Spec, final: Path, out: Path, w: int, h: int, x: dict) -> Path:
    """Band cuts of each [from, to] range (references allowed), joined with short audio crossfades."""
    parts = []
    tmp = out.parent / f".{out.stem}_parts"
    tmp.mkdir(parents=True, exist_ok=True)
    for i, (r0, r1) in enumerate(x["ranges"]):
        part = tmp / f"{i:02d}.mp4"
        _band(final, part, spec.t(r0), spec.t(r1), w, h, x)
        parts.append(part)
    lst = tmp / "list.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lst), "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "18", "-c:a", "aac", "-b:a", "192k", "-af", "aresample=async=1", "-movflags", "+faststart", str(out)])
    for p in parts:
        p.unlink(missing_ok=True)
    lst.unlink(missing_ok=True)
    tmp.rmdir()
    return out


def preview(final: Path) -> Path:
    out = final.with_name(final.stem + "_preview720.mp4")
    run(["ffmpeg", "-y", "-i", str(final), "-vf", "scale=-2:720", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "24", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)])
    return out


# ---------------------------------------------------------------- review

def music_gaps(spec: Spec, win: float = 0.4) -> list[dict]:
    """How far the music sits under each voice while it speaks (dB in the speech band 300-4000 Hz, where music masks
    words; the median over 0.4 s windows while speaking, and the worst 10%), from the stems the mix wrote. The lesson: a skit mixed like a voice-over bed, and "we can't hear ourselves"."""
    import subprocess
    import numpy as np
    vp, mp = spec.work / "stem_voice.wav", spec.work / "stem_music.wav"
    if not (vp.exists() and mp.exists()):
        return []

    def pcm(p):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-af", "highpass=f=300,highpass=f=300,"
                              "lowpass=f=4000,lowpass=f=4000", "-f", "f32le", "-ac", "1", "-ar", "16000", "-"],
                             capture_output=True).stdout
        return np.frombuffer(raw, np.float32)

    v, m = pcm(vp), pcm(mp)
    n = int(win * 16000)
    k = min(len(v), len(m)) // n
    if k == 0:
        return []
    rms = lambda x: np.sqrt(np.mean(x[:k * n].reshape(k, n) ** 2, axis=1) + 1e-12)  # noqa: E731
    vdb, mdb = 20 * np.log10(rms(v)), 20 * np.log10(rms(m))
    out = []
    for name, vo in spec.voices.items():
        a = spec.t(vo.get("at", 0))
        d = (float(vo["out"]) - float(vo.get("in", 0))) if "out" in vo else float(vo.get("dur", 0))
        i0, i1 = int(a / win), min(k, int((a + d) / win))
        idx = [i for i in range(i0, i1) if vdb[i] > -40 and vdb[i] > vdb[i0:i1].max() - 12]   # while speaking
        if not idx:
            out.append({"voice": name, "gap_db": None, "at": a})
            continue
        gap = vdb[idx] - mdb[idx]
        worst = idx[int(np.argmin(gap))]
        out.append({"voice": name, "gap_db": round(float(np.median(gap)), 1),
                    "worst_db": round(float(np.percentile(gap, 10)), 1), "at": round(worst * win, 1)})
    return out


def _graphics_on_faces(spec: Spec, els: list[dict], dur: float, limit: float = 0.15) -> list[dict]:
    """At each graphic's mid-time: faces (OpenCV) in the clean base picture vs the overlay's alpha over them."""
    import subprocess
    import cv2
    import numpy as np
    base = spec.work / "base.mp4"
    ovs = sorted(spec.work.glob("overlay.*.mov"), key=lambda p: p.stat().st_mtime)
    ovs = [p for p in ovs if ".part." not in p.name]
    if not base.exists() or not ovs or not hasattr(cv2, "CascadeClassifier"):
        return []
    ov = ovs[-1]
    face = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    W, H = spec.w, spec.h
    hits, seen = [], set()
    for e in els:
        if e.get("type") in ("caption", "flash", "logo_sting", "end_card", "shimmer") or e.get("t_in") is None:
            continue
        t0 = float(e["t_in"])
        t1 = float(e.get("t_out", t0 + 3.5) or t0 + 3.5)
        t = min((t0 + t1) / 2, t0 + 1.5, dur - 0.05)
        if round(t) in seen:
            continue
        seen.add(round(t))

        def grab(src, fmt, ch):
            raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(src), "-frames:v", "1",
                                  "-f", "rawvideo", "-pix_fmt", fmt, "-"], capture_output=True).stdout
            return np.frombuffer(raw, np.uint8).reshape(H, W, ch) if len(raw) == W * H * ch else None

        img, rgba = grab(base, "gray", 1), grab(ov, "rgba", 4)
        if img is None or rgba is None:
            continue
        small = cv2.resize(img[:, :, 0], (W // 2, H // 2))
        for (x, y, w, h) in face.detectMultiScale(small, 1.1, 6, minSize=(W // 30, W // 30)):
            x, y, w, h = (int(v * 2) for v in (x, y, w, h))
            alpha = rgba[y:y + h, x:x + w, 3]
            share = float((alpha > 96).mean()) if alpha.size else 0.0
            if share > limit:
                hits.append({"t": round(t, 1), "covered_pct": round(100 * share), "element": e.get("type"),
                             "face": [x, y, w, h]})
    return hits


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
    gaps = music_gaps(spec)
    rep["music_under_voice"] = gaps
    for g in gaps:
        if g["gap_db"] is not None and g["gap_db"] < float(spec.data.get("output", {}).get("min_voice_gap", 9)):
            issues.append(f"voice {g['voice']}: the music is only {g['gap_db']} dB under the voice (speech band, "
                          f"worst around {g['at']:.1f} s): people may not hear what's said")
    for (a1, b1), (a2, b2) in zip(caps, caps[1:]):
        if a2 < b1 - 0.05:
            issues.append(f"captions overlap at {a2:.2f} s")
    # numbers on screen must come from the brief or be declared as read off the app's screen ("numbers_from_screen")
    if spec.data.get("brief"):
        allowed = _numbers(spec.p(spec.data["brief"]).read_text()) | {_norm_num(str(x)) for x in
                                                                     spec.data.get("numbers_from_screen", [])}
        shown = {}
        for e in els:
            if e.get("type") == "caption":
                continue                      # spoken words: what was said, checked by ear
            for txt in _texts(e):
                for n in _numbers(txt):
                    shown.setdefault(n, txt)
        rogue = sorted(n for n in shown if n not in allowed)
        rep["numbers"] = {"shown": sorted(shown), "not_in_brief": rogue}
        for n in rogue:
            issues.append(f"number {n} on screen (\"{shown[n][:60]}\") isn't in the brief or numbers_from_screen")
    late = [e for e in els if float(e.get("t_out", e.get("t_in", 0)) or 0) > dur + 0.05]
    if late:
        issues.append(f"{len(late)} overlay element(s) end after the video")
    # pacing: the longest stretch with nothing new on screen (a new piece, a push/punch, or a graphic arriving)
    changes = sorted({0.0, spec.total, *[spec.starts[pc["name"]][0] for pc in spec.pieces],
                      *[spec.starts[pc["name"]][0] + float(pc["punch"][0]) for pc in spec.pieces if pc.get("punch")],
                      *[spec.starts[pc["name"]][0] + float(pc["push"][0]) for pc in spec.pieces if pc.get("push")],
                      *[float(e["t_in"]) for e in els if e.get("type") != "caption" and e.get("t_in") is not None],
                      *[float(t) for e in els for t in e.get("times", []) or []],
                      *[float(ln["t"]) for e in els for ln in e.get("lines", []) or [] if isinstance(ln, dict) and "t" in ln]})
    still = max(((b_ - a_, a_) for a_, b_ in zip(changes, changes[1:])), default=(0.0, 0.0))
    rep["longest_still"] = {"seconds": round(still[0], 1), "at": round(still[1], 1)}
    limit = float(spec.data.get("output", {}).get("max_still", 7.0))
    if still[0] > limit:
        issues.append(f"{still[0]:.1f} s with nothing new on screen from {still[1]:.1f} s (a punch-in, a graphic or "
                      "a shorter piece would help)")
    # graphics over faces: faces found in the clean picture, overlay pixels on top of them
    rep["graphics_on_faces"] = _graphics_on_faces(spec, els, dur)
    for g in rep["graphics_on_faces"]:
        issues.append(f"a graphic covers {g['covered_pct']}% of a face at {g['t']:.1f} s")
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
             f"- longest stretch with nothing new: {rep['longest_still']['seconds']} s at {rep['longest_still']['at']} s",
             f"- graphics over faces: {len(rep['graphics_on_faces'])}",
             *[f"- captions on {c['voice']}: {c['covered_pct']}%" for c in cover],
             *[f"- music under {g['voice']}: {g['gap_db']} dB (worst 10%: {g['worst_db']} dB)" for g in gaps
               if g["gap_db"] is not None], "",
             "## Issues" if issues else "No automatic issues found.", *[f"- {x}" for x in issues], "",
             "Read: " + ", ".join(Path(x).name for x in [rep["contact_sheet"], *sheets]),
             "Still yours to check: every frame of each sheet (overlaps, readability, faces), and say you can't hear it."]
    (out / "review.md").write_text("\n".join(lines) + "\n")
    return rep


# ---------------------------------------------------------------- a first spec from the footage

def _measure_lufs(path: Path, a: float, b: float) -> float | None:
    """Integrated loudness of a stretch of a file (after the same voice clean-up the mix applies)."""
    import subprocess
    r = subprocess.run(["ffmpeg", "-hide_banner", "-ss", f"{a}", "-to", f"{b}", "-i", str(path), "-vn", "-af",
                        f"{VOICE_CLEAN},ebur128", "-f", "null", "-"], capture_output=True, text=True)
    m = re.findall(r"I:\s+(-?[\d.]+) LUFS", r.stderr)
    v = float(m[-1]) if m else None
    return v if v is not None and v > -70 else None


def init_spec(folder: str | Path, out: str | Path, inventory_dir: str | Path | None = None, transcribe: bool = True,
              width: int = 1920, height: int = 1080, fps: int = 30, shots: str | Path | None = None) -> dict:
    """A starting spec from a footage folder: each clip trimmed to its speech (a breath either side), voice-over files
    over a placeholder picture, pictures as framed shots, captions from the word times, an original music bed, and
    a freeze-frame end card. Every placeholder is listed under "todo"; it's a draft to edit, not the edit."""
    from .inventory import inventory
    folder, out = Path(folder).resolve(), Path(out).resolve()
    inv_dir = Path(inventory_dir).resolve() if inventory_dir else out.parent / "work" / "inventory"
    inv_json = inv_dir / "inventory.json"
    inv = json.loads(inv_json.read_text()) if inv_json.exists() else inventory(folder, inv_dir, transcribe)
    rel = lambda p: str(Path(os.path.relpath(p, out.parent)))  # noqa: E731
    pieces, voices, caps, todo = [], [], {}, []
    last_video = None
    for it in inv["items"]:
        name = re.sub(r"[^A-Za-z0-9_]+", "_", Path(it["file"]).stem).strip("_") or "clip"
        src = rel(folder / it["file"])
        words_path = inv_dir / f"{Path(it['file']).stem}.words.json"
        words = json.loads(words_path.read_text()) if words_path.exists() else []
        dur = float(it.get("duration") or 0)
        if words:
            a = max(0.0, float(words[0]["start"]) - 0.4)
            b = min(dur, float(words[-1]["end"]) + 0.5) if dur else float(words[-1]["end"]) + 0.5
        else:
            a, b = 0.0, min(dur, 6.0) if dur else 4.0
        if it["kind"] == "video":
            pieces.append({"name": name, "type": "video", "src": src, "in": round(a, 2), "out": round(b, 2),
                           "grade": "neutral"})
            last_video = name
            if it.get("has_audio") and words:
                voices.append({"name": f"v_{name}", "src": src, "in": round(a, 2), "out": round(b, 2), "at": name})
        elif it["kind"] == "audio" and words:
            pieces.append({"name": name, "type": "color", "color": "#1f241c", "dur": round(b - a, 2)})
            voices.append({"name": f"v_{name}", "src": src, "in": round(a, 2), "out": round(b, 2), "at": name})
            todo.append(f"piece {name}: a placeholder under the voice-over {it['file']}: put app captures or b-roll here")
        elif it["kind"] == "image":
            pieces.append({"name": name, "type": "framed", "src": src, "dur": 4.0})
        if words and voices and voices[-1]["src"] == src:
            caps[voices[-1]["name"]] = rel(words_path)
    if shots:                                         # app captures (editor capture shots): framed, aimed at their focus
        shots = Path(shots).resolve()
        for sh in json.loads(shots.read_text()).get("shots", []):
            if not sh.get("file"):
                continue
            name = "shot_" + re.sub(r"[^A-Za-z0-9_]+", "_", sh["name"]).strip("_")
            pc = {"name": name, "type": "framed", "src": rel(shots.parent / sh["file"]), "dur": 4.0}
            if sh.get("focus"):
                pc["focus_from"] = f"{rel(shots)}#{sh['name']}"
            pieces.append(pc)
            todo.append(f"piece {name}: place it where the voice talks about it (and trim its dur)")
    if not pieces:
        raise EditorError(f"nothing usable in {folder}")
    for v in voices:                                  # level every voice to the same loudness (pocket mics are quiet)
        lufs = _measure_lufs(out.parent / v["src"], v["in"], v["out"])
        if lufs is not None:
            v["gain"] = round(max(-12.0, min(15.0, -16.0 - lufs)), 1)
    if last_video:
        pieces.append({"name": "end", "type": "freeze", "from": last_video, "dur": 6.0, "blur": 12, "darken": 0.3,
                       "fade_out": 0.5})
    total = sum(float(p.get("dur", 0)) if "dur" in p else (p["out"] - p["in"]) for p in pieces)
    # the lesson from the Walk-Free skits ("we can't hear ourselves"): the bed dips 10 dB under on-camera dialogue
    spans, t = [], 0.0
    talking = {v["at"] for v in voices}
    for p in pieces:
        d = float(p["dur"]) if "dur" in p else p["out"] - p["in"]
        if p.get("type") == "video" and p["name"] in talking:
            if spans and abs(spans[-1][1] - t) < 0.05:
                spans[-1][1] = t + d
            else:
                spans.append([t, t + d])
        t += d
    dips = []
    for a_, b_ in spans:
        dips += [[round(max(0.0, a_ - 0.4), 2), 0], [round(a_, 2), -10], [round(b_, 2), -10],
                 [round(min(total, b_ + 0.4), 2), 0]]
    spec = {
        "todo": todo + ["order the pieces into the story (inventory.md has what each clip says)",
                        "correct the captions' words (offline transcripts mishear names): captions.replace",
                        "write the overlay (tags, numbers, lower thirds, end card lines)", "check --plan, then render"],
        "output": {"width": width, "height": height, "fps": fps, "file": f"out/{out.parent.name or 'video'}.mp4",
                   "duration": round(total, 2), "lufs": -14},
        "frame": {"scale": 0.92, "radius": 18, "backdrop": "#f4f1e6"},
        "pieces": pieces,
        "audio": {"voices": voices,
                  "music": [{"src": {"compose": {"mood": "warm", "end_chord_at": round(max(1.0, total - 6.0), 2)}},
                             "at": 0, "dur": round(total, 2), "gain": -3, "fade_in": 0.5,
                             **({"automation": dips} if dips else {})}]},
        "captions": {"voices": caps, "replace": {}},
        "overlay": {"elements": [{"type": "end_card", "lines": ["TITLE", "website", "names"], "t_in": "end+0.4",
                                  "t_out": "end.end-0.3"}] if last_video else []},
    }
    out.write_text(json.dumps(spec, indent=1, ensure_ascii=False) + "\n")
    log(f"produce init: {len(pieces)} pieces, {len(voices)} voices, {total:.1f} s -> {out}")
    return spec


# ---------------------------------------------------------------- post kit: subtitles, chapters, cover

def _all_captions(spec: Spec) -> list[dict]:
    ov = spec.data.get("overlay") or {}
    ov = json.loads(spec.p(ov).read_text()) if isinstance(ov, str) else ov
    els = spec.resolve({**ov, "elements": list(ov.get("elements", [])) + auto_captions(spec)}).get("elements", [])
    return sorted((e for e in els if e.get("type") == "caption"), key=lambda e: float(e["t_in"]))


def _srt_time(t: float) -> str:
    ms = int(round(max(0.0, t) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"


def _sharpest(video: Path, t: float, window: float = 1.0) -> float:
    """The least blurred moment within `window` s of t (people move: the exact second is often a smear)."""
    import subprocess
    import cv2
    import numpy as np
    info = probe(video)
    w, h = info["video"]["width"] // 4, info["video"]["height"] // 4
    a = max(0.0, t - window)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{a:.3f}", "-t", f"{2 * window:.3f}", "-i", str(video),
                          "-vf", f"fps=10,scale={w}:{h},format=gray", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    n = len(raw) // (w * h)
    if n == 0:
        return t
    frames = np.frombuffer(raw[:n * w * h], np.uint8).reshape(n, h, w)
    sharp = [cv2.Laplacian(f, cv2.CV_64F).var() for f in frames]
    return round(a + int(np.argmax(sharp)) / 10, 2)


def _description(spec: Spec, post: dict, chapters_path: str | None) -> str:
    """A YouTube/upload description: title, summary, chapters, links from the end card, credits."""
    ov = spec.data.get("overlay") or {}
    ov = json.loads(spec.p(ov).read_text()) if isinstance(ov, str) else ov
    lines = [ln for e in ov.get("elements", []) if e.get("type") == "end_card" for ln in e.get("lines", [])]
    links = []
    for ln in lines:
        for m in re.finditer(r"\b((?:https?://)?[\w-]+(?:\.[\w-]+)+(?:/[\w./-]*)?)", str(ln)):
            u = m.group(1)
            if "." in u and not re.fullmatch(r"[\d.]+", u):
                links.append(u if u.startswith("http") else f"https://{u}")
    title = post.get("title") or (post.get("cover") or {}).get("title") or spec.file.stem.replace("-", " ")
    parts = [title, ""]
    if post.get("summary"):
        parts += [post["summary"], ""]
    if chapters_path and Path(chapters_path).exists():
        parts += ["Chapters", Path(chapters_path).read_text().strip(), ""]
    if links:
        parts += ["Links", *dict.fromkeys(links), ""]
    credits = []
    for m in spec.data.get("audio", {}).get("music", []):
        if isinstance(m.get("src"), dict) and ("compose" in m["src"] or "lofi" in m["src"]):
            credits.append("Music: original, composed for this video (royalty-free).")
            break
    if post.get("credits"):
        credits += list(post["credits"])
    if post.get("ai_label"):
        credits.append(post["ai_label"])
    if credits:
        parts += ["Credits", *credits, ""]
    if post.get("hashtags"):
        parts.append(" ".join("#" + h.lstrip("#") for h in post["hashtags"]))
    return "\n".join(parts).strip() + "\n"


def post_kit(spec: Spec, final: Path) -> dict:
    """<name>.srt (from every caption card), <name>_chapters.txt (YouTube chapters from pieces with a "chapter"
    or post.chapters), and <name>_cover.jpg (a clean frame from the base picture, with a title) when asked."""
    post = spec.data.get("post", {})
    out, issues = {}, []
    caps = _all_captions(spec)
    if caps and post.get("srt", True):
        srt = final.with_suffix(".srt")
        blocks = []
        for i, c in enumerate(caps, 1):
            text = c["text"] + (f"\n{c['sub']}" if c.get("sub") else "")
            blocks.append(f"{i}\n{_srt_time(float(c['t_in']))} --> {_srt_time(float(c['t_out']))}\n{text}\n")
        srt.write_text("\n".join(blocks))
        out["srt"] = str(srt)
    chapters = [(spec.t(t), title) for t, title in post.get("chapters", [])] or \
        [(spec.starts[pc["name"]][0], pc["chapter"]) for pc in spec.pieces if pc.get("chapter")]
    if chapters:
        chapters.sort()
        if chapters[0][0] > 0.5:
            issues.append("YouTube chapters must start at 0:00: the first one was moved there")
        chapters[0] = (0.0, chapters[0][1])
        if len(chapters) < 3:
            issues.append("YouTube needs at least 3 chapters to show them")
        short = [t for (t, _), (n, _) in zip(chapters, chapters[1:] + [(spec.total, "")]) if n - t < 10]
        if short:
            issues.append(f"{len(short)} chapter(s) shorter than 10 s (YouTube ignores the list then)")
        txt = final.with_name(final.stem + "_chapters.txt")
        txt.write_text("".join(f"{int(t // 60)}:{int(t % 60):02d} {title}\n" for t, title in chapters))
        out["chapters"] = str(txt)
    desc = _description(spec, post, out.get("chapters"))
    if desc:
        dpath = final.with_name(final.stem + "_description.txt")
        dpath.write_text(desc)
        out["description"] = str(dpath)
    cov = post.get("cover")
    if cov:
        from .cover import cover
        base = spec.work / "base.mp4"
        src = base if base.exists() else final
        dst = final.with_name(final.stem + "_cover.jpg")
        at = _sharpest(src, spec.t(cov["at"]), float(cov.get("window", 1.0))) if "at" in cov else None
        cover(src, dst, title=cov.get("title", ""), at=at,
              accent=cov.get("accent", "#FFE600"), highlight=cov.get("highlight"),
              preset="youtube" if spec.w >= spec.h else "reels")
        out["cover"] = str(dst)
    out["issues"] = issues
    for i in issues:
        log(f"produce: post: {i}")
    return out


# ---------------------------------------------------------------- versions (one per note)

def save_version(spec: Spec, note: str, files: list[str]) -> dict:
    """out/versions/<name>.vN.mp4 (+ extras), the spec as it was, and a line in project.md."""
    import shutil
    from datetime import datetime
    vdir = spec.file.parent / "versions"
    vdir.mkdir(parents=True, exist_ok=True)
    log_path = vdir / "versions.json"
    hist = json.loads(log_path.read_text()) if log_path.exists() else []
    n = len(hist) + 1
    kept = []
    for f in files:
        f = Path(f)
        if f.exists():
            dst = vdir / f"{f.stem}.v{n}{f.suffix}"
            shutil.copy2(f, dst)
            kept.append(str(dst))
    shutil.copy2(spec.path, vdir / f"{spec.path.stem}.v{n}.json")
    entry = {"n": n, "note": note, "at": datetime.now().isoformat(timespec="seconds"), "files": kept,
             "duration": round(spec.total, 2)}
    hist.append(entry)
    log_path.write_text(json.dumps(hist, indent=1))
    pm = spec.root / "project.md"
    with pm.open("a") as fh:
        fh.write(f"- v{n} ({entry['at'][:16]}): {note}\n")
    log(f"produce: saved version {n}: {note}")
    return entry


def _short(v) -> str:
    t = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else repr(v)
    return t if len(t) <= 48 else t[:45] + "..."


def _field_diff(a: dict, b: dict, skip=()) -> list[str]:
    out = []
    for k in [*a, *[k for k in b if k not in a]]:
        if k in skip or a.get(k) == b.get(k):
            continue
        out.append(f"{k} added {_short(b[k])}" if k not in a else f"{k} removed" if k not in b
                   else f"{k} {_short(a[k])} -> {_short(b[k])}")
    return out


def spec_changes(old: dict, new: dict) -> tuple[list[str], list[str]]:
    """What changed between two specs, in plain lines, and the stages that re-render for it (a note's summary for the
    user, and a check that the edit touched only what the note asked)."""
    lines, stages = [], set()
    for k in ("output", "frame"):
        if old.get(k) != new.get(k):
            lines.append(f"{k}: " + "; ".join(_field_diff(old.get(k) or {}, new.get(k) or {})))
            stages |= {"pieces", "overlay", "mix", "composite"}
    op = {pc.get("name"): pc for pc in old.get("pieces", [])}
    np_ = {pc.get("name"): pc for pc in new.get("pieces", [])}
    for n in np_:
        if n not in op:
            lines.append(f"piece {n}: added ({np_[n].get('type', 'video')})")
            stages |= {"pieces", "composite"}
        elif op[n] != np_[n]:
            d = _field_diff(op[n], np_[n])
            lines.append(f"piece {n}: " + "; ".join(d))
            if _field_diff(op[n], np_[n], skip=NOT_PICTURE):
                stages |= {"pieces", "composite"}
    for n in op:
        if n not in np_:
            lines.append(f"piece {n}: removed")
            stages |= {"pieces", "composite"}
    if [n for n in [pc.get("name") for pc in old.get("pieces", [])] if n in np_] != \
            [n for n in [pc.get("name") for pc in new.get("pieces", [])] if n in op]:
        lines.append("pieces: reordered")
        stages |= {"pieces", "composite"}
    oa, na = old.get("audio", {}), new.get("audio", {})
    for kind in sorted({*oa, *na}):
        a, b = oa.get(kind), na.get(kind)
        if a == b:
            continue
        stages |= {"mix", "composite"}
        if not isinstance(a, list) or not isinstance(b, list):
            lines.append(f"audio {kind}: " + ("; ".join(_field_diff(a or {}, b or {})) if isinstance(a or b, dict)
                                              else f"{_short(a)} -> {_short(b)}"))
            continue
        for i in range(max(len(a), len(b))):
            x, y = (a[i] if i < len(a) else None), (b[i] if i < len(b) else None)
            name = (y or x).get("name") or (y or x).get("src") if isinstance(y or x, dict) else i
            name = name if isinstance(name, str) else f"#{i}"
            if x is None:
                lines.append(f"audio {kind} {name}: added")
            elif y is None:
                lines.append(f"audio {kind} {name}: removed")
            elif x != y:
                lines.append(f"audio {kind} {name}: " + "; ".join(_field_diff(x, y)))
    if old.get("captions") != new.get("captions"):
        lines.append("captions: " + "; ".join(_field_diff(old.get("captions") or {}, new.get("captions") or {})))
        stages |= {"overlay", "composite"}
    ov0, ov1 = old.get("overlay"), new.get("overlay")
    if ov0 != ov1:
        stages |= {"overlay", "composite"}
        if isinstance(ov0, dict) and isinstance(ov1, dict):
            e0, e1 = ov0.get("elements", []), ov1.get("elements", [])
            for i in range(max(len(e0), len(e1))):
                x, y = (e0[i] if i < len(e0) else None), (e1[i] if i < len(e1) else None)
                label = f"overlay #{i} {(y or x).get('type')}"
                if x is None:
                    lines.append(f"{label}: added {_short(' / '.join(_texts(y)))}")
                elif y is None:
                    lines.append(f"{label}: removed {_short(' / '.join(_texts(x)))}")
                elif x != y:
                    lines.append(f"{label}: " + "; ".join(_field_diff(x, y)))
            if {k: v for k, v in ov0.items() if k != "elements"} != {k: v for k, v in ov1.items() if k != "elements"}:
                lines.append("overlay theme: " + "; ".join(_field_diff(ov0.get("theme") or {}, ov1.get("theme") or {})))
        else:
            lines.append(f"overlay: {_short(ov0)} -> {_short(ov1)}")
    for k, st in (("extras", "extras"), ("post", "post")):
        if old.get(k) != new.get(k):
            lines.append(f"{k}: changed")
            stages.add(st)
    order = ["pieces", "overlay", "mix", "composite", "extras", "post"]
    return lines, [s for s in order if s in stages]


NUM = re.compile(r"(?<![\w.])[+−-]?\d[\d,]*(?:\.\d+)?%?")


def _norm_num(x: str) -> str:
    return x.replace(",", "").replace("−", "-").lstrip("+").rstrip(".")


def _numbers(text: str) -> set[str]:
    """Numbers worth checking (2 digits or more, or with a % / decimal), normalised: '2,300+' -> '2300'."""
    out = set()
    for m in NUM.finditer(text):
        n = _norm_num(m.group(0))
        digits = re.sub(r"\D", "", n)
        if len(digits) >= 2 or "%" in n or "." in n:
            out.add(n)
    return out


def _texts(e: dict) -> list[str]:
    out = []
    for k, v in e.items():
        if k in ("text", "label", "sub", "source", "heading") and isinstance(v, str):
            out.append(v)
        elif k in ("items", "lines") and isinstance(v, list):
            out += [x if isinstance(x, str) else str(x.get("text", "")) for x in v]
        elif k in ("from", "to") and e.get("type") == "big_stat":
            out.append(f"{v:,}" if isinstance(v, (int, float)) and k == "to" else "")
    return [t for t in out if t]


# ---------------------------------------------------------------- driver

def preview_range(spec_path: str | Path, a_ref, b_ref, jobs: int = 4) -> Path:
    """A quick look at one stretch after a note: changed pieces, the overlay for just that stretch, the current mix
    (re-mixed only if missing), a short composite at 720p. Seconds instead of the full render."""
    spec = Spec(spec_path)
    a, b = spec.t(a_ref), spec.t(b_ref)
    if not 0 <= a < b <= spec.total + 0.01:
        raise EditorError(f"range {a:.2f}-{b:.2f} s is outside the video (0-{spec.total:.2f} s)")
    base = pieces(spec, jobs)
    ov = overlay(spec, max(1, jobs - 1), (a, b))
    audio = spec.work / "mix.wav"
    if not audio.exists():
        audio = mix(spec)
    out = spec.file.with_name(f"{spec.file.stem}_range_{a:.0f}-{b:.0f}.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    ins = ["-ss", f"{a}", "-to", f"{b}", "-i", str(base)]
    if ov:
        ins += ["-i", str(ov)]
    ins += ["-ss", f"{a}", "-to", f"{b}", "-i", str(audio)]
    vf = "[0:v][1:v]overlay=0:0:format=auto,scale=-2:720,format=yuv420p[v]" if ov else "[0:v]scale=-2:720[v]"
    run(["ffmpeg", "-y", *ins, "-filter_complex", vf, "-map", "[v]", "-map", f"{2 if ov else 1}:a",
         "-t", f"{b - a}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k",
         "-movflags", "+faststart", str(out)])
    log(f"produce: range {a:.2f}-{b:.2f} s -> {out}")
    return out


def produce(spec_path: str | Path, only: str | None = None, jobs: int = 4, want_preview: bool = False,
            effort: str = "standard") -> dict:
    from . import effort as eff
    spec = Spec(spec_path)
    errors, warnings = validate(spec)
    for w in warnings:
        log(f"produce: warning: {w}")
    if errors and only not in ("review", "post", "extras"):
        raise EditorError("the spec has problems (nothing rendered):\n  " + "\n  ".join(errors))
    spec.work.mkdir(parents=True, exist_ok=True)
    stages = [only] if only else ["pieces", "overlay", "mix", "composite", "extras", "post", "review"]
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
            from . import effort as _eff
            res["file"] = str(composite(spec, base, ov, audio, effort=_eff.normalise(effort) or "standard"))
            from . import style
            if not style._snap_path(spec.path).exists():       # the first render is the first draft
                style.snapshot(spec.path)
            if want_preview:
                res["preview"] = str(preview(Path(res["file"])))
        elif st == "extras":
            if spec.file.exists():
                res["extras"] = [str(p) for p in extras(spec, spec.file)]
        elif st == "post":
            if spec.file.exists():
                res["post"] = post_kit(spec, spec.file)
        elif st == "review":
            if (eff.normalise(effort) or "standard") == "rush" and not only:
                log("produce: review skipped at rush effort (run --only review when there's a minute)")
                continue
            res["review"] = review(spec)
        else:
            raise EditorError(f"unknown stage {st!r} (pieces, overlay, mix, composite, extras, post, review)")
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


def _clock(x) -> float | str:
    """"1:23" / "1:23.5" -> seconds; numbers stay numbers; anything else is a reference."""
    m = re.fullmatch(r"(\d+):(\d{1,2}(?:\.\d+)?)", str(x).strip())
    if m:
        return int(m[1]) * 60 + float(m[2])
    return float(x) if re.fullmatch(r"-?[\d.]+", str(x)) else str(x)


def what_is_at(spec: Spec, ref) -> dict:
    """Everything on screen and in the mix at one moment of the output: the piece (and its source second), voices
    speaking (and their source second), music / beds / effects playing, graphics visible. A user's note ("at 1:23 the
    music is too loud") becomes the exact spec entry to change."""
    from .overlay import element_end
    t = spec.t(_clock(ref))
    out = {"t": round(t, 2), "clock": f"{int(t // 60)}:{t % 60:05.2f}", "piece": None, "voices": [], "audio": [],
           "graphics": []}
    for pc in spec.pieces:
        a, b = spec.starts[pc["name"]]
        if a <= t < b or (t == b == spec.total):
            off = t - a
            row = {"name": pc["name"], "type": pc.get("type", "video"), "offset": round(off, 2)}
            if pc.get("src"):
                row["src"] = pc["src"]
            if pc.get("type", "video") == "video" and not pc.get("_ramps"):
                row["source_second"] = round(float(pc.get("in", 0)) + off * float(pc.get("speed", 1.0)), 2)
            out["piece"] = row
            break
    au = spec.data.get("audio", {})
    for v in au.get("voices", []):
        a = spec.t(v.get("at", 0))
        length = float(v.get("out", 1e9)) - float(v.get("in", 0))
        if a <= t < a + length:
            out["voices"].append({"name": v.get("name", v["src"]), "src": v["src"],
                                  "source_second": round(float(v.get("in", 0)) + t - a, 2), "gain": v.get("gain", 0)})
    for kind in ("music", "beds", "sfx"):
        for i, m in enumerate(au.get(kind, [])):
            a = spec.t(m.get("at", 0))
            if kind == "sfx":
                hit = abs(t - a) <= 1.0
            else:
                length = float(m["dur"]) if "dur" in m else (float(m["out"]) - float(m.get("in", 0)) if "out" in m
                                                              else spec.total - a)
                hit = a <= t < a + length
            if hit:
                src = m.get("src")
                out["audio"].append({"list": kind, "index": i, "at": round(a, 2), "gain": m.get("gain", 0),
                                     "src": src if isinstance(src, str) else next(iter(src), "?")})
    ov = spec.data.get("overlay")
    if isinstance(ov, str):
        ov = json.loads(spec.p(ov).read_text())
    els = spec.resolve(list((ov or {}).get("elements", [])) + auto_captions(spec))
    for i, e in enumerate(els):
        t_in = e.get("t_in")
        if t_in is None and e.get("times"):
            t_in = min(e["times"])
        if t_in is not None and float(t_in) <= t <= element_end(e):
            out["graphics"].append({"index": i, "type": e.get("type"), "text": " / ".join(_texts(e))[:70],
                                    "t_in": float(t_in), "t_out": round(element_end(e), 2)})
    return out


def _print_at(w: dict) -> None:
    print(f"at {w['clock']} ({w['t']} s)")
    pc = w["piece"]
    if pc:
        print(f"  picture  {pc['name']} ({pc['type']}) +{pc['offset']} s" + (f", {pc['src']}" if pc.get("src") else "")
              + (f" at source {pc['source_second']} s" if "source_second" in pc else ""))
    for v in w["voices"]:
        print(f"  voice    {v['name']} at source {v['source_second']} s (gain {v['gain']} dB)")
    for m in w["audio"]:
        print(f"  {m['list']:<8} [{m['index']}] {m['src']} from {m['at']} s (gain {m['gain']} dB)")
    for g in w["graphics"]:
        print(f"  graphic  #{g['index']} {g['type']} {g['t_in']}-{g['t_out']}  {g['text']}")
    if pc:
        print(f"  look:    editor produce <spec> --range {pc['name']} {pc['name']}.end")


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="editor produce", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("spec")
    ap.add_argument("--plan", action="store_true", help="print the timeline and resolved overlay times; render nothing")
    ap.add_argument("--only", choices=["pieces", "overlay", "mix", "composite", "extras", "post", "review"])
    ap.add_argument("-j", "--jobs", type=int, default=4)
    ap.add_argument("--preview", action="store_true", help="also write a 720p preview")
    ap.add_argument("--effort", default="standard", help="for the learned timings (rush, standard, polish)")
    ap.add_argument("--range", nargs=2, metavar=("FROM", "TO"),
                    help="quick 720p look at one stretch after a note (times or references like d7c d7c.end)")
    ap.add_argument("--note", help="save this render as the next version (out/versions/), with the user's note")
    ap.add_argument("--versions", action="store_true", help="list the saved versions")
    ap.add_argument("--changes", nargs="?", const="", metavar="N",
                    help="what changed in the spec since the last saved version (or vN), and what re-renders")
    ap.add_argument("--at", nargs="+", metavar="TIME",
                    help="what's on screen and in the mix at these moments (1:23, 83.5 or a reference): turns a note "
                         "with a timestamp into the spec entry to change")
    if argv and argv[0] == "captions-from-brief":
        cp = argparse.ArgumentParser(prog="editor produce captions-from-brief",
                                     description="put the brief's caption lines on the voices that say them")
        cp.add_argument("spec")
        cp.add_argument("brief")
        ca = cp.parse_args(argv[1:])
        print(json.dumps(captions_from_brief(ca.spec, ca.brief), indent=1, ensure_ascii=False))
        return 0
    if argv and argv[0] == "init":
        ip = argparse.ArgumentParser(prog="editor produce init",
                                     description="a starting spec from a footage folder (runs inventory first)")
        ip.add_argument("folder")
        ip.add_argument("-o", "--out", required=True)
        ip.add_argument("--inventory", help="an existing inventory folder (inventory.json + <clip>.words.json)")
        ip.add_argument("--no-transcribe", action="store_true")
        ip.add_argument("--size", default="1920x1080")
        ip.add_argument("--shots", help="a capture shots.json: each screen becomes a framed piece aimed at its focus")
        ia = ip.parse_args(argv[1:])
        w, h = (int(x) for x in ia.size.lower().split("x"))
        init_spec(ia.folder, ia.out, ia.inventory, not ia.no_transcribe, w, h, ia.shots)
        print(Spec(ia.out).table())
        return 0
    a = ap.parse_args(argv)
    spec = Spec(a.spec)
    if a.plan:
        print(spec.table())
        errors, warnings = validate(spec)
        for x in errors:
            print(f"ERROR   {x}")
        for x in warnings:
            print(f"warning {x}")
        ov = spec.data.get("overlay")
        auto = auto_captions(spec)
        for card in spec.resolve(auto):
            print(f"  caption {card['t_in']:7.2f}-{card['t_out']:7.2f}  {card['text']}")
        for voice, line in UNHEARD:
            print(f"warning caption line not heard in {voice}, dropped: {line}")
        if ov or auto:
            ov = (json.loads(spec.p(ov).read_text()) if isinstance(ov, str) else ov) or {}
            els = spec.resolve({**ov, "elements": list(ov.get("elements", [])) + auto}).get("elements", [])
            late = [e for e in els if float(e.get("t_out", e.get("t_in", 0)) or 0) > spec.total + 0.01]
            print(f"overlay: {len(els)} elements" + (f", {len(late)} end after the video" if late else ""))
        return 0
    if a.at:
        for x in a.at:
            _print_at(what_is_at(spec, x))
        return 0
    if a.changes is not None:
        vdir = spec.file.parent / "versions"
        hist = json.loads((vdir / "versions.json").read_text()) if (vdir / "versions.json").exists() else []
        if not hist:
            print("no saved versions yet (render with --note to save one)")
            return 0
        n = int(a.changes) if a.changes else hist[-1]["n"]
        prev = vdir / f"{spec.path.stem}.v{n}.json"
        if not prev.exists():
            raise EditorError(f"no saved spec for v{n} ({prev.name})")
        lines, stages = spec_changes(json.loads(prev.read_text()), json.loads(spec.path.read_text()))
        print(f"since v{n}" + (f" ({next((v['note'] for v in hist if v['n'] == n), '')})" if hist else "") + ":")
        print("\n".join(f"  {x}" for x in lines) or "  nothing")
        print("re-renders: " + (", ".join(stages) or "nothing"))
        return 0
    if a.versions:
        vlog = spec.file.parent / "versions" / "versions.json"
        for v in json.loads(vlog.read_text()) if vlog.exists() else []:
            print(f"v{v['n']}  {v['at']}  {v['duration']} s  {v['note']}")
        return 0
    if a.range:
        print(preview_range(a.spec, *[float(x) if re.fullmatch(r"-?[\d.]+", x) else x for x in a.range], jobs=a.jobs))
        return 0
    res = produce(a.spec, a.only, a.jobs, a.preview, a.effort)
    if a.note and res.get("file"):
        res["version"] = save_version(spec, a.note, [res["file"], *res.get("extras", []), res.get("preview", "")])
    print(json.dumps(res, indent=1))
    return 0
