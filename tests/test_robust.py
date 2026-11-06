"""Plain errors instead of tracebacks for the mistakes people make (from a fuzzing pass of the CLI)."""
import json

import pytest

from editor import produce
from editor.util import EditorError, load_json


def test_load_json_says_what_is_wrong(tmp_path):
    with pytest.raises(EditorError, match="doesn't exist"):
        load_json(tmp_path / "cut_meta.json")
    with pytest.raises(EditorError, match="is a folder"):
        load_json(tmp_path)
    (tmp_path / "bad.json").write_text("{nope")
    with pytest.raises(EditorError, match="isn't valid JSON"):
        load_json(tmp_path / "bad.json")


def test_specs_with_the_wrong_shape_are_refused_before_rendering(tmp_path):
    def spec(data):
        p = tmp_path / "s.json"
        p.write_text(json.dumps(data))
        return p
    for data, msg in (([], "not a list"), ({"pieces": {}}, "must be a list"), ({"pieces": [{"name": "a"}]}, "needs a \"src\""),
                      ({"pieces": [{"name": "a", "type": "color", "dur": "2s"}]}, "must be a number"),
                      ({"pieces": [{"name": "a", "type": "color", "dur": -2}]}, "more than 0"),
                      ({"audio": [], "pieces": [{"name": "a", "type": "color", "dur": 1}]}, "JSON object")):
        with pytest.raises(EditorError, match=msg):
            produce.Spec(spec(data))


def test_a_version_note_without_a_preview_is_saved(tmp_path):
    p = tmp_path / "s.json"
    p.write_text(json.dumps({"output": {"file": "out/x.mp4"}, "pieces": [{"name": "a", "type": "color", "dur": 1}]}))
    s = produce.Spec(p)
    s.file.parent.mkdir(parents=True)
    s.file.write_bytes(b"video")
    entry = produce.save_version(s, "first draft", [str(s.file), ""])      # no --preview: an empty preview path
    assert entry["n"] == 1 and len(entry["files"]) == 1


def test_times_that_are_not_times(tmp_path):
    from editor.anchors import _clock
    for bad in (":", "", "1:99", "-3"):
        with pytest.raises(EditorError, match="not a time"):
            _clock(bad)
    with pytest.raises(EditorError, match="not a time"):
        produce._clock("-3")


def test_spoken_numbers_only_combine_the_way_numbers_are_said():
    from editor.wordfix import digits

    def say(s):
        return " ".join(w["text"] for w in digits([{"text": t, "start": i, "end": i + 0.5} for i, t in enumerate(s.split())]))
    assert say("three two one go") == "3 2 one go"
    assert say("in twenty twenty four") == "in 2024" and say("nineteen ninety five") == "1995"
    assert say("seven eleven") == "7 11" and say("two, three ideas") == "2, 3 ideas"
    assert say("two hundred and fifty dollars") == "$250" and say("three thousand five hundred") == "3,500"
    assert say("one point five million") == "one point five million"


def test_tight_max_gap_never_plays_a_moment_twice(tmp_path):
    from editor.plan import plan
    w = lambda t, s, e: {"text": t, "start": s, "end": e, "src": 0}  # noqa: E731
    (tmp_path / "tr.json").write_text(json.dumps({"sources": [{"path": "x.mp4", "duration": 10.0}],
                                                  "words": [w("hello", 0.5, 0.9), w("there", 1.02, 1.4), w("friend.", 1.52, 2.0)]}))
    plan(tmp_path / "tr.json", tmp_path / "edl.json", max_gap=0.1)
    segs = json.loads((tmp_path / "edl.json").read_text())["segments"]
    assert all(b["start"] >= a["end"] for a, b in zip(segs, segs[1:]))


def test_a_two_line_hook_title_keeps_its_second_line():
    from editor.captions import _escape
    assert _escape("Stop editing\nlike this") == "Stop editing\\Nlike this"
    assert _escape("a\\b {x}") == "a/b (x)"
