"""The reel render's picture key: what may change without a re-encode (sound) and what may not (picture)."""
import json
from pathlib import Path

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


def test_a_treatment_png_rewritten_with_the_same_pixels_keeps_the_picture(tmp_path):
    (tmp_path / "cut.mkv").write_bytes(b"cut")
    (tmp_path / "cut_meta.json").write_text("{}")
    png = tmp_path / "pop.png"
    png.write_bytes(b"\x89PNG same pixels")
    broll = [{"path": str(png), "start": 1, "dur": 2, "mode": "overlay"}]
    k1 = _key(tmp_path, {}, broll=broll)
    import os
    import time
    time.sleep(0.01)
    png.write_bytes(b"\x89PNG same pixels")                    # text-pop / post-wall PNGs are rewritten every render
    os.utime(png, None)
    assert _key(tmp_path, {}, broll=broll) == k1
    png.write_bytes(b"\x89PNG new pixels")
    assert _key(tmp_path, {}, broll=broll) != k1


def test_transparent_card_picture_goes_on_white(tmp_path):
    from PIL import Image
    from editor.render import _on_white
    logo = tmp_path / "logo.png"
    im = Image.new("RGBA", (100, 100), (0, 0, 0, 0))
    im.paste((0, 0, 0, 255), (30, 30, 70, 70))                    # a black logo on nothing
    im.save(logo)
    flat = Path(_on_white(str(logo), tmp_path / "flat.png"))
    out = Image.open(flat).convert("RGB")
    assert out.size == (132, 132) and out.getpixel((2, 2)) == (255, 255, 255) and out.getpixel((66, 66)) == (0, 0, 0)
    photo = tmp_path / "photo.png"
    Image.new("RGB", (50, 50), (200, 10, 10)).save(photo)
    assert _on_white(str(photo), tmp_path / "x.png") == str(photo)    # opaque pictures are used as they are
