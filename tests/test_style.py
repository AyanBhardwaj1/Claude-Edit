"""Style memory: decay and confidence, scopes, the draft -> approved loop, apply and auto defaults."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import cli, style  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(style, "ROOT", tmp_path / "style")


def edl(**kw):
    return {"segments": [{"src": 0, "start": 0, "end": 5}], **kw}


def test_one_keep_is_not_enough_but_a_note_is():
    p = style._empty()
    style.observe(p, "kind:reel", "reel.captions.style", "beast", "keep")
    assert style.value_of(p["prefs"]["kind:reel"]["reel.captions.style"])[2] is False
    style.observe(p, "kind:reel", "reel.captions.style", "clean", "note")
    val, _, ok = style.value_of(p["prefs"]["kind:reel"]["reel.captions.style"])
    assert (val, ok) == ("clean", True)


def test_decay_lets_taste_move():
    p = style._empty()
    for _ in range(3):
        style.observe(p, "global", "reel.music.db", -20, "change")
    for _ in range(4):
        style.observe(p, "global", "reel.music.db", -26, "change")
    assert style.value_of(p["prefs"]["global"]["reel.music.db"])[0] < -23.5
    with pytest.raises(style.EditorError):
        style.observe(p, "global", "reel.nope", 1, "note")


def test_split_votes_are_not_applied():
    p = style._empty()
    style.observe(p, "global", "reel.grade", "warm", "change")
    style.observe(p, "global", "reel.grade", "punchy", "change")
    assert style.value_of(p["prefs"]["global"]["reel.grade"])[2] is False


def test_brand_beats_kind_beats_global():
    style.note("white captions everywhere", sets=["reel.captions.style=white"])
    assert style.resolve("reel.captions.style", "reel", "acme") == "white"
    style.note("reels get bold captions", kind="reel", sets=["reel.captions.style=bold"])
    assert style.resolve("reel.captions.style", "reel", "acme") == "bold"
    style.note("Acme wants clean captions", kind="reel", brand="Acme", sets=["reel.captions.style=clean"])
    assert style.resolve("reel.captions.style", "reel", "acme") == "clean"
    assert style.resolve("reel.captions.style", "reel", "other") == "bold"
    assert "Acme wants clean captions" in (style.ROOT / "STYLE.md").read_text()


def test_launch_keys_never_leak_into_reels():
    style.note("always 16:9", sets=["launch.format=16:9"])
    assert "launch.format" not in style.learned("reel")
    assert style.learned("launch")["launch.format"][0] == "16:9"


def test_snapshot_then_learn_records_changes(tmp_path):
    f = tmp_path / "work" / "edl.json"
    f.parent.mkdir()
    f.write_text(json.dumps(edl(settings={"captions.style": "bold", "grade": "natural"}, brand="acme")))
    style.snapshot(f)
    f.write_text(json.dumps(edl(settings={"captions.style": "clean", "grade": "natural"}, brand="acme")))
    assert style.learn(f) == ["reel.captions.style: bold -> clean"]
    prof = style.load()
    assert prof["prefs"]["brand:acme"]["reel.captions.style"]["votes"] == {"clean": 2.0}
    assert prof["prefs"]["kind:reel"]["reel.grade"]["votes"] == {"natural": 0.5}
    assert style.resolve("reel.captions.style", "reel", "acme") == "clean"   # one change is enough
    assert style.resolve("reel.grade", "reel") is None                       # one keep is not


def test_launch_plan_settings_and_brand_only_keys(tmp_path):
    plan = {"format": "16:9", "brand": {"name": "YouBank"}, "theme": {"dark": "#07080a"},
            "music": {"synth": True, "bpm": 96, "key": -2, "gain": 0.6}, "mix": {"sfx": 0.8},
            "scenes": [{"type": "text", "text": "Your fund runs on _research._", "dur": 2.0},
                       {"type": "text", "text": "@brand", "dur": 3.0}]}
    s = style.detect(plan)[1]
    assert s["launch.voice"] == "none" and s["launch.serif_accents"] is True
    assert s["launch.text_dur"] == 2.0 and s["launch.length"] == 5.0
    f = tmp_path / "plan.json"
    f.write_text(json.dumps(plan))
    style.learn(f)
    prefs = style.load()["prefs"]
    assert "launch.theme.dark" in prefs["brand:youbank"] and "launch.theme.dark" not in prefs["kind:launch"]


def test_apply_fills_only_unset_fields(tmp_path):
    style.note("calm music", kind="launch", sets=["launch.music.bpm=96", "launch.format=16:9"])
    f = tmp_path / "plan.json"
    f.write_text(json.dumps({"format": "9:16", "music": {"synth": True}, "scenes": []}))
    done = style.apply(f)
    doc = json.loads(f.read_text())
    assert doc["format"] == "9:16" and doc["music"]["bpm"] == 96
    assert done == ["launch.music.bpm = 96 (kind:launch)"]
    f.write_text(json.dumps({"music": False, "scenes": []}))
    style.apply(f)
    assert json.loads(f.read_text())["music"] is False
    assert style.check(f) == []


def test_check_reports_drift(tmp_path):
    style.note("quiet music", kind="reel", sets=["reel.music.db=-24"])
    f = tmp_path / "edl.json"
    f.write_text(json.dumps(edl(music={"track": "x", "db": -16})))
    assert style.check(f) == ["reel.music.db: draft -16, usually -24.0 (kind:reel)"]


def test_forget():
    e = style.note("no music ever", kind="reel", sets=["reel.music.db=-30"])
    assert style.forget(e["id"]) == 1
    assert style.forget("reel.music.db") == 1
    assert style.learned("reel") == {}


def _auto_args(**kw):
    base = {a: None for a in cli.AUTO_STYLE}
    return argparse.Namespace(**{**base, "brand": None, "no_learned_style": False, **kw})


def test_auto_flag_beats_project_beats_learned_beats_builtin(tmp_path):
    style.note("tight cuts", kind="reel", sets=["reel.max_gap=0.2", "reel.captions.style=clean",
                                               "reel.grade=warm"])
    work = tmp_path / "work"
    work.mkdir()
    (work / "edl.json").write_text(json.dumps(edl(settings={"grade": "punchy"})))
    args = _auto_args(style="beast")
    brand, settings = cli._resolve_style(args, work)
    assert args.style == "beast"                         # explicit flag
    assert args.grade == "punchy"                        # this project's EDL
    assert args.max_gap == 0.2                           # learned
    assert args.speed == 1.0 and args.preset == "reels"  # built-in
    assert settings["max_gap"] == 0.2
    args = _auto_args(no_learned_style=True)
    cli._resolve_style(args, tmp_path / "none")
    assert args.max_gap == 0.30 and args.style == "bold"
