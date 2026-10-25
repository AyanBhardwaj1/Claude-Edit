"""Reusable asset libraries shared across every reel: music (by mood) and B-roll (by category).

library/
  music/LIBRARY.md      human/Claude-readable list grouped by mood (regenerated)
  music/library.json    tracks: mood, tags, starred, bpm, loudness, duration, source
  music/<mood>/...      audio files
  broll/index.json      clips: category, tags, description, duration, size, source
  broll/<category>/...  clips and images
Claude picks music by reading LIBRARY.md against the video's topic and energy,
and picks B-roll from index.json; tags and descriptions are what make that work.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from datetime import date
from pathlib import Path

import numpy as np

from .util import EditorError, load_json, log, probe, run, save_json

ROOT = Path(os.environ.get("CLAUDE_EDIT_LIBRARY", Path(__file__).resolve().parent.parent / "library"))
MOODS = ["hype", "uplifting", "emotional", "tense-dark", "cool-fun"]
MOOD_TITLES = {"hype": "Hype", "uplifting": "Uplifting", "emotional": "Emotional", "tense-dark": "Tense / Dark",
               "cool-fun": "Cool / Fun"}
AUDIO_EXT = {".m4a", ".mp3", ".wav", ".aac", ".flac", ".ogg", ".opus"}


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:48] or "item"


def _unique_id(existing: set[str], base: str) -> str:
    cand, n = base, 2
    while cand in existing:
        cand, n = f"{base}-{n}", n + 1
    return cand


# ---------------------------------------------------------------- music

def _music_db() -> dict:
    path = ROOT / "music" / "library.json"
    return load_json(path) if path.exists() else {"moods": MOODS, "tracks": []}


def _save_music(db: dict) -> None:
    save_json(ROOT / "music" / "library.json", db)
    _write_music_md(db)


def analyze_audio(path: str | Path) -> dict:
    """Tempo and loudness so Claude can judge energy without hearing the track."""
    info = probe(path)
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-t", "90", "-i", str(path), "-ac", "1", "-ar", "11025",
                           "-f", "f32le", "-"], capture_output=True)
    samples = np.frombuffer(proc.stdout, np.float32)
    bpm = _estimate_bpm(samples, 11025) if samples.size > 11025 * 5 else None
    loud = run(["ffmpeg", "-i", str(path), "-af", "ebur128", "-f", "null", "-"], quiet=False).stderr
    lufs = re.findall(r"I:\s+(-?[\d.]+) LUFS", loud)
    lra = re.findall(r"LRA:\s+([\d.]+) LU", loud)
    return {"duration": round(info["duration"], 1), "bpm": bpm,
            "lufs": float(lufs[-1]) if lufs else None, "lra": float(lra[-1]) if lra else None}


def _estimate_bpm(x: np.ndarray, sr: int) -> int | None:
    hop = 256
    frames = len(x) // hop
    energy = np.sqrt(np.mean(x[:frames * hop].reshape(frames, hop) ** 2, axis=1) + 1e-12)
    onset = np.maximum(np.diff(np.log(energy)), 0)
    onset -= onset.mean()
    if not onset.any():
        return None
    fps = sr / hop
    lags = np.arange(int(fps * 60 / 180), int(fps * 60 / 60) + 1)
    ac = np.array([np.dot(onset[:-lag], onset[lag:]) for lag in lags])
    bpm = 60 * fps / lags[int(np.argmax(ac))]
    while bpm < 75:
        bpm *= 2
    while bpm > 165:
        bpm /= 2
    return int(round(bpm))


def music_add(src: str, mood: str, tags: list[str] | None = None, title: str | None = None, starred: bool = False,
              notes: str = "", cookies_from_browser: str | None = None) -> dict:
    if mood not in MOODS:
        raise EditorError(f"mood must be one of {MOODS}")
    db = _music_db()
    dest = ROOT / "music" / mood
    dest.mkdir(parents=True, exist_ok=True)
    if re.match(r"https?://", src):
        from .fetch import fetch
        paths = fetch(src, dest, audio_only=True, cookies_from_browser=cookies_from_browser,
                      name=_slug(title) if title else None)
        if not paths:
            raise EditorError("nothing downloaded")
        file = paths[0]
        meta_path = file.with_suffix(".info.json")
        meta = load_json(meta_path) if meta_path.exists() else {}
        title = title or meta.get("track") or meta.get("title") or file.stem
    else:
        srcp = Path(src)
        if not srcp.exists():
            raise EditorError(f"{src} not found")
        file = dest / srcp.name
        if srcp.resolve() != file.resolve():
            shutil.copy2(srcp, file)
        title = title or srcp.stem
    stats = analyze_audio(file)
    track = {"id": _unique_id({t["id"] for t in db["tracks"]}, _slug(title)), "title": title, "mood": mood,
             "tags": tags or [], "starred": starred, "notes": notes,
             "file": str(file.relative_to(ROOT)), "source": src, "added": date.today().isoformat(), **stats}
    db["tracks"].append(track)
    _save_music(db)
    log(f"music: added '{title}' [{mood}] {stats['bpm']} bpm, {stats['duration']}s -> {track['id']}")
    return track


def music_tag(track_id: str, mood: str | None = None, tags: list[str] | None = None, star: bool | None = None,
              notes: str | None = None) -> dict:
    db = _music_db()
    t = next((t for t in db["tracks"] if t["id"] == track_id), None)
    if not t:
        raise EditorError(f"no track '{track_id}'")
    if mood:
        if mood not in MOODS:
            raise EditorError(f"mood must be one of {MOODS}")
        t["mood"] = mood
    if tags is not None:
        t["tags"] = tags
    if star is not None:
        t["starred"] = star
    if notes is not None:
        t["notes"] = notes
    _save_music(db)
    return t


def music_path(track_id_or_path: str) -> Path:
    p = Path(track_id_or_path)
    if p.exists():
        return p
    t = next((t for t in _music_db()["tracks"] if t["id"] == track_id_or_path), None)
    if not t:
        raise EditorError(f"music '{track_id_or_path}' is neither a file nor a library track id")
    return ROOT / t["file"]


def _write_music_md(db: dict) -> None:
    lines = ["# Music library", "", "Pick by the video's topic and energy. ★ = favourite. "
             "Add with `python3 -m editor music add <file-or-url> --mood <mood> --tags ...`.", ""]
    for mood in MOODS:
        tracks = sorted([t for t in db["tracks"] if t["mood"] == mood], key=lambda t: (not t["starred"], t["title"]))
        lines.append(f"## {MOOD_TITLES[mood]} ({len(tracks)})")
        for t in tracks:
            star = "★ " if t["starred"] else ""
            bits = [f"{t.get('bpm') or '?'} bpm", f"{t.get('duration', 0):.0f}s"]
            tags = ", ".join(t["tags"])
            lines.append(f"- {star}**{t['title']}** `{t['id']}` ({', '.join(bits)})" + (f" — {tags}" if tags else "")
                         + (f". {t['notes']}" if t.get("notes") else ""))
        lines.append("")
    (ROOT / "music" / "LIBRARY.md").write_text("\n".join(lines))


def music_list(mood: str | None = None) -> str:
    db = _music_db()
    _write_music_md(db)
    text = (ROOT / "music" / "LIBRARY.md").read_text()
    if mood:
        block = re.search(rf"## {re.escape(MOOD_TITLES[mood])}.*?(?=\n## |\Z)", text, re.S)
        return block.group(0) if block else ""
    return text


# ---------------------------------------------------------------- b-roll

def _broll_db() -> dict:
    path = ROOT / "broll" / "index.json"
    return load_json(path) if path.exists() else {"clips": []}


def broll_add(files: list[str], category: str, tags: list[str] | None = None, description: str = "",
              source: str = "") -> list[dict]:
    db = _broll_db()
    dest = ROOT / "broll" / _slug(category)
    dest.mkdir(parents=True, exist_ok=True)
    added = []
    for f in files:
        src = Path(f)
        if not src.exists():
            raise EditorError(f"{f} not found")
        target = dest / src.name
        if target.exists() and target.resolve() != src.resolve():
            target = dest / f"{src.stem}-{len(db['clips'])}{src.suffix}"
        shutil.copy2(src, target)   # copy, never move: raw/ is read-only by rule
        info = probe(target)
        v = info.get("video", {})
        clip = {"id": _unique_id({c["id"] for c in db["clips"]}, _slug(src.stem)), "file": str(target.relative_to(ROOT)),
                "category": _slug(category), "tags": tags or [], "description": description,
                "duration": round(info["duration"], 2), "width": v.get("width"), "height": v.get("height"),
                "has_audio": info["has_audio"], "source": source or str(src), "added": date.today().isoformat()}
        db["clips"].append(clip)
        added.append(clip)
        log(f"broll: added {clip['id']} [{clip['category']}] {clip['duration']}s")
    save_json(ROOT / "broll" / "index.json", db)
    return added


def broll_list(query: str | None = None) -> list[dict]:
    clips = _broll_db()["clips"]
    if query:
        q = query.lower()
        clips = [c for c in clips if q in c["category"] or q in c["description"].lower() or
                 any(q in t.lower() for t in c["tags"]) or q in c["id"]]
    return clips


def broll_path(clip_id_or_path: str) -> Path:
    p = Path(clip_id_or_path)
    if p.exists():
        return p
    c = next((c for c in _broll_db()["clips"] if c["id"] == clip_id_or_path), None)
    return ROOT / c["file"] if c else p
