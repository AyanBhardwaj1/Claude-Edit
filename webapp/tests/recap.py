"""Animated recap: the sample video becomes a Motion Studio animation (python3 tests/recap.py <url> <out>)."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
base, out = sys.argv[1].rstrip("/"), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page(); page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/login?mode=signup"); page.get_by_label("Your name").fill("Re Cap"); page.get_by_label("Email").fill("recap@example.com")
    page.get_by_label("Password", exact=True).fill("reels4ever!"); page.get_by_role("button", name="Create my account").click(); page.wait_for_url("**/app**")
    page.goto(base + "/app#sample"); page.get_by_text("This is the sample").wait_for(timeout=60000); page.wait_for_timeout(1500)
    page.get_by_role("button", name="Animated recap").click()
    page.get_by_role("button", name="All animations").wait_for(timeout=30000); page.wait_for_timeout(1500)
    print("scenes:", page.locator(".scene-strip .chip").all_inner_texts())
    page.screenshot(path=str(out / "recap.png"))
    b.close()
print("errors:", errors or "none")
