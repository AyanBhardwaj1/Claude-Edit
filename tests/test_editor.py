"""Unit tests for the planning/caption/zoom logic plus one end-to-end pipeline run.

Run: python3 -m pytest -q
The end-to-end test uses tests/make_fixture.py (flite TTS speech, no Whisper model needed).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import captions, plan, render  # noqa: E402
from editor.util import normalize_fps  # noqa: E402


def W(src, start, end, text):
    return {"src": src, "start": start, "end": end, "text": text, "prob": 1.0}


def write_tr(tmp_path, words, durations=(20.0,)):
    tr = {"sources": [{"path": f"/clip{i}.mp4", "duration": d} for i, d in enumerate(durations)],
          "words": words, "phrases": []}
    path = tmp_path / "transcript.json"
    path.write_text(json.dumps(tr))
    return path


def run_plan(tmp_path, words, **kw):
    out = plan.plan(write_tr(tmp_path, words), tmp_path / "edl.json", **kw)
    return json.loads(out.read_text())


def test_fillers_removed_and_split(tmp_path):
    edl = run_plan(tmp_path, [W(0, 0.0, 0.4, "So"), W(0, 0.45, 0.7, "um"), W(0, 0.75, 1.0, "this"),
                              W(0, 1.05, 1.4, "works.")])
    assert [s["text"] for s in edl["segments"]] == ["So", "this works."]
    assert edl["removed"][0]["reason"] == "filler"


def test_long_pause_is_cut_with_padding(tmp_path):
    edl = run_plan(tmp_path, [W(0, 1.0, 1.4, "Hello"), W(0, 3.0, 3.5, "world")], max_gap=0.3)
    a, b = edl["segments"]
    assert a["start"] == pytest.approx(0.94) and a["end"] == pytest.approx(1.5)
    assert b["start"] == pytest.approx(2.94)


def test_padding_never_bleeds_into_removed_word(tmp_path):
    edl = run_plan(tmp_path, [W(0, 1.0, 1.4, "Hello"), W(0, 1.45, 1.6, "uh"), W(0, 1.65, 2.0, "there")])
    first, second = edl["segments"]
    assert first["end"] <= 1.45 and second["start"] >= 1.6


def test_retake_keeps_last_take(tmp_path):
    words = [W(0, 0.0, 0.3, "The"), W(0, 0.3, 0.6, "best"), W(0, 0.6, 0.9, "tool"), W(0, 0.9, 1.0, "is"),
             W(0, 2.0, 2.3, "The"), W(0, 2.3, 2.6, "best"), W(0, 2.6, 2.9, "tool"), W(0, 2.9, 3.1, "is"),
             W(0, 3.1, 3.6, "Claude.")]
    edl = run_plan(tmp_path, words)
    assert [s["text"] for s in edl["segments"]] == ["The best tool is Claude."]
    assert edl["removed"][0]["reason"].startswith("retake")


def test_distinct_lines_are_not_retakes(tmp_path):
    words = [W(0, 0.0, 0.3, "Step"), W(0, 0.3, 0.6, "one:"), W(0, 0.6, 1.0, "record."),
             W(0, 2.0, 2.3, "Step"), W(0, 2.3, 2.6, "two:"), W(0, 2.6, 3.0, "edit.")]
    edl = run_plan(tmp_path, words, max_gap=2.0)
    assert not edl["removed"]


def test_retakes_can_be_disabled(tmp_path):
    words = [W(0, 0, 0.3, "Hi"), W(0, 0.3, 0.6, "there"), W(0, 0.6, 0.9, "friends"),
             W(0, 2, 2.3, "Hi"), W(0, 2.3, 2.6, "there"), W(0, 2.6, 2.9, "friends")]
    assert not run_plan(tmp_path, words, retakes=False)["removed"]


def test_speed_shortens_output_estimate(tmp_path):
    edl = run_plan(tmp_path, [W(0, 0.0, 2.0, "long"), W(0, 2.05, 4.0, "words")], speed=2.0)
    assert edl["stats"]["output_seconds"] == pytest.approx((4.1 + 0.06) / 2, abs=0.05)


def test_caption_groups_respect_limits_and_punctuation():
    words = [{"start": i * 0.3, "end": i * 0.3 + 0.25, "text": t, "segment": 0}
             for i, t in enumerate("THIS IS GREAT. AND THEN SOMETHING ELSE".split())]
    groups = captions._groups(words, max_words=3, max_chars=14)
    texts = [" ".join(w["text"] for w in g) for g in groups]
    assert texts[0] == "THIS IS GREAT."
    assert all(len(g) <= 3 for g in groups)


def test_caption_ass_has_one_event_per_word_and_emphasis(tmp_path):
    words = [{"start": 0.0, "end": 0.3, "text": "Make", "segment": 0},
             {"start": 0.3, "end": 0.6, "text": "money", "segment": 0},
             {"start": 0.6, "end": 0.9, "text": "online.", "segment": 0}]
    wp = tmp_path / "w.json"
    wp.write_text(json.dumps({"words": words}))
    out = captions.build(wp, tmp_path / "c.ass", style="bold", emphasis=["money"], title="Hook")
    text = out.read_text()
    dialogue = [line for line in text.splitlines() if line.startswith("Dialogue: 1")]
    assert len(dialogue) == 3
    assert "MONEY" in text and captions.ass_color("#FF3B30") in text
    assert "Hook" in text and (tmp_path / "c.srt").exists()


def test_ass_time_and_color():
    assert captions.ass_time(3661.239) == "1:01:01.24"
    assert captions.ass_color("#FFE600") == "&H0000E6FF"


def test_zoom_curve_alternates_and_eases():
    seg = np.array([0] * 30 + [1] * 30 + [2] * 30)
    z = render._zoom_curve(seg, [{"start": 2.0, "end": 3.0, "scale": 1.5, "ease": 0.2}], 1.1, 90, 30.0)
    assert z[10] == pytest.approx(1.0) and z[40] == pytest.approx(1.1)
    assert z[75] == pytest.approx(1.5) and 1.0 < z[61] < 1.5


def test_gauss_smoothing_preserves_constant():
    v = np.full(100, 0.4)
    assert np.allclose(render._gauss(v, 5), 0.4)


def test_normalize_fps():
    assert float(normalize_fps(29.97)) == pytest.approx(30000 / 1001)
    assert float(normalize_fps(59.94)) == pytest.approx(60000 / 1001)
    assert float(normalize_fps(120)) == 60


@pytest.mark.slow
def test_end_to_end_pipeline(tmp_path):
    project = tmp_path / "demo"
    subprocess.run([sys.executable, str(ROOT / "tests" / "make_fixture.py"), str(project)], check=True,
                   capture_output=True)
    res = subprocess.run([sys.executable, "-m", "editor", "auto", str(project), "--from", "plan",
                          "--title", "Test hook"], cwd=ROOT, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr[-2000:]
    report = json.loads((project / "out" / "qa.json").read_text())
    assert report["passed"], report
    edl = json.loads((project / "work" / "edl.json").read_text())
    reasons = {r["reason"].split(" ")[0] for r in edl["removed"]}
    assert {"filler", "retake"} <= reasons
    assert (project / "out" / "contact_sheet.png").exists()
