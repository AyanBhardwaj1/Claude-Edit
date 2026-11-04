"""The welcome banner and the Cmd/Ctrl+K command palette (python3 tests/command.py <url> <out>)."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
base, out = sys.argv[1].rstrip("/"), Path(sys.argv[2]); out.mkdir(parents=True, exist_ok=True)
errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
    page = b.new_context(viewport={"width": 1440, "height": 900}).new_page(); page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(base + "/login?mode=signup"); page.get_by_label("Your name").fill("Kay Board"); page.get_by_label("Email").fill("kb@example.com")
    page.get_by_label("Password", exact=True).fill("reels4ever!"); page.get_by_role("button", name="Create my account").click(); page.wait_for_url("**/app**")
    page.get_by_text("Welcome to Cutmind, Kay").wait_for()
    page.screenshot(path=str(out / "welcome.png"))
    page.keyboard.press("Control+k")
    page.get_by_role("combobox").fill("terminal"); page.keyboard.press("Enter"); page.wait_for_timeout(300)
    assert page.evaluate("document.documentElement.dataset.theme") == "terminal"
    page.keyboard.press("Control+k"); page.get_by_role("combobox").fill("animate"); page.wait_for_timeout(200)
    page.screenshot(path=str(out / "palette.png"))
    page.keyboard.press("Enter"); page.wait_for_timeout(500)
    assert page.evaluate("location.hash") == "#animate", page.evaluate("location.hash")
    page.get_by_role("button", name="Go anywhere").click(); page.get_by_role("combobox").press("Escape")
    page.goto(base + "/app"); page.wait_for_timeout(600)
    page.get_by_role("button", name="Close the welcome").click()
    page.reload(); page.wait_for_timeout(800)
    assert not page.get_by_text("Welcome to Cutmind").is_visible()
    b.close()
print("errors:", errors or "none")
