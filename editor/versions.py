"""Versions, the post kit and export: the notes loop of a reel.

  editor version projects/<name> --note "music too loud at the start"   save the current render as vN
  editor version projects/<name> --list                                  every version and the note that made it
  editor version projects/<name> --restore 2                             put v2's EDL back (then re-render)
  editor post projects/<name> --caption "..." --hashtags a b c d e --keywords "..."   the text under the post
  editor export projects/<name> [--version 3]                            out/export/<Title> - Version N.mp4 + cover + caption

versions/vN/ holds export.mp4, cover.jpg, edl.json and notes.md. The post caption is three short parts (a hook
line of 60-80 characters that leads with the words people search, one or two sentences of context, at most one
specific ask) and EXACTLY 5 hashtags; credits for CC BY pictures are added automatically.
"""
from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path

from .util import EditorError, load_json, log, save_json


def _latest_render(project: Path) -> Path:
    outs = sorted((p for p in (project / "out").glob("*.mp4") if "_draft" not in p.name),
                  key=lambda p: p.stat().st_mtime)
    if not outs:
        raise EditorError(f"no finished render in {project}/out: render first (without --draft)")
    return outs[-1]


def versions(project: str | Path) -> list[dict]:
    project = Path(project)
    out = []
    for d in sorted((project / "versions").glob("v*"), key=lambda d: int(d.name[1:]) if d.name[1:].isdigit() else 0):
        if (d / "export.mp4").exists():
            notes = (d / "notes.md").read_text().strip() if (d / "notes.md").exists() else ""
            out.append({"n": int(d.name[1:]), "dir": str(d), "note": notes})
    return out


def save_version(project: str | Path, note: str = "") -> Path:
    project = Path(project)
    video = _latest_render(project)
    n = (versions(project)[-1]["n"] + 1) if versions(project) else 1
    d = project / "versions" / f"v{n}"
    d.mkdir(parents=True, exist_ok=True)
    shutil.copy2(video, d / "export.mp4")
    if (project / "out" / "cover.jpg").exists():
        shutil.copy2(project / "out" / "cover.jpg", d / "cover.jpg")
    if (project / "work" / "edl.json").exists():
        shutil.copy2(project / "work" / "edl.json", d / "edl.json")
    (d / "notes.md").write_text(f"{note or 'First draft'}\n\n_{datetime.now():%Y-%m-%d %H:%M}_\n")
    log(f"version {n} saved: {d}" + (f" ({note})" if note else ""))
    return d


def restore(project: str | Path, n: int) -> Path:
    project = Path(project)
    src = project / "versions" / f"v{n}" / "edl.json"
    if not src.exists():
        raise EditorError(f"version {n} has no saved edit")
    shutil.copy2(src, project / "work" / "edl.json")
    log(f"restored version {n}'s edit: re-run `editor auto {project} --from cut` to render it")
    return project / "work" / "edl.json"


def write_post(project: str | Path, caption: str, hashtags: list[str], keywords: list[str] | None = None) -> Path:
    project = Path(project)
    tags = [("#" + re.sub(r"\s+", "", t.lstrip("#"))) for t in hashtags if t.strip("# ")]
    if len(tags) != 5 or len({t.lower() for t in tags}) != 5:
        raise EditorError(f"a post takes exactly 5 different hashtags (got {len(tags)}): specific to this video, "
                          f"a mix of niche and mid-size, no giant generic tags")
    caption = re.sub(r"\s*—\s*", ", ", caption).strip()
    edl_p = project / "work" / "edl.json"
    edl = load_json(edl_p) if edl_p.exists() else {}
    edl["post"] = {"caption": caption, "hashtags": tags, "keywords": keywords or []}
    if edl_p.exists():
        save_json(edl_p, edl)
    from .images import credit_line
    paths = [str((project / b["path"]) if not Path(b["path"]).is_absolute() else b["path"])
             for b in edl.get("broll", []) if b.get("path")]
    credits = credit_line(paths)
    text = caption + (f"\n\n{credits}" if credits else "") + "\n\n" + " ".join(tags) + "\n"
    out = project / "out" / "post.txt"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    log(f"post caption -> {out}")
    return out


def export(project: str | Path, version: int | None = None) -> Path:
    project = Path(project)
    edl_p = project / "work" / "edl.json"
    edl = load_json(edl_p) if edl_p.exists() else {}
    title = edl.get("title") or project.name
    vs = versions(project)
    if version is not None or vs:
        v = next((x for x in vs if x["n"] == version), None) if version is not None else vs[-1]
        if not v:
            raise EditorError(f"no version {version}")
        video, n = Path(v["dir"]) / "export.mp4", v["n"]
        cover = Path(v["dir"]) / "cover.jpg"
    else:
        video, n, cover = _latest_render(project), 1, project / "out" / "cover.jpg"
    stem = re.sub(r'[\\/:*?"<>|]+', "", title).strip()[:80] + f" - Version {n}"
    dest = project / "out" / "export"
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copy2(video, dest / f"{stem}.mp4")
    if cover.exists():
        shutil.copy2(cover, dest / f"{stem} cover.jpg")
    if (project / "out" / "post.txt").exists():
        shutil.copy2(project / "out" / "post.txt", dest / f"{stem} caption.txt")
    log(f"exported {dest / (stem + '.mp4')}")
    return dest / f"{stem}.mp4"
