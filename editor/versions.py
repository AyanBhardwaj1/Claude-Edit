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

import json
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
    cover = project / "out" / "cover.jpg"
    # only a cover made for this render: a rush run makes none, and an older one would show another version
    if cover.exists() and cover.stat().st_mtime >= Path(video).stat().st_mtime - 1:
        shutil.copy2(cover, d / "cover.jpg")
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


def suggest_chapters(words: list[dict], duration: float) -> list[dict]:
    """Chapters for a cut over a minute, as Cutmind's lib/chapters.ts does: about one a minute (3 to 8), each at the
    sentence start nearest its even share of the video, 10 s or more apart, titled with the sentence's opening words
    (better titles are an editorial pass). [{"words": "w12-w12", "text": ..., "start": s}] (start for showing only)."""
    import re as _re
    if duration < 60:
        return []
    spoken = [w for w in words if str(w.get("text", "")).strip() and w.get("id")]
    starts, new = [], True
    for i, w in enumerate(spoken):
        if new:
            starts.append(i)
        new = bool(_re.search(r"[.!?][\"')]*$", str(w["text"]).strip()))
    want = max(3, min(8, int(duration / 60 + 0.5)))
    picked = [0] if starts else []
    for k in range(1, want):
        target = duration * k / want
        prev = float(spoken[picked[-1]]["start"]) if picked else 0.0
        ok = [i for i in starts if float(spoken[i]["start"]) - prev >= 10 and duration - float(spoken[i]["start"]) >= 10 and i not in picked]
        if ok:
            picked.append(min(ok, key=lambda i: abs(float(spoken[i]["start"]) - target)))
    picked.sort()
    lead = _re.compile(r"^(so|and|but|okay|ok|now|then|also|well|um|uh)\b,?\s*", _re.I)
    out = []
    for n, i in enumerate(picked):
        text = " ".join(str(w["text"]).strip() for w in spoken[i:i + 12])
        text = _re.split(r"(?<=[.!?])\s", text)[0]
        title = " ".join(lead.sub("", text).rstrip(".!?,;:").split()[:6])
        title = "Intro" if n == 0 else (title[:1].upper() + title[1:] if title else f"Part {n + 1}")
        out.append({"words": f"{spoken[i]['id']}-{spoken[i]['id']}", "text": title, "start": round(float(spoken[i]["start"]), 2)})
    return out if len(out) >= 3 else []


def youtube_chapters(project: str | Path, edl: dict) -> str:
    """The EDL's chapters as YouTube description timestamps ("0:00 Intro" lines), which YouTube turns into chapters
    when there are at least 3, the first at 0:00 and each at least 10 s long; "" otherwise (with why, in the log)."""
    chapters = edl.get("chapters") or []
    if not chapters:
        return ""
    work = Path(project) / "work"
    try:
        from .anchors import resolve_work
        chapters = resolve_work({"chapters": chapters}, work).get("chapters", [])
    except EditorError:
        pass
    marks = sorted((float(c["start"]), str(c.get("text", "")).strip()) for c in chapters if "start" in c and c.get("text"))
    if not marks:
        return ""
    marks[0] = (0.0, marks[0][1])                     # YouTube wants the first at 0:00
    meta = work / "cut_meta.json"
    end = float(load_json(meta)["duration"]) if meta.exists() else marks[-1][0] + 10
    lengths = [b[0] - a[0] for a, b in zip(marks, marks[1:] + [(end, "")])]
    if len(marks) < 3 or min(lengths) < 10:
        log(f"post: chapters not listed for YouTube ({len(marks)} chapter(s), shortest {min(lengths):.0f} s): it wants "
            f"3 or more, each 10 s or longer")
        return ""

    def clock(t: float) -> str:
        t = int(t)
        return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60}:{t % 60:02d}"
    return "\n".join(f"{clock(t)} {title}" for t, title in marks)


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
    marks = youtube_chapters(project, edl)
    text = caption + (f"\n\n{marks}" if marks else "") + (f"\n\n{credits}" if credits else "") + "\n\n" + " ".join(tags) + "\n"
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


def _kept_words(edl: dict, words: list[dict]) -> set[int]:
    segs = edl.get("segments") or []
    return {i for i, w in enumerate(words) for sg in segs
            if sg.get("src", 0) == w.get("src", 0) and sg["start"] <= (w["start"] + w["end"]) / 2 <= sg["end"]}


def _runs(words: list[dict], ids: set[int]) -> list[str]:
    out, cur = [], []
    for i, w in enumerate(words):
        if i in ids:
            cur.append(str(w.get("text", "")).strip())
        elif cur:
            out.append(" ".join(cur))
            cur = []
    if cur:
        out.append(" ".join(cur))
    return [r for r in out if r]


def _q(t: str) -> str:
    return f'"{t}"' if len(t) <= 50 else f'"{t[:47]}..."'


def edl_changes(old: dict, new: dict, words: list[dict] | None = None) -> list[str]:
    """What changed between two EDLs, in plain words: the length, the words cut or brought back, the hook title,
    b-roll, zooms, music, captions, transitions and SFX. For telling the user what a note did, and checking that the
    edit touched only what the note asked (the reel twin of `editor produce --changes`)."""
    out = []
    dur = lambda e: sum((sg["end"] - sg["start"]) for sg in e.get("segments") or []) / float(e.get("speed", 1.0) or 1)  # noqa: E731
    if old.get("segments") != new.get("segments") or old.get("speed") != new.get("speed"):
        a, b = dur(old), dur(new)
        out.append(f"length {a:.1f} s -> {b:.1f} s ({b - a:+.1f} s)")
        if words:
            ko, kn = _kept_words(old, words), _kept_words(new, words)
            cut, back = _runs(words, ko - kn), _runs(words, kn - ko)
            if cut:
                out.append("cut " + ", ".join(_q(x) for x in cut[:4]) + (f" and {len(cut) - 4} more" if len(cut) > 4 else ""))
            if back:
                out.append("brought back " + ", ".join(_q(x) for x in back[:4]) + (f" and {len(back) - 4} more" if len(back) > 4 else ""))
        if old.get("speed") != new.get("speed"):
            out.append(f"speed {old.get('speed', 1.0)} -> {new.get('speed', 1.0)}")
    if old.get("title") != new.get("title"):
        out.append(f"hook title {_q(str(old.get('title') or ''))} -> {_q(str(new.get('title') or ''))}")
    ident = lambda b: json.dumps({k: b.get(k) for k in ("path", "text", "treatment", "on", "words", "start")}, sort_keys=True)  # noqa: E731
    label = lambda b: b.get("on") and f"{b.get('path') or b.get('text') or b.get('treatment')} on {_q(str(b['on']))}" \
        or str(b.get("path") or b.get("text") or b.get("treatment"))  # noqa: E731
    ob, nb = {ident(b): b for b in old.get("broll") or []}, {ident(b): b for b in new.get("broll") or []}
    added = [label(nb[k]) for k in nb if k not in ob]
    gone = [label(ob[k]) for k in ob if k not in nb]
    changed = [label(nb[k]) for k in nb if k in ob and ob[k] != nb[k]]
    if added:
        out.append("b-roll added: " + "; ".join(added[:4]) + (f" (+{len(added) - 4})" if len(added) > 4 else ""))
    if gone:
        out.append("b-roll removed: " + "; ".join(gone[:4]) + (f" (+{len(gone) - 4})" if len(gone) > 4 else ""))
    if changed:
        out.append("b-roll changed: " + "; ".join(changed[:4]))
    for key, name in (("zooms", "zooms"), ("transitions", "transitions"), ("chapters", "chapters")):
        a, b = old.get(key) or [], new.get(key) or []
        if a != b:
            out.append(f"{name}: {len(a)} -> {len(b)}" if len(a) != len(b) else f"{name} moved or changed")
    mo = old.get("music") if isinstance(old.get("music"), dict) else {}
    mn = new.get("music") if isinstance(new.get("music"), dict) else {}
    for k in sorted({*mo, *mn}):
        if mo.get(k) != mn.get(k):
            if k == "automation":
                out.append(f"music dips/lifts: {len(mo.get(k) or [])} -> {len(mn.get(k) or [])}")
            else:
                out.append(f"music {k}: {mo.get(k)} -> {mn.get(k)}")
    co = old.get("captions") if isinstance(old.get("captions"), dict) else {}
    cn = new.get("captions") if isinstance(new.get("captions"), dict) else {}
    for k in sorted({*co, *cn}):
        if co.get(k) != cn.get(k):
            out.append(f"captions {k}: {co.get(k)} -> {cn.get(k)}")
    if old.get("sfx") != new.get("sfx"):
        out.append("sound effects changed")
    return out


def changes(project: str | Path, n: int | None = None) -> str:
    """The plain-words diff between version n (default: the last saved) and the current work/edl.json."""
    project = Path(project)
    vs = versions(project)
    if not vs:
        return "no saved versions yet (editor version <project> --note ...)"
    n = n or vs[-1]["n"]
    old_p = project / "versions" / f"v{n}" / "edl.json"
    if not old_p.exists():
        raise EditorError(f"v{n} has no edl.json")
    tr = project / "work" / "transcript.json"
    words = load_json(tr).get("words") if tr.exists() else None
    lines = edl_changes(load_json(old_p), load_json(project / "work" / "edl.json"), words)
    return f"since v{n}:\n" + ("\n".join(f"  {x}" for x in lines) or "  nothing")
