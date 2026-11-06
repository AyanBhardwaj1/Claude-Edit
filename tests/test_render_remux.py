"""The reel render's picture key: what may change without a re-encode (sound) and what may not (picture)."""
import json

from editor.render import PRESETS, _picture_key


def _key(tmp, edl, **kw):
    args = dict(captions=None, track=None, zooms=[], punch_in=1.0, grade="natural", lut=None, sharpen=0.35, fit="crop",
                broll=[], crf=18, auto_color=0.5, draft=False)
    args.update(kw)
    return _picture_key(tmp, dict(PRESETS["reels"]), args["captions"], args["track"], args["zooms"], args["punch_in"],
                        args["grade"], args["lut"], args["sharpen"], args["fit"], args["broll"], args["crf"],
                        args["auto_color"], args["draft"], edl, [])


def test_sound_changes_keep_the_picture_and_picture_changes_dont(tmp_path):
    (tmp_path / "cut.mkv").write_bytes(b"cut")
    (tmp_path / "cut_meta.json").write_text(json.dumps({"duration": 10}))
    caps = tmp_path / "captions.ass"
    caps.write_text("[Events]\nDialogue: hello")
    edl = {"segments": [{"src": 0, "start": 0, "end": 5}], "music": {"gain": -18}, "settings": {"music.db": -18}}
    base = _key(tmp_path, edl, captions=caps)
    # sound only: the music, its record in settings, effects, b-roll natural sound
    louder = dict(edl, music={"gain": -10}, settings={"music.db": -10}, sfx=[{"type": "pop", "at": 1}])
    assert _key(tmp_path, louder, captions=caps) == base
    assert _key(tmp_path, edl, captions=caps, broll=[{"path": "x.mp4", "start": 1, "dur": 2, "nat": -12}]) == \
        _key(tmp_path, edl, captions=caps, broll=[{"path": "x.mp4", "start": 1, "dur": 2, "nat": -20}])
    # picture: zooms, grade, the captions' text, the cut, b-roll timing
    assert _key(tmp_path, edl, captions=caps, zooms=[{"start": 1, "end": 2, "scale": 1.2}]) != base
    assert _key(tmp_path, edl, captions=caps, grade="warm") != base
    caps.write_text("[Events]\nDialogue: goodbye")
    assert _key(tmp_path, edl, captions=caps) != base
    caps.write_text("[Events]\nDialogue: hello")
    assert _key(tmp_path, dict(edl, segments=[{"src": 0, "start": 0, "end": 4}]), captions=caps) != base
