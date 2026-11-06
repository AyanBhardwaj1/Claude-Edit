"""editor version --changes: what a note changed in the reel's EDL, in plain words."""
from editor.versions import edl_changes

WORDS = [{"src": 0, "start": 0.5 * i, "end": 0.5 * i + 0.4, "text": t}
         for i, t in enumerate("here is my tip about my cat and the real tip".split())]


def test_edl_changes_in_plain_words():
    old = {"segments": [{"src": 0, "start": 0.0, "end": 5.5}], "speed": 1.0, "title": "My tip",
           "broll": [{"path": "broll/cat.png", "on": "my cat"}], "zooms": [{"start": 1, "end": 2, "scale": 1.2}],
           "music": {"path": "music/a.mp3", "gain": -18}, "captions": {"style": "bold"}}
    assert edl_changes(old, old, WORDS) == []
    new = dict(old, segments=[{"src": 0, "start": 0.0, "end": 1.9}, {"src": 0, "start": 3.4, "end": 5.5}],
               title="The real tip", broll=[{"text": "TIP", "treatment": "text-pop", "on": "real tip"}], zooms=[],
               music={"path": "music/a.mp3", "gain": -24}, captions={"style": "clean"})
    out = edl_changes(old, new, WORDS)
    assert out[0] == "length 5.5 s -> 4.0 s (-1.5 s)"
    assert 'cut "about my cat"' in out
    assert 'hook title "My tip" -> "The real tip"' in out
    assert 'b-roll added: TIP on "real tip"' in out and 'b-roll removed: broll/cat.png on "my cat"' in out
    assert "zooms: 1 -> 0" in out and "music gain: -18 -> -24" in out and "captions style: bold -> clean" in out
