"""Make B-roll automatically: web screenshots/scroll recordings (Playwright),
iPhone Simulator recordings (Xcode's simctl, macOS) and Android screen
recordings (adb).
"""
from __future__ import annotations

import glob
import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

from .util import EditorError, log, run

CHROMIUM_FALLBACKS = ["/opt/pw-browsers"]


def _launch(p):
    try:
        return p.chromium.launch()
    except Exception as first:
        # an already-installed Chromium of another Playwright version (glob follows symlinked dirs)
        for root in [os.environ.get("CHROMIUM_PATH", ""), *CHROMIUM_FALLBACKS]:
            if not root:
                continue
            found = [root] if os.path.isfile(root) else glob.glob(f"{root}/**/chrome", recursive=True)
            exe = next((x for x in found if os.path.isfile(x) and os.access(x, os.X_OK)), None)
            if exe:
                return p.chromium.launch(executable_path=exe)
        raise EditorError(f"could not start Chromium; run `python3 -m playwright install chromium`: {first}") from first


def web(url: str, out: str | Path, mobile: bool = True, full_page: bool = False, video: float = 0.0,
        scroll: bool = True, wait: float = 1.5, dark: bool = False) -> Path:
    """Screenshot (or record a smooth scroll of) a web page, phone-sized by default."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as e:
        raise EditorError("playwright is not installed: pip install playwright && python3 -m playwright install chromium") from e
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = _launch(p)
        ctx_opts = dict(p.devices["iPhone 14 Pro"]) if mobile else {"viewport": {"width": 1440, "height": 900},
                                                                      "device_scale_factor": 2}
        ctx_opts["color_scheme"] = "dark" if dark else "light"
        ctx = browser.new_context(**ctx_opts)
        page = ctx.new_page()
        page.goto(url, wait_until="networkidle", timeout=45000)
        time.sleep(wait)
        if video:
            # deterministic: one screenshot per output frame at an exact (eased) scroll position,
            # so the result is perfectly smooth regardless of machine speed
            fps = 30
            frames = max(1, int(video * fps))
            height = page.evaluate("document.documentElement.scrollHeight - window.innerHeight") if scroll else 0
            out = out.with_suffix(".mp4")
            enc = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe",
                                    "-framerate", str(fps), "-c:v", "png", "-i", "-", "-vf",
                                    "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264",
                                    "-crf", "16", "-preset", "medium", str(out)], stdin=subprocess.PIPE)
            for k in range(frames):
                x = k / max(frames - 1, 1)
                eased = x * x * (3 - 2 * x)
                page.evaluate(f"window.scrollTo(0, {height * eased:.1f})")
                enc.stdin.write(page.screenshot(type="png"))
            enc.stdin.close()
            if enc.wait() != 0:
                raise EditorError("ffmpeg failed while encoding the scroll recording")
        else:
            page.screenshot(path=str(out), full_page=full_page)
        ctx.close()
        browser.close()
    log(f"captured {url} -> {out}")
    return out


def sim(out: str | Path, seconds: float = 8.0, url: str | None = None, device: str = "booted",
        screenshot: bool = False) -> Path:
    """Record (or screenshot) the iOS Simulator. Boot one first: `open -a Simulator`."""
    if not shutil.which("xcrun"):
        raise EditorError("xcrun not found: the iPhone Simulator needs macOS with Xcode installed")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    if url:  # open a deep link / web page in the simulator before capturing
        run(["xcrun", "simctl", "openurl", device, url])
        time.sleep(2)
    if screenshot:
        run(["xcrun", "simctl", "io", device, "screenshot", str(out)])
    else:
        proc = subprocess.Popen(["xcrun", "simctl", "io", device, "recordVideo", "--codec=h264", "--force", str(out)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(seconds)
        proc.send_signal(signal.SIGINT)  # simctl finalises the file on SIGINT
        proc.wait(timeout=30)
    log(f"simulator capture -> {out}")
    return out


def android(out: str | Path, seconds: float = 8.0, screenshot: bool = False) -> Path:
    """Record (or screenshot) a connected Android device or emulator via adb."""
    if not shutil.which("adb"):
        raise EditorError("adb not found: install Android platform-tools")
    out = Path(out)
    out.parent.mkdir(parents=True, exist_ok=True)
    remote = "/sdcard/claude_edit_capture." + ("png" if screenshot else "mp4")
    if screenshot:
        run(["adb", "shell", "screencap", "-p", remote])
    else:
        run(["adb", "shell", "screenrecord", "--time-limit", str(int(seconds)), remote])
    run(["adb", "pull", remote, str(out)])
    run(["adb", "shell", "rm", remote])
    log(f"android capture -> {out}")
    return out
