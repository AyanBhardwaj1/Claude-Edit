"""Reel Studio parity: word anchors, caption fixes, placement, treatments, images, attach, versions, music, pacing."""
from __future__ import annotations

import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import anchors, audio, images, placement, treatments, versions, wordfix  # noqa: E402
from editor.review import pacing  # noqa: E402
from editor.util import EditorError, save_json  # noqa: E402


def words(text, t0=0.0, step=0.4, start_id=0):
    return [{"id": f"w{start_id + i}", "text": t, "start": round(t0 + i * step, 3), "end": round(t0 + i * step + 0.3, 3),
             "segment": 0, "prob": 0.95} for i, t in enumerate(text.split())]


# ---------------------------------------------------------------- anchors

def test_anchors_resolve_phrases_ids_and_drop_cut_words():
    ws = words("so it costs twenty bucks a month and twenty bucks again")
    edl = {"broll": [{"path": "x.png", "on": "twenty bucks"}, {"path": "y.png", "on": "twenty bucks#2", "hold": 0.5},
                     {"path": "z.png", "on": "not said"}, {"path": "t.png", "start": 1, "dur": 2}],
           "zooms": [{"words": "w1-w2", "scale": 1.1}],
           "chapters": [{"on": "a month", "text": "2: Price"}],
           "transitions": [{"on": "again", "type": "flash"}],
           "music": {"automation": [{"on": "so it costs", "db": -6}]}}
    out = anchors.resolve(edl, ws)
    b = out["broll"]
    assert len(b) == 3 and b[0]["start"] == round(1.2 - 0.1, 3) and b[0]["dur"] >= 1.2
    assert b[0]["word_times"] == [1.2, 1.6] and b[0]["spoken"] == "twenty bucks"
    assert b[1]["start"] == round(3.2 - 0.1, 3)
    assert out["zooms"][0]["start"] == 0.4 and out["zooms"][0]["end"] >= 0.4 + 0.6
    assert out["chapters"][0]["start"] == 2.0 and out["transitions"][0]["at"] == 4.0
    assert out["music"]["automation"][0]["start"] == 0.0
    assert edl["broll"][0].get("start") is None                       # the EDL itself is untouched


def test_words_listing(tmp_path):
    (tmp_path / "cut_words.json").write_text(json.dumps({"words": [*words("hello there"),
                                                                   {**words("frend")[0], "id": "w2", "start": 0.8,
                                                                    "end": 1.1, "prob": 0.3}]}))
    txt = anchors.listing(tmp_path)
    assert "hello[w0]" in txt and "frend(?)[w2]" in txt
    assert anchors.listing(tmp_path, find_phrase="there").startswith("w1-w1")


# ---------------------------------------------------------------- caption text

def test_digits_corrections_hidden():
    ws = words("I paid twenty five dollars for step one of the pay pal thing, sixty four percent of three thousand "
               "users and the one thing 3 ,000 64 %")
    out = wordfix.fix(ws, {"corrections": [{"from": "pay pal", "to": "PayPal"}, {"from": "nope", "to": "x"}],
                           "hidden": [{"on": "and the"}]})
    text = " ".join(w["text"] for w in out)
    assert text == "I paid $25 for step 1 of the PayPal thing, 64% of 3,000 users one thing 3,000 64%"
    merged = next(w for w in out if w["text"] == "$25")
    assert merged["end"] == ws[4]["end"]                               # timing spans the merged words


# ---------------------------------------------------------------- placement and treatments

FACE_LOW = {"x0": 390, "x1": 690, "y0": 600, "y1": 990, "cx": 540, "fw": 300, "found": True}
FACE_BIG = {"x0": 140, "x1": 940, "y0": 250, "y1": 1290, "cx": 540, "fw": 800, "found": True}


def test_place_card_above_beside_split():
    above = placement.place_card(16 / 9, "photo", FACE_LOW, 1080, 1920)
    assert above["mode"] == "card" and above["how"] == "above the face"
    c = placement.core(FACE_LOW)
    assert above["y"] * 1920 + above["width"] * 1080 / (16 / 9) / 2 <= c["y0"]      # clears the brows
    assert above["width"] >= 0.30
    text = placement.place_card(16 / 9, "text", FACE_BIG, 1080, 1920)
    assert text["mode"] == "split"                                     # no readable room around a close-up
    side = placement.place_card(0.6, "photo", {**FACE_LOW, "x0": 600, "x1": 900, "cx": 750}, 1080, 1920, side="beside")
    assert side["mode"] == "card" and "left" in side["how"]


def test_text_pop_and_walls(tmp_path):
    from PIL import Image
    p = treatments.text_pop(tmp_path / "t.png", "why every gym feels the same", "label", FACE_LOW, 1080, 1920, 0)
    im = np.asarray(Image.open(p))
    ys, xs = np.nonzero(im[..., 3])
    assert ys.max() < placement.core(FACE_LOW)["y0"] and ys.min() >= placement.SAFE_TOP * 1920 - 1
    logos = []
    for i, c in enumerate(["black", "orange"]):
        Image.new("RGBA", (200, 200), c).save(tmp_path / f"l{i}.png")
        logos.append(str(tmp_path / f"l{i}.png"))
    w = treatments.wall(tmp_path / "w.png", logos, "icon-wall", FACE_LOW, 1080, 1920, total=2)
    assert Image.open(w).size == (1080, 1920)
    pw = treatments.wall(tmp_path / "p.png", logos, "post-wall", FACE_LOW, 1080, 1920, total=2)
    assert np.asarray(Image.open(pw))[5, 5, 3] == 255                 # full-screen, opaque
    assert treatments._step_times(3, 1.0, 3.0, [1.0, 1.4, 1.8, 2.2]) == [1.0, 1.35, 1.75]


def test_expand_treatments(tmp_path):
    from PIL import Image
    Image.new("RGB", (1600, 900), "white").save(tmp_path / "photo.jpg")
    out = treatments.expand([{"treatment": "card-above-head", "path": str(tmp_path / "photo.jpg"), "start": 1, "dur": 2},
                             {"treatment": "text-pop", "text": "$20", "start": 3, "dur": 2},
                             {"treatment": "icon-wall", "items": [str(tmp_path / "photo.jpg")] * 3, "start": 5,
                              "dur": 3, "word_times": [5.0, 5.5, 6.0]},
                             {"path": "plain.mp4", "start": 9, "dur": 1}], tmp_path, 1080, 1920)
    assert out[0]["mode"] == "card" and out[0]["tilt"] == -2.5
    assert out[1]["mode"] == "overlay" and out[1]["path"].endswith(".png")
    assert [round(o["start"], 2) for o in out[2:5]] == [5.0, 5.45, 5.95] and all(o["mode"] == "overlay" for o in out[2:5])
    assert out[-1] == {"path": "plain.mp4", "start": 9, "dur": 1}


# ---------------------------------------------------------------- images

def test_licences_and_search(monkeypatch, tmp_path):
    assert images._lic("CC BY-SA 4.0") == "by-sa" and images._lic("CC0") == "cc0" and images._lic("Public domain") == "pdm"
    monkeypatch.setattr(images, "LAST", tmp_path / "last.json")
    monkeypatch.setattr(images, "openverse", lambda q, n: [
        {"url": "https://x/a.jpg", "title": "Bridge", "creator": "Ann", "license": "by", "page": "p", "source": "o",
         "kind": "photo"},
        {"url": "https://x/b.jpg", "title": "Bridge NC", "creator": "Bo", "license": "by-nc", "page": "p",
         "source": "o", "kind": "photo"}])
    monkeypatch.setattr(images, "wikimedia", lambda q, n: [])
    res = images.search("golden gate bridge photo")
    assert [r["title"] for r in res] == ["Bridge"] and res[0]["n"] == 1
    png = b"\x89PNG\r\n\x1a\n" + b"0" * 100
    monkeypatch.setattr(images, "_get_bytes", lambda url: (png, url))
    got = images.fetch(1, tmp_path / "proj")
    assert Path(got["path"]).name == "bridge.png"
    assert images.credit_line([got["path"]]) == "Photo credits: Bridge by Ann (BY)"


def test_private_addresses_are_refused():
    for url in ("http://127.0.0.1/x.png", "http://10.0.0.2/a", "http://user:pw@example.com/a", "file:///etc/passwd"):
        with pytest.raises(EditorError):
            images._check_public(url)


# ---------------------------------------------------------------- attach, versions, post

def test_attach_gif_becomes_looped_clip(tmp_path):
    from PIL import Image
    frames = [Image.new("RGB", (64, 64), c) for c in ("red", "blue")]
    frames[0].save(tmp_path / "meme.gif", save_all=True, append_images=frames[1:], duration=200, loop=0)
    info = attach_mod().attach(tmp_path / "meme.gif", tmp_path / "proj")
    assert info["path"].endswith("meme.mp4") and info["kind"] == "video" and info["duration"] >= 2.9
    assert not info["has_audio"] and Path(info["path"] + ".attach.json").exists()
    Image.new("RGB", (20, 20)).save(tmp_path / "pic.bmp")
    assert attach_mod().attach(tmp_path / "pic.bmp", tmp_path / "proj")["path"].endswith("pic.png")
    (tmp_path / "x.txt").write_text("hi")
    with pytest.raises(EditorError, match="isn't supported"):
        attach_mod().attach(tmp_path / "x.txt", tmp_path / "proj")


def attach_mod():
    from editor import attach
    return attach


def test_versions_post_export(tmp_path):
    proj = tmp_path / "p"
    (proj / "out").mkdir(parents=True)
    (proj / "work").mkdir()
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=64x64:d=0.5", "-y",
                    str(proj / "out" / "p_reels.mp4")], check=True)
    save_json(proj / "work" / "edl.json", {"title": "My: reel", "segments": [], "broll": []})
    versions.save_version(proj, "first draft")
    versions.save_version(proj, "music quieter")
    assert [(v["n"], v["note"].splitlines()[0]) for v in versions.versions(proj)] == [(1, "first draft"), (2, "music quieter")]
    with pytest.raises(EditorError, match="exactly 5"):
        versions.write_post(proj, "x", ["a", "b", "c", "d"])
    post = versions.write_post(proj, "Three tools — one week.", ["a", "#b", "c d", "e", "f"])
    assert post.read_text() == "Three tools, one week.\n\n#a #b #cd #e #f\n"
    out = versions.export(proj)
    assert out.name == "My reel - Version 2.mp4" and (out.parent / "My reel - Version 2 caption.txt").exists()
    versions.restore(proj, 1)


# ---------------------------------------------------------------- music and pacing

def test_music_feel_and_entry():
    from editor.library import feel
    sr = 11025
    t = np.arange(sr * 40) / sr
    quiet = 0.02 * np.sin(2 * np.pi * 220 * t[: sr * 16])
    beat = (np.sin(2 * np.pi * 2 * t[: sr * 24]) > 0.9) * np.random.default_rng(0).standard_normal(sr * 24) * 0.8
    x = np.concatenate([quiet, beat + 0.3 * np.sin(2 * np.pi * 110 * t[: sr * 24])]).astype(np.float32)
    f = feel(x, sr, 120)
    assert 12.0 <= f["entry"] <= 16.0                                    # a bar (2 s at 120 bpm) before the hit
    assert f["feel"] in ("gentle", "steady", "upbeat", "driving", "hype") and 0 <= f["energy"] <= 1


def test_music_automation_filter():
    s = audio._automation([{"start": 1.0, "end": 3.0, "db": -6}, {"start": 5, "end": 6}])
    assert s.startswith("volume='pow(10,(-6.00*clip((t-1.000)/0.35,0,1)*clip((3.000-t)/0.35,0,1))/20)'")
    assert audio._automation(None) == ""


def test_pacing_checks():
    ws = words("I tried Notion and then Spotify for a whole month and it was fine really")
    edl = {"broll": [{"path": "a.png", "start": 0.2, "dur": 0.8}], "zooms": [{"start": 9.0, "end": 10.0}]}
    rep = pacing(edl, ws, 30.0)
    assert rep["face_only_over_4_5s"] == ["1.0-9.0s", "10.0-30.0s"]
    assert rep["visuals_under_1_2s"] == ["a.png at 0.2s"]
    assert rep["named_not_shown"] == ["Spotify"]                       # Notion is said while a.png is up
    assert rep["broll_moments"].startswith("1 ")
    assert rep["no_hook_title"] and rep["first_word_after_0_6s"] is None        # speech from 0.0 s, no title
    titled = pacing(dict(edl, title="I quit Notion"), [dict(w, start=w["start"] + 1.0, end=w["end"] + 1.0) for w in ws], 30.0)
    assert titled["no_hook_title"] is None and titled["first_word_after_0_6s"]


def write_wav(path, x, sr=48000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
