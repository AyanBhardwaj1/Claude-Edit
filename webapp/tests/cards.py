"""The sample has an animated counter card: find it on the timeline and grab frames while it plays (python3 tests/cards.py <url> <out>)."""
import base64, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
base, out = sys.argv[1].rstrip("/"), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page(); page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/login?mode=signup"); page.get_by_label("Your name").fill("Car D"); page.get_by_label("Email").fill("card@example.com")
    page.get_by_label("Password", exact=True).fill("reels4ever!"); page.get_by_role("button", name="Create my account").click(); page.wait_for_url("**/app**")
    page.goto(base + "/app#sample"); page.get_by_text("This is the sample").wait_for(timeout=60000); page.wait_for_timeout(1500)
    assert page.get_by_text("1 animated card").is_visible()
    # find the card's start from the timeline: the layer whose title is "every Sunday morning"
    for i, frac in enumerate([0.25, 0.5, 0.8]):
        x = page.evaluate(f"""() => {{ const el = [...document.querySelectorAll('.track .lay')].find(e => e.title === 'every Sunday morning'); el.scrollIntoView({{block: 'center'}});
            const r = el.getBoundingClientRect(); return [r.left + r.width * {frac}, r.top + r.height / 2]; }}""")
        page.mouse.click(x[0], x[1]); page.wait_for_timeout(900)
        print("click", x, page.locator(".time").inner_text(), page.evaluate("[...document.querySelectorAll('.track .lay')].map(e => e.title + '@' + e.style.left).join(' | ')") if i == 0 else "")
        d = page.evaluate("document.querySelector('canvas').toDataURL('image/jpeg', 0.85)"); (out / f"card{i}.jpg").write_bytes(base64.b64decode(d.split(",")[1]))
    b.close()
print("errors:", errors or "none")
