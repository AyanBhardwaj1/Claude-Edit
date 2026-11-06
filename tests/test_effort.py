"""Effort: rush/standard/polish profiles, learned timings, and choosing an effort for a time budget."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import effort, style  # noqa: E402
from editor.util import EditorError  # noqa: E402


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(effort, "ROOT", tmp_path / "style")
    monkeypatch.setattr(style, "ROOT", tmp_path / "style")


def test_aliases_match_cutmind_names():
    assert effort.normalise("fast") == "rush"
    assert effort.normalise("Balanced") == "standard"
    assert effort.normalise("best") == "polish"
    assert effort.normalise(None) is None
    with pytest.raises(EditorError):
        effort.normalise("ludicrous")


def test_profiles_trade_time_for_quality():
    r, s, p = (effort.PROFILE[e] for e in effort.EFFORTS)
    assert r["encode"] == "veryfast" and s["encode"] == "slow" and p["encode"] == "slower"
    assert not r["review"] and s["review"] and p["critic"]
    assert r["track_fps"] < s["track_fps"] < p["track_fps"]
    a, b, c = (effort.estimate(e, 60)["seconds"] for e in effort.EFFORTS)
    assert a < b < c                                    # with nothing learned, the priors still order them


def test_record_is_a_moving_average_per_machine():
    first = effort.record("render", "standard", 60, 60)        # 60 s for one media minute
    assert first == 60
    second = effort.record("render", "standard", 120, 60)
    assert second == pytest.approx(0.6 * 60 + 0.4 * 120)
    data = json.loads((effort.ROOT / "timings.json").read_text())
    entry = data["machines"][effort.machine()]["render:standard"]
    assert entry["runs"] == 2
    rate, learned = effort.rate("render", "standard")
    assert learned and rate == pytest.approx(second)


def test_learned_standard_rate_scales_for_other_efforts():
    effort.record("render", "standard", 100, 60)
    rate, learned = effort.rate("render", "rush")
    assert learned and rate == pytest.approx(100 * effort.SCALE["rush"]["render"])


def test_choose_the_best_effort_that_fits_the_budget():
    stages = ["render"]
    effort.record("render", "rush", 60, 60)
    effort.record("render", "standard", 180, 60)
    effort.record("render", "polish", 600, 60)
    assert effort.choose(4, 60, stages)[0] == "standard"     # 3 min fits 85% of 4 min
    assert effort.choose(20, 60, stages)[0] == "polish"
    pick, _, fits = effort.choose(0.5, 60, stages)
    assert pick == "rush" and not fits
    assert "nothing fits" in effort.table(60, stages, 0.5)


def test_bad_measurements_are_refused():
    with pytest.raises(EditorError):
        effort.record("render", "standard", 10, 0)


def test_reel_effort_is_a_style_key():
    assert "reel.effort" in style.KEYS


def test_auto_records_timings_and_uses_the_effort(tmp_path):
    project = tmp_path / "demo"
    subprocess.run([sys.executable, str(ROOT / "tests" / "make_fixture.py"), str(project)], check=True,
                   capture_output=True)
    env = {**os.environ, "CLAUDE_EDIT_STYLE": str(tmp_path / "style2")}
    res = subprocess.run([sys.executable, "-m", "editor", "auto", str(project), "--from", "plan", "--to", "plan",
                          "--effort", "fast"], cwd=ROOT, capture_output=True, text=True, env=env)
    assert res.returncode == 0, res.stderr[-2000:]
    assert "effort: rush" in res.stderr
    data = json.loads((tmp_path / "style2" / "timings.json").read_text())
    assert any(k == "plan:rush" for k in next(iter(data["machines"].values())))
    res = subprocess.run([sys.executable, "-m", "editor", "auto", str(project), "--from", "plan", "--to", "plan",
                          "--budget", "60"], cwd=ROOT, capture_output=True, text=True, env=env)
    assert res.returncode == 0, res.stderr[-2000:]
    assert "budget 60 min -> polish" in res.stderr
