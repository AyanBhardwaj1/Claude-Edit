"""Designed overlay track: a JSON spec of timed elements -> one transparent PNG-in-MOV (rgba).

  editor overlay SPEC.json OUT.mov [--from S --to S] [-j 3]
  editor overlay frame OUT_DIR [--size 1920x1080]           backdrop + rounded mask for screen recordings
  editor overlay still SRC OUT.mp4 --dur 4 [--punch T Z X Y] a screenshot / recording on that backdrop

Full-timeline overlays for demo / launch / explainer videos: captions in a custom box, model or feature tags,
chips, counters, checklists, callouts, lower thirds, URL band, logo sting, end card (23 types, README.md).
page.html draws every element from t alone (`seek(t)`), headless Chromium (Node Playwright) screenshots it with a
transparent background, ffmpeg packs the PNGs. Speed: a frame whose element state key is unchanged reuses the last
PNG, empty frames are captured once, and `-j N` renders N chunks in parallel (global frame indices) then
concatenates. Composite: ffmpeg -i base.mp4 -i OUT.mov -filter_complex "[0][1]overlay=0:0:format=auto" ...

The look lives in the spec's optional "theme" (colours, fonts by name from assets/fonts, size, fps); the defaults
are the Walk-Free look it was built for (ivory / deep green / heat orange / shade teal, Playfair Display + DM Sans).
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from functools import lru_cache
from pathlib import Path

from ..util import EditorError, log

HERE = Path(__file__).resolve().parent
CHUNK_JS = HERE / "render_chunk.js"

DEFAULT_COLORS = {
    "bg": "#f4f1e6",          # light surface: cards, chips, light pills, logo sting, light text on footage
    "ink": "#2f4a33",         # dark brand colour: pills, checklist, lower third, text on cards
    "accent": "#d7772d",      # highlight: checkmarks, stamp, marker, glow box, lower-third bar ("heat")
    "accent2": "#2f6577",     # second accent ("shade")
    "dark": "#1f241c",        # off-black: caption box (at box_opacity)
    "text": "#ffffff",        # caption text
    "muted": "#e4e2da",       # chips_compete chip
    "muted_ink": "#5b5f57",   # chips_compete text
    "muted_label": "#8a8d84", # chips_compete label
    "highlight": "#fffdf5",   # trace line, shimmer band
    "flash": "#ffffff",
    "shadow": "#101810",      # drop shadows and the big_stat vignette
}
ALIASES = {"heat": "accent", "shade": "accent2", "green": "ink", "ivory": "bg", "off_black": "dark"}
DEFAULT_FONTS = {"display": "Playfair Display", "text": "DM Sans"}
DEFAULT_THEME = {"colors": DEFAULT_COLORS, "fonts": DEFAULT_FONTS, "width": 1920, "height": 1080, "fps": 30,
                 "scale": 1.0, "box_opacity": 0.6}
FACE_WEIGHTS = (400, 600, 700)

# type -> required fields (seconds on the spec timeline, pixels in the layout)
TYPES = {
    "caption": ("text", "t_in", "t_out"),
    "meta_tag": ("text", "t_in", "x", "y"),
    "tag": ("text", "t_in", "t_out", "x", "y"),
    "chip": ("text", "t_in", "t_out", "x", "y"),
    "big_stat": ("to", "t_in", "t_out"),
    "big_caption": ("text", "t_in", "t_out"),
    "counter": ("lines", "t_out"),
    "callout": ("text", "t_in", "t_out", "tx", "ty"),
    "ring": ("x", "y", "t_in", "t_out"),
    "glow_box": ("x", "y", "w", "h", "t_in", "t_out"),
    "trace": ("points", "t_in", "t_out"),
    "chips_compete": ("items", "times", "t_out"),
    "checklist": ("heading", "items", "times", "t_in", "t_out"),
    "lower_third": ("name", "t_in", "t_out"),
    "shimmer": ("t_in", "t_out"),
    "marker": ("x", "y", "w", "h", "t_in", "t_out"),
    "stamp": ("text", "x", "y", "t_in", "t_out"),
    "pills_row": ("items", "times", "t_out"),
    "url_band": ("text", "t_in", "t_out"),
    "logo_sting": ("t_in",),
    "end_card": ("lines", "t_in", "t_out"),
    "wipe_labels": ("left", "right", "t_in", "t_out"),
    "flash": ("t_in",),
}
AUTO_DUR = {"meta_tag": 3.5, "logo_sting": 2.5, "flash": 0.3}
WEIGHT_WORDS = {"thin": 100, "hairline": 100, "extralight": 200, "ultralight": 200, "light": 300, "": 400,
                "regular": 400, "normal": 400, "book": 400, "medium": 500, "semibold": 600, "demibold": 600,
                "bold": 700, "extrabold": 800, "ultrabold": 800, "black": 900, "heavy": 900}


# ---------------------------------------------------------------- spec + theme

def _rgba(color: str, a: float) -> str:
    m = re.fullmatch(r"#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})", color.strip())
    if not m:
        return f"color-mix(in srgb, {color} {a * 100:g}%, transparent)"
    h = m.group(1)
    h = "".join(c * 2 for c in h) if len(h) == 3 else h
    return f"rgba({int(h[0:2], 16)},{int(h[2:4], 16)},{int(h[4:6], 16)},{a:g})"


def theme_of(spec: dict) -> dict:
    """The spec's theme with every default filled in (old palette names map onto roles)."""
    user = dict(spec.get("theme") or {})
    th = {k: v for k, v in DEFAULT_THEME.items() if k not in ("colors", "fonts")}
    for k in ("width", "height", "fps"):                 # also accepted at the top level
        if k in spec and k not in user:
            user[k] = spec[k]
    th.update({k: v for k, v in user.items() if k not in ("colors", "fonts")})
    given = {ALIASES.get(k, k): v for k, v in (user.get("colors") or {}).items()}
    colors = {**DEFAULT_COLORS, **given}
    if "box" not in given:
        colors["box"] = _rgba(colors["dark"], float(th["box_opacity"]))
    th["colors"] = colors
    th["fonts"] = {**DEFAULT_FONTS, **(user.get("fonts") or {})}
    th["width"], th["height"], th["fps"] = int(th["width"]), int(th["height"]), int(th["fps"])
    th["scale"] = float(th["scale"])
    if th["width"] <= 0 or th["height"] <= 0 or th["fps"] <= 0 or th["scale"] <= 0:
        raise EditorError("theme width, height, fps and scale must be positive")
    return th


def element_end(e: dict) -> float:
    if e.get("t_out") is not None:
        return float(e["t_out"])
    t_in = e.get("t_in")
    if t_in is None and e.get("type") == "counter":
        t_in = min(float(l.get("t", 0)) for l in e.get("lines") or [{"t": 0}])
    return float(t_in or 0) + float(e.get("dur") or AUTO_DUR.get(e.get("type"), 0))


def validate(spec: dict) -> tuple[list[str], list[str]]:
    """(errors, warnings) for a spec. Errors stop a render; warnings are logged."""
    errors, warnings = [], []
    els = spec.get("elements")
    if not isinstance(els, list):
        return ["spec needs an \"elements\" list"], []
    try:
        theme_of(spec)
    except (TypeError, ValueError, EditorError) as e:
        errors.append(f"theme: {e}")
    for i, e in enumerate(els):
        where = f"element {i} ({e.get('type', '?')})" if isinstance(e, dict) else f"element {i}"
        if not isinstance(e, dict):
            errors.append(f"{where}: not an object")
            continue
        typ = e.get("type")
        if typ not in TYPES:
            errors.append(f"{where}: unknown type (known: {', '.join(TYPES)})")
            continue
        missing = [f for f in TYPES[typ] if e.get(f) is None]
        if missing:
            errors.append(f"{where}: missing {', '.join(missing)}")
            continue
        bad = [f for f in ("t_in", "t_out", "x", "y", "w", "h", "tx", "ty", "r", "dur")
               if e.get(f) is not None and (isinstance(e[f], bool) or not isinstance(e[f], (int, float)))]
        if bad:
            errors.append(f"{where}: {', '.join(bad)} must be a number")
            continue
        for f in ("items", "times", "lines", "points"):
            if f in e and not isinstance(e[f], list):
                bad.append(f)
        if bad or any(not isinstance(v, (int, float)) for v in e.get("times") or []):
            errors.append(f"{where}: {', '.join(bad) or 'times'} must be a list" + ("" if bad else " of numbers"))
            continue
        if typ in ("chips_compete", "checklist", "pills_row") and len(e["times"]) != len(e["items"]):
            errors.append(f"{where}: times has {len(e['times'])} entries for {len(e['items'])} items")
        if typ == "counter" and any(not isinstance(l, dict) or "text" not in l or "t" not in l for l in e["lines"]):
            errors.append(f"{where}: each line needs text and t")
        if typ == "trace" and len(e["points"]) < 2:
            errors.append(f"{where}: trace needs at least 2 points")
        if typ == "logo_sting" and not (e.get("text") or e.get("image") or e.get("mark")):
            warnings.append(f"{where}: no text, image or mark: it is a plain colour card")
        if e.get("t_in") is not None and e.get("t_out") is not None and e["t_out"] <= e["t_in"]:
            warnings.append(f"{where}: t_out {e['t_out']} is not after t_in {e['t_in']}: never visible")
    return errors, warnings


def duration(spec: dict) -> float:
    if spec.get("duration") is not None:
        return float(spec["duration"])
    return max((element_end(e) for e in spec.get("elements") or []), default=0.0)


def load(spec_path: str | Path) -> dict:
    try:
        spec = json.loads(Path(spec_path).read_text())
    except (OSError, json.JSONDecodeError) as e:
        raise EditorError(f"cannot read overlay spec {spec_path}: {e}") from e
    if not isinstance(spec, dict):
        raise EditorError(f"{spec_path}: expected a JSON object with \"elements\"")
    return spec


# ---------------------------------------------------------------- fonts

def _scan_faces(family: str) -> dict[tuple[int, str], Path]:
    from .. import fonts
    faces: dict[tuple[int, str], Path] = {}
    if not fonts.DIR.exists():
        return faces
    want = family.strip().lower()
    for p in sorted(fonts.DIR.iterdir()):
        if p.suffix.lower() not in fonts.FONT_EXT:
            continue
        try:
            full = fonts.full_name(*fonts.names(p))
        except EditorError:
            continue
        if not full.lower().startswith(want):
            continue
        rest = full[len(want):].lower()
        italic = "italic" in rest or "oblique" in rest
        rest = re.sub(r"italic|oblique|[\s_-]", "", rest)
        weight = WEIGHT_WORDS.get(rest)
        if weight is not None:
            faces.setdefault((weight, "italic" if italic else "normal"), p)
    return faces


def font_faces(family: str, fetch: bool = True) -> tuple[list[tuple[int, str, Path]], str | None]:
    """Files for a family in assets/fonts ([(weight, style, path)], warning). Downloads a missing Google font
    through editor.fonts when `fetch`; otherwise the page falls back to a system font of that name, then serif/sans."""
    faces = _scan_faces(family)
    if not faces and fetch:
        from .. import fonts
        try:
            fonts.google(family, list(FACE_WEIGHTS))
        except Exception as e:  # noqa: BLE001  (offline, unknown family)
            log(f"overlay: could not add font '{family}' from Google Fonts: {e}")
        faces = _scan_faces(family)
    warn = None
    if not faces:
        from ..fonts import _system
        if family in _system():
            warn = f"font '{family}' is not in assets/fonts; using the system copy"
        else:
            warn = (f"font '{family}' is not installed (editor fonts add \"{family}\"); "
                    "falling back to a system serif/sans")
    return sorted((w, s, p) for (w, s), p in faces.items()), warn


# ---------------------------------------------------------------- job

def _media_url(value: str, base: Path) -> str:
    if re.match(r"^(https?|data|file):", value):
        return value
    p = Path(value).expanduser()
    p = p if p.is_absolute() else base / p
    if not p.exists():
        raise EditorError(f"overlay image not found: {value}")
    return p.resolve().as_uri()


def build_job(spec: dict, base_dir: Path, fetch_fonts: bool = True) -> tuple[dict, list[str]]:
    """The page's input: layout size, theme, @font-face list and elements (image paths -> file:// URLs)."""
    errors, warnings = validate(spec)
    if errors:
        raise EditorError("overlay spec has errors:\n  " + "\n  ".join(errors))
    th = theme_of(spec)
    faces = []
    for alias, role in (("D", "display"), ("T", "text")):
        found, warn = font_faces(th["fonts"][role], fetch=fetch_fonts)
        if warn:
            warnings.append(warn)
        faces += [{"family": alias, "weight": w, "style": s, "url": p.resolve().as_uri()} for w, s, p in found]
    elements = []
    for e in spec["elements"]:
        e = dict(e)
        if e.get("image"):
            e["image"] = _media_url(str(e["image"]), base_dir)
        elements.append(e)
    job = {"width": th["width"] / th["scale"], "height": th["height"] / th["scale"], "scale": th["scale"],
           "fps": th["fps"], "theme": {"colors": th["colors"], "fonts": th["fonts"]}, "faces": faces,
           "elements": elements}
    return job, warnings


# ---------------------------------------------------------------- render

def _pw_env() -> dict:
    env = dict(os.environ)
    spec = importlib.util.find_spec("playwright")
    if spec and spec.submodule_search_locations:            # the Python package ships a Node copy of Playwright
        pkg = Path(list(spec.submodule_search_locations)[0]) / "driver" / "package"
        if pkg.exists():
            env.setdefault("CLAUDE_EDIT_PLAYWRIGHT", str(pkg))
    return env


@lru_cache(maxsize=1)
def available() -> tuple[bool, str]:
    """(True, "") when node, Playwright, Chromium and ffmpeg are all usable."""
    for b in ("node", "ffmpeg"):
        if not shutil.which(b):
            return False, f"`{b}` not found on PATH"
    try:
        r = subprocess.run(["node", str(CHUNK_JS), "--check"], capture_output=True, text=True, timeout=90,
                           env=_pw_env())
    except subprocess.TimeoutExpired:
        return False, "Chromium did not start within 90 s"
    if r.returncode != 0:
        return False, (r.stderr.strip().splitlines() or ["Playwright check failed"])[-1]
    return True, ""


def _fail_reason(code: int, err: str) -> str:
    if code == 3:
        return "Node cannot find Playwright: npm i -g playwright && npx playwright install chromium"
    if code == 4:
        return "Chromium did not start: npx playwright install chromium"
    tail = "\n".join(err.strip().splitlines()[-12:])
    return f"chunk render failed ({code})" + (f":\n{tail}" if tail else "")


def render(spec_path: str | Path, out_path: str | Path, start: float | None = None, end: float | None = None,
           jobs: int = 3, fetch_fonts: bool = True) -> dict:
    """Render [start, end) of the spec timeline (default 0..duration) to a transparent MOV (png, rgba).
    Output t=0 is `start`. Returns stats: frames, shots, secs, jobs, out, warnings."""
    for b in ("node", "ffmpeg"):
        if not shutil.which(b):
            raise EditorError(f"`{b}` not found on PATH (editor overlay needs Node + Playwright and ffmpeg)")
    spec_path = Path(spec_path).resolve()
    spec = load(spec_path)
    job, warnings = build_job(spec, spec_path.parent, fetch_fonts)
    for w in warnings:
        log(f"overlay: {w}")
    fps = job["fps"]
    t0 = float(start or 0.0)
    t1 = float(end) if end is not None else duration(spec)
    f0, f1 = round(t0 * fps), round(t1 * fps)
    if f1 <= f0:
        raise EditorError(f"empty range: {t0:g}..{t1:g} s (set \"duration\" in the spec or --to)")
    n = f1 - f0
    jobs = max(1, min(int(jobs), n // 30 or 1))
    out = Path(out_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="overlay_", dir=out.parent))
    try:
        job_path = tmp / "job.json"
        job_path.write_text(json.dumps(job))
        bounds = [f0 + n * k // jobs for k in range(jobs + 1)]
        began = time.time()
        env = _pw_env()
        procs, parts = [], []
        for k in range(jobs):
            part = tmp / f"part{k:02d}.mov"
            parts.append(part)
            procs.append(subprocess.Popen(["node", str(CHUNK_JS), str(job_path), str(part), str(bounds[k]),
                                           str(bounds[k + 1])], stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                          text=True, env=env))
        shots, fonts_loaded, page_warn, fail = 0, None, [], None
        for p in procs:
            o, e = p.communicate()
            if p.returncode != 0 and fail is None:
                fail = _fail_reason(p.returncode, e)
            try:
                info = json.loads(o.strip().splitlines()[-1])
                shots += info["shots"]
                fonts_loaded = info.get("fonts", fonts_loaded)
                page_warn = page_warn or info.get("warnings") or []
            except (IndexError, ValueError, KeyError):
                pass
        if fail:
            raise EditorError(fail)
        for w in page_warn:
            log(f"overlay: page: {w}")
            warnings.append(w)
        if jobs == 1:
            shutil.move(str(parts[0]), out)
        else:
            lst = tmp / "list.txt"
            lst.write_text("".join(f"file '{p}'\n" for p in parts))
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(lst),
                                "-c", "copy", str(out)], capture_output=True, text=True)
            if r.returncode != 0:
                raise EditorError(f"concat failed: {r.stderr.strip()[-400:]}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    secs = time.time() - began
    log(f"overlay: {out}: {n} frames ({n / fps:.2f}s) at {job['width'] * job['scale']:.0f}x"
        f"{job['height'] * job['scale']:.0f} in {secs:.1f}s = {n / max(secs, 1e-6):.1f} fps, {shots} screenshots "
        f"({100 * (1 - shots / n):.0f}% deduped), j={jobs}, {fonts_loaded} font faces")
    return {"out": str(out), "frames": n, "shots": shots, "secs": round(secs, 2), "jobs": jobs,
            "fonts": fonts_loaded, "warnings": warnings}


# ---------------------------------------------------------------- CLI

def main(argv: list[str] | None = None) -> int:
    """`editor overlay SPEC OUT [--from --to -j]`, `editor overlay frame ...`, `editor overlay still ...`."""
    argv = list(argv or [])
    if argv and argv[0] in ("frame", "still"):
        from .frame import main as frame_main
        return frame_main(argv)
    ap = argparse.ArgumentParser(prog="editor overlay", description=(
        "Render a designed overlay track (JSON spec, editor/overlay/README.md) to a transparent PNG-in-MOV. "
        "Also: `editor overlay frame OUT_DIR` and `editor overlay still SRC OUT` (screen recordings on a backdrop)."))
    ap.add_argument("spec", help="overlay spec .json")
    ap.add_argument("out", help="output .mov (png, rgba)")
    ap.add_argument("--from", dest="start", type=float, help="spec time of the first frame (default 0)")
    ap.add_argument("--to", dest="end", type=float, help="spec time to stop at (default: spec duration)")
    ap.add_argument("-j", "--jobs", type=int, default=3, help="parallel Chromium chunks (default 3)")
    ap.add_argument("--no-fetch-fonts", action="store_true", help="don't download missing theme fonts")
    ap.add_argument("--check", action="store_true", help="only validate the spec and print its timeline")
    a = ap.parse_args(argv)
    if a.check:
        spec = load(a.spec)
        errors, warnings = validate(spec)
        th = theme_of(spec) if not errors else DEFAULT_THEME
        print(f"{len(spec.get('elements') or [])} elements, {duration(spec):g} s, "
              f"{th['width']}x{th['height']} @ {th['fps']} fps")
        for w in warnings:
            print(f"warning: {w}")
        if errors:
            raise EditorError("overlay spec has errors:\n  " + "\n  ".join(errors))
        return 0
    render(a.spec, a.out, a.start, a.end, a.jobs, fetch_fonts=not a.no_fetch_fonts)
    return 0
