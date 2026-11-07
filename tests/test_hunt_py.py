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
    transcribe.transcribe([str(clip)], work, engine="faster-whisper", glossary=transcribe._shipped_glossary())
    assert "cached" in (work / "transcript.txt").read_text()
    with pytest.raises(AssertionError, match="re-transcribed"):                   # a new glossary name: transcribe again
        transcribe.transcribe([str(clip)], work, engine="faster-whisper", glossary=[*transcribe._shipped_glossary(), "Cutmind"])


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


def test_a_version_takes_only_a_cover_made_for_its_render(tmp_path):
    import os
    import time as _t
    from editor.versions import save_version
    project = tmp_path / "p"
    (project / "out").mkdir(parents=True)
    (project / "out" / "cover.jpg").write_bytes(b"old cover")
    old = _t.time() - 600
    os.utime(project / "out" / "cover.jpg", (old, old))
    (project / "out" / "p_reels.mp4").write_bytes(b"new render")        # a rush render: no new cover
    d = save_version(project, "rush")
    assert not (d / "cover.jpg").exists()


def test_fix_zooms_never_span_a_cold_open_and_respect_the_rate():
    from editor.anchors import find
    from editor.review import stillness_zooms
    cold = [{"id": f"w{i}", "text": "x", "start": (i - 50) * 0.4, "end": (i - 50) * 0.4 + 0.3} for i in range(50, 56)]
    body = [{"id": f"w{i}", "text": "x", "start": 2.6 + i * 0.4, "end": 2.6 + i * 0.4 + 0.3} for i in range(0, 60)]
    ws = cold + body
    for z in stillness_zooms(["1.0-20.0s"], ws):
        a, b = find(ws, z)
        assert b["end"] - a["start"] < 2.0, z
    assert len(stillness_zooms(["0.0-60.0s"], body, limit=2)) == 2 and stillness_zooms(["0.0-60.0s"], body, limit=0) == []


def test_numbers_bigger_scale_after_and():
    def say(t):
        return " ".join(w["text"] for w in wordfix.digits([{"text": x, "start": i, "end": i + 0.5} for i, x in enumerate(t.split())]))
    assert say("two hundred and fifty thousand dollars") == "$250,000"
    assert say("one hundred and twenty thousand people") == "120,000 people"
    assert say("between two hundred and three hundred dollars") == "between 200 and $300"


def test_broll_readd_refiles_instead_of_duplicating(tmp_path, monkeypatch):
    import subprocess
    from editor import library
    monkeypatch.setattr(library, "ROOT", tmp_path / "lib")
    clip = tmp_path / "x.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=black:s=64x64:d=1", str(clip)], check=True)
    library.broll_add([str(clip)], "a")
    inside = tmp_path / "lib" / "broll" / "a" / "x.mp4"
    library.broll_add([str(inside)], "a", tags=["night"])                 # same category: updated in place
    library.broll_add([str(inside)], "b")                                 # another category: moved, one entry
    clips = library._broll_db()["clips"]
    assert len(clips) == 1 and clips[0]["category"] == "b" and clips[0]["file"].startswith("broll/b/")
    assert not inside.exists() and (tmp_path / "lib" / clips[0]["file"]).exists()


def test_coldopen_moves_the_kept_line_first(tmp_path):
    import json
    from editor.cli import main
    work = tmp_path / "w"
    work.mkdir()
    text = "Hi everyone. I want to share my week. I lost 4000 dollars on one bad habit. Here is the fix."
    tr = [{"src": 0, "start": i * 0.5, "end": i * 0.5 + 0.4, "text": t} for i, t in enumerate(text.split())]
    (work / "transcript.json").write_text(json.dumps({"words": tr}))
    cut = [{"id": f"w{i}", "text": w["text"], "start": w["start"], "end": w["end"]} for i, w in enumerate(tr)]
    (work / "cut_words.json").write_text(json.dumps({"words": cut}))
    (work / "edl.json").write_text(json.dumps({"segments": [{"src": 0, "start": 0.0, "end": 5.4}, {"src": 0, "start": 6.0, "end": 10.0}]}))
    assert main(["coldopen", str(work), "--apply"]) == 0
    segs = json.loads((work / "edl.json").read_text())["segments"]
    # "I lost 4000 dollars on one bad habit." is w8-w15 (4.0-7.9 s): its kept parts first, the 5.4-6.0 pause still out
    # it ends where the next word ("Here", 8.0) starts: never a clipped syllable of it
    assert [(s["start"], s["end"]) for s in segs[:2]] == [(3.95, 5.4), (6.0, 8.0)]
    assert segs[0]["text"].startswith("I lost 4000") and segs[2] == {"src": 0, "start": 0.0, "end": 3.95}
    assert sum(s["end"] - s["start"] for s in segs) == pytest.approx(5.4 + 4.0)


def test_takes_plays_another_take_in_its_place(tmp_path, capsys):
    import json
    from editor.cli import main
    from editor.takes import take_lines
    work = tmp_path / "w"
    work.mkdir()

    def said(text, t0):
        return [{"src": 0, "start": round(t0 + i * 0.4, 3), "end": round(t0 + i * 0.4 + 0.3, 3), "text": t}
                for i, t in enumerate(text.split())]
    tr = (said("So the best way to edit a reel is this.", 0.0) + said("The best way to edit a reel is this one.", 5.0)
          + said("You add the captions after the cut.", 10.0))
    (work / "transcript.json").write_text(json.dumps({"words": tr}))
    plan_segs = [{"src": 0, "start": 4.94, "end": 9.0}, {"src": 0, "start": 9.94, "end": 12.8}]
    (work / "edl.json").write_text(json.dumps({"segments": plan_segs}))
    lines = take_lines(tr, plan_segs)
    assert len(lines) == 1 and lines[0]["playing"] == 1 and len(lines[0]["takes"]) == 2
    assert main(["takes", str(work)]) == 0
    assert "* take 2" in capsys.readouterr().out
    assert main(["takes", str(work), "--use", "1:1", "--apply"]) == 0
    segs = json.loads((work / "edl.json").read_text())["segments"]
    assert [(s["start"], s["end"]) for s in segs] == [(0.0, 4.0), (9.94, 12.8)]       # take 1 plays where take 2 did
    assert main(["takes", str(work), "--use", "1:2", "--apply"]) == 0
    segs = json.loads((work / "edl.json").read_text())["segments"]
    assert [(s["start"], s["end"]) for s in segs] == [(4.94, 9.0), (9.94, 12.8)]
    # a re-ordered cut keeps its order: the last line opens, the line's take follows it
    (work / "edl.json").write_text(json.dumps({"segments": [plan_segs[1], plan_segs[0]]}))
    assert main(["takes", str(work), "--use", "1:1", "--apply"]) == 0
    segs = json.loads((work / "edl.json").read_text())["segments"]
    assert [(s["start"], s["end"]) for s in segs] == [(9.94, 12.8), (0.0, 4.0)]
    assert main(["takes", str(work), "--use", "3:1"]) != 0                            # no line 3: an error, nothing written


def test_lessons_add_under_a_heading_given_whole(tmp_path):
    from editor.lessons import add
    path = tmp_path / "lessons.md"
    path.write_text("# Lessons\n\n## 2026-11-01 Demo\n- one\n")
    add("two", video="2026-11-01 Demo", path=path)
    add("three", video="## 2026-11-01 Demo", path=path)
    body = path.read_text()
    assert body.count("## 2026-11-01 Demo") == 1 and "- one\n- two\n- three" in body
    add("four", video="Launch", path=path)
    assert "Launch\n- four" in path.read_text() and "## 2026-11-01 Demo" in path.read_text()


def test_named_not_shown_keeps_a_name_that_opens_a_sentence():
    from editor.review import named_not_shown
    text = "Claude Code changed how I work. New York is where Notion started. So Figma helps. The end."
    words = [{"id": f"w{i}", "text": t, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, t in enumerate(text.split())]
    assert [m["name"] for m in named_not_shown({"broll": []}, words)] == ["Claude Code", "New York", "Notion", "Figma"]


def test_with_take_places_and_pads_only_by_real_words():
    from editor.takes import take_lines, with_take
    def said(text, t0, step=0.4):
        return [{"src": 0, "start": round(t0 + i * step, 3), "end": round(t0 + i * step + 0.3, 3), "text": t}
                for i, t in enumerate(text.split())]
    # intro, take 1 (dropped) right after it, other talk, take 2 (played)
    tr = (said("Hi there.", 0.0) + said("The best way to edit a reel is this.", 0.75)
          + said("Some other talk here today.", 5.0) + said("The best way to edit a reel is this one.", 8.0))
    segs = [{"src": 0, "start": 0.0, "end": 0.7}, {"src": 0, "start": 4.94, "end": 6.75}, {"src": 0, "start": 7.94, "end": 12.0}]
    line = take_lines(tr, segs)[0]
    assert line["playing"] == 1
    out = with_take(segs, line, 0)
    # take 1 plays where take 2 did (after the other talk), and its pads stop at the intro's last word
    assert [(s["start"], s["end"]) for s in out] == [(0.0, 0.7), (4.94, 6.75), (0.7, 4.35)]


def test_habits_found_in_safe_forms_and_cut(tmp_path, capsys):
    import json
    from editor.cli import main
    from editor.habits import find
    text = "So basically, you know, it's literally the best. Do you know why? It actually works, and, like, I mean, try it. I like it."
    tr = [{"src": 0, "start": round(i * 0.4, 3), "end": round(i * 0.4 + 0.3, 3), "text": t} for i, t in enumerate(text.split())]
    segs = [{"src": 0, "start": 0.0, "end": 12.0}]
    assert {f["name"]: len(f["hits"]) for f in find(tr, segs)} == {"basically": 1, "you know": 1, "literally": 1, "like": 1, "I mean": 1}
    assert [f["name"] for f in find(tr, [{"src": 0, "start": 2.0, "end": 12.0}])] == ["literally", "like", "I mean"]   # only what plays
    work = tmp_path / "w"
    work.mkdir()
    (work / "transcript.json").write_text(json.dumps({"words": tr}))
    (work / "edl.json").write_text(json.dumps({"segments": segs}))
    assert main(["habits", str(work), "--only", "basically", "--apply"]) == 0
    out = json.loads((work / "edl.json").read_text())["segments"]
    # "basically," is 0.4-0.7: cut from the middle of each pause around it
    assert [(s["start"], s["end"]) for s in out] == [(0.0, 0.35), (0.75, 12.0)]


def test_fit_cuts_the_least_gripping_lines_never_hook_ending_or_list(tmp_path, capsys):
    import json
    from editor.cli import main
    lines = ["I lost 4000 dollars on one bad habit.", "It was a normal week at the office and nothing much happened at all.",
             "The first one is batching your posts.", "The weather was fine and the coffee was fine too and so on.",
             "Here is the secret you need to know.", "Follow for part two."]
    tr, t = [], 0.0
    for line in lines:
        for w in line.split():
            tr.append({"src": 0, "start": round(t, 3), "end": round(t + 0.4, 3), "text": w})
            t += 0.5
        t += 0.35
    work = tmp_path / "w"
    work.mkdir()
    (work / "transcript.json").write_text(json.dumps({"words": tr}))
    (work / "cut_words.json").write_text(json.dumps({"words": [{"id": f"w{i}", **w} for i, w in enumerate(tr)]}))
    (work / "edl.json").write_text(json.dumps({"segments": [{"src": 0, "start": 0.0, "end": round(t, 3)}]}))
    assert main(["fit", str(work), "--under", "22", "--apply"]) == 0
    out = capsys.readouterr().out
    assert "normal week" in out and "weather" in out and "first one" not in out and "secret" not in out
    segs = json.loads((work / "edl.json").read_text())["segments"]
    assert sum(s["end"] - s["start"] for s in segs) <= 22.05
    kept = [w["text"] for w in tr if any(s["start"] <= (w["start"] + w["end"]) / 2 <= s["end"] for s in segs)]
    assert kept[:3] == ["I", "lost", "4000"] and kept[-1] == "two." and "batching" in kept and "secret" in kept
    # run again before re-cutting (cut_words.json is stale): lines already cut aren't proposed again
    assert main(["fit", str(work), "--under", "5"]) == 0
    out = capsys.readouterr().out
    assert "normal week" not in out and "weather" not in out and "still over" in out


def test_pacing_reports_habit_words_from_two():
    from editor.review import _habits
    say = lambda text: [{"id": f"w{i}", "text": t, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, t in enumerate(text.split())]  # noqa: E731
    assert _habits(say("It is basically done, you know, and it works.")) == \
        '"basically" x1, "you know" x1: offer to cut them (editor habits <work> --only ... --apply)'
    assert _habits(say("It is basically done and it works.")) is None


def test_fit_cuts_a_line_whole_and_honours_segment_speed():
    from editor.fit import _duration, plan_fit
    lines = ["I lost 4000 dollars on one bad habit.", "The weather was fine and calm.", "Here is the secret you need to know.",
             "Batch your posts and you will never miss a day.", "Follow for part two."]
    tr, t = [], 0.0
    for k, line in enumerate(lines):
        for w in line.split():
            tr.append({"src": 0, "start": round(t, 3), "end": round(t + 0.4, 3), "text": w})
            t += 0.95 if k == 1 else 0.5                # 0.55 s pauses inside the weather line
        t += 0.35
    cut_words = [{"id": f"w{i}", **w} for i, w in enumerate(tr)]
    edl = {"segments": [{"src": 0, "start": 0.0, "end": round(t, 3)}]}
    plan = plan_fit(edl, cut_words, tr, _duration(edl["segments"]) - 3)
    assert [d["text"] for d in plan["drop"]] == ["The weather was fine and calm."]
    assert len(plan["segments"]) == 2                    # one cut for the line: no silent slivers left inside it
    assert _duration([{"start": 0, "end": 2, "speed": 2.0}, {"start": 2, "end": 4}], 1.0) == 3.0


def test_takes_keeps_the_word_before_ahead_of_the_picked_take():
    from editor.takes import take_lines, with_take
    def w(t, a, b):
        return {"src": 0, "start": a, "end": b, "text": t}
    line = [("Say", 0.0, 0.2), ("this", 0.25, 0.45), ("line", 0.5, 0.7), ("now.", 0.75, 0.98)]
    tr = ([w("Hello", 0.0, 0.45), w("there.", 0.5, 1.0)] + [w(t, 1.02 + a, 1.02 + b) for t, a, b in line]
          + [w("Okay.", 2.5, 2.98)] + [w(t, 3.0 + a, 3.0 + b) for t, a, b in line] + [w("Bye.", 4.6, 4.9)])
    segs = [{"src": 0, "start": 0.0, "end": 1.01}, {"src": 0, "start": 2.45, "end": 4.95}]
    out = with_take(segs, take_lines(tr, segs)[0], 0)
    # "Okay." (2.45-2.98) still plays before the swapped line (take 1, 1.0-2.1), then "Bye."
    assert [(s["start"], s["end"]) for s in out] == [(0.0, 1.0), (2.45, 2.98), (1.0, 2.1), (4.08, 4.95)]


def test_cut_plays_touching_pieces_of_one_take_as_one(tmp_path):
    import json
    import subprocess
    from editor.cut import cut
    clip = tmp_path / "clip.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=4", "-f", "lavfi", "-i",
                    "sine=f=300:d=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(clip)], check=True)
    edl = {"sources": [{"path": str(clip), "duration": 4.0}], "speed": 1.0,
           "segments": [{"src": 0, "start": 0.2, "end": 1.6}, {"src": 0, "start": 1.6, "end": 3.0}, {"src": 0, "start": 3.2, "end": 3.8}]}
    (tmp_path / "edl.json").write_text(json.dumps(edl))
    cut(tmp_path / "edl.json", tmp_path)
    meta = json.loads((tmp_path / "cut_meta.json").read_text())
    tl = meta.get("timeline") or meta.get("segments")
    assert [(s["src_start"], s["src_end"]) for s in tl] == [(0.2, 3.0), (3.2, 3.8)]     # one seamless piece, then a real cut
    assert [s["edl"] for s in tl] == [[0, 1], [2]]                                     # named as in edl.json
    from editor.anchors import _edl_name
    assert [_edl_name(s) for s in tl] == ["0-1", "2"]


def test_pacing_reports_lines_said_twice():
    from editor.review import _said_twice
    text = "Here is the secret you need. It works every day. Here is the secret you need. Yes. Yes."
    words = [{"id": f"w{i}", "text": t, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, t in enumerate(text.split())]
    assert _said_twice(words) == '"Here is the secret you need." at 0.0s and 4.0s: cut the later one?'
    assert _said_twice(words[:10]) is None


def test_edl_changes_length_uses_a_segments_own_speed():
    from editor.versions import edl_changes
    old = {"segments": [{"src": 0, "start": 0, "end": 4}]}
    new = {"segments": [{"src": 0, "start": 0, "end": 4, "speed": 2.0}]}
    assert edl_changes(old, new)[0] == "length 4.0 s -> 2.0 s (-2.0 s)"


def test_said_twice_needs_the_same_sentence_not_the_same_opening():
    from editor.review import _said_twice, same_sentence
    say = lambda text: [{"id": f"w{i}", "text": t, "start": i * 0.4, "end": i * 0.4 + 0.3} for i, t in enumerate(text.split())]  # noqa: E731
    assert _said_twice(say("I'm going to show you three tools. Then more. I'm going to show you how it works.")) is None
    assert _said_twice(say("I use it every day. Then more. I use it every week now.")) is None
    assert not same_sentence("so i use notion".split(), "and i use figma".split())
    assert same_sentence("um follow for part two".split(), "follow for part two".split())


def test_cut_refuses_a_backwards_segment_even_next_to_a_touching_one(tmp_path):
    import json
    import pytest as _pt
    from editor.cut import cut
    from editor.util import EditorError
    edl = {"sources": [{"path": str(tmp_path / "missing.mp4")}], "segments": [{"src": 0, "start": 0, "end": 3}, {"src": 0, "start": 3, "end": 1}]}
    (tmp_path / "edl.json").write_text(json.dumps(edl))
    with _pt.raises(EditorError, match="segment 1"):
        cut(tmp_path / "edl.json", tmp_path)


def test_pacing_lists_words_the_recogniser_was_unsure_of():
    from editor.review import _unsure
    words = [{"id": f"w{i}", "text": t, "start": i * 0.4, "end": i * 0.4 + 0.3, "prob": p}
             for i, (t, p) in enumerate([("I", 0.99), ("use", 0.98), ("Clawed", 0.31), ("um", 0.2), ("Clawed", 0.4), ("daily.", 0.95)])]
    assert _unsure(words, {}) == '"Clawed" at 0.8s: check the captions (editor words <work> --unsure); fix with EDL captions.corrections'
    assert _unsure(words, {"captions": {"corrections": [{"from": "Clawed", "to": "Claude"}]}}) is None


def test_unsure_phrase_correction_and_curly_apostrophes():
    from editor.plan import norm
    from editor.review import _unsure
    from editor.wordfix import apply_corrections
    words = [{"id": f"w{i}", "text": t, "start": i * 0.4, "end": i * 0.4 + 0.3, "prob": p}
             for i, (t, p) in enumerate([("Clawed", 0.3), ("Code", 0.99), ("rocks", 0.99), ("and", 0.99), ("Clawed", 0.3), ("wins.", 0.99)])]
    # a phrase correction fixes the phrase, not every "Clawed": still listed, as Cutmind lists it
    assert _unsure(words, {"captions": {"corrections": [{"from": "Clawed Code", "to": "Claude Code"}]}}).startswith('"Clawed"')
    assert norm("don’t") == norm("don't") == "don't"
    fixed = apply_corrections([{"text": "I", "start": 0, "end": 0.3}, {"text": "don’t", "start": 0.4, "end": 0.7}], [{"from": "don't", "to": "do not"}])
    assert [w["text"] for w in fixed] == ["I", "do not"]


def test_post_fit_names_each_app_limit():
    from editor.versions import post_fit
    assert post_fit("One habit doubled my posting.\n\nMore here.\n\n#a #b #c #d #e\n") == []
    long = post_fit("x" * 2300 + "\n\n" + " ".join(f"#t{i}" for i in range(31)))
    assert any("Instagram takes 2,200" in w for w in long) and any("31 hashtags" in w for w in long)
    assert any("YouTube Shorts title" in w for w in long) and not any("TikTok" in w for w in long)
