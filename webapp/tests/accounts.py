"""Server accounts (needs the app running with DATABASE_URL set):

  DATABASE_URL=postgres://... npm run build && DATABASE_URL=postgres://... npx next start -p 3200 &
  python3 tests/accounts.py

Signs up in one browser, makes a style rule and picks a look, then signs in from a second, fresh browser and checks
the account, the rule and the look came along while the API keys did not. Also: wrong password, duplicate email,
signed-out access, cross-site writes refused, sign out, password change signing out other devices.
"""
import json
import secrets
import sys

from playwright.sync_api import sync_playwright

URL = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3200").rstrip("/")
CHROME = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"
email = f"sync-{secrets.token_hex(4)}@example.com"


def signup(page, name, pw):
    page.goto(URL + "/login?mode=signup")
    page.get_by_label("Your name").fill(name)
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password", exact=True).fill(pw)
    page.get_by_role("button", name="Create my account").click()
    page.wait_for_url("**/app**")


def signin(page, pw):
    page.goto(URL + "/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password", exact=True).fill(pw)
    page.get_by_role("button", name="Sign in").click()


with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=CHROME)
    errors = []

    a = b.new_context()
    pa = a.new_page()
    pa.on("pageerror", lambda e: errors.append(str(e)))
    assert pa.request.get(URL + "/api/account").json()["mode"] == "server", "server accounts are not on"
    signup(pa, "Riya Sen", "first-pass-1")
    pa.get_by_text("Good").first.wait_for()
    assert any(c["name"] == "cm_session" and c["httpOnly"] for c in a.cookies()), "no httpOnly session cookie"
    # a style rule, a look and a key in browser A
    pa.goto(URL + "/app#style")
    pa.get_by_label("New rule").fill("Keep music quieter under talking.")
    pa.get_by_role("button", name="Add rule").click()
    pa.get_by_role("button", name="Terminal look").click()
    pa.goto(URL + "/app#settings")
    pa.get_by_label("Anthropic API key").fill("sk-ant-should-stay-here")
    pa.get_by_role("button", name="Save settings").click()
    pa.wait_for_timeout(1500)                                          # the push is debounced

    # the same email again is refused
    r = pa.request.post(URL + "/api/account", data=json.dumps({"action": "signup", "name": "X", "email": email, "password": "another-1"}),
                        headers={"content-type": "application/json", "origin": URL})
    assert r.status == 409, r.status
    # a write from another site is refused
    r = pa.request.post(URL + "/api/account", data=json.dumps({"action": "rename", "name": "Mallory"}),
                        headers={"content-type": "application/json", "origin": "https://evil.example"})
    assert r.status == 403, r.status
    stored = pa.request.get(URL + "/api/account/data").json()
    assert "sk-ant" not in json.dumps(stored), "an API key reached the server"
    assert stored["theme"] == "terminal" and stored["style"][0]["text"].startswith("Keep music"), stored

    # browser B: fresh, nothing local
    c = b.new_context()
    pb = c.new_page()
    pb.on("pageerror", lambda e: errors.append(str(e)))
    pb.goto(URL + "/app")
    pb.wait_for_url("**/login**")                                      # signed out
    assert pb.request.get(URL + "/api/account/data").status == 401
    signin(pb, "wrong-pass-9")
    pb.get_by_text("don't match an account").wait_for()
    signin(pb, "first-pass-1")
    pb.wait_for_url("**/app**")
    pb.get_by_text("Good").first.wait_for()
    assert pb.get_by_text("Riya Sen").first.is_visible()
    assert pb.evaluate("document.documentElement.dataset.theme") == "terminal", "look didn't follow"
    pb.goto(URL + "/app#style")
    pb.get_by_text("Keep music quieter under talking.").wait_for()
    pb.goto(URL + "/app#settings")
    assert pb.get_by_label("Anthropic API key").input_value() == "", "the key travelled"

    # changing the password in B signs A out; B stays in
    pb.get_by_label("Current password").fill("first-pass-1")
    pb.get_by_label("New password").fill("second-pass-2")
    pb.get_by_role("button", name="Change password").click()
    pb.get_by_text("Password changed.").wait_for()
    assert pa.request.get(URL + "/api/account").json()["user"] is None, "the other device is still signed in"
    assert pb.request.get(URL + "/api/account").json()["user"]["email"] == email

    # sign out
    pb.goto(URL + "/app")
    pb.get_by_role("button", name="Riya Sen").click()
    pb.get_by_role("menuitem", name="Sign out").click()
    pb.wait_for_url(URL + "/")
    assert pb.request.get(URL + "/api/account").json()["user"] is None
    assert not errors, errors
    b.close()
print("ACCOUNTS OK", email)
