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


def test_word_anchor_picks_the_same_occurrence_as_a_phrase():
    from editor.anchors import find
    # a cold open plays w2-w3 first, then the whole take w0-w4: w2/w3 appear twice on the cut
    words = [{"id": "w2", "text": "twenty", "start": 0.0, "end": 0.3}, {"id": "w3", "text": "bucks", "start": 0.3, "end": 0.6},
             {"id": "w0", "text": "it", "start": 1.0, "end": 1.2}, {"id": "w1", "text": "costs", "start": 1.2, "end": 1.5},
             {"id": "w2", "text": "twenty", "start": 1.5, "end": 1.8}, {"id": "w3", "text": "bucks", "start": 1.8, "end": 2.1}]
    on = find(words, {"on": "twenty bucks"})
    ids = find(words, {"words": "w2-w3"})
    assert on[0]["start"] == ids[0]["start"] == 0.0 and ids[1]["end"] == 0.6
    second = find(words, {"words": "w2-w3#2"})
    assert second[0]["start"] == 1.5 and second[1]["end"] == 2.1
    assert find(words, {"words": "w2-w3#3"}) is None
    assert find(words, {"words": ["w0", "w3"]})[1]["end"] == 2.1              # the end word after the start


def test_word_anchor_stays_inside_one_play_of_a_repeated_stretch():
    from editor.anchors import find
    # cold open w44-w49 (0-3 s), then the body w40-w60 from 4 s
    cold = [{"id": f"w{i}", "text": "x", "start": (i - 44) * 0.5, "end": (i - 44) * 0.5 + 0.4} for i in range(44, 50)]
    body = [{"id": f"w{i}", "text": "x", "start": 4 + (i - 40) * 0.6, "end": 4 + (i - 40) * 0.6 + 0.5} for i in range(40, 61)]
    words = cold + body
    a, b = find(words, {"words": "w46-w52"})                 # w52 is only in the body: the body's w46
    assert a["start"] == 4 + 6 * 0.6 and b["start"] == 4 + 12 * 0.6
    a, b = find(words, {"words": "w49-w44"})                 # backwards, within the cold open
    assert a["start"] == 0.0 and b["start"] == 2.5
