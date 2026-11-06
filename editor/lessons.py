"""Lessons: what each production taught, kept where the next plan will read it.

`.claude/skills/edit-reel/lessons.md` holds craft and process lessons (newest first, one line each, under a dated
heading per video). Preferences go to style memory; timings to `editor effort`. This makes the after-every-video
step a one-liner, and lets a plan pull the lessons relevant to it.

  editor lessons add "Blur dev URLs in stills before they go in a video" --video "Walk-Free demo" --tag capture
  editor lessons show [--grep capture] [--last 20]
"""
from __future__ import annotations

import re
from datetime import date
from pathlib import Path

from .util import EditorError, log

PATH = Path(__file__).resolve().parent.parent / ".claude" / "skills" / "edit-reel" / "lessons.md"
HEAD = re.compile(r"^## (\d{4}-\d{2}-\d{2}) (.+)$")


def add(text: str, video: str | None = None, tag: str | None = None, path: Path = PATH) -> str:
    text = " ".join(text.split())
    if not text:
        raise EditorError("a lesson needs text")
    line = f"- {'[' + tag + '] ' if tag else ''}{text}"
    today = date.today().isoformat()
    heading = f"## {today} {video or 'Notes'}"
    body = path.read_text() if path.exists() else "# Lessons from real productions\n\n"
    if line in body:
        log("lessons: already recorded")
        return line
    lines = body.split("\n")
    at = next((i for i, ln in enumerate(lines) if ln.strip() == heading), None)
    if at is None:   # a new dated section goes above the older ones (newest first)
        first = next((i for i, ln in enumerate(lines) if HEAD.match(ln)), len(lines))
        lines[first:first] = [heading, line, ""]
    else:
        end = next((i for i in range(at + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
        while end > at + 1 and not lines[end - 1].strip():
            end -= 1
        lines.insert(end, line)
    path.write_text("\n".join(lines))
    log(f"lessons: added under {heading}")
    return line


def show(grep: str | None = None, last: int | None = None, path: Path = PATH) -> str:
    if not path.exists():
        return "no lessons yet"
    out, section = [], None
    for ln in path.read_text().split("\n"):
        if HEAD.match(ln):
            section = ln[3:]
            continue
        if not ln.strip() or ln.startswith("# ") or section is None:
            continue
        if grep and not re.search(grep, ln, re.I):
            continue
        out.append(f"{section}: {ln[2:].strip()}" if ln.startswith("- ") else f"{section}: {ln.strip()}")
    if last:
        # the newest: sections are newest first, but a video's lessons are in story order (newest at the bottom)
        by: dict[str, list[str]] = {}
        for ln in out:
            by.setdefault(ln.split(": ", 1)[0], []).append(ln)
        out = [ln for sec in by.values() for ln in reversed(sec)][:last]
    return "\n".join(out) if out else "no matching lessons"


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="editor lessons", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    q = sub.add_parser("add", help="record one lesson (one line) under today's video")
    q.add_argument("text")
    q.add_argument("--video", help="the video it came from (the dated heading)")
    q.add_argument("--tag", help="a short topic: capture, audio, captions, honesty, pacing, process...")
    q = sub.add_parser("show", help="the lessons, newest first")
    q.add_argument("--grep", help="only lessons matching this (regex)")
    q.add_argument("--last", type=int)
    a = ap.parse_args(argv)
    if a.cmd == "add":
        print(add(a.text, a.video, a.tag))
    else:
        print(show(a.grep, a.last))
    return 0
