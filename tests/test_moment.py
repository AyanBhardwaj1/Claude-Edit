"""editor timeline --at: a timed note on a reel -> the segment, words with ids and EDL entries at that moment."""
import json

from editor.anchors import moment


def test_moment_names_the_segment_words_broll_zoom_and_music_dip(tmp_path):
    words = [{"id": f"w{i}", "start": round(0.4 * i, 2), "end": round(0.4 * i + 0.3, 2), "text": t, "segment": 0 if i < 5 else 1}
             for i, t in enumerate("this app saves you twenty bucks every month at home".split())]
    (tmp_path / "cut_words.json").write_text(json.dumps({"words": words}))
    (tmp_path / "cut_meta.json").write_text(json.dumps({"duration": 4.0, "timeline": [
        {"index": 0, "src": 0, "src_start": 1.0, "src_end": 3.0, "speed": 1.0, "start": 0.0, "end": 2.0},
        {"index": 1, "src": 0, "src_start": 5.0, "src_end": 7.0, "speed": 1.0, "start": 2.0, "end": 4.0}]}))
    (tmp_path / "edl.json").write_text(json.dumps({
        "broll": [{"treatment": "text-pop", "text": "$20", "on": "twenty bucks"}],
        "zooms": [{"start": 3.5, "end": 3.9, "scale": 1.2}],
        "music": {"path": "music/song.mp3", "gain": -18, "automation": [{"on": "twenty bucks", "db": -6}]}}))
    out = moment(tmp_path, "0:02.1")
    assert "segment 1: source 0 at 5.10 s" in out
    assert "twenty[w4]" in out and "bucks[w5]" in out
    assert "b-roll:  text-pop" in out and "on 'twenty bucks'" in out
    assert "-6 dB" in out and "zoom" not in out
    assert "zoom:    1.2x" in moment(tmp_path, 3.6)


def test_times_people_write():
    from editor.anchors import _clock
    assert [_clock(x) for x in ("1:23", "1m23s", "83s", "83", "2m", "12.5s")] == [83, 83, 83, 83, 120, 12.5]
