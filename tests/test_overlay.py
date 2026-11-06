"""editor overlay: spec validation, theme defaults, frame assets, and a tiny real render (skipped without Playwright)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import overlay  # noqa: E402
from editor.overlay import frame  # noqa: E402
from editor.util import EditorError  # noqa: E402


# ---------------------------------------------------------------- spec + theme (pure Python)

def test_theme_defaults_are_the_walk_free_look():
    th = overlay.theme_of({"elements": []})
    assert (th["width"], th["height"], th["fps"], th["scale"]) == (1920, 1080, 30, 1.0)
    c = th["colors"]
    assert (c["bg"], c["ink"], c["accent"], c["accent2"], c["dark"]) == \
        ("#f4f1e6", "#2f4a33", "#d7772d", "#2f6577", "#1f241c")
    assert c["box"] == "rgba(31,36,28,0.6)"                     # caption box = dark at box_opacity
    assert th["fonts"] == {"display": "Playfair Display", "text": "DM Sans"}


def test_theme_overrides_aliases_and_top_level_size():
    th = overlay.theme_of({"width": 1080, "height": 1920,
                           "theme": {"colors": {"heat": "#ff0000", "ink": "#111111", "dark": "#000"},
                                     "fonts": {"text": "Inter"}, "fps": 25}})
    assert (th["width"], th["height"], th["fps"]) == (1080, 1920, 25)
    assert th["colors"]["accent"] == "#ff0000" and th["colors"]["ink"] == "#111111"
    assert th["colors"]["box"] == "rgba(0,0,0,0.6)"              # derived from the new dark
    assert th["fonts"] == {"display": "Playfair Display", "text": "Inter"}
    assert overlay.theme_of({"theme": {"colors": {"box": "red"}}})["colors"]["box"] == "red"
    with pytest.raises(EditorError):
        overlay.theme_of({"theme": {"width": 0}})


def test_validate_catches_bad_elements():
    spec = {"elements": [
        {"type": "caption", "text": "hi", "t_in": 0, "t_out": 1},
        {"type": "sparkle", "t_in": 0},
        {"type": "chip", "text": "x", "t_in": 0, "t_out": 1, "x": 10},
        {"type": "checklist", "heading": "h", "items": ["a", "b"], "times": [1], "t_in": 0, "t_out": 2},
        {"type": "counter", "lines": [{"text": "4,375"}], "t_out": 2},
        {"type": "tag", "text": "t", "t_in": "soon", "t_out": 1, "x": 0, "y": 0},
        {"type": "caption", "text": "never", "t_in": 3, "t_out": 2},
        {"type": "logo_sting", "t_in": 5},
    ]}
    errors, warnings = overlay.validate(spec)
    joined = "\n".join(errors)
    assert "element 1" in joined and "unknown type" in joined
    assert "element 2 (chip): missing y" in joined
    assert "times has 1 entries for 2 items" in joined
    assert "each line needs text and t" in joined
    assert "t_in must be a number" in joined
    assert len(errors) == 5
    assert any("element 6" in w for w in warnings) and any("logo_sting" in w for w in warnings)
    assert overlay.validate({"nope": 1})[0]


def test_every_documented_type_is_drawn_by_the_page():
    page = (ROOT / "editor" / "overlay" / "page.html").read_text()
    for typ in overlay.TYPES:
        assert f"F.{typ}=" in page, typ
    readme = (ROOT / "editor" / "overlay" / "README.md").read_text()
    for typ in overlay.TYPES:
        assert f"| `{typ}` |" in readme, typ


def test_duration_and_example_spec_validate():
    assert overlay.duration({"elements": [{"type": "meta_tag", "text": "a", "t_in": 2, "x": 0, "y": 0},
                                          {"type": "flash", "t_in": 1}]}) == 5.5
    assert overlay.duration({"duration": 9, "elements": []}) == 9
    example = overlay.load(ROOT / "editor" / "overlay" / "example_spec.json")
    assert overlay.validate(example) == ([], [])
    assert {e["type"] for e in example["elements"]} == set(overlay.TYPES)


def test_build_job_scales_layout_and_resolves_images(tmp_path):
    Image.new("RGBA", (8, 8), (255, 0, 0, 255)).save(tmp_path / "logo.png")
    spec = {"theme": {"width": 320, "height": 180, "scale": 1 / 6, "fonts": {"display": "No Such Font Zz",
                                                                              "text": "No Such Font Zz"}},
            "elements": [{"type": "logo_sting", "t_in": 0, "image": "logo.png", "text": "x"}]}
    job, warnings = overlay.build_job(spec, tmp_path, fetch_fonts=False)
    assert round(job["width"]) == 1920 and round(job["height"]) == 1080 and job["scale"] == pytest.approx(1 / 6)
    assert job["elements"][0]["image"].startswith("file://") and job["faces"] == []
    assert any("not installed" in w for w in warnings)
    spec["elements"][0]["image"] = "missing.png"
    with pytest.raises(EditorError):
        overlay.build_job(spec, tmp_path, fetch_fonts=False)


# ---------------------------------------------------------------- frame assets

def test_frame_assets_box_shadow_and_mask(tmp_path):
    a = frame.assets(tmp_path, 1920, 1080)
    assert (a["x"], a["y"], a["w"], a["h"]) == (77, 43, 1766, 994)
    bg = np.asarray(Image.open(a["bg"]).convert("RGB"), dtype=int)
    mask = np.asarray(Image.open(a["mask"]))
    assert bg.shape == (1080, 1920, 3) and mask.shape == (994, 1766)
    assert tuple(bg[5, 5]) == (244, 241, 230) and tuple(bg[540, 960]) == (244, 241, 230)
    assert bg[1045, 960].sum() < bg[5, 5].sum() - 60                 # shadow below the picture
    assert mask[0, 0] == 0 and mask[497, 883] == 255 and ((mask > 0) & (mask < 255)).any()   # antialiased corners
    v = frame.assets(tmp_path / "v", 1080, 1920, backdrop="#000000")
    assert (v["w"], v["h"]) == (994, 1766) and Image.open(v["bg"]).size == (1080, 1920)


def test_frame_composite_still_with_punch(tmp_path):
    img = tmp_path / "shot.png"
    Image.new("RGB", (640, 360), (30, 120, 200)).save(img)
    out = frame.composite(img, tmp_path / "s.mp4", dur=1.0, width=320, height=180, fps=10, punch=(0.3, 1.3, 0.2, 0.2))
    info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-count_frames", "-show_entries",
                                      "stream=width,height,nb_read_frames", "-of", "json", str(out)],
                                     capture_output=True, text=True).stdout)["streams"][0]
    assert (info["width"], info["height"], int(info["nb_read_frames"])) == (320, 180, 10)
    with pytest.raises(EditorError):
        frame.composite(img, tmp_path / "x.mp4")                     # a still needs a duration


# ---------------------------------------------------------------- real render (Node + Playwright + Chromium)

def _alpha_frame(mov: Path, t: float) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(mov), "-frames:v", "1", "-f", "rawvideo",
                          "-pix_fmt", "rgba", "-"], capture_output=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(180, 320, 4)


def test_tiny_render_has_alpha_and_every_frame(tmp_path):
    ok, why = overlay.available()
    if not ok:
        pytest.skip(f"overlay renderer unavailable: {why}")
    spec = {"duration": 2, "theme": {"width": 320, "height": 180, "scale": 1 / 6},
            "elements": [{"type": "caption", "text": "Hello overlay", "t_in": 0.2, "t_out": 1.8},
                         {"type": "meta_tag", "text": "Muse Spark", "t_in": 0.1, "x": 80, "y": 80},
                         {"type": "counter", "lines": [{"text": "4,375 trees", "t": 0.5, "color": "heat"}],
                          "t_out": 2}]}
    sp = tmp_path / "spec.json"
    sp.write_text(json.dumps(spec))
    out = tmp_path / "o.mov"
    stats = overlay.render(sp, out, jobs=2, fetch_fonts=False)
    assert stats["frames"] == 60 and stats["shots"] < 60               # dedupe kicked in (empty first frames)
    info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-count_frames",
                                      "-show_entries", "stream=codec_name,pix_fmt,width,height,nb_read_frames",
                                      "-of", "json", str(out)], capture_output=True, text=True).stdout)["streams"][0]
    assert info["codec_name"] == "png" and info["pix_fmt"] == "rgba"
    assert (info["width"], info["height"], int(info["nb_read_frames"])) == (320, 180, 60)
    a = _alpha_frame(out, 1.0)[..., 3]
    assert a.min() == 0 and a.max() == 255                           # transparent background, opaque graphics
    assert _alpha_frame(out, 0.0)[..., 3].max() == 0                 # nothing on screen at t=0
