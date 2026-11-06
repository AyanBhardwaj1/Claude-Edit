"""Regression tests for a bug hunt in the older modules (transcribe cache, share, library, retext, wordfix, util)."""
import socket
import threading
import time
import urllib.request

import pytest

from editor import retext, util, wordfix
from editor.transcribe import _variant


def test_transcript_cache_varies_with_model_language_glossary():
    assert _variant("faster-whisper", "small", None, None, None) == ""          # old caches keep working
    keys = {_variant("faster-whisper", m, l, g, None) for m, l, g in
            [("small", None, None), ("medium", None, None), ("small", "es", None), ("small", None, ["Cutmind"])]}
    assert len(keys) == 4
    assert _variant("vosk", "medium", None, None, None) == ""                    # vosk has no model choice


def test_years_and_numbers_in_captions():
    def say(t):
        return " ".join(w["text"] for w in wordfix.digits([{"text": x, "start": i, "end": i + 0.5} for i, x in enumerate(t.split())]))
    assert say("in two thousand twenty four we") == "in 2024 we"
    assert say("back in two thousand and nineteen") == "back in 2019"
    assert say("two thousand five hundred people") == "2,500 people"


def test_retext_keeps_words_before_a_colon_and_clip_times():
    assert retext._parse("[0] 00:01.20-00:03.40 Tip: always back up")[0] == ["Tip:", "always", "back", "up"]
    assert retext._parse("[0] 00:01.20-00:03.40 speaker_0: hi")[0] == ["hi"]
    old = [{"text": "hello", "start": 40.0, "end": 40.4, "src": 0}, {"text": "world", "start": 40.5, "end": 41.0, "src": 0},
           {"text": "is", "start": 0.5, "end": 0.7, "src": 1}, {"text": "next", "start": 0.8, "end": 1.1, "src": 1}]
    out = retext.align(old, "hello world so this is next".split())
    added = [w for w in out if w["text"] in ("so", "this")]
    assert all(w["src"] == 1 and 0 <= w["start"] < w["end"] <= 0.5 for w in added), added
    assert all(w["end"] >= w["start"] for w in retext.align(old, "hello there friends is next".split()))


def test_fmt_ts_rounds_into_the_next_minute():
    assert util.fmt_ts(59.996) == "01:00.00" and util.fmt_ts(61.5) == "01:01.50"


def test_share_ranges_names_and_no_spin(tmp_path):
    from editor import share
    video = tmp_path / "I quit 😳 - Version 2.mp4"
    video.write_bytes(b"x" * 100000)
    got = {}
    t = threading.Thread(target=lambda: share.serve(video, lifetime=4, port=0, on_ready=lambda url, qr: got.setdefault("url", url)),
                         daemon=True)
    t.start()
    for _ in range(50):
        if "url" in got:
            break
        time.sleep(0.1)
    url = got["url"].replace(got["url"].split("/")[2].split(":")[0], "127.0.0.1")
    urllib.request.urlopen(url).read()
    r = urllib.request.urlopen(urllib.request.Request(url + "video.mp4?save=1"))
    assert "filename*=UTF-8''I%20quit%20%F0%9F%98%B3" in r.headers["Content-Disposition"]
    r = urllib.request.urlopen(urllib.request.Request(url + "video.mp4", headers={"Range": "bytes=0-199999"}))
    assert r.status == 206 and len(r.read()) == 100000
    with pytest.raises(urllib.error.HTTPError) as e:
        urllib.request.urlopen(urllib.request.Request(url + "video.mp4", headers={"Range": "bytes=200000-"}))
    assert e.value.code == 416
    t.join(6)


def test_old_default_caches_are_still_found(tmp_path, monkeypatch):
    import json
    import subprocess
    from editor import transcribe
    clip = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=300:d=1", "-f", "lavfi", "-i", "color=black:s=64x64:d=1",
                    "-shortest", str(clip)], check=True)
    work = tmp_path / "work"
    (work / "transcripts").mkdir(parents=True)
    legacy = transcribe._cache_path(work / "transcripts", clip, "faster-whisper")         # a cache from before variants
    legacy.write_text(json.dumps({"engine": "faster-whisper", "words": [{"text": "cached", "start": 0.1, "end": 0.5}]}))
    monkeypatch.setattr(transcribe, "_make", lambda *a, **k: (_ for _ in ()).throw(AssertionError("re-transcribed")))
    transcribe.transcribe([str(clip)], work, engine="faster-whisper", glossary=["Claude Code", "WhisperX"])
    assert "cached" in (work / "transcript.txt").read_text()


def test_and_between_two_numbers_keeps_them_apart():
    def say(t):
        return " ".join(w["text"] for w in wordfix.digits([{"text": x, "start": i, "end": i + 0.5} for i, x in enumerate(t.split())]))
    assert say("between two hundred and three hundred dollars") == "between 200 and $300"
    assert say("from one thousand and two thousand followers") == "from 1,000 and 2,000 followers"
    assert say("two hundred and fifty people") == "250 people"


def test_retext_replaced_run_across_clips_keeps_each_clip():
    old = [{"text": "hello", "start": 40.0, "end": 40.4, "src": 0}, {"text": "wisper", "start": 40.5, "end": 41.0, "src": 0},
           {"text": "ex", "start": 0.5, "end": 0.7, "src": 1}, {"text": "rocks", "start": 0.8, "end": 1.1, "src": 1}]
    out = {w["text"]: w for w in retext.align(old, "hello Whisper X rocks".split())}
    assert out["Whisper"]["src"] == 0 and out["X"]["src"] == 1 and out["X"]["start"] == 0.5


def test_fix_zooms_name_the_play_of_a_repeated_stretch():
    from editor.anchors import find
    from editor.review import stillness_zooms
    cold = [{"id": f"w{i}", "text": "x", "start": (i - 20) * 0.5, "end": (i - 20) * 0.5 + 0.4} for i in range(20, 23)]
    body = [{"id": f"w{i}", "text": "x", "start": 12 + (i - 10) * 0.5, "end": 12 + (i - 10) * 0.5 + 0.4} for i in range(10, 35)]
    ws = cold + body
    z = stillness_zooms(["12.5-18.5s"], ws)
    a, _ = find(ws, z[0])
    assert a["start"] >= 12.5, (z[0], a)


def test_post_lists_youtube_chapters_when_youtube_would_take_them(tmp_path):
    import json
    from editor.versions import youtube_chapters, write_post
    project = tmp_path / "p"
    (project / "work").mkdir(parents=True)
    (project / "work" / "cut_meta.json").write_text(json.dumps({"duration": 95.0}))
    edl = {"chapters": [{"start": 0.4, "text": "Why I switched"}, {"start": 31.0, "text": "The setup"}, {"start": 62.5, "text": "What it costs"}]}
    assert youtube_chapters(project, edl) == "0:00 Why I switched\n0:31 The setup\n1:02 What it costs"
    assert youtube_chapters(project, {"chapters": edl["chapters"][:2]}) == ""                     # fewer than 3
    short = {"chapters": [*edl["chapters"][:2], {"start": 36.0, "text": "Too close"}]}
    assert youtube_chapters(project, short) == ""                                                # one under 10 s
    (project / "work" / "edl.json").write_text(json.dumps(edl))
    text = write_post(project, "Switching editors.", ["#a", "#b", "#c", "#d", "#e"]).read_text()
    assert "0:00 Why I switched" in text and text.index("1:02") < text.index("#a")


def test_suggest_chapters_and_cli_apply(tmp_path):
    import json
    from editor.anchors import resolve
    from editor.cli import main
    from editor.versions import suggest_chapters, youtube_chapters
    ws = []
    for s in range(48):                                   # a 10-word sentence every 5 s: 4 minutes
        for i, t in enumerate(f"so this is the next part of what I learned {s}.".split()):
            ws.append({"id": f"w{len(ws)}", "text": t, "start": s * 5 + i * 0.4, "end": s * 5 + i * 0.4 + 0.33})
    chs = suggest_chapters(ws, 240.0)
    assert len(chs) == 4 and chs[0]["text"] == "Intro" and chs[1]["text"].startswith("This is the next part")
    assert all(b["start"] - a["start"] >= 10 for a, b in zip(chs, chs[1:]))
    assert suggest_chapters(ws[:100], 50.0) == []
    work = tmp_path / "p" / "work"
    work.mkdir(parents=True)
    (work / "edl.json").write_text(json.dumps({"segments": []}))
    (work / "cut_words.json").write_text(json.dumps({"words": ws}))
    (work / "cut_meta.json").write_text(json.dumps({"duration": 240.0, "edl": str(work / "edl.json")}))
    assert main(["chapters", str(work), "--apply"]) == 0
    edl = json.loads((work / "edl.json").read_text())
    starts = [c["start"] for c in resolve(edl, ws)["chapters"]]
    assert starts[0] == 0.0 and len(starts) == 4
    assert youtube_chapters(tmp_path / "p", edl).startswith("0:00 Intro\n")
