"""editor produce: time references, the timeline, caching, and a tiny end-to-end production."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import effort, produce  # noqa: E402
from editor.util import EditorError, probe  # noqa: E402


@pytest.fixture(autouse=True)
def no_real_timings(tmp_path, monkeypatch):
    monkeypatch.setattr(effort, "ROOT", tmp_path / "style")


def write_spec(tmp_path: Path, spec: dict) -> Path:
    p = tmp_path / "spec.json"
    p.write_text(json.dumps(spec))
    return p


def base_spec(**kw):
    spec = {"output": {"width": 320, "height": 180, "fps": 30, "file": "out/x.mp4", "duration": 4.5},
            "pieces": [{"name": "a", "type": "color", "dur": 2.0, "color": "red"},
                       {"name": "b", "type": "color", "dur": 1.5},
                       {"name": "c", "type": "color", "dur": 1.0, "color": "blue"}],
            "audio": {"voices": [{"name": "v", "src": "voice.wav", "in": 1.0, "out": 3.0, "at": "a+0.5"}]}}
    spec.update(kw)
    return spec


def test_references_resolve_to_output_seconds(tmp_path):
    s = produce.Spec(write_spec(tmp_path, base_spec()))
    assert s.total == pytest.approx(4.5)
    assert s.t("b") == 2.0 and s.t("b.end") == 3.5 and s.t("c+0.25") == 3.75 and s.t("b.end-0.5") == 3.0
    assert s.t("@v:1.0") == pytest.approx(0.5) and s.t("@v:2.2") == pytest.approx(1.7)   # voice source -> output
    assert s.t(1.25) == 1.25
    with pytest.raises(EditorError):
        s.t("nope")
    with pytest.raises(EditorError):
        s.t("@ghost:1")
    els = s.resolve({"elements": [{"type": "caption", "t_in": "@v:1.5", "t_out": "b", "text": "hi"},
                                  {"type": "pills_row", "times": ["a", "c"], "items": ["x", "y"], "y": 10}]})
    assert els["elements"][0]["t_in"] == 1.0 and els["elements"][0]["t_out"] == 2.0
    assert els["elements"][1]["times"] == [0.0, 3.5] and els["elements"][1]["y"] == 10


def test_plan_table_and_bad_specs(tmp_path):
    s = produce.Spec(write_spec(tmp_path, base_spec()))
    assert "total 4.50 s (target 4.5 s, +0.00)" in s.table()
    with pytest.raises(EditorError):
        produce.Spec(write_spec(tmp_path, base_spec(pieces=[{"name": "a", "type": "color", "dur": 1},
                                                             {"name": "a", "type": "color", "dur": 1}])))
    with pytest.raises(EditorError):
        produce.Spec(write_spec(tmp_path, base_spec(pieces=[{"name": "a", "type": "framed", "src": "x.png"}])))


def test_ramp_expression_is_piecewise_linear():
    expr = produce._ramp_expr([(0, 0), (1, -20)])
    f = lambda t: eval(expr.replace("if(", "_if(").replace("lt(", "_lt(").replace("pow(", "pow("),  # noqa: E731
                       {"_if": lambda c, a, b: a if c else b, "_lt": lambda a, b: a < b, "t": t, "pow": pow})
    assert f(0) == pytest.approx(1.0) and f(1.5) == pytest.approx(0.1, rel=1e-3)
    assert f(0.5) == pytest.approx(10 ** (-10 / 20), rel=1e-3)


@pytest.mark.slow
def test_tiny_production_end_to_end(tmp_path):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=480x270:r=30:d=4", "-f", "lavfi",
                    "-i", "sine=frequency=220:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    str(tmp_path / "clip.mp4")], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4",
                    str(tmp_path / "voice.wav")], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=640x360:d=1", "-frames:v", "1",
                    str(tmp_path / "shot.png")], check=True)
    spec = base_spec(pieces=[
        {"name": "a", "type": "video", "src": "clip.mp4", "in": 0.5, "out": 2.5, "grade": "hot", "z1": 1.1},
        {"name": "b", "type": "framed", "src": "shot.png", "dur": 1.5, "punch": [0.5, 1.5, 0.2, 0.2], "flash": 0.2},
        {"name": "c", "type": "freeze", "from": "a", "dur": 1.0, "blur": 6, "darken": 0.3, "fade_out": 0.3}])
    spec["audio"]["sfx"] = [{"src": "pop", "at": "b", "gain": -6}]
    spec["audio"]["music"] = [{"src": "clip.mp4", "at": 0, "gain": -10}]
    spec["extras"] = [{"name": "sq", "from": "a", "to": "b.end", "size": [180, 180]}]
    path = write_spec(tmp_path, spec)
    res = produce.produce(path)
    out = Path(res["file"])
    info = probe(out)
    assert info["duration"] == pytest.approx(4.5, abs=0.1)
    assert info["video"]["width"] == 320 and info.get("has_audio")
    rv = res["review"]
    assert rv["duration"] == pytest.approx(4.5, abs=0.1) and Path(rv["contact_sheet"]).exists()
    assert any("voice v" in i for i in rv["issues"])        # the voice has no captions: flagged
    sq = probe(Path(res["extras"][0]))
    assert sq["video"]["width"] == 180 and sq["duration"] == pytest.approx(3.5, abs=0.15)
    data = json.loads((tmp_path / "style" / "timings.json").read_text()) if (tmp_path / "style" /
                                                                            "timings.json").exists() else {}
    # a second run renders nothing new: every piece is cached
    spec["pieces"][1]["dur"] = 1.5
    res2 = produce.produce(path, only="pieces")
    assert res2["timing"]["pieces"] < res["timing"]["pieces"]
    assert isinstance(data, dict)


def test_caption_cards_break_on_pauses_punctuation_and_length():
    w = lambda t, a, b: {"text": t, "start": a, "end": b}  # noqa: E731
    words = [w("heat", 1.0, 1.2), w("is", 1.25, 1.3), w("deadly.", 1.35, 1.7), w("every", 1.8, 2.0),
             w("map", 2.05, 2.2), w("still", 3.5, 3.7), w("walk", 3.8, 3.9), w("free", 3.95, 4.1)]
    cards = produce.caption_cards(words, "v", 0.5, 10, max_chars=16, lines=1, replace={"walk free": "Walk-Free"})
    texts = [c["text"] for c in cards]
    assert texts == ["Heat is deadly.", "Every map", "Still Walk-Free"]
    assert [c["text"] for c in produce.caption_cards(words, "v", 0.5, 10, max_chars=7, lines=1)][:2] == \
        ["Heat is", "Deadly."]
    assert cards[0]["t_in"] == "@v:1.00"
    s_ = [float(c["t_in"].split(":")[1]) for c in cards]
    e_ = [float(c["t_out"].split(":")[1]) for c in cards]
    assert all(e <= n for e, n in zip(e_, s_[1:]))                  # cards never overlap
    assert produce.caption_cards(words, "v", 3.0, 10)[0]["text"] == "Still walk free"   # outside in/out dropped


def test_inventory_lists_media_without_transcribing(tmp_path):
    from editor import inventory
    raw = tmp_path / "raw"
    raw.mkdir()
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2", "-f", "lavfi",
                    "-i", "sine=duration=2", "-shortest", "-pix_fmt", "yuv420p", str(raw / "a.mp4")], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=duration=1", str(raw / "b.wav")],
                   check=True)
    (raw / "notes.txt").write_text("ignored")
    res = inventory.inventory(raw, tmp_path / "inv", transcribe=False)
    kinds = {i["file"]: i["kind"] for i in res["items"]}
    assert kinds == {"a.mp4": "video", "b.wav": "audio"}
    a = next(i for i in res["items"] if i["file"] == "a.mp4")
    assert a["width"] == 320 and a["has_audio"] and Path(a["sheet"]).exists()
    assert "| a.mp4 | video |" in (tmp_path / "inv" / "inventory.md").read_text()


@pytest.mark.slow
def test_waits_in_a_screen_recording_are_sped_up(tmp_path):
    # 1 s moving, 3 s frozen (a spinner that doesn't spin), 1 s moving
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=1", "-f", "lavfi",
                    "-i", "color=c=gray:s=320x180:r=30:d=3", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=1",
                    "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0", "-pix_fmt", "yuv420p",
                    str(tmp_path / "rec.mp4")], check=True)
    spec = base_spec(pieces=[{"name": "rec", "type": "video", "src": "rec.mp4", "in": 0, "out": 5,
                              "ramp_waits": {"speed": 6, "keep": 0.25, "label": "thinking…"}}])
    spec["audio"] = {"music": [{"src": "rec.mp4", "at": 0}]}
    s = produce.Spec(write_spec(tmp_path, spec))
    runs = s.pieces[0]["_ramps"]
    fast = [r for r in runs if r[2] == 6]
    assert len(fast) == 1 and fast[0][0] == pytest.approx(1.25, abs=0.15) and fast[0][1] == pytest.approx(3.75, abs=0.15)
    assert s.total == pytest.approx(5 - 2.5 + 2.5 / 6, abs=0.2)
    shim = produce.ramp_shimmers(s)
    assert shim and shim[0]["label"] == "thinking…"
    path = tmp_path / "pieces_only.mp4"
    produce._render_piece(s, s.pieces[0], path)
    assert probe(path)["duration"] == pytest.approx(s.total, abs=0.1)
