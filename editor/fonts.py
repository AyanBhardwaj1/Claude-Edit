"""Caption fonts: add any Google Font by name, or your own .ttf/.otf, and use it by name.

  editor fonts add "Bebas Neue"                 Google Fonts, static instances per weight
  editor fonts add "Montserrat" --weights 800 900
  editor fonts add ~/Fonts/BrandSans-Bold.otf   your own file (copied, never committed)
  editor fonts list                             names you can pass to --font / EDL "captions": {"font": ...}
  editor fonts sync                             re-download the Google ones on a new machine / cloud session

Fonts live in assets/fonts/ (the folder libass is pointed at). The files are git-ignored; the manifest
assets/fonts/fonts.json is committed, so `fonts sync` (and ./setup.sh) restores Google fonts anywhere.
Only use fonts you're licensed to use; Google Fonts are under the SIL Open Font License.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

from .util import EditorError, log

DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
MANIFEST = DIR / "fonts.json"
WEIGHTS = {100: "Thin", 200: "ExtraLight", 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold",
           700: "Bold", 800: "ExtraBold", 900: "Black"}
FONT_EXT = {".ttf", ".otf"}
# an old user agent makes the Google Fonts CSS API answer with plain .ttf files, one static file per weight
UA = "Wget/1.21"


def names(path: str | Path) -> tuple[str, str]:
    """(family, style) of a font file."""
    from PIL import ImageFont
    try:
        family, style = ImageFont.truetype(str(path), 20).getname()
    except OSError as e:
        raise EditorError(f"not a readable font: {path}") from e
    return family, style or "Regular"


def full_name(family: str, style: str) -> str:
    return family if style.lower() in ("regular", "normal", "book") else f"{family} {style}"


def installed() -> dict[str, Path]:
    """Every caption-usable name -> file, for the fonts in assets/fonts/."""
    out = {}
    for p in sorted(DIR.glob("*")) if DIR.exists() else []:
        if p.suffix.lower() not in FONT_EXT:
            continue
        try:
            family, style = names(p)
        except EditorError:
            continue
        out[full_name(family, style)] = p
        out.setdefault(family, p)
    return out


def _system() -> set[str]:
    if not shutil.which("fc-list"):
        return set()
    listing = subprocess.run(["fc-list", ":", "family", "fullname"], capture_output=True, text=True).stdout
    return {n.strip() for line in listing.splitlines() for part in line.split(":") for n in part.split(",")}


def resolve(name: str) -> str:
    """The name libass should use for `name` (case-insensitive; "Montserrat 800" means ExtraBold)."""
    m = re.match(r"^(.*?)\s+(\d00)$", name.strip())
    if m and int(m.group(2)) in WEIGHTS:
        name = full_name(m.group(1), WEIGHTS[int(m.group(2))])
    for attempt in (0, 1):
        known = list(installed()) + sorted(_system())
        for cand in known:
            if cand.lower() == name.lower():
                return cand
        # a Google font from the manifest that this machine doesn't have yet (new machine, cloud session)
        family = next((f for f in _manifest()["google"] if name.lower().startswith(f.lower())), None)
        if attempt or not family:
            break
        google(family, _manifest()["google"][family])
    raise EditorError(f"font '{name}' is not installed. Add it: python3 -m editor fonts add \"{name}\" "
                      f"(Google Fonts) or editor fonts add path/to/font.ttf")


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"google": {}, "files": []}


def _save_manifest(m: dict) -> None:
    DIR.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, indent=1, sort_keys=True) + "\n")


def google(family: str, weights: list[int] | None = None) -> list[str]:
    """Download static .ttf files for a Google Fonts family. Returns the usable names."""
    weights = sorted(set(weights or [400, 700, 800, 900]))
    query = urllib.parse.quote(family) + (":wght@" + ";".join(map(str, weights)) if weights != [400] else "")
    url = f"https://fonts.googleapis.com/css2?family={query}"
    css = _get(url).decode()
    if "@font-face" not in css and weights != [400]:     # single-weight families reject a weight list
        css = _get(f"https://fonts.googleapis.com/css2?family={urllib.parse.quote(family)}").decode()
    faces = re.findall(r"font-style:\s*normal;\s*font-weight:\s*(\d+);\s*src:\s*url\((https://[^)]+\.ttf)\)", css)
    if not faces:
        raise EditorError(f"Google Fonts has no family '{family}' (check the spelling at fonts.google.com)")
    DIR.mkdir(parents=True, exist_ok=True)
    got = []
    for weight, src in faces:
        dst = DIR / f"{family.replace(' ', '')}-{WEIGHTS.get(int(weight), weight)}.ttf"
        if not dst.exists():
            dst.write_bytes(_get(src))
        got.append(full_name(*names(dst)))
    m = _manifest()
    have = set(m["google"].get(family, []))
    m["google"][family] = sorted(have | {int(w) for w, _ in faces})
    _save_manifest(m)
    log(f"fonts: {family}: {', '.join(got)}")
    return got


def add_file(path: str | Path) -> list[str]:
    path = Path(path).expanduser()
    if path.suffix.lower() not in FONT_EXT or not path.exists():
        raise EditorError(f"{path}: expected an existing .ttf or .otf file")
    family, style = names(path)
    DIR.mkdir(parents=True, exist_ok=True)
    dst = DIR / path.name
    if path.resolve() != dst.resolve():
        shutil.copy2(path, dst)
    m = _manifest()
    if path.name not in m["files"]:
        m["files"].append(path.name)
    _save_manifest(m)
    name = full_name(family, style)
    log(f"fonts: added {name} ({dst.name}; your own file: git-ignored, copy it again on another machine)")
    return [name]


def add(source: str, weights: list[int] | None = None) -> list[str]:
    if Path(source).expanduser().suffix.lower() in FONT_EXT:
        return add_file(source)
    return google(source, weights)


def sync() -> list[str]:
    got = []
    m = _manifest()
    for family, weights in m["google"].items():
        got += google(family, weights)
    missing = [f for f in m["files"] if not (DIR / f).exists()]
    if missing:
        log(f"fonts: your own files are not here (copy them into assets/fonts/): {', '.join(missing)}")
    return got


def listing() -> str:
    lines = ["# Caption fonts in assets/fonts (use with --font or EDL \"captions\": {\"font\": ...})"]
    seen = set()
    for n, p in installed().items():
        if p not in seen and n == full_name(*names(p)):
            seen.add(p)
            lines.append(f"- {n}  ({p.name})")
    if len(lines) == 1:
        lines.append("(none yet: ./setup.sh adds Montserrat; editor fonts add \"<Google font>\")")
    return "\n".join(lines)


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.read()
    except Exception as e:  # noqa: BLE001
        if getattr(e, "code", None) == 400:
            return b""
        raise EditorError(f"download failed: {url}: {e}") from e
