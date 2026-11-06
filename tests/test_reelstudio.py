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
    # a face on the left: the card goes right, but stays left of the apps' like / comment / share column
    right = placement.place_card(0.6, "photo", {**FACE_LOW, "x0": 150, "x1": 450, "cx": 300}, 1080, 1920, side="right")
    assert right["mode"] == "card" and (right["x"] + right["width"] / 2) <= 0.84 + 1e-6


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
    assert "of nothing after the last word" in rep["loop_seam"]            # the words end long before 30 s
    end = ws[-1]["end"]
    assert pacing(edl, ws, end + 0.3)["loop_seam"] is None
    from editor.review import punch_cuts
    meta = {"timeline": [{"start": 0.0}, {"start": 4.0}, {"start": 8.5}]}
    assert punch_cuts({"auto_punch_in": 1.0}, meta) == [] and punch_cuts({"auto_punch_in": 1.12}, meta) == [4.0, 8.5]
    cut = pacing({"broll": [], "zooms": []}, ws, 12.0, punch_cuts({"auto_punch_in": 1.12}, meta))
    assert cut["face_only_over_4_5s"] == []                                # a punch-in every 4-4.5 s keeps it moving
    assert rep["opens_with_warm_up"] is None and rep["hook_too_quick_to_read"] is None
    quick = {"broll": [{"treatment": "text-pop", "style": "label", "text": "The one bill you can cut by half this year",
                        "start": 0.0, "dur": 1.5}], "zooms": []}
    assert "need about 2.9s" in pacing(quick, ws, 30.0)["hook_too_quick_to_read"]
    assert "warm-up" in pacing(edl, words("So today I quit Notion"), 30.0)["opens_with_warm_up"]
    from editor.review import stronger_opening
    assert "4000" in stronger_opening(words("Hi everyone. I want to share my week. I lost 4000 dollars on one bad habit."))
    assert stronger_opening(words("I lost 4000 dollars on one bad habit. Hi everyone. I want to share my week.")) is None
    assert stronger_opening(words("I plan my week. Step two, I never move the camera. Then I film 5 videos.")) is None
    cta = words("save this and follow for more")
    assert pacing(edl, cta, cta[-1]["end"] + 0.2)["loop_seam"] is None          # a CTA is a choice
    bye = words("here is the trick thanks for watching")
    assert "sign-off" in pacing(edl, bye, bye[-1]["end"] + 0.2)["loop_seam"]


def write_wav(path, x, sr=48000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())


def test_named_not_shown_runs_cards_and_cli(tmp_path, monkeypatch, capsys):
    from editor import images
    from editor.cli import main
    from editor.review import named_not_shown
    ws = [dict(w, id=f"w{i}") for i, w in enumerate(words("I moved from Notion to Claude Code. Then I tried Obsidian and Notion"))]
    assert [n["name"] for n in named_not_shown({"broll": []}, ws)] == ["Notion", "Claude Code", "Obsidian"]
    assert named_not_shown({"broll": []}, ws)[1]["words"] == "w5-w6"
    card = {"broll": [{"treatment": "text-pop", "text": "Step 1", "start": 1.0, "dur": 1.0}]}      # a label doesn't show Notion
    assert named_not_shown(card, ws)[0]["name"] == "Notion"
    spelled = {"broll": [{"treatment": "text-pop", "text": "Why I left Notion", "start": 1.0, "dur": 1.0}]}
    assert "Notion" not in [n["name"] for n in named_not_shown(spelled, ws)]
    # the CLI: --logos --apply adds a card per name (the download faked: no network in tests)
    work = tmp_path / "p" / "work"
    work.mkdir(parents=True)
    (work / "edl.json").write_text('{"segments": [], "broll": []}')
    (work / "cut_words.json").write_text(__import__("json").dumps({"words": ws}))
    monkeypatch.setattr(images, "save_hit", lambda hit, project, name=None: {"path": str(tmp_path / "p" / "broll" / "web" / f"{name}.png")})
    assert main(["names", str(work), "--logos", "--apply"]) == 0
    edl = __import__("json").loads((work / "edl.json").read_text())
    assert [b["words"] for b in edl["broll"]] == ["w3-w3", "w5-w6", "w10-w10"] and edl["broll"][0]["treatment"] == "card-above-head"


def test_names_curly_apostrophes_and_svg_logos(tmp_path, monkeypatch):
    from editor import images
    from editor.cli import main
    from editor.review import named_not_shown
    ws = [dict(w, id=f"w{i}") for i, w in enumerate(words("so honestly I’m moving to Notion today"))]
    assert [n["name"] for n in named_not_shown({"broll": []}, ws)] == ["Notion"]
    work = tmp_path / "p" / "work"
    work.mkdir(parents=True)
    (work / "edl.json").write_text('{"segments": [], "broll": []}')
    (work / "cut_words.json").write_text(__import__("json").dumps({"words": ws}))
    monkeypatch.setattr(images, "save_hit", lambda hit, project, name=None: {"path": str(tmp_path / "p" / "broll" / "web" / "notion.svg")})
    assert main(["names", str(work), "--logos", "--apply"]) == 0
    assert __import__("json").loads((work / "edl.json").read_text())["broll"] == []     # an SVG would flash for one frame


def test_pacing_fix_adds_word_anchored_zooms_in_bare_face_stretches():
    from editor.review import stillness_zooms
    ws = [dict(w, id=f"w{i}") for i, w in enumerate(words("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"))]
    z = stillness_zooms(["1.0-8.0s"], ws)                 # 7 s: one zoom inside it leaves two gaps under 4.5 s
    assert len(z) == 1 and set(z[0]) == {"words", "scale", "ease"}
    a, b = z[0]["words"].split("-")
    start = next(float(w["start"]) for w in ws if w["id"] == a)
    end = next(float(w["end"]) for w in ws if w["id"] == b)                   # the zoom holds until its last word
    assert start - 1.0 < 4.5 and 8.0 - end < 4.5
    long = [dict(w, id=f"w{i}", start=i * 0.5, end=i * 0.5 + 0.4) for i, w in enumerate(ws * 3)]
    z = stillness_zooms(["0.0-29.0s"], long)
    assert [x["scale"] for x in z[:2]] == [1.15, 1.25] and len(z) <= 5        # about one every 6 s, not every 3
    assert stillness_zooms([], ws) == []


def test_variants_render_each_hook_and_restore_the_edl(tmp_path, monkeypatch):
    import argparse
    import json
    from editor import cli
    project = tmp_path / "demo"
    (project / "work").mkdir(parents=True)
    (project / "out").mkdir()
    edl = {"segments": [], "broll": [{"treatment": "text-pop", "style": "label", "text": "Original hook", "start": 0.0, "dur": 2.0}]}
    (project / "work" / "edl.json").write_text(json.dumps(edl))
    seen = []

    def fake_main(argv):            # stands in for `editor auto ... --from captions --to render`
        hook = json.loads((project / "work" / "edl.json").read_text())["broll"][0]["text"]
        seen.append(hook)
        (project / "out" / "demo_reels.mp4").write_text(hook)
        return 0
    monkeypatch.setattr(cli, "main", fake_main)
    cli.cmd_variants(argparse.Namespace(project=str(project), hooks=["Hook two", "Hook three"], preset="reels", auto_args="--effort rush"))
    assert seen == ["Hook two", "Hook three", "Original hook"]                   # the reel itself last, as it was
    assert (project / "out" / "demo_reels - hook B.mp4").read_text() == "Hook two"
    assert (project / "out" / "demo_reels - hook C.mp4").read_text() == "Hook three"
    assert json.loads((project / "work" / "edl.json").read_text()) == edl


def test_before_post_collects_file_edit_and_app_checks(tmp_path):
    import json
    from editor.cli import _before_post
    work = tmp_path / "w"
    work.mkdir()
    ws = [dict(w, id=f"w{i}") for i, w in enumerate(words("so this is how I film a week of videos in an hour"))]
    (work / "edl.json").write_text(json.dumps({"segments": [], "broll": []}))
    (work / "cut_words.json").write_text(json.dumps({"words": ws}))
    (work / "cut_meta.json").write_text(json.dumps({"duration": 12.0, "edl": str(work / "edl.json"), "timeline": []}))
    qa = {"checks": [{"check": "loudness", "ok": False, "detail": "-19.0 LUFS (target -14.0)"}, {"check": "fps", "ok": True, "detail": "30"}]}
    rep = _before_post(work, tmp_path, qa, [{"platform": "tiktok", "from": 1.0, "to": 2.0, "zone": "caption block"}])
    whats = [i["what"] for i in rep["items"]]
    assert "file loudness" in whats and "captions under app UI" in whats and "opens with warm up" in whats
    assert "face only over 4.5 s" in whats and "fps" not in " ".join(whats)
    assert json.loads((tmp_path / "before_post.json").read_text())["to_look_at"] == len(rep["items"])
