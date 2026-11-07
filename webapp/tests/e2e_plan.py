"""Cutmind end-to-end with "Your Claude or ChatGPT plan" as the editor: a new video's first edit goes through the
copy-and-paste window (the request shown, the reply pasted back) and no AI API is called. Transcription is mocked.

  npm run build && npx next start -p 3200 &
  python3 tests/e2e_plan.py <take.mp4> <transcript.json (Claude-Edit format)> <out_dir>
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
    if "Write 5 different hook titles" in user:
        answer = {"hooks": ["The editing habit I quit", "3 tools, zero editing", "Stop editing like it's 2015", "What 3 hours taught me", "You edit too much"]}
    elif "Translate these subtitle lines" in user:
        lines = [l.split(": ", 1) for l in user.split("\n") if l[:1].isdigit() and ": " in l]
        answer = {"lines": [{"i": int(i), "text": "ES " + t} for i, t in lines]}
    elif "The user left this note" in user:
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
    ctx.add_init_script("""localStorage.setItem('ce.settings', JSON.stringify({provider:'chat', anthropicKey:'',
      openaiKey:'sk-openai-test', anthropicModel:'claude-sonnet-5-5', transcriber:'openai', rememberKeys:true}));""")
    ctx.route("https://api.anthropic.com/**", lambda r: cors(r) or route_anthropic(r))
    ctx.route("https://api.openai.com/v1/audio/transcriptions", lambda r: cors(r) or route_whisper(r))
    import base64
    png = base64.b64encode((out / "pic.png").read_bytes()).decode()
    ctx.route("https://api.openai.com/v1/images/generations", lambda r: cors(r) or r.fulfill(status=200, content_type="application/json",
              headers={"access-control-allow-origin": "*"}, body=json.dumps({"data": [{"b64_json": png}]})))
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
    dlg = page.locator("dialog.relay")
    dlg.wait_for(state="visible", timeout=120000)
    print("dialog:", dlg.locator("h2").inner_text())
    dlg.locator("summary").click()
    req = dlg.locator("#relay-req").input_value()
    print("request words:", len(req.split()), "| has transcript ids:", "w0" in req, "| answer shape:", "## How to answer" in req)
    dlg.locator("#relay-ans").fill("Here you go:\n```json\n" + json.dumps(first_edit) + "\n```")
    dlg.get_by_role("button", name="Use this answer").click()
    page.get_by_text("What I did").wait_for(timeout=120000)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(out / "plan-editor.png"))
    print("calls:", calls)
    assert calls["anthropic"] == 0, calls
    assert page.get_by_text("#videoediting #reels #aitools #creator #claude").first.is_visible()
    print("summary:", page.locator(".msg.ed").first.inner_text()[:200].replace("\n", " | "))
    assert not errors, errors
    b.close()
    print("E2E PLAN OK")
