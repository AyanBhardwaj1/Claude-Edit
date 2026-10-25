"""Unit tests for the planning/caption/zoom logic plus one end-to-end pipeline run.

Run: python3 -m pytest -q
The end-to-end test uses tests/make_fixture.py (flite TTS speech, no Whisper model needed).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import captions, graphics, library, plan, render, retext, sfx, transcribe  # noqa: E402
from editor.util import normalize_fps  # noqa: E402


def W(src, start, end, text):
    return {"src": src, "start": start, "end": end, "text": text, "prob": 1.0}


def write_tr(tmp_path, words, durations=(20.0,)):
    tr = {"sources": [{"path": f"/clip{i}.mp4", "duration": d} for i, d in enumerate(durations)],
          "words": words, "phrases": []}
    path = tmp_path / "transcript.json"
    path.write_text(json.dumps(tr))
    return path


def run_plan(tmp_path, words, **kw):
    out = plan.plan(write_tr(tmp_path, words), tmp_path / "edl.json", **kw)
    return json.loads(out.read_text())


def test_fillers_removed_and_split(tmp_path):
    edl = run_plan(tmp_path, [W(0, 0.0, 0.4, "So"), W(0, 0.45, 0.7, "um"), W(0, 0.75, 1.0, "this"),
                              W(0, 1.05, 1.4, "works.")])
    assert [s["text"] for s in edl["segments"]] == ["So", "this works."]
    assert edl["removed"][0]["reason"] == "filler"


def test_long_pause_is_cut_with_padding(tmp_path):
    edl = run_plan(tmp_path, [W(0, 1.0, 1.4, "Hello"), W(0, 3.0, 3.5, "world")], max_gap=0.3)
    a, b = edl["segments"]
    assert a["start"] == pytest.approx(0.94) and a["end"] == pytest.approx(1.5)
    assert b["start"] == pytest.approx(2.94)


def test_padding_never_bleeds_into_removed_word(tmp_path):
    edl = run_plan(tmp_path, [W(0, 1.0, 1.4, "Hello"), W(0, 1.45, 1.6, "uh"), W(0, 1.65, 2.0, "there")])
    first, second = edl["segments"]
    assert first["end"] <= 1.45 and second["start"] >= 1.6


def test_retake_keeps_last_take(tmp_path):
    words = [W(0, 0.0, 0.3, "The"), W(0, 0.3, 0.6, "best"), W(0, 0.6, 0.9, "tool"), W(0, 0.9, 1.0, "is"),
             W(0, 2.0, 2.3, "The"), W(0, 2.3, 2.6, "best"), W(0, 2.6, 2.9, "tool"), W(0, 2.9, 3.1, "is"),
             W(0, 3.1, 3.6, "Claude.")]
    edl = run_plan(tmp_path, words)
    assert [s["text"] for s in edl["segments"]] == ["The best tool is Claude."]
    assert edl["removed"][0]["reason"].startswith("retake")


def test_distinct_lines_are_not_retakes(tmp_path):
    words = [W(0, 0.0, 0.3, "Step"), W(0, 0.3, 0.6, "one:"), W(0, 0.6, 1.0, "record."),
             W(0, 2.0, 2.3, "Step"), W(0, 2.3, 2.6, "two:"), W(0, 2.6, 3.0, "edit.")]
    edl = run_plan(tmp_path, words, max_gap=2.0)
    assert not edl["removed"]


def test_retakes_can_be_disabled(tmp_path):
    words = [W(0, 0, 0.3, "Hi"), W(0, 0.3, 0.6, "there"), W(0, 0.6, 0.9, "friends"),
             W(0, 2, 2.3, "Hi"), W(0, 2.3, 2.6, "there"), W(0, 2.6, 2.9, "friends")]
    assert not run_plan(tmp_path, words, retakes=False)["removed"]


def test_speed_shortens_output_estimate(tmp_path):
    edl = run_plan(tmp_path, [W(0, 0.0, 2.0, "long"), W(0, 2.05, 4.0, "words")], speed=2.0)
    assert edl["stats"]["output_seconds"] == pytest.approx((4.1 + 0.06) / 2, abs=0.05)


def test_caption_groups_respect_limits_and_punctuation():
    words = [{"start": i * 0.3, "end": i * 0.3 + 0.25, "text": t, "segment": 0}
             for i, t in enumerate("THIS IS GREAT. AND THEN SOMETHING ELSE".split())]
    groups = captions._groups(words, max_words=3, max_chars=14)
    texts = [" ".join(w["text"] for w in g) for g in groups]
    assert texts[0] == "THIS IS GREAT."
    assert all(len(g) <= 3 for g in groups)


def test_caption_ass_has_one_event_per_word_and_emphasis(tmp_path):
    words = [{"start": 0.0, "end": 0.3, "text": "Make", "segment": 0},
             {"start": 0.3, "end": 0.6, "text": "money", "segment": 0},
             {"start": 0.6, "end": 0.9, "text": "online.", "segment": 0}]
    wp = tmp_path / "w.json"
    wp.write_text(json.dumps({"words": words}))
    out = captions.build(wp, tmp_path / "c.ass", style="bold", emphasis=["money"], title="Hook")
    text = out.read_text()
    dialogue = [line for line in text.splitlines() if line.startswith("Dialogue: 1")]
    assert len(dialogue) == 3
    assert "MONEY" in text and captions.ass_color("#FF3B30") in text
    assert "Hook" in text and (tmp_path / "c.srt").exists()


def test_ass_time_and_color():
    assert captions.ass_time(3661.239) == "1:01:01.24"
    assert captions.ass_color("#FFE600") == "&H0000E6FF"


def test_zoom_curve_alternates_and_eases():
    seg = np.array([0] * 30 + [1] * 30 + [2] * 30)
    z = render._zoom_curve(seg, [{"start": 2.0, "end": 3.0, "scale": 1.5, "ease": 0.2}], 1.1, 90, 30.0)
    assert z[10] == pytest.approx(1.0) and z[40] == pytest.approx(1.1)
    assert z[75] == pytest.approx(1.5) and 1.0 < z[61] < 1.5


def test_gauss_smoothing_preserves_constant():
    v = np.full(100, 0.4)
    assert np.allclose(render._gauss(v, 5), 0.4)


def test_normalize_fps():
    assert float(normalize_fps(29.97)) == pytest.approx(30000 / 1001)
    assert float(normalize_fps(59.94)) == pytest.approx(60000 / 1001)
    assert float(normalize_fps(120)) == 60


def test_better_take_beats_later_flubbed_take(tmp_path):
    words = [W(0, 0.0, 0.3, "This"), W(0, 0.3, 0.6, "is"), W(0, 0.6, 0.9, "the"), W(0, 0.9, 1.3, "one."),
             W(0, 2.0, 2.3, "This"), W(0, 2.3, 2.6, "is"), W(0, 2.6, 2.9, "the"), W(0, 2.9, 3.3, "one")]
    for w in words[4:]:
        w["prob"] = 0.5  # mumbled second take
    edl = run_plan(tmp_path, words)
    assert [s["text"] for s in edl["segments"]] == ["This is the one."]
    assert "earlier take was cleaner" in edl["removed"][0]["reason"]


def test_whisperx_missing_times_are_interpolated():
    ws = [{"start": 1.0, "end": 1.2, "text": "I"}, {"start": None, "end": None, "text": "2026"},
          {"start": None, "end": None, "text": "$5"}, {"start": 2.0, "end": 2.4, "text": "won"}]
    out = transcribe.fill_missing_times(ws, 0.8, 2.6)
    assert out[1]["start"] == pytest.approx(1.2) and out[2]["end"] == pytest.approx(2.0)
    assert all(a["end"] <= b["start"] + 1e-9 for a, b in zip(out, out[1:]))


def test_bpm_estimate_on_click_track():
    sr, bpm = 11025, 120
    x = np.zeros(sr * 20, np.float32)
    for k in range(int(20 * bpm / 60)):
        i = int(k * sr * 60 / bpm)
        x[i:i + 200] = np.hanning(200)
    assert abs(library._estimate_bpm(x, sr) - bpm) <= 3


def test_chapter_pills_and_white_style(tmp_path):
    words = [{"start": 0.0, "end": 0.4, "text": "Step", "segment": 0},
             {"start": 0.4, "end": 0.8, "text": "one", "segment": 0}]
    wp = tmp_path / "w.json"
    wp.write_text(json.dumps({"words": words}))
    text = captions.build(wp, tmp_path / "c.ass", style="white",
                          chapters=[{"start": 0.0, "text": "1: The hook"}], duration=5.0).read_text()
    pill = [line for line in text.splitlines() if line.startswith("Dialogue: 3")]
    assert pill and "\\p1" in pill[0] and pill[0].split(",")[2] == "0:00:05.00"
    assert "1: The hook" in text and "Step one" in text


def test_music_library_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(library, "ROOT", tmp_path)
    track = tmp_path / "t.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=f=440:d=6", str(track)], check=True)
    t = library.music_add(str(track), "cool-fun", tags=["bouncy"], title="Bouncy Test", starred=True)
    assert library.music_path(t["id"]).exists()
    assert "★ **Bouncy Test**" in library.music_list("cool-fun")


def test_retext_fixes_words_and_keeps_timing():
    old = [W(0, 0.0, 0.3, "glug"), W(0, 0.3, 0.6, "code"), W(0, 0.7, 1.0, "edits"), W(0, 1.0, 1.2, "for"),
           W(0, 1.2, 1.5, "you")]
    new = retext.align(old, "Claude Code edits for you.".split())
    assert [w["text"] for w in new] == ["Claude", "Code", "edits", "for", "you."]
    assert new[2]["start"] == 0.7 and new[-1]["end"] == 1.5          # matched words keep their times
    assert new[0]["start"] == 0.0 and new[1]["end"] == pytest.approx(0.6)  # replaced run keeps its span


def test_retext_parses_transcript_lines(tmp_path):
    by_src = retext._parse("## source 0: a.mp4\n  [0] 00:01.00-00:02.00 S1: Hello there.\n  [1] 00:00.10-00:01.00 Bye.")
    assert by_src == {0: ["Hello", "there."], 1: ["Bye."]}


def test_sfx_transient_lands_on_attack_and_density_cap():
    y = sfx.synth("whoosh")
    assert abs(np.argmax(np.abs(y)) / sfx.SR - sfx.TYPES["whoosh"][0]) < 0.06
    edl = {"broll": [{"start": 2.0}, {"start": 3.0}, {"start": 8.0}], "chapters": [{"start": 12.0, "text": "x"}]}
    ev = sfx.plan_events(edl, 20.0)
    assert [e["at"] for e in ev] == [2.0, 8.0, 12.0]       # 3.0 dropped: within 3 s of the last effect
    assert ev[0]["start"] == pytest.approx(2.0 - sfx.TYPES["whoosh"][0])
    assert sfx.plan_events({"sfx": "none", "broll": [{"start": 1}]}, 10) == []


def test_graphic_has_alpha(tmp_path):
    out = graphics.make("cta", tmp_path / "cta", w=360, h=640, fps=10, dur=0.6, text="Follow")
    info = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v", "-show_entries", "stream=pix_fmt",
                           "-of", "csv=p=0", str(out)], capture_output=True, text=True).stdout
    assert "yuva" in info


def test_phone_card_assets(tmp_path):
    img = tmp_path / "s.png"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=590x1278", "-frames:v", "1",
                    str(img)], check=True)
    a = render._card_assets(str(img), 1080, 1920, {"frame": "phone"}, tmp_path, 0)
    assert a["bez"] > 0 and a["ow"] == a["cw"] + 2 * a["bez"] and a["bezel"].exists()
    assert a["cx"] + a["ow"] / 2 <= 1080 and a["cx"] > 540      # beside the face, inside the frame


def test_vosk_engine_transcribes_tts(tmp_path):
    pytest.importorskip("vosk")
    from editor import models
    try:
        models.vosk_model()
    except Exception:
        pytest.skip("no Vosk model available offline")
    wav = tmp_path / "s.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "flite=text='the first one is claude code':voice=slt",
                    "-ar", "48000", str(wav)], check=True)
    words, _ = transcribe._vosk()(str(wav))
    assert {"first", "one", "is"} <= {w["text"] for w in words}
    assert all(w["end"] > w["start"] for w in words)


@pytest.mark.slow
def test_end_to_end_pipeline(tmp_path):
    project = tmp_path / "demo"
    subprocess.run([sys.executable, str(ROOT / "tests" / "make_fixture.py"), str(project)], check=True,
                   capture_output=True)
    res = subprocess.run([sys.executable, "-m", "editor", "auto", str(project), "--from", "plan", "--to", "plan"],
                         cwd=ROOT, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr[-2000:]
    assert (project / "work" / "rough_cut_viz.png").exists()
    edl_path = project / "work" / "edl.json"
    edl = json.loads(edl_path.read_text())
    edl["chapters"] = [{"start": 3.0, "text": "1: The hook"}]
    edl["broll"] = [{"path": "work/rough_cut_viz.png", "start": 4.0, "dur": 1.5, "mode": "card"}]
    edl_path.write_text(json.dumps(edl))
    res = subprocess.run([sys.executable, "-m", "editor", "auto", str(project), "--from", "cut",
                          "--title", "Test hook", "--style", "white"], cwd=ROOT, capture_output=True, text=True)
    assert res.returncode == 0, res.stderr[-2000:]
    report = json.loads((project / "out" / "qa.json").read_text())
    assert report["passed"], report
    edl = json.loads((project / "work" / "edl.json").read_text())
    reasons = {r["reason"].split(" ")[0] for r in edl["removed"]}
    assert {"filler", "retake"} <= reasons
    assert (project / "out" / "contact_sheet.png").exists()
