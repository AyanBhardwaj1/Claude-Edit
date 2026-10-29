"""Transitions, caption fonts and looks, realistic sound (library SFX, room tone), AI generation plumbing."""
from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import captions, fonts, genai, sfx, transitions as tx  # noqa: E402
from editor.util import EditorError  # noqa: E402

DEJAVU = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")


# ---------------------------------------------------------------- transitions

def test_expand_resolves_chapters_cuts_and_broll():
    edl = {"chapters": [{"start": 0, "text": "intro"}, {"start": 6.0, "text": "2"}],
           "transitions": [{"at": "chapters", "type": "zoom"}, {"at": "cuts", "type": "whip-left"},
                           {"at": 9.0, "type": "dip", "dur": 0.8}],
           "broll": [{"path": "x.mp4", "start": 3.0, "dur": 2.0, "in": "whip-right", "out": "flash"}]}
    timeline = [{"end": 2.5}, {"end": 7.5}, {"end": 12.0}]
    got = [(t["at"], t["type"]) for t in tx.expand(edl, 12.0, timeline)]
    assert got == [(2.5, "whip-left"), (3.0, "whip-right"), (5.0, "flash"), (6.0, "zoom"),
                   (7.5, "whip-left"), (9.0, "dip")]                     # chapter at 0 is skipped
    with pytest.raises(EditorError):
        tx.expand({"transitions": [{"at": 1, "type": "wipe-sideways"}]}, 5.0)


def test_layer_effects_only_touch_the_transition_window():
    rng = np.random.default_rng(0)
    img = rng.integers(0, 255, (160, 90, 3), dtype=np.uint8)
    fps = 30
    for typ in ("whip-left", "whip-up", "zoom", "blur", "glitch", "leak", "shake"):
        trs = tx.expand({"transitions": [{"at": 1.0, "type": typ}]}, 5.0)
        fx = tx.frame_fx(trs, fps)
        assert np.array_equal(fx(img.copy(), 15), img)                  # 0.5 s: outside
        k = 30 if typ != "shake" else 32                                 # shake starts on the hit
        out = fx(img.copy(), k)
        assert out.shape == img.shape and not np.array_equal(out, img), typ
    assert tx.frame_fx(tx.expand({"transitions": [{"at": 1.0, "type": "flash"}]}, 5.0), fps) is None


def test_zoom_boost_and_composite_eq():
    trs = tx.expand({"transitions": [{"at": 1.0, "type": "zoom"}, {"at": 2.0, "type": "dip"}]}, 5.0)
    m = tx.zoom_boost(trs, 90, 30)
    assert m[30] == pytest.approx(1.55) and m[0] == 1.0 and m[60] == 1.0
    assert tx.max_boost(trs) == pytest.approx(1.55)
    eq = tx.eq_filter(trs)
    assert eq.startswith("eq=brightness='-1.000*pow(max(0,1-abs(t-2.000)/0.250),2)'") and "eval=frame" in eq


def test_broll_overlay_motion():
    x, y = tx.overlay_motion({"start": 2, "dur": 3, "in": "slide-left", "out": "whip-down"}, 1080, 1920)
    assert x == "1080*pow(1-min(1,max(0,(t-2.000)/0.35)),3)"
    assert y == "1920*pow(min(1,max(0,(t-4.820)/0.18)),3)"
    assert tx.overlay_motion({"start": 0, "dur": 1, "in": "fade"}, 10, 10) == ("0", "0")


def test_transitions_get_sound_design(monkeypatch, tmp_path):
    monkeypatch.setattr(sfx, "CACHE", tmp_path / "sfx")
    edl = {"transitions": [{"at": 2.0, "type": "whip-left"}, {"at": 6.0, "type": "glitch"}]}
    ev = sfx.plan_events(edl, 10.0, transitions=tx.expand(edl, 10.0))
    assert [(e["type"], e["at"]) for e in ev] == [("whip", 2.0), ("glitch", 6.0)]


# ---------------------------------------------------------------- realistic sfx

def _wav(path, peak_at, sr=48000, n=24000):
    x = np.zeros(n, np.float32)
    i = int(peak_at * sr)
    x[i:i + 200] = np.hanning(200)
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes((x * 30000).astype(np.int16).tobytes())


def test_real_sfx_variants_rotate_and_hit_on_their_transient(monkeypatch, tmp_path):
    monkeypatch.setattr(sfx, "CACHE", tmp_path / "sfx")
    _wav(tmp_path / "sfx" / "whoosh" / "a.wav", 0.30)
    _wav(tmp_path / "sfx" / "whoosh" / "b.wav", 0.10)
    edl = {"broll": [{"start": 2.0, "dur": 1}, {"start": 6.0, "dur": 1}], "sfx": "auto"}
    ev = sfx.plan_events(edl, 10.0)
    assert [Path(e["file"]).name for e in ev] == ["a.wav", "b.wav"]
    assert ev[0]["start"] == pytest.approx(2.0 - 0.30, abs=0.01)
    assert ev[1]["start"] == pytest.approx(6.0 - 0.10, abs=0.01)
    assert sfx.path_for("pop").name == "pop.wav"                        # no recordings: synth


# ---------------------------------------------------------------- fonts and caption looks

@pytest.mark.skipif(not DEJAVU.exists(), reason="DejaVu not installed")
def test_add_own_font_file_and_resolve(monkeypatch, tmp_path):
    monkeypatch.setattr(fonts, "DIR", tmp_path / "fonts")
    monkeypatch.setattr(fonts, "MANIFEST", tmp_path / "fonts" / "fonts.json")
    assert fonts.add(str(DEJAVU)) == ["DejaVu Sans Bold"]
    assert fonts.resolve("dejavu sans bold") == "DejaVu Sans Bold"
    assert json.loads((tmp_path / "fonts" / "fonts.json").read_text())["files"] == ["DejaVuSans-Bold.ttf"]
    assert "DejaVu Sans Bold" in fonts.listing()
    with pytest.raises(EditorError, match="fonts add"):
        fonts.resolve("No Such Font Family")


def test_caption_look_overrides(tmp_path):
    words = {"words": [{"text": w, "start": i * 0.4, "end": i * 0.4 + 0.35, "segment": 0}
                       for i, w in enumerate("this is a custom caption look".split())]}
    wp = tmp_path / "w.json"
    wp.write_text(json.dumps(words))
    out = captions.build(wp, tmp_path / "c.ass", style="bold", srt=False,
                         look={"font": "DejaVu Sans", "box": "#112233", "case": "lower", "size": 1.5,
                               "active": "none", "max_words": 2})
    ass = out.read_text()
    cap = next(ln for ln in ass.splitlines() if ln.startswith("Style: Cap"))
    f = cap.split(",")
    assert f[1] == "DejaVu Sans" and f[15] == "3"                        # font, opaque box
    assert f[5] == captions.ass_color("#112233") and int(f[2]) == round(0.085 * 1.5 * 1080)
    texts = [ln.split(",,", 1)[1] for ln in ass.splitlines() if ln.startswith("Dialogue: 1")]
    assert len(texts) == 3 and "this is" in texts[0] and "\\c" not in texts[0]


# ---------------------------------------------------------------- AI generation (fake transport)

class FakeHTTP:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, method, url, headers, body=None, raw=False):
        self.calls.append((method, url, headers, body))
        return self.replies.pop(0)


@pytest.fixture
def keys(monkeypatch):
    for k in genai.KEYS.values():
        monkeypatch.delenv(k, raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    monkeypatch.chdir(ROOT / "tests")                                   # no stray .env picked up from cwd
    monkeypatch.setattr("editor.transcribe._api_key", lambda name: __import__("os").environ.get(name))
    monkeypatch.setattr(genai, "POLL_SECONDS", 0)
    return monkeypatch


def test_no_key_says_where_to_put_it(keys):
    with pytest.raises(EditorError, match=r"\.env"):
        genai.pick("video")


def test_dry_run_spends_nothing(keys, capsys):
    plan = genai.video("a barista pouring latte art, handheld 35mm", "x.mp4", model="kling", dur=8, dry_run=True)
    assert plan["provider"] == "fal" and plan["body"]["duration"] == "10" and plan["key_set"] is False
    assert not Path("x.mp4").exists()


def test_fal_video_queue_flow(keys, tmp_path):
    keys.setenv("FAL_KEY", "k")
    fake = FakeHTTP([{"request_id": "r1", "status_url": "https://q/s", "response_url": "https://q/r"},
                     {"status": "IN_PROGRESS"}, {"status": "COMPLETED"},
                     {"video": {"url": "https://cdn/v.mp4"}}, b"MP4DATA"])
    keys.setattr(genai, "_http", fake)
    first = tmp_path / "frame.png"
    first.write_bytes(b"\x89PNG fake")
    out = genai.video("city street at dusk", tmp_path / "v.mp4", dur=5, image=str(first), model="veo-fal")
    assert out.read_bytes() == b"MP4DATA"
    method, url, headers, body = fake.calls[0]
    assert url == "https://queue.fal.run/fal-ai/veo3" and headers == {"Authorization": "Key k"}
    assert body["duration"] == "6s" and body["image_url"].startswith("data:image/png;base64,")
    side = genai.provenance(out)
    assert side["ai_generated"] and side["model"] == "fal-ai/veo3" and side["prompt"] == "city street at dusk"


def test_gemini_veo_flow(keys, tmp_path):
    keys.setenv("GEMINI_API_KEY", "g")
    fake = FakeHTTP([{"name": "models/veo/operations/1"}, {"name": "models/veo/operations/1", "done": False},
                     {"done": True, "response": {"generateVideoResponse": {"generatedSamples": [
                         {"video": {"uri": "https://files/v:download"}}]}}}, b"VEO"])
    keys.setattr(genai, "_http", fake)
    out = genai.video("waves on rocks", tmp_path / "w.mp4", aspect="16:9", dur=8)
    assert out.read_bytes() == b"VEO"
    assert fake.calls[0][3]["parameters"] == {"aspectRatio": "16:9", "durationSeconds": 8}
    assert fake.calls[-1][2] == {"x-goog-api-key": "g"}                  # file download is authorised


def test_openai_image_and_elevenlabs_sfx(keys, tmp_path):
    keys.setenv("OPENAI_API_KEY", "o")
    keys.setenv("ELEVENLABS_API_KEY", "e")
    import base64
    fake = FakeHTTP([{"data": [{"b64_json": base64.b64encode(b"PNG").decode()}]}, b"MP3"])
    keys.setattr(genai, "_http", fake)
    img = genai.image("desk with a laptop, morning light", tmp_path / "i.png", aspect="16:9")
    assert img.read_bytes() == b"PNG" and fake.calls[0][3]["size"] == "1536x1024"
    s = genai.sfx("soft whoosh, close mic", tmp_path / "s.mp3", dur=1.2)
    assert s.read_bytes() == b"MP3"
    assert fake.calls[1][1] == "https://api.elevenlabs.io/v1/sound-generation"
    assert fake.calls[1][3]["duration_seconds"] == 1.2 and fake.calls[1][2]["xi-api-key"] == "e"


def test_generation_failure_is_reported(keys, tmp_path):
    keys.setenv("REPLICATE_API_TOKEN", "r")
    fake = FakeHTTP([{"status": "processing", "urls": {"get": "https://r/p/1"}},
                     {"status": "failed", "error": "NSFW"}])
    keys.setattr(genai, "_http", fake)
    with pytest.raises(EditorError, match="failed"):
        genai.video("x", tmp_path / "v.mp4", provider="replicate")
    assert not (tmp_path / "v.mp4").exists()
