"""editor lessons: one line per lesson, under a dated heading per video, newest first."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import lessons  # noqa: E402


def test_add_and_show(tmp_path):
    f = tmp_path / "lessons.md"
    f.write_text("# Lessons from real productions\n\nRead this first.\n\n## 2026-01-01 Old video\n- old lesson\n")
    lessons.add("Blur dev URLs in stills", video="Demo", tag="capture", path=f)
    lessons.add("Music under skits much lower", video="Demo", tag="audio", path=f)
    lessons.add("Music under skits much lower", video="Demo", tag="audio", path=f)     # no duplicates
    text = f.read_text()
    today = date.today().isoformat()
    assert text.index(f"## {today} Demo") < text.index("## 2026-01-01 Old video")       # newest first
    assert text.count("Music under skits") == 1
    assert text.index("[capture] Blur") < text.index("[audio] Music")                    # in order within a video
    shown = lessons.show(grep="capture", path=f)
    assert "Blur dev URLs" in shown and "old lesson" not in shown
    assert lessons.show(path=f).splitlines()[-1].endswith("old lesson")
