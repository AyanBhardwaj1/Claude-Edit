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
