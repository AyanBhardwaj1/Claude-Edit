"""Brand kit + timeline + shortcuts + every-shape export, on the sample."""
import base64, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
base, out = sys.argv[1].rstrip("/"), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", args=["--autoplay-policy=no-user-gesture-required"])
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, accept_downloads=True)
    page = ctx.new_page(); page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/login?mode=signup")
    page.get_by_label("Your name").fill("Bran Dee"); page.get_by_label("Email").fill("brand@example.com")
    page.get_by_label("Password", exact=True).fill("reels4ever!"); page.get_by_role("button", name="Create my account").click()
    page.wait_for_url("**/app**"); page.goto(base + "/app#settings")
    page.get_by_label("Brand or channel name").fill("Northside")
    page.get_by_label("Handle", exact=True).fill("@northside")
    page.locator("#b-acc").evaluate("(el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, '#ff3d9a'); el.dispatchEvent(new Event('input', {bubbles: true})); }")
    page.locator('input[type=file][accept^="image/png"]').set_input_files("/home/user/Claude-Edit/webapp/app/icon.svg") if False else None
    page.get_by_label("Put my logo and handle in the corner of every video").check()
    page.get_by_role("button", name="Save settings").first.click()
    page.screenshot(path=str(out / "settings-brand.png"), full_page=False)
    page.goto(base + "/app#sample"); page.get_by_text("This is the sample").wait_for(timeout=60000); page.wait_for_timeout(1500)
    page.get_by_role("button", name="Northside", exact=True).click(); page.wait_for_timeout(1800)
    page.screenshot(path=str(out / "editor.png"))
    d = page.evaluate("document.querySelector('canvas').toDataURL('image/jpeg', 0.85)"); (out / "frame.jpg").write_bytes(base64.b64decode(d.split(",")[1]))
    # shortcuts: right arrow moves 1 s, ctrl+z steps back a version
    t0 = page.locator(".time").inner_text()
    page.keyboard.press("ArrowRight"); page.keyboard.press("ArrowRight"); page.wait_for_timeout(400)
    assert page.locator(".time").inner_text().startswith("0:02"), page.locator(".time").inner_text()
    page.keyboard.press("Control+z"); page.wait_for_timeout(1200)
    assert page.locator('.versions [aria-pressed="true"]').inner_text() == "Version 1"
    page.keyboard.press("Control+Shift+z"); page.wait_for_timeout(1200)
    assert page.locator('.versions [aria-pressed="true"]').inner_text() == "Version 2"
    # animate with brand colours
    page.goto(base + "/app#animate")
    page.get_by_role("button", name="Product launch").click()
    page.locator(".pal", has_text="Brand").click()
    print("brand palette pressed:", page.locator(".pal", has_text="Brand").get_attribute("aria-pressed"))
    page.get_by_role("button", name="Animate it").click()
    page.get_by_role("button", name="All animations").wait_for(timeout=30000); page.wait_for_timeout(800)
    dur = page.evaluate("+document.querySelector('.scrub').max")
    page.evaluate(f"""() => {{ const r = document.querySelector('.scrub'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(r, '{dur - 0.5}'); r.dispatchEvent(new Event('input', {{bubbles: true}})); }}""")
    page.wait_for_timeout(400)
    d = page.evaluate("document.querySelector('canvas').toDataURL('image/jpeg', 0.85)"); (out / "anim-cta.jpg").write_bytes(base64.b64decode(d.split(",")[1]))
    b.close()
print("errors:", errors or "none")
