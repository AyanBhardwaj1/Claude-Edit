"""editor capture shots / stills-from: in-page actions, reads, failure reporting, recording, mpdecimate stills."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from editor import effort, shots  # noqa: E402
from editor.util import EditorError  # noqa: E402

PAGE = """<!doctype html><html><head><meta charset="utf-8"><title>Shots fixture</title>
<style>body{margin:0;font:20px sans-serif;background:#123;color:#fff}#ui{position:absolute;top:10px;left:10px;z-index:2}
canvas{position:absolute;inset:0;width:100%;height:100%}</style></head><body>
<canvas id="gl"></canvas>
<div id="ui">
<div id="banner">No live weather <button aria-label="Close banner">&times;</button></div>
<button id="go">Show result</button> <span id="status">Waiting</span><br>
<input type="range" min="0" max="24" value="12" aria-label="Time of day"> <span id="level">12</span><br>
<input placeholder="Search places" id="q"> <span id="echo"></span><br>
<select id="mode"><option value="walk">Walk</option><option value="bike">Bike</option></select> <span id="modeout">walk</span>
<div><p>With the model, canopy covers <b id="pct">0</b>%</p></div>
<span id="frames">0</span>
</div>
<script>
document.getElementById('go').addEventListener('click', () => {
  document.getElementById('status').textContent = 'Done: 42'; document.getElementById('pct').textContent = '37'; });
document.querySelector('#banner button').addEventListener('click', () => document.getElementById('banner').remove());
const r = document.querySelector('input[type=range]');
r.addEventListener('input', () => document.getElementById('level').textContent = r.value);
const q = document.getElementById('q');
q.addEventListener('input', () => document.getElementById('echo').textContent = q.value);
const m = document.getElementById('mode');
m.addEventListener('change', () => document.getElementById('modeout').textContent = m.value);
const c = document.getElementById('gl'); c.width = innerWidth; c.height = innerHeight;
const gl = c.getContext('webgl'), g2 = gl ? null : c.getContext('2d'); let n = 0;
function loop(t) {
  n++; document.getElementById('frames').textContent = n;
  const x = Math.floor((Math.sin(t / 300) * 0.4 + 0.5) * c.width);
  if (gl) {
    gl.enable(gl.SCISSOR_TEST); gl.scissor(0, 0, c.width, c.height);
    gl.clearColor(0.1, 0.2 + 0.2 * Math.sin(t / 300), 0.4, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.scissor(x, 60, 80, 80); gl.clearColor(1, 0.8, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  } else { g2.fillStyle = '#246'; g2.fillRect(0, 0, c.width, c.height); g2.fillStyle = '#fc0'; g2.fillRect(x, c.height - 140, 80, 80); }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script></body></html>
"""

_CHROMIUM = None


def chromium_ok() -> bool:
    global _CHROMIUM
    if _CHROMIUM is None:
        try:
            from playwright.sync_api import sync_playwright

            from editor.capture import _launch
            with sync_playwright() as p:
                _launch(p).close()
            _CHROMIUM = True
        except Exception:  # noqa: BLE001 - no playwright / no browser: skip
            _CHROMIUM = False
    return _CHROMIUM


needs_chromium = pytest.mark.skipif("not chromium_ok()", reason="Playwright/Chromium not available")


@pytest.fixture(autouse=True)
def fresh_timings(tmp_path, monkeypatch):
    monkeypatch.setattr(effort, "ROOT", tmp_path / "style")


@pytest.fixture
def site(tmp_path):
    d = tmp_path / "site"
    d.mkdir()
    (d / "app.html").write_text(PAGE)
    return d.as_uri() + "/"


def spec(base, shots_, **kw):
    return {"base": base, "viewport": [640, 360], "settle": 0.3, "pause": 0.1, "shots": shots_, **kw}


def test_spec_validation():
    with pytest.raises(EditorError, match="non-empty"):
        shots.load_spec({"shots": []})
    with pytest.raises(EditorError, match="unknown action"):
        shots.load_spec({"base": "x", "shots": [{"name": "a", "do": [{"hover": "x"}]}]})
    with pytest.raises(EditorError, match="two shots"):
        shots.load_spec({"base": "x", "shots": [{"name": "a"}, {"name": "a"}]})
    with pytest.raises(EditorError, match="needs a url"):
        shots.load_spec({"shots": [{"name": "a"}]})
    s = shots.load_spec({"base": "x", "shots": [{}, {}]})
    assert [x["name"] for x in s["shots"]] == ["shot01", "shot02"] and s["settle"] == 8.0
    assert shots.gl_args("swiftshader")[:2] == ["--use-gl=angle", "--use-angle=swiftshader"]
    with pytest.raises(EditorError):
        shots.gl_args("vulkan")


@needs_chromium
def test_shot_list_applies_actions_and_reports_failures(tmp_path, site):
    out = tmp_path / "out"
    report = shots.shots(spec(site, [
        {"name": "start", "url": "app.html", "wait": 0.5,
         "read": {"status": "#status", "canopy": "text=canopy covers"}},
        {"name": "after", "do": [
            {"dismiss": "No live weather"},
            {"click": "Show result"},
            {"slider": "input[aria-label='Time of day']", "value": 22},
            {"type": "PCL", "into": "input[placeholder^='Search']", "delay": 5},
            {"select": "#mode", "value": "Bike"},
            {"click": "There is no such button", "timeout": 3},
            {"eval": "document.title"},
            {"wait": 0.2}],
         "read": {"status": "#status", "level": "#level", "echo": "#echo", "mode": "#modeout",
                  "canopy": "text=canopy covers", "missing": "#nope"},
         "shot": {"clip": [0, 0, 320, 180]}},
    ]), out)

    start, after = report["shots"]
    assert start["read"] == {"status": "Waiting", "canopy": "With the model, canopy covers 0%"}
    assert after["read"]["status"] == "Done: 42"
    assert after["read"]["level"] == "22" and after["read"]["echo"] == "PCL" and after["read"]["mode"] == "bike"
    assert after["read"]["canopy"].endswith("37%")
    assert after["url"] == start["url"] and start["url"].endswith("app.html")       # state carried over
    failed = [f["action"] for f in after["failed"]]
    assert failed == ['click "There is no such button"', "read missing"]
    assert [a["ok"] for a in after["actions"]] == [True, True, True, True, True, False, True, True]
    assert report["failures"] == 2

    import cv2
    assert cv2.imread(str(out / "start.png")).shape[:2] == (360, 640)
    assert cv2.imread(str(out / "after.png")).shape[:2] == (180, 320)               # clip
    assert (out / "shots_sheet.jpg").stat().st_size > 1000
    saved = json.loads((out / "shots.json").read_text())
    assert saved["shots"][1]["read"]["status"] == "Done: 42"
    assert json.loads((out / "after.read.json").read_text())["echo"] == "PCL"
    rate, learned = effort.rate("capture", "standard")                                # timing recorded per run
    assert learned and rate > 0


@needs_chromium
def test_required_failure_stops_the_run(tmp_path, site):
    out = tmp_path / "out"
    with pytest.raises(EditorError, match="required action failed"):
        shots.shots(spec(site, [
            {"name": "a", "url": "app.html", "wait": 0.2, "do": [{"click": "css=#nothing", "required": True,
                                                                  "timeout": 3}]},
            {"name": "b"},
        ]), out, learn=False)
    saved = json.loads((out / "shots.json").read_text())
    assert [s["name"] for s in saved["shots"]] == ["a"] and "aborted" in saved
    assert not (out / "a.png").exists()


def _distinct_frames(video: Path) -> int:
    err = subprocess.run(["ffmpeg", "-hide_banner", "-i", str(video), "-vf", "mpdecimate,showinfo", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    return err.count("pts_time:")


@needs_chromium
@pytest.mark.skipif("shots._Recorder.available() is not None", reason="needs xvfb-run + ffmpeg x11grab")
def test_record_captures_canvas_motion(tmp_path, site):
    out = tmp_path / "out"
    report = shots.shots(spec(site, [
        {"name": "a", "url": "app.html", "wait": 1.5},
        {"name": "b", "do": [{"click": "Show result"}, {"wait": 1.0}], "read": {"status": "#status"}},
    ]), out, record=True, learn=False)
    assert report["recording"] == "shots.mp4"
    a, b = report["shots"]
    assert a["rec_in"] < a["rec_out"] <= b["rec_in"] < b["rec_shot"] < b["rec_out"]
    assert b["read"]["status"] == "Done: 42"
    from editor.util import probe
    v = probe(out / "shots.mp4")["video"]
    assert (v["width"], v["height"]) == (640, 360)
    assert _distinct_frames(out / "shots.mp4") >= 10                                 # the canvas really moves


def test_stills_from_choppy_recording(tmp_path):
    video = tmp_path / "choppy.mp4"
    # 2 distinct pictures a second, each repeated 15x at 30 fps: like a slow WebGL page recorded at 30 fps
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
                    "testsrc2=size=320x180:rate=2:duration=4", "-vf", "fps=30", "-c:v", "libx264", "-crf", "10",
                    "-pix_fmt", "yuv420p", str(video)], check=True)
    stills = shots.stills_from(video, tmp_path / "all")
    assert 7 <= len(stills) <= 9
    assert (tmp_path / "all" / "stills_sheet.jpg").exists()
    assert json.loads((tmp_path / "all" / "stills.json").read_text())["stills"][0]["t"] == 0
    gapped = shots.stills_from(video, tmp_path / "gap", min_gap=1.0)
    ts = [s["t"] for s in gapped]
    assert 3 <= len(ts) <= 5 and all(b - a >= 0.99 for a, b in zip(ts, ts[1:]))
    assert ts[-1] == stills[-1]["t"]                                                # end state kept
    cli = subprocess.run([sys.executable, "-m", "editor", "capture", "stills-from", str(video), str(tmp_path / "cli"),
                          "--max", "3"], cwd=ROOT, capture_output=True, text=True)
    assert cli.returncode == 0, cli.stderr
    assert len(list((tmp_path / "cli").glob("still_*.png"))) == 3


@needs_chromium
def test_dev_addresses_on_screen_are_flagged(tmp_path):
    page = tmp_path / "letter.html"
    page.write_text("<html><body style='font:20px sans-serif'><p>See it planted: "
                    "http://localhost:5173/demo?plant=Robert</p><p style='margin-top:3000px'>192.168.0.9 below the fold"
                    "</p><input value='walk-free.vercel.app'></body></html>")
    report = shots.shots({"base": tmp_path.as_uri() + "/", "gl": "off", "settle": 0.5,
                          "shots": [{"name": "letter", "url": "letter.html", "wait": 1}]}, tmp_path / "out")
    assert report["shots"][0]["dev_text"] == ["localhost:5173"]       # only what's in view, only dev addresses
    (x, y, w, h), = report["shots"][0]["dev_boxes"]                  # where it is, to blur it in the video
    assert 0 < x < 0.6 and y < 0.2 and 0 < w < 0.5 and 0 < h < 0.1
