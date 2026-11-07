"""Inventory: what's actually in a pile of footage, before planning (brief-production step 1).

For every video, audio file and picture in a folder: kind, length, size, frame rate, whether it has sound, a contact
sheet (videos), and what is said (the transcription engines with their usual fallback, cached), so the brief's
names can be mapped to real files and gaps found early. Writes `inventory.md` (read it) and `inventory.json`.

  editor inventory projects/<name>/raw [--out projects/<name>/work/inventory] [--no-transcribe]
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from .util import EditorError, log, probe, run

VIDEO = {".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi", ".mts"}
AUDIO = {".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg", ".opus"}
IMAGE = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic"}


def _kind(p: Path) -> str | None:
    s = p.suffix.lower()
    return "video" if s in VIDEO else "audio" if s in AUDIO else "image" if s in IMAGE else None


def _sheet(src: Path, dur: float, out: Path, n: int = 8) -> Path:
    rate = max(n / max(dur, 0.1), 0.01)
    run(["ffmpeg", "-y", "-i", str(src), "-vf", f"fps={rate:.4f},scale=360:-2,tile=4x2", "-frames:v", "1",
         "-q:v", "4", str(out)])
    return out


def inventory(folder: str | Path, out: str | Path | None = None, transcribe: bool = True, engine: str = "auto",
              model: str = "small", language: str | None = None) -> dict:
    folder = Path(folder)
    if not folder.is_dir():
        raise EditorError(f"not a folder: {folder}")
    out = Path(out) if out else folder.parent / "work" / "inventory"
    out.mkdir(parents=True, exist_ok=True)
    items = []
    for p in sorted(folder.iterdir()):
        kind = _kind(p)
        if not kind or p.name.startswith("."):
            continue
        it = {"file": p.name, "kind": kind, "bytes": p.stat().st_size}
        try:
            info = probe(p)
        except EditorError as e:
            it["error"] = str(e)
            items.append(it)
            continue
        it["duration"] = round(float(info.get("duration") or 0), 2)
        v = info.get("video") or {}
        if kind != "audio" and v:
            it.update(width=v.get("width"), height=v.get("height"))
            if kind == "video":
                it["fps"] = round(float(v.get("fps") or 0), 2)
        it["has_audio"] = bool(info.get("has_audio"))
        if it["has_audio"] and _silent(p):   # an audio track with nothing on it (camera mic off, a muted export)
            it["silent"] = True
        if kind == "video" and it["duration"] > 0:
            it["sheet"] = str(_sheet(p, it["duration"], out / f"{p.stem}_sheet.jpg"))
        items.append(it)
    speech = [it for it in items if it.get("has_audio") and not it.get("silent") and it["kind"] in ("video", "audio")
              and "error" not in it]
    engine_used = None
    if transcribe and speech:
        from .transcribe import transcribe as tr
        tdir = out / "transcribe"
        try:
            tr([str(folder / it["file"]) for it in speech], tdir, model=model, language=language, engine=engine)
            data = json.loads((tdir / "transcript.json").read_text())
            engine_used = ", ".join(sorted({s.get("engine", "?") for s in data.get("sources", [])})) or None
            words = data.get("words", [])
            for i, it in enumerate(speech):
                ws = [w for w in words if w.get("src", w.get("source")) == i]
                it["words"] = len(ws)
                it["first_word_at"] = round(ws[0]["start"], 2) if ws else None
                it["said"] = " ".join(w.get("word", w.get("text", "")).strip() for w in ws)
                (out / f"{Path(it['file']).stem}.words.json").write_text(json.dumps(ws))
        except EditorError as e:
            log(f"inventory: transcription skipped: {e}")
    res = {"folder": str(folder), "engine": engine_used, "items": items}
    (out / "inventory.json").write_text(json.dumps(res, indent=1))
    (out / "inventory.md").write_text(_md(res))
    log(f"inventory: {len(items)} files -> {out / 'inventory.md'}")
    return res


def _silent(path: Path, floor_db: float = -60.0) -> bool:
    """True when the loudest moment of the sound track is below the floor (or it can't be read)."""
    try:
        r = run(["ffmpeg", "-i", str(path), "-vn", "-af", "volumedetect", "-f", "null", "-"], quiet=False)
    except EditorError:
        return False
    m = re.search(r"max_volume: (-?inf|-?[\d.]+) dB", r.stderr)
    return bool(m) and (m.group(1).endswith("inf") or float(m.group(1)) < floor_db)


def _md(res: dict) -> str:
    lines = [f"# Inventory of {res['folder']}", "",
             "| file | kind | length | size | sound | first word |", "|---|---|---|---|---|---|"]
    for it in res["items"]:
        size = f"{it.get('width')}x{it.get('height')}" + (f" @{it['fps']}" if it.get("fps") else "") \
            if it.get("width") else ""
        lines.append(f"| {it['file']} | {it['kind']} | {it.get('duration', '?')} s | {size} | "
                     f"{'silent' if it.get('silent') else 'yes' if it.get('has_audio') else 'no'} | {it.get('first_word_at', '')} |")
    quiet = [it["file"] for it in res["items"] if it.get("silent")]
    if quiet:
        lines += ["", f"Silent (a sound track with nothing on it: the mic was off or muted, not transcribed): {', '.join(quiet)}"]
    lines += ["", f"Transcripts ({res.get('engine') or 'none'}; offline engines mishear names and other languages: "
                  "check against the script and on-screen text):", ""]
    for it in res["items"]:
        if it.get("said"):
            lines.append(f"- **{it['file']}**: {it['said'][:600]}")
    lines += ["", "Contact sheets: " + ", ".join(Path(it["sheet"]).name for it in res["items"] if it.get("sheet")), "",
              "Next: map the brief's names to these files, list what's missing or different, tell the user once."]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="editor inventory", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder")
    ap.add_argument("--out")
    ap.add_argument("--no-transcribe", action="store_true")
    ap.add_argument("--engine", default="auto")
    ap.add_argument("--model", default="small")
    ap.add_argument("--language")
    a = ap.parse_args(argv)
    res = inventory(a.folder, a.out, not a.no_transcribe, a.engine, a.model, a.language)
    print(_md(res))
    return 0
