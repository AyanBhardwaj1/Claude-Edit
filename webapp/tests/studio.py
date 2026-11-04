"""Motion Studio in a browser: animate an example (no key), grab frames across it, change colours and shape, export."""
import base64, json, subprocess, sys
from pathlib import Path
from playwright.sync_api import sync_playwright

base, out = sys.argv[1].rstrip("/"), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/login?mode=signup")
    page.get_by_label("Your name").fill("Ani Mate"); page.get_by_label("Email").fill("anim@example.com")
    page.get_by_label("Password", exact=True).fill("reels4ever!"); page.get_by_role("button", name="Create my account").click()
    page.wait_for_url("**/app**"); page.goto(base + "/app#animate")
    page.get_by_role("button", name=sys.argv[3] if len(sys.argv) > 3 else "Product launch").click()
    page.get_by_role("button", name="Animate it").click()
    page.get_by_role("button", name="All animations").wait_for(timeout=30000)
    page.wait_for_timeout(1200)
    page.screenshot(path=str(out / "editor.png"))

    def grab(name, t):
        page.evaluate(f"""() => {{ const r = document.querySelector('.scrub'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          set.call(r, '{t}'); r.dispatchEvent(new Event('input', {{bubbles: true}})); }}""")
        page.wait_for_timeout(250)
        d = page.evaluate("document.querySelector('canvas').toDataURL('image/jpeg', 0.85)")
        (out / f"{name}.jpg").write_bytes(base64.b64decode(d.split(",")[1]))

    dur = page.evaluate("+document.querySelector('.scrub').max")
    for i in range(12):
        grab(f"f{i:02d}", round(dur * (i + 0.5) / 12, 2))
    page.get_by_role("tab", name="Look").click()
    for pal in ["Paper", "Electric"]:
        page.get_by_role("button", name=pal).click(); page.wait_for_timeout(300); grab(f"pal-{pal}", 1.5)
    page.get_by_role("button", name="16:9 Wide").click(); page.wait_for_timeout(400); grab("wide-title", 1.5); grab("wide-mid", round(dur * 0.4, 2))
    page.get_by_role("button", name="1:1 Square").click(); page.wait_for_timeout(400)
    page.get_by_role("button", name="Export").click()
    page.get_by_text("Ready", exact=True).wait_for(timeout=120000)
    with page.expect_download() as dl:
        page.get_by_role("link", name="Download video").click()
    vid = out / dl.value.suggested_filename; dl.value.save_as(vid)
    b.close()
info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(vid)], capture_output=True, text=True).stdout)
print("export", vid.name, [(s["codec_type"], s.get("width"), s.get("height")) for s in info["streams"]], info["format"].get("duration"))
print("errors:", errors or "none")
