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
    spec["extras"] = [{"name": "sq", "from": "a", "to": "b.end", "size": [180, 180]},
                      {"name": "vert", "kind": "band", "size": [180, 320], "title": "It's 100°F: walk home"},
                      {"name": "hl", "kind": "band", "size": [180, 320], "ranges": [["a", "a+1"], ["c", "c.end"]]}]
    spec["overlay"] = {"elements": [{"type": "caption", "text": "Hello there", "t_in": "a+0.2", "t_out": "a+1.4"}]}
    spec["pieces"][0]["chapter"] = "Intro"
    spec["post"] = {"chapters": [], "cover": {"at": "a+1", "title": "Tiny"}}
    path = write_spec(tmp_path, spec)
    res = produce.produce(path)
    kit = res["post"]
    assert "00:00:00,200 --> 00:00:01,400\nHello there" in Path(kit["srt"]).read_text()
    assert Path(kit["chapters"]).read_text() == "0:00 Intro\n" and any("3 chapters" in i for i in kit["issues"])
    assert Path(kit["cover"]).exists()
    desc = Path(kit["description"]).read_text()
    assert desc.startswith("Tiny\n") and "0:00 Intro" in desc
    out = Path(res["file"])
    info = probe(out)
    assert info["duration"] == pytest.approx(4.5, abs=0.1)
    assert info["video"]["width"] == 320 and info.get("has_audio")
    rv = res["review"]
    assert rv["music_under_voice"] and rv["music_under_voice"][0]["gap_db"] is not None     # measured from the stems
    assert rv["longest_still"]["seconds"] == pytest.approx(2.0, abs=0.05)   # pieces of 2.0, 1.5 (+punch), 1.0 s
    assert rv["graphics_on_faces"] == []                                    # no faces in test patterns
    assert rv["duration"] == pytest.approx(4.5, abs=0.1) and Path(rv["contact_sheet"]).exists()
    assert any("voice v" in i for i in rv["issues"])        # the voice has no captions: flagged
    hl = probe(Path(res["extras"][2]))
    assert hl["duration"] == pytest.approx(2.0, abs=0.2)
    vert = probe(Path(res["extras"][1]))
    assert (vert["video"]["width"], vert["video"]["height"]) == (180, 320)
    sq = probe(Path(res["extras"][0]))
    assert sq["video"]["width"] == 180 and sq["duration"] == pytest.approx(3.5, abs=0.15)
    data = json.loads((tmp_path / "style" / "timings.json").read_text()) if (tmp_path / "style" /
                                                                            "timings.json").exists() else {}
    rng = produce.preview_range(path, "b", "c.end")
    assert probe(rng)["duration"] == pytest.approx(2.5, abs=0.15)
    spec["pieces"][0]["chapter"] = "Renamed"                       # labels never re-render a piece
    path.write_text(json.dumps(spec))
    assert produce.produce(path, only="pieces")["timing"]["pieces"] < 2
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


def test_init_drafts_a_spec_from_an_inventory(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=6", "-f", "lavfi",
                    "-i", "sine=duration=6", "-shortest", "-pix_fmt", "yuv420p", str(raw / "scene 1.mp4")], check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=duration=5", str(raw / "vo.wav")],
                   check=True)
    inv = tmp_path / "work" / "inventory"
    inv.mkdir(parents=True)
    w = lambda t, a, b: {"text": t, "start": a, "end": b}  # noqa: E731
    (inv / "scene 1.words.json").write_text(json.dumps([w("hello", 1.0, 1.4), w("there.", 1.5, 2.0)]))
    (inv / "vo.words.json").write_text(json.dumps([w("voice", 0.5, 0.9), w("over", 1.0, 3.0)]))
    (inv / "inventory.json").write_text(json.dumps({"items": [
        {"file": "scene 1.mp4", "kind": "video", "duration": 6.0, "has_audio": True},
        {"file": "vo.wav", "kind": "audio", "duration": 5.0, "has_audio": True}]}))
    caps = tmp_path / "caps"
    caps.mkdir()
    (caps / "route.png").write_bytes(b"")
    (caps / "shots.json").write_text(json.dumps({"shots": [{"name": "route", "file": "route.png",
                                                            "focus": {"x": 0.5, "y": 0.5, "w": 0.2, "h": 0.1}}]}))
    out = tmp_path / "produce.json"
    spec = produce.init_spec(raw, out, inv, shots=caps / "shots.json")
    names = [p["name"] for p in spec["pieces"]]
    assert names == ["scene_1", "vo", "shot_route", "end"]
    assert spec["pieces"][2]["focus_from"] == "caps/shots.json#route"
    assert spec["pieces"][0]["in"] == 0.6 and spec["pieces"][0]["out"] == 2.5
    assert spec["pieces"][1]["type"] == "color" and spec["pieces"][1]["dur"] == pytest.approx(3.4)
    assert set(spec["captions"]["voices"]) == {"v_scene_1", "v_vo"}
    s = produce.Spec(out)                       # it loads and resolves as a real spec
    assert s.total == pytest.approx(1.9 + 3.4 + 4.0 + 6.0)
    assert produce.auto_captions(s)[0]["text"] == "Hello there."
    assert any("placeholder" in t for t in spec["todo"])
    auto = spec["audio"]["music"][0]["automation"]                   # dips under the on-camera dialogue
    assert [0.6 - 0.4, 0] in [[round(x, 2), y] for x, y in auto] or auto[0] == [0.0, 0]
    assert [0.0, -10] in auto and [1.9, -10] in auto


def test_versions_keep_each_note(tmp_path):
    spec = base_spec()
    path = write_spec(tmp_path, spec)
    s = produce.Spec(path)
    s.file.parent.mkdir(parents=True, exist_ok=True)
    s.file.write_bytes(b"fake video")
    v1 = produce.save_version(s, "first draft", [str(s.file)])
    v2 = produce.save_version(s, "music quieter under the skit", [str(s.file)])
    assert (v1["n"], v2["n"]) == (1, 2)
    assert Path(v2["files"][0]).name == "x.v2.mp4" and Path(v2["files"][0]).exists()
    assert (s.file.parent / "versions" / "spec.v2.json").exists()
    assert "v2" in (tmp_path / "project.md").read_text() and "music quieter" in (tmp_path / "project.md").read_text()


def test_numbers_must_come_from_the_brief():
    assert produce._numbers("Heat on 2,300+ certificates; +62,748 crowns; 13–25% of the sun; 3.3°F; 9 hours") == \
        {"2300", "62748", "13", "25%", "3.3"}
    e = {"type": "counter", "lines": [{"text": "4,375 trees"}, {"text": "+62,748 tree crowns"}]}
    assert produce._texts(e) == ["4,375 trees", "+62,748 tree crowns"]
    assert "2,300" in produce._texts({"type": "big_stat", "from": 0, "to": 2300, "label": "US heat deaths"})


def test_script_lines_become_captions_timed_on_misheard_words():
    # what Vosk heard for "Meta's SAM 3.1 finds the trees, the pavement and the sky"
    heard = [("matter", 3.51, 3.8), ("sam", 3.85, 4.2), ("three", 4.29, 4.45), ("point", 4.5, 4.7),
             ("one", 4.74, 4.9), ("five", 4.95, 5.3), ("the", 5.43, 5.5), ("trees", 5.52, 6.0), ("the", 6.18, 6.3),
             ("pavement", 6.34, 6.9), ("and", 6.93, 7.1), ("the", 7.2, 7.28), ("sky", 7.29, 7.8)]
    words = [{"text": t, "start": a, "end": b} for t, a, b in heard]
    cards = produce.script_cards(words, "v6", 0, 20, ["Meta's SAM 3.1 finds the trees,", "the pavement and the sky."])
    assert [c["text"] for c in cards] == ["Meta's SAM 3.1 finds the trees,", "the pavement and the sky."]
    assert cards[0]["t_in"] == "@v6:3.51" and float(cards[1]["t_in"].split(":")[1]) == pytest.approx(6.18, abs=0.01)
    assert float(cards[1]["t_out"].split(":")[1]) == pytest.approx(7.95, abs=0.01)
    fixed = produce.scripted_words(words, 0, 20, "Meta's SAM 3.1 finds the trees, the pavement and the sky.")
    assert fixed[0]["text"] == "Meta's" and fixed[-1]["start"] == pytest.approx(7.29)


def test_at_turns_a_timestamped_note_into_the_entries_to_change(tmp_path):
    spec = base_spec(overlay={"elements": [{"type": "caption", "text": "hello", "t_in": "b", "t_out": "b+1"},
                                           {"type": "caption", "text": "later", "t_in": "c", "t_out": "c+0.5"}]})
    spec["audio"]["music"] = [{"src": {"compose": {"mood": "warm"}}, "at": 0, "gain": -6}]
    spec["audio"]["sfx"] = [{"src": "whoosh", "at": "b"}]
    s = produce.Spec(write_spec(tmp_path, spec))
    w = produce.what_is_at(s, "0:02.2")
    assert w["t"] == 2.2 and w["piece"]["name"] == "b" and w["piece"]["offset"] == 0.2
    assert w["voices"] == [{"name": "v", "src": "voice.wav", "source_second": 2.7, "gain": 0}]
    assert [g["text"] for g in w["graphics"]] == ["hello"]
    assert {m["list"] for m in w["audio"]} == {"music", "sfx"}
    assert produce.what_is_at(s, "c")["piece"]["name"] == "c" and produce._clock("1:02.5") == 62.5


def test_a_script_line_nobody_said_in_that_voice_is_reported_not_hidden():
    heard = [("the", 1.0, 1.2), ("shadiest", 1.25, 1.8), ("route", 1.85, 2.2), ("he", 3.0, 3.1), ("asked", 3.15, 3.5),
             ("out", 3.55, 3.7), ("loud", 3.75, 4.1)]
    words = [{"text": t, "start": a, "end": b} for t, a, b in heard]
    produce.UNHEARD.clear()
    cards = produce.script_cards(words, "v3", 0, 20, ["The shadiest route.", "Because that's the way home?",
                                                      "He asked out loud."])
    assert [c["text"] for c in cards] == ["The shadiest route.", "He asked out loud."]
    assert produce.UNHEARD == [("v3", "Because that's the way home?")]


def test_validation_catches_problems_before_rendering(tmp_path):
    spec = base_spec(pieces=[
        {"name": "a", "type": "framed", "src": "missing.png", "dur": 2, "punhc": [0.5, 1.5, 0.2, 0.2]},
        {"name": "b", "type": "video", "src": "voice.wav", "in": 3, "out": 1},
        {"name": "c", "type": "freeze", "from": "nope", "dur": 1},
        {"name": "d", "type": "framed", "src": "voice.wav", "dur": 1, "punch": [1, 2]}])
    spec["audio"]["sfx"] = [{"src": "boing", "at": "a"}, {"src": "pop", "at": "zz+1"}]
    (tmp_path / "voice.wav").write_bytes(b"")
    path = write_spec(tmp_path, spec)
    s = produce.Spec(path)
    errors, warnings = produce.validate(s)
    text = "\n".join(errors)
    assert "file not found: missing.png" in text and "out must be after in" in text
    assert "freezes 'nope'" in text and "punch needs 4 numbers" in text
    assert "file not found: boing" in text and "no piece named 'zz'" in text
    assert any("punhc" in w for w in warnings)                       # a typo is a warning
    with pytest.raises(EditorError, match="nothing rendered"):
        produce.produce(path)


def test_captions_from_a_brief_land_on_the_voice_that_says_them(tmp_path):
    w = lambda t, a, b: {"text": t, "start": a, "end": b}  # noqa: E731
    heard1 = "bro why are you walk in the sun".split()
    heard2 = "heat is the deadliest weather in america".split()
    (tmp_path / "v1.json").write_text(json.dumps([w(t, 1 + i * 0.3, 1.25 + i * 0.3) for i, t in enumerate(heard1)]))
    (tmp_path / "v2.json").write_text(json.dumps([w(t, 0.5 + i * 0.3, 0.75 + i * 0.3) for i, t in enumerate(heard2)]))
    spec = base_spec()
    spec["audio"]["voices"] = [{"name": "v1", "src": "voice.wav", "in": 0, "out": 5, "at": "a"},
                               {"name": "v2", "src": "voice.wav", "in": 0, "out": 5, "at": "b"}]
    spec["captions"] = {"voices": {"v1": "v1.json", "v2": "v2.json"}}
    path = write_spec(tmp_path, spec)
    brief = tmp_path / "brief.md"
    brief.write_text("## Captions\n```\n0:00 Bro. Why are you walking in the sun?\n0:08 Heat is the deadliest weather in "
                     "America.\n     (El calor es el clima más mortal.)\n0:12 A line nobody recorded about trees.\n```\n")
    rep = produce.captions_from_brief(path, brief)
    assert rep["assigned"] == {"v1": 1, "v2": 1} and rep["unmatched"] == ["0:12 A line nobody recorded about trees."]
    s = produce.Spec(path)
    cards = s.resolve(produce.auto_captions(s))
    assert [c["text"] for c in cards] == ["Bro. Why are you walking in the sun?", "Heat is the deadliest weather in America."]
    assert cards[1]["sub"] == "(El calor es el clima más mortal.)"
    assert cards[0]["t_in"] == pytest.approx(1.0) and cards[1]["t_in"] == pytest.approx(2.0 + 0.5)


@pytest.mark.slow
def test_a_vertical_production(tmp_path):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=3", "-f", "lavfi",
                    "-i", "sine=frequency=330:duration=3", "-shortest", "-pix_fmt", "yuv420p", str(tmp_path / "talk.mp4")],
                   check=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=1280x800:d=1", "-frames:v", "1",
                    str(tmp_path / "app.png")], check=True)
    spec = {"output": {"width": 180, "height": 320, "fps": 30, "file": "out/v.mp4", "duration": 4.0},
            "pieces": [{"name": "talk", "type": "video", "src": "talk.mp4", "in": 0, "out": 2.5, "grade": "cool"},
                       {"name": "app", "type": "framed", "src": "app.png", "dur": 1.5, "punch": [0.3, 1.5, 0.3, 0.3]}],
            "audio": {"voices": [{"name": "v", "src": "talk.mp4", "in": 0, "out": 2.5, "at": "talk"}]},
            "post": {"srt": True}}
    res = produce.produce(write_spec(tmp_path, spec))
    info = probe(Path(res["file"]))
    assert (info["video"]["width"], info["video"]["height"]) == (180, 320)
    assert info["duration"] == pytest.approx(4.0, abs=0.1)


def test_band_titles_wrap_and_shrink_to_fit():
    assert produce._fit_title("Hi", 1080, 81) == (81, ["Hi"])
    size, lines = produce._fit_title("A cooler way across campus", 1080, 81)
    assert lines == ["A cooler way", "across campus"]
    size, lines = produce._fit_title("Walk-Free: the shadiest way home from every class on campus", 1080, 81)
    assert len(lines) == 2 and size * 0.56 * max(map(len, lines)) <= 1080 * 0.88


def test_punch_in_aimed_at_a_captured_element(tmp_path):
    (tmp_path / "shots.json").write_text(json.dumps({"shots": [
        {"name": "route", "file": "route.png", "focus": {"x": 0.12, "y": 0.4, "w": 0.2, "h": 0.1}},
        {"name": "home", "file": "home.png"}]}))
    (tmp_path / "route.png").write_bytes(b"")
    spec = base_spec(pieces=[{"name": "r", "type": "framed", "src": "route.png", "dur": 4, "focus_from": "shots.json#route"}])
    s = produce.Spec(write_spec(tmp_path, spec))
    pc = s.pieces[0]
    assert pc["punch"][:2] == [1.2, 2.0]
    z = 2.0 * 1.06                                 # the punch times the Ken Burns
    ax, ay = pc["punch"][2:]
    assert ax == 0.0                               # too close to the left edge to centre: the view starts at the edge
    assert (ay * (1 - 1 / z) + 0.5 / z) == pytest.approx(0.4, abs=1e-3)   # centred vertically
    spec["pieces"][0]["focus_from"] = "shots.json#home"
    with pytest.raises(EditorError, match="no recorded focus"):
        produce.Spec(write_spec(tmp_path, spec))


def test_a_video_piece_from_a_recorded_shot(tmp_path):
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=6", "-pix_fmt", "yuv420p",
                    str(tmp_path / "shots.mp4")], check=True)
    (tmp_path / "shots.json").write_text(json.dumps({"recording": "shots.mp4", "shots": [
        {"name": "route", "rec_in": 1.0, "rec_out": 3.5}, {"name": "still", "rec_in": None}]}))
    spec = base_spec(pieces=[{"name": "r", "type": "video", "from_shot": "shots.json#route", "ramp_waits": {"speed": 4}}])
    s = produce.Spec(write_spec(tmp_path, spec))
    assert (s.pieces[0]["in"], s.pieces[0]["out"]) == (1.0, 3.5) and s.pieces[0]["src"] == "shots.mp4"
    spec["pieces"][0]["from_shot"] = "shots.json#still"
    with pytest.raises(EditorError, match="no recorded stretch"):
        produce.Spec(write_spec(tmp_path, spec))


def test_transitions_keep_every_piece_on_time(tmp_path):
    spec = base_spec(pieces=[{"name": "a", "type": "color", "dur": 1.0, "color": "red"},
                             {"name": "b", "type": "color", "dur": 1.0, "color": "blue",
                              "transition": {"type": "dissolve", "dur": 0.4}},
                             {"name": "c", "type": "color", "dur": 1.0, "color": "green", "transition": "whip"},
                             {"name": "d", "type": "color", "dur": 0.5, "color": "white"},          # a plain cut...
                             {"name": "e", "type": "color", "dur": 0.5, "color": "black",
                              "transition": "dip_white"}])                                            # ...then one more
    s = produce.Spec(write_spec(tmp_path, spec))
    base = produce.pieces(s)
    assert probe(base)["duration"] == pytest.approx(4.0, abs=0.05)

    def rgb(t):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(base), "-frames:v", "1", "-vf",
                              "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        return tuple(raw[:3])
    assert rgb(0.5)[0] > 200                       # red
    r, g, b = rgb(1.2)
    assert r > 60 and b > 60                       # mid-dissolve: red and blue mixed
    assert rgb(1.7)[2] > 200                       # blue, on time after the transition
    assert rgb(2.8)[1] > 100                       # green at the end
