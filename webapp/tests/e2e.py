"""Cutmind end-to-end: the whole workflow in a real browser, with the OpenAI and Anthropic APIs mocked.

  npm run build && npx next start -p 3200 &
  python3 tests/e2e.py <take.mp4> <transcript.json (Claude-Edit format)> <out_dir>

Checks: sign up (email + password) -> new video -> transcript -> first edit (hook, labels, zooms, music, post) -> live preview draws frames ->
a note makes version 2 -> "Edit it myself" makes version 3 -> export records a playable video + cover + caption.
"""
import json
import math
import struct
import subprocess
import sys
import wave
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = "http://localhost:3200/"
take, transcript, out = Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_text()), Path(sys.argv[3])
out.mkdir(parents=True, exist_ok=True)

# a song (4 s of tone) and a picture for the library
song = out / "song.wav"
with wave.open(str(song), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 220 * i / 16000))) for i in range(16000 * 4)))
subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=800x600:d=1", "-frames:v", "1", str(out / "pic.png")], check=True)

words = transcript["words"]
whisper = {"text": " ".join(w["text"] for w in words), "words": [{"word": w["text"], "start": w["start"], "end": w["end"]} for w in words],
           "segments": [{"start": 0, "end": 99, "avg_logprob": -0.05}]}
ids = lambda i: f"w{i}"  # noqa: E731
n = len(words)
first_edit = {
    "summary": "I kept your best takes and cut the pauses. I added a hook title, a picture and your song, and wrote your caption.",
    "keep": [{"from": "w0", "to": ids(n - 1)}], "gapCap": 0.12,
    "corrections": [{"from": "Claude Code", "to": "ClaudeCode"}],
    "hook": {"text": "3 tools that change editing", "from": "w0", "to": "w5"},
    "labels": [{"text": "1: ClaudeCode", "from": "w12", "to": "w14", "style": "label"}],
    "broll": [], "webPictures": [{"query": "Spotify", "kind": "logo", "from": "w20", "to": "w23"}],
    "zooms": [{"from": "w16", "to": "w19", "scale": 1.12}],
    "music": {"level": "under-voice", "automation": []},
    "cover": {"word": "w2", "text": "3 tools"},
    "post": {"caption": "3 tools that edit your videos for you. This one saves me hours.", "hashtags": ["videoediting", "reels", "aitools", "creator", "claude"],
             "keywords": ["video editing"]},
}
calls = {"anthropic": 0, "whisper": 0}


def route_anthropic(route):
    calls["anthropic"] += 1
    body = json.loads(route.request.post_data or "{}")
    user = body["messages"][0]["content"]
    if "The user left this note" in user:
        cur = json.loads(user.split("CURRENT EDIT:\n", 1)[1].split("\n\n", 1)[0])
        cur["music"]["automation"] = [{"from": "w0", "to": "w5", "db": -6}]
        cur["summary"] = "I turned the music down at the start."
        cur["styleRule"] = "Keep music quieter under talking."
        answer = cur
    else:
        answer = first_edit
    assert route.request.headers.get("anthropic-dangerous-direct-browser-access") == "true"
    assert route.request.headers.get("x-api-key") == "sk-ant-test"
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"},
                  body=json.dumps({"content": [{"type": "tool_use", "name": "submit_edit", "input": answer}]}))


def route_whisper(route):
    calls["whisper"] += 1
    assert route.request.headers.get("authorization") == "Bearer sk-openai-test"
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(whisper))


def cors(route):
    if route.request.method == "OPTIONS":
        route.fulfill(status=204, headers={"access-control-allow-origin": "*", "access-control-allow-headers": "*",
                                           "access-control-allow-methods": "POST, GET"})
        return True
    return False


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
                           args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1400, "height": 1000}, accept_downloads=True)
    ctx.add_init_script("""localStorage.setItem('ce.settings', JSON.stringify({provider:'anthropic', anthropicKey:'sk-ant-test',
      openaiKey:'sk-openai-test', anthropicModel:'claude-sonnet-5-5', transcriber:'openai', rememberKeys:true}));""")
    ctx.route("https://api.anthropic.com/**", lambda r: cors(r) or route_anthropic(r))
    ctx.route("https://api.openai.com/v1/audio/transcriptions", lambda r: cors(r) or route_whisper(r))
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL + "login?mode=signup")
    page.get_by_label("Your name").fill("Test Creator")
    page.get_by_label("Email").fill("test@example.com")
    page.get_by_label("Password", exact=True).fill("cutmind-e2e-1")
    page.get_by_role("button", name="Create my account").click()
    page.wait_for_url("**/app**")
    page.get_by_role("button", name="New video").first.click()
    page.locator("input[type=file]").set_input_files([str(take), str(song), str(out / "pic.png")])
    page.get_by_role("button", name="Make my reel").click()
    page.get_by_text("What I did").wait_for(timeout=120000)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(out / "1-editor.png"))
    assert calls == {"anthropic": 1, "whisper": 1}, calls
    assert page.get_by_text("Added music: song.wav").is_visible()
    assert page.get_by_text("#videoediting #reels #aitools #creator #claude").first.is_visible()

    def lit():                      # how much of the preview is drawn (not black)
        return page.evaluate("""() => { const c = document.querySelector('canvas'); const g = c.getContext('2d');
          const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 4000) if (d[i] + d[i+1] + d[i+2] > 30) n++;
          return n / (d.length / 4000); }""")
    assert lit() > 0.3, f"preview looks empty ({lit():.2f})"
    page.get_by_role("button", name="Play").click()
    page.wait_for_timeout(2500)
    page.get_by_role("button", name="Pause").click()
    t = page.locator("text=/\\d:\\d\\d \\/ \\d:\\d\\d/").inner_text()
    assert not t.startswith("0:00 /"), f"playback didn't advance: {t}"
    page.screenshot(path=str(out / "2-playing.png"))

    page.get_by_placeholder("Tell your editor what to change").fill("music too loud at the start")
    page.get_by_role("button", name="Send").click()
    page.get_by_text("Version 2: I turned the music down at the start.").wait_for(timeout=30000)
    page.get_by_role("button", name="Yes, remember it").click()
    style = page.evaluate("Object.keys(localStorage).filter(k => k.startsWith('ce.style.')).map(k => localStorage.getItem(k))")
    assert len(style) == 1 and json.loads(style[0])[0]["text"] == "Keep music quieter under talking.", style

    page.get_by_role("button", name="Edit it myself").click()
    page.get_by_role("tab", name="Subtitles").click()
    page.get_by_role("button", name="Big").click()
    page.get_by_role("button", name="Make a new version").click()
    page.get_by_role("button", name="Version 3").wait_for(timeout=15000)

    page.get_by_role("button", name="Export").click()
    page.get_by_text("Ready to post").wait_for(timeout=120000)
    with page.expect_download() as dl:
        page.get_by_role("link", name="Download video").click()
    video = out / dl.value.suggested_filename
    dl.value.save_as(video)
    with page.expect_download() as dl2:
        page.get_by_role("link", name="Download cover").click()
    dl2.value.save_as(out / "cover.jpg")
    page.screenshot(path=str(out / "3-exported.png"))
    assert not errors, errors
    b.close()

info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)],
                                 capture_output=True, text=True).stdout)
kinds = sorted(s["codec_type"] for s in info["streams"])
print("exported", video.name, kinds, info["format"].get("duration"))
assert kinds == ["audio", "video"], kinds
print("E2E OK")
