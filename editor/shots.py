"""App captures from a shot list: reliable screenshots of web apps, even heavy WebGL pages on machines
without a GPU (`editor capture shots`), plus clean stills from a choppy recording (`editor capture stills-from`).

What works on a cloud machine with no GPU (and is the default here):
- Chromium with software WebGL (SwiftShader through ANGLE) instead of a missing GPU,
- every action runs inside the page (`element.click()` found by visible text, native value setters plus
  input/change events for sliders and text) with its own timeout: no Playwright actionability waits,
  which time out while a 3D page renders a few frames a second,
- a settle wait after the actions, then CDP `Page.captureScreenshot` (not `page.screenshot`).
Budget about 60-90 s per shot of a Three.js app on 4 CPUs.

Shot list (JSON):
  {"base": "http://localhost:5173", "viewport": [1440, 810], "scale": 1, "gl": "auto", "settle": 8,
   "shots": [
     {"name": "route", "url": "/demo?tab=route", "wait": 40, "wait_for": "text=Quickest",
      "do": [{"dismiss": "No live weather"}, {"click": "Hide its trees"}, {"wait": 8}],
      "shot": true, "read": {"canopy": "text=With Meta's DINOv3"}},
     {"name": "night", "do": [{"slider": "input[aria-label='Time of day']", "value": 22}]},
     {"name": "search", "do": [{"type": "PCL", "into": "input[placeholder^='Search']"}],
      "shot": {"clip": [0, 0, 720, 405]}}]}

Top level: base (joined with each shot's url), viewport [w, h], scale (device pixel ratio), gl
(auto | swiftshader | gpu | off), settle (seconds before each screenshot after actions, default 8),
pause (seconds after each action, default 1), timeout (seconds per action, default 20).
Per shot: name, url (absent: continue on the same page, state carries), wait (seconds after loading,
default = settle), wait_for (selector / text= to poll for, up to `wait` seconds), do (actions), settle,
shot (true | false | {"clip": [x, y, w, h]}; default true), read ({key: selector or "text=..."}).
Actions (each also takes "timeout" and "required": a required action that fails stops the run):
  {"click": "Visible text"} or {"click": "css=button.go"}     element.click() in the page (+ pointer events)
  {"type": "PCL", "into": "input[placeholder^='Search']", "delay": 60}   per-character, React-safe
  {"key": "Enter"}                                             a real key press (CDP), optional "into"
  {"slider": "input[type=range]", "value": 22}                 native setter + input/change
  {"select": "select#mode", "value": "bike"}                   by option value or label
  {"scroll": 600} / {"scroll": "#results"} / {"scroll": "#list", "by": 400}
  {"wait": 8}                                                  seconds
  {"dismiss": "No live weather"} / {"dismiss": true}           a close / x button near that text (or any)
  {"eval": "document.title"}                                   raw JS, allowed but logged
Selectors: "css=..." or "text=..." prefixes; without one, click/dismiss mean visible text and the rest CSS.

Outputs in the out dir: <name>.png per shot, <name>.read.json for shots that read text, shots.json
(per shot: file, url, actions done/failed, read values, seconds) and shots_sheet.jpg (contact sheet).
`record=True` also records the whole run as shots.mp4 (headed Chromium on Xvfb + ffmpeg x11grab) with
per-shot rec_in / rec_shot / rec_out times in shots.json (seconds into shots.mp4, about +-0.3 s).

Timing convention for planning: each run records `effort.record("capture", "standard", seconds, shots * 5)`,
i.e. one shot counts as 5 s of finished video, so the capture rate is seconds of capture work per minute
of footage at 12 shots a minute.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import shutil
import subprocess
import time
from pathlib import Path
from urllib.parse import urljoin

from .util import EditorError, load_json, log, save_json

SWIFTSHADER = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
GL_ARGS = {"swiftshader": SWIFTSHADER, "gpu": ["--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
           "off": ["--disable-gpu"], "default": []}
MEDIA_PER_SHOT = 5.0          # seconds of finished video one shot stands for (effort timings)
DEFAULTS = {"viewport": [1440, 810], "scale": 1, "gl": "auto", "settle": 8.0, "pause": 1.0, "timeout": 20.0,
            "shot_timeout": 120.0, "goto_timeout": 90.0}
ACTIONS = ("click", "type", "key", "slider", "select", "scroll", "wait", "dismiss", "eval")
MARKER = (255, 0, 254)        # calibration colour for finding the page inside the X screen

# One in-page helper: everything is done by the page itself, so a busy WebGL main thread only delays it.
JS = r"""
async (a) => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const visible = el => {
    if (!el || !el.isConnected || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && parseFloat(cs.opacity || '1') > 0.01;
  };
  const CLICKABLE = 'button,a,[role=button],[role=tab],[role=menuitem],[role=option],[role=link],[role=switch],' +
    '[role=checkbox],[role=radio],input,label,summary,select,[onclick],[tabindex]';
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'HTML', 'BODY']);
  const attrs = el => ['aria-label', 'title', 'placeholder', 'alt'].map(k => el.getAttribute(k)).filter(Boolean);
  const labels = el => {
    const out = attrs(el).map(norm);
    if (el.tagName === 'INPUT' && ['button', 'submit', 'reset'].includes(el.type)) out.push(norm(el.value));
    return out;
  };
  const byText = (text, root) => {
    const want = norm(text);
    let best = null, key = null, i = 0;
    for (const el of (root || document).querySelectorAll('*')) {
      i++;
      if (SKIP.has(el.tagName)) continue;
      const cheap = norm(el.textContent).includes(want) || labels(el).some(l => l.includes(want));
      if (!cheap || !visible(el)) continue;
      const own = norm(el.innerText);
      const ls = labels(el);
      if (!own.includes(want) && !ls.some(l => l.includes(want))) continue;
      const exact = own === want || ls.some(l => l === want) ? 1 : 0;
      const len = Math.min(own.length || 9999, ...ls.map(l => l.length));
      const k = [exact, -len, i];          // exact first, then the smallest, then the deepest
      if (!key || k[0] > key[0] || (k[0] === key[0] && (k[1] > key[1] || (k[1] === key[1] && k[2] > key[2])))) {
        best = el; key = k;
      }
    }
    return best;
  };
  const css = (sel, root) => {
    const all = [...(root || document).querySelectorAll(sel)];
    return all.find(visible) || all[0] || null;
  };
  const find = (sel, dflt) => {
    if (sel === true || sel === undefined || sel === null) return null;
    sel = String(sel);
    if (sel.startsWith('css=')) return css(sel.slice(4));
    if (sel.startsWith('text=')) return byText(sel.slice(5));
    if (dflt === 'text') return byText(sel);
    try { return css(sel); } catch (e) { return byText(sel); }
  };
  const describe = el => {
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (t ? ' "' + t.slice(0, 50) + '"' : '');
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const press = (el, plain) => {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) el.scrollIntoView({block: 'center'});
    const b = el.getBoundingClientRect();
    const o = {bubbles: true, cancelable: true, composed: true, view: window, button: 0,
               clientX: b.left + b.width / 2, clientY: b.top + b.height / 2};
    if (el.focus) el.focus({preventScroll: true});
    if (!plain) {
      el.dispatchEvent(new PointerEvent('pointerdown', {...o, pointerId: 1, isPrimary: true, buttons: 1}));
      el.dispatchEvent(new MouseEvent('mousedown', {...o, buttons: 1}));
      el.dispatchEvent(new PointerEvent('pointerup', {...o, pointerId: 1, isPrimary: true}));
      el.dispatchEvent(new MouseEvent('mouseup', o));
    }
    el.click();
  };
  const setter = (el, v) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
                  el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  };
  const fire = (el, ...names) => names.forEach(n => el.dispatchEvent(new Event(n, {bubbles: true})));
  const fail = msg => ({ok: false, detail: msg});
  const readText = sel => {
    let el = find(sel, 'css');
    if (!el) return null;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)) return el.value;
    if (String(sel).startsWith('text=')) {       // climb from a bare label to the block that holds the number
      const want = norm(String(sel).slice(5));
      for (let k = 0; k < 3 && el.parentElement && norm(el.innerText).length <= want.length + 3; k++) {
        if (norm(el.parentElement.innerText).length > 400) break;
        el = el.parentElement;
      }
    }
    return (el.innerText || el.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  };

  switch (a.kind) {
    case 'click': {
      const el = find(a.target, 'text');
      if (!el) return fail('not found');
      const target = el.closest(CLICKABLE) || el;
      press(target, a.plain);
      return {ok: true, detail: describe(target)};
    }
    case 'dismiss': {
      const CLOSE = '[aria-label*="close" i],[aria-label*="dismiss" i],[title*="close" i],[data-dismiss],' +
                    '[data-testid*="close" i],[data-bs-dismiss],.close,.btn-close';
      const WORDS = ['×', '✕', '✖', 'x', 'close', 'dismiss', 'got it', 'ok', 'no thanks', 'not now', 'skip'];
      const closers = root => [...root.querySelectorAll(CLOSE + ',button,[role=button]')].filter(el =>
        visible(el) && (el.matches(CLOSE) || WORDS.includes(norm(el.innerText || el.value))));
      if (a.target === true) {
        const el = closers(document)[0];
        if (!el) return fail('no close button on the page');
        press(el); return {ok: true, detail: describe(el)};
      }
      const anchor = byText(a.target);
      if (!anchor) return fail('text not found');
      for (let n = anchor, k = 0; n && k < 7; n = n.parentElement, k++) {
        const el = closers(n)[0];
        if (el) { press(el); return {ok: true, detail: describe(el)}; }
      }
      return fail('no close button near that text');
    }
    case 'type': {
      const el = a.into ? find(a.into, 'css') : document.activeElement;
      if (!el || el === document.body) return fail('no input to type into');
      el.focus && el.focus();
      const editable = el.isContentEditable;
      if (a.clear !== false && !editable) { setter(el, ''); fire(el, 'input'); }
      for (const ch of String(a.text)) {
        const k = {key: ch, bubbles: true, cancelable: true};
        el.dispatchEvent(new KeyboardEvent('keydown', k));
        el.dispatchEvent(new KeyboardEvent('keypress', k));
        if (editable) document.execCommand('insertText', false, ch);
        else {
          setter(el, el.value + ch);
          el.dispatchEvent(new InputEvent('input', {bubbles: true, data: ch, inputType: 'insertText'}));
        }
        el.dispatchEvent(new KeyboardEvent('keyup', k));
        if (a.delay) await sleep(a.delay);
      }
      fire(el, 'change');
      return {ok: true, detail: describe(el)};
    }
    case 'focus': {
      const el = find(a.target, 'css');
      if (!el) return fail('not found');
      el.focus(); return {ok: true, detail: describe(el)};
    }
    case 'slider': {
      const el = a.target === true ? css('input[type=range]') : find(a.target, 'css');
      if (!el) return fail('not found');
      setter(el, String(a.value)); fire(el, 'input', 'change');
      return {ok: true, detail: describe(el) + ' = ' + el.value};
    }
    case 'select': {
      const el = find(a.target, 'css');
      if (!el || el.tagName !== 'SELECT') return fail('no <select> found (click custom dropdowns instead)');
      const want = norm(String(a.value));
      const opt = [...el.options].find(o => o.value === String(a.value)) ||
                  [...el.options].find(o => norm(o.label || o.text) === want) ||
                  [...el.options].find(o => norm(o.label || o.text).includes(want));
      if (!opt) return fail('no option ' + a.value);
      setter(el, opt.value); fire(el, 'input', 'change');
      return {ok: true, detail: describe(el) + ' = ' + opt.value};
    }
    case 'scroll': {
      if (typeof a.target === 'number') {
        window.scrollBy(0, a.target); return {ok: true, detail: 'page y=' + scrollY};
      }
      const el = find(a.target, 'css');
      if (!el) return fail('not found');
      if (a.by) el.scrollBy(0, a.by); else el.scrollIntoView({block: 'center'});
      return {ok: true, detail: describe(el)};
    }
    case 'exists':
      return {ok: !!find(a.target, 'css'), detail: ''};
    case 'read': {
      const out = {};
      for (const [k, sel] of Object.entries(a.target)) out[k] = readText(sel);
      return {ok: true, detail: out};
    }
    case 'where': {
      // where the thing a shot is about sits on screen, as 0-1 of the viewport (for produce's punch-ins)
      const el = find(a.target, 'text');
      if (!el) return {ok: false, detail: 'not found'};
      const r = el.getBoundingClientRect();
      const W = innerWidth, H = innerHeight;
      return {ok: true, detail: {x: +((r.left + r.width / 2) / W).toFixed(4), y: +((r.top + r.height / 2) / H).toFixed(4),
                                 w: +(r.width / W).toFixed(4), h: +(r.height / H).toFixed(4)}};
    }
    case 'marker': {
      let d = document.getElementById('__ce_marker');
      if (a.on && !d) {
        d = document.createElement('div'); d.id = '__ce_marker';
        d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:' + a.color;
        (document.body || document.documentElement).appendChild(d);
      } else if (!a.on && d) d.remove();
      return {ok: true, detail: ''};
    }
  }
  return fail('unknown action ' + a.kind);
}
"""


def gl_args(gl: str) -> list[str]:
    """auto: software WebGL (SwiftShader) when the machine has no GPU device, else Chromium's default."""
    if gl == "auto":
        gpu = Path("/dev/dri").exists() or os.uname().sysname == "Darwin"
        return GL_ARGS["default"] if gpu else SWIFTSHADER
    if gl not in GL_ARGS:
        raise EditorError(f"gl must be auto, swiftshader, gpu or off (got {gl!r})")
    return GL_ARGS[gl]


def load_spec(spec) -> dict:
    spec = load_json(spec) if isinstance(spec, (str, Path)) else dict(spec)
    shots = spec.get("shots")
    if not isinstance(shots, list) or not shots:
        raise EditorError("shot list needs a non-empty \"shots\" array")
    seen = set()
    for k, s in enumerate(shots):
        s.setdefault("name", f"shot{k + 1:02d}")
        if not re.fullmatch(r"[\w.-]+", s["name"]):
            raise EditorError(f"shot name {s['name']!r}: use letters, digits, - _ . only")
        if s["name"] in seen:
            raise EditorError(f"two shots are named {s['name']!r}")
        seen.add(s["name"])
        if k == 0 and not s.get("url") and not spec.get("base"):
            raise EditorError("the first shot needs a url (or set \"base\")")
        for a in s.get("do", []):
            kind = next((x for x in ACTIONS if x in a), None)
            if not kind:
                raise EditorError(f"shot {s['name']}: unknown action {a} (one of {', '.join(ACTIONS)})")
    return {**DEFAULTS, **spec}


def _brief(a: dict) -> str:
    kind = next(x for x in ACTIONS if x in a)
    v = a[kind]
    extra = "".join(f" {k}={a[k]!r}" for k in ("into", "value", "by") if k in a)
    return f"{kind} {json.dumps(v)[:70]}{extra}"


class _Recorder:
    """Headed Chromium on a private Xvfb display, recorded with ffmpeg x11grab."""

    def __init__(self, w: int, h: int, out: Path):
        self.w, self.h, self.out = w, h, out
        self.sw, self.sh = (max(w + 64, 1024) + 1) // 2 * 2, (h + 320) // 2 * 2
        self.xvfb = self.ff = None
        self.t0 = None
        self.box = None

    @staticmethod
    def available() -> str | None:
        """None when recording can work here, else the reason it can't."""
        if not shutil.which("xvfb-run") or not shutil.which("Xvfb"):
            return "--record needs xvfb-run / Xvfb (Linux: apt-get install xvfb)"
        devs = subprocess.run(["ffmpeg", "-hide_banner", "-devices"], capture_output=True, text=True).stdout
        if "x11grab" not in devs:
            return "--record needs an ffmpeg built with x11grab"
        return None

    def start_display(self) -> str:
        self.xvfb = subprocess.Popen(["Xvfb", "-displayfd", "1", "-screen", "0", f"{self.sw}x{self.sh}x24",
                                      "-nolisten", "tcp"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        num = self.xvfb.stdout.readline().decode().strip()
        if not num.isdigit():
            raise EditorError("Xvfb did not start")
        self.display = f":{num}"
        return self.display

    def grab(self):
        import numpy as np
        raw = subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "x11grab", "-draw_mouse", "0",
                              "-video_size", f"{self.sw}x{self.sh}", "-i", self.display, "-frames:v", "1",
                              "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        if len(raw) != self.sw * self.sh * 3:
            return None
        return np.frombuffer(raw, np.uint8).reshape(self.sh, self.sw, 3)

    def find_page(self):
        """Where the page sits on the X screen: the box of the calibration colour."""
        import numpy as np
        img = self.grab()
        if img is None:
            return None
        hit = np.all(np.abs(img.astype(int) - MARKER) <= 2, axis=2)
        ys, xs = np.nonzero(hit)
        if len(xs) < 100:
            return None
        return int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)

    def start(self, box):
        x, y, w, h = box
        if abs(w - self.w) <= 4 and abs(h - self.h) <= 4:   # anti-aliased edges: trust the viewport size
            w, h = self.w, self.h
        w, h = w // 2 * 2, h // 2 * 2
        self.box = (x, y, w, h)
        self.ff = subprocess.Popen(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab",
                                    "-draw_mouse", "0", "-framerate", "30", "-video_size", f"{w}x{h}",
                                    "-i", f"{self.display}+{x},{y}", "-c:v", "libx264", "-preset", "ultrafast",
                                    "-crf", "16", "-pix_fmt", "yuv420p", str(self.out)], stdin=subprocess.PIPE)
        self.t0 = time.monotonic()

    def now(self) -> float | None:
        return None if self.t0 is None else round(time.monotonic() - self.t0, 2)

    def stop(self):
        if self.ff:
            try:
                self.ff.communicate(b"q", timeout=30)
            except Exception:
                self.ff.kill()
        if self.xvfb:
            self.xvfb.terminate()
            try:
                self.xvfb.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.xvfb.kill()


async def _run(spec: dict, out_dir: Path, record: bool, headed: bool) -> dict:
    from playwright.async_api import async_playwright

    from .capture import chromium_fallback

    vw, vh = (int(v) for v in spec["viewport"])
    scale = float(spec["scale"])
    rec = None
    if record:
        why = _Recorder.available()
        if why:
            log(f"shots: {why}; taking stills only")
        else:
            rec = _Recorder(vw, vh, out_dir / "shots.mp4")
            if scale != 1:
                log("shots: --record captures at scale 1 (screen pixels)")
                scale = spec["scale"] = 1.0
    args = gl_args(spec["gl"])
    report = {"base": spec.get("base"), "viewport": [vw, vh], "scale": scale, "gl": spec["gl"],
              "gl_args": args, "recording": None, "shots": []}
    t_start = time.monotonic()
    tmo = float(spec["timeout"])

    async def guard(coro, seconds):
        return await asyncio.wait_for(coro, timeout=seconds)

    async with async_playwright() as p:
        opts = dict(headless=not (rec or headed), args=args)
        if rec:
            opts["env"] = {**os.environ, "DISPLAY": rec.start_display()}
            opts["args"] = [*args, "--window-position=0,0"]
        browser = None
        try:
            try:
                browser = await p.chromium.launch(**opts)
            except Exception as first:
                exe = chromium_fallback()
                if not exe:
                    raise EditorError(f"could not start Chromium; run `python3 -m playwright install chromium`: "
                                      f"{first}") from first
                browser = await p.chromium.launch(executable_path=exe, **opts)
            ctx = await browser.new_context(viewport={"width": vw, "height": vh}, device_scale_factor=scale)
            page = await ctx.new_page()
            cdp = await ctx.new_cdp_session(page)

            async def js(kind, target=None, seconds=None, **kw):
                return await guard(page.evaluate(JS, {"kind": kind, "target": target, **kw}), seconds or tmo)

            if rec:     # find the page on the X screen with a full-viewport colour, then start recording
                await page.set_content("<body style='margin:0;background:#000'></body>")
                box = None
                for _ in range(10):
                    await js("marker", on=True, color="rgb(%d,%d,%d)" % MARKER)
                    await asyncio.sleep(0.8)
                    box = rec.find_page()
                    if box:
                        break
                await js("marker", on=False)
                if box:
                    rec.start(box)
                    report["recording"] = rec.out.name
                    x, y, w, h = rec.box
                    log(f"shots: recording {w}x{h} from {rec.display}+{x},{y} -> {rec.out}")
                else:
                    log("shots: could not find the page on the virtual screen; taking stills only")

            for s in spec["shots"]:
                live = rec if rec and rec.t0 is not None else None
                entry = await _one_shot(s, spec, page, cdp, js, guard, out_dir, live, t_start)
                report["shots"].append(entry)
                if entry.get("aborted"):
                    break
        finally:
            if rec:
                rec.stop()
            if browser:
                try:
                    await guard(browser.close(), 30)
                except Exception:  # noqa: BLE001
                    pass
    report["seconds"] = round(time.monotonic() - t_start, 1)
    return report


# localhost, loopback and private-network addresses, and dev-server ports, in the visible text or a link
DEV_PATTERN = (r"(localhost(:\d+)?|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+"
               r"|\b[\w.-]+:(3000|3001|5173|5174|8000|8080|8787)\b)")
DEV_TEXT_JS = """(pat) => {
  const re = new RegExp(pat, 'gi'), hits = new Set(), boxes = [];
  const inView = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  const box = (r) => { const x = Math.max(0, r.left) / innerWidth, y = Math.max(0, r.top) / innerHeight;
    boxes.push([x, y, Math.min(1 - x, r.width / innerWidth), Math.min(1 - y, r.height / innerHeight)].map((v) => +v.toFixed(4))); };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue; if (!t || !n.parentElement || !inView(n.parentElement.getBoundingClientRect())) continue;
    for (const m of t.matchAll(re)) {
      hits.add(m[0]);
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      for (const r of rg.getClientRects()) if (inView(r)) box(r);
    }
  }
  for (const el of document.querySelectorAll('input,textarea')) {
    const r = el.getBoundingClientRect();
    if (!inView(r)) continue;
    let hit = false;
    for (const m of String(el.value || '').matchAll(re)) { hits.add(m[0]); hit = true; }
    if (hit) box(r);
  }
  return { hits: [...hits].slice(0, 10), boxes: boxes.slice(0, 200), more: boxes.length > 200, vw: innerWidth, vh: innerHeight };
}"""


async def _one_shot(s, spec, page, cdp, js, guard, out_dir, rec, t_start) -> dict:
    name = s["name"]
    t0 = time.monotonic()
    entry = {"name": name, "file": None, "url": None, "started": round(t0 - t_start, 1),
             "rec_in": rec.now() if rec else None, "actions": [], "failed": [], "read": {}}
    settle = float(s.get("settle", spec["settle"]))
    if s.get("url"):
        url = urljoin(spec["base"].rstrip("/") + "/", s["url"]) if spec.get("base") else s["url"]
        entry["url"] = url
        log(f"shots: {name}: open {url}")
        try:
            await guard(page.goto(url, wait_until="domcontentloaded"), float(spec["goto_timeout"]))
        except Exception as e:
            log(f"shots: {name}: page load did not finish ({type(e).__name__}); carrying on")
            entry["failed"].append({"action": "open", "error": f"load: {type(e).__name__}"})
        wait = float(s.get("wait", settle))
        if s.get("wait_for"):
            end, found = time.monotonic() + wait, False
            while time.monotonic() < end and not found:
                try:
                    found = (await js("exists", s["wait_for"], seconds=10))["ok"]
                except Exception:
                    pass
                if not found:
                    await asyncio.sleep(1.0)
            log(f"shots: {name}: wait_for {s['wait_for']!r} -> {'found' if found else 'not found'} "
                f"after {time.monotonic() - t0:.0f} s")
            if not found:
                entry["failed"].append({"action": f"wait_for {s['wait_for']}", "error": "not found"})
            await asyncio.sleep(min(2.0, settle))
        else:
            await asyncio.sleep(wait)
    else:
        entry["url"] = page.url

    for a in s.get("do", []):
        kind = next(x for x in ACTIONS if x in a)
        brief = _brief(a)
        ta = time.monotonic()
        seconds = float(a.get("timeout", spec["timeout"]))
        ok, detail = False, ""
        try:
            if kind == "wait":
                await asyncio.sleep(float(a["wait"]))
                ok = True
            elif kind == "key":
                if a.get("into"):
                    r = await js("focus", a["into"], seconds)
                    if not r["ok"]:
                        raise EditorError(f"focus {a['into']}: {r['detail']}")
                await guard(page.keyboard.press(a["key"]), seconds)
                ok = True
            elif kind == "eval":
                log(f"shots: {name}: eval (raw JS) {a['eval'][:120]!r}")
                res = await guard(page.evaluate(a["eval"]), seconds)
                ok, detail = True, json.dumps(res, default=str)[:200] if res is not None else ""
            else:
                kw = {}
                if kind == "type":
                    kw = dict(text=a["type"], into=a.get("into"), delay=float(a.get("delay", 60)),
                              clear=a.get("clear", True))
                    target = None
                    seconds = max(seconds, len(str(a["type"])) * kw["delay"] / 1000 + 10)
                else:
                    target = a[kind]
                    kw = {k: a[k] for k in ("value", "by", "plain") if k in a}
                r = await js(kind, target, seconds, **kw)
                ok, detail = bool(r["ok"]), r["detail"]
        except asyncio.TimeoutError:
            detail = f"timed out after {seconds:.0f} s"
        except Exception as e:  # noqa: BLE001 - an action failing must not stop the run
            detail = f"{type(e).__name__}: {str(e).splitlines()[0][:160] if str(e) else ''}"
        dt = round(time.monotonic() - ta, 1)
        log(f"shots: {name}: {brief} -> {'ok' if ok else 'FAILED'}{(' (' + str(detail) + ')') if detail else ''} "
            f"{dt} s")
        rec_ = {"action": brief, "ok": ok, "detail": detail, "seconds": dt}
        entry["actions"].append(rec_)
        if not ok:
            entry["failed"].append({"action": brief, "error": detail})
            if a.get("required"):
                entry["aborted"] = f"required action failed: {brief}"
                log(f"shots: {name}: required action failed, stopping the run")
                break
        if kind != "wait":
            await asyncio.sleep(float(spec["pause"]))
    if entry.get("aborted"):
        entry["seconds"] = round(time.monotonic() - t0, 1)
        entry["rec_out"] = rec.now() if rec else None
        return entry

    if s.get("do"):                   # let the page render the result of the actions (a trailing wait counts)
        last = s["do"][-1]
        await asyncio.sleep(max(0.0, settle - (float(last["wait"]) if "wait" in last else 0.0)))

    if s.get("read"):
        try:
            r = await js("read", s["read"], 30)
            entry["read"] = r["detail"]
            for k, v in entry["read"].items():
                if v is None:
                    entry["failed"].append({"action": f"read {k}", "error": "not found"})
            save_json(out_dir / f"{name}.read.json", entry["read"])
            log(f"shots: {name}: read {json.dumps(entry['read'])[:200]}")
        except Exception as e:  # noqa: BLE001
            entry["failed"].append({"action": "read", "error": type(e).__name__})

    if s.get("focus"):
        try:
            r = await js("where", s["focus"], 15)
            if r.get("ok"):
                entry["focus"] = r["detail"]
            else:
                entry["failed"].append({"action": f"focus {s['focus']}", "error": "not found"})
        except Exception as e:  # noqa: BLE001
            entry["failed"].append({"action": "focus", "error": type(e).__name__})

    try:   # dev addresses visible on the page would end up in the video: flag them (blur, or capture the live site)
        res = await guard(page.evaluate(DEV_TEXT_JS, DEV_PATTERN), 15) or {}
        found = res.get("hits") or []
        if found:
            entry["dev_text"] = found
            entry["dev_boxes"] = res.get("boxes") or []     # where on screen (0-1): a piece's "redact": "dev" blurs them
            entry["_viewport"] = [res.get("vw") or 0, res.get("vh") or 0]
            if res.get("more"):
                log(f"shots: {name}: more than 200 dev addresses on screen: capture the deployed site instead")
            log(f"shots: {name}: WARNING dev address on screen: {', '.join(found[:3])} "
                "(blur it in the still, or capture the deployed site)")
    except Exception:  # noqa: BLE001 - a busy page only skips the check
        pass

    shot = s.get("shot", True)
    if shot:
        params = {"format": "png", "fromSurface": True, "captureBeyondViewport": False}
        clip = shot.get("clip") if isinstance(shot, dict) else None
        if clip and entry.get("dev_boxes"):    # the still is cropped to the clip: put the boxes in its frame
            entry["dev_boxes"] = clip_boxes(entry["dev_boxes"], clip, *entry.get("_viewport", [0, 0]))
        out = out_dir / f"{name}.png"
        entry["rec_shot"] = rec.now() if rec else None
        tshot = time.monotonic()
        for attempt in (1, 2):
            try:
                data = await guard(cdp.send("Page.captureScreenshot", params), float(spec["shot_timeout"]))
                png = base64.b64decode(data["data"])
                if clip:    # cropped here, not by CDP: a CDP clip briefly re-lays out a headed (recorded) window
                    png = _crop(png, clip, float(spec["scale"]))
                out.write_bytes(png)
                entry["file"] = out.name
                log(f"shots: {name}: screenshot -> {out} ({time.monotonic() - tshot:.0f} s)")
                break
            except Exception as e:  # noqa: BLE001
                log(f"shots: {name}: screenshot attempt {attempt} failed ({type(e).__name__})")
                if attempt == 2:
                    entry["failed"].append({"action": "screenshot", "error": type(e).__name__})
                else:
                    await asyncio.sleep(5)
    entry["seconds"] = round(time.monotonic() - t0, 1)
    entry["rec_out"] = rec.now() if rec else None
    if not rec:
        for k in ("rec_in", "rec_out", "rec_shot"):
            entry.pop(k, None)
    return entry


def clip_boxes(boxes: list, clip, vw: float, vh: float) -> list:
    """Boxes measured as 0-1 of the viewport, re-expressed as 0-1 of a clip [x, y, w, h] (CSS px) of it; the parts
    outside the clip are cut off and boxes wholly outside are dropped."""
    if not (vw and vh):
        return boxes
    cx, cy, cw, ch = (float(v) for v in clip)
    out = []
    for x, y, w, h in boxes:
        x0, y0, x1, y1 = x * vw, y * vh, (x + w) * vw, (y + h) * vh
        x0, y0, x1, y1 = max(x0, cx), max(y0, cy), min(x1, cx + cw), min(y1, cy + ch)
        if x1 > x0 and y1 > y0:
            out.append([round((x0 - cx) / cw, 4), round((y0 - cy) / ch, 4), round((x1 - x0) / cw, 4), round((y1 - y0) / ch, 4)])
    return out


def _crop(png: bytes, clip, scale: float) -> bytes:
    import cv2
    import numpy as np
    img = cv2.imdecode(np.frombuffer(png, np.uint8), cv2.IMREAD_UNCHANGED)
    x, y, w, h = (int(round(float(v) * scale)) for v in clip)
    x, y = max(0, x), max(0, y)
    part = img[y:y + h, x:x + w]
    if part.size == 0:
        raise EditorError(f"clip {clip} is outside the {img.shape[1]}x{img.shape[0]} screenshot")
    return cv2.imencode(".png", part)[1].tobytes()


def contact_sheet(items: list[tuple[Path, str]], out: str | Path, cols: int = 3, tile_w: int = 640) -> Path | None:
    """Labelled grid of images (JPEG)."""
    import cv2
    import numpy as np
    imgs = [(cv2.imread(str(p)), label) for p, label in items]
    imgs = [(im, label) for im, label in imgs if im is not None]
    if not imgs:
        return None
    cols = max(1, min(cols, len(imgs)))
    tile_h = max(int(round(tile_w * im.shape[0] / im.shape[1])) for im, _ in imgs)
    rows = (len(imgs) + cols - 1) // cols
    canvas = np.full((rows * (tile_h + 6) + 6, cols * (tile_w + 6) + 6, 3), 32, np.uint8)
    for k, (im, label) in enumerate(imgs):
        h = int(round(tile_w * im.shape[0] / im.shape[1]))
        im = cv2.resize(im, (tile_w, h), interpolation=cv2.INTER_AREA)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
        cv2.rectangle(im, (4, 4), (12 + tw, 14 + th), (0, 0, 0), -1)
        cv2.putText(im, label, (8, 9 + th), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1, cv2.LINE_AA)
        r, c = divmod(k, cols)
        y, x = 6 + r * (tile_h + 6), 6 + c * (tile_w + 6)
        canvas[y:y + h, x:x + tile_w] = im[:tile_h]
    out = Path(out)
    cv2.imwrite(str(out), canvas, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return out


def shots(spec, out_dir: str | Path, record: bool = False, headed: bool = False, base: str | None = None,
          learn: bool = True) -> dict:
    """Run a shot list (path or dict). Returns the report also written to <out_dir>/shots.json."""
    try:
        import playwright  # noqa: F401
    except ImportError as e:
        raise EditorError("playwright is not installed: pip install playwright && python3 -m playwright install "
                          "chromium") from e
    spec = load_spec(spec)
    if base:
        spec["base"] = base
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    report = asyncio.run(_run(spec, out_dir, record, headed))
    report["failures"] = sum(len(e["failed"]) for e in report["shots"])
    aborted = next((e["aborted"] for e in report["shots"] if e.get("aborted")), None)
    if aborted:
        report["aborted"] = aborted
    taken = [e for e in report["shots"] if e.get("file")]
    sheet = contact_sheet([(out_dir / e["file"], e["name"]) for e in taken], out_dir / "shots_sheet.jpg")
    report["sheet"] = sheet.name if sheet else None
    save_json(out_dir / "shots.json", report)
    log(f"shots: {len(taken)}/{len(report['shots'])} shots in {report['seconds']:.0f} s, "
        f"{report['failures']} failed step(s) -> {out_dir / 'shots.json'}")
    for e in report["shots"]:
        for f in e["failed"]:
            log(f"shots:   FAILED {e['name']}: {f['action']} ({f['error']})")
    if learn and taken:
        try:
            from . import effort
            effort.record("capture", "standard", report["seconds"], len(taken) * MEDIA_PER_SHOT)
        except Exception as e:  # noqa: BLE001 - timing memory must never fail a capture
            log(f"shots: could not record timing ({e})")
    if aborted:
        raise EditorError(f"shot list stopped: {aborted} (see {out_dir / 'shots.json'})")
    return report


def stills_from(video: str | Path, out_dir: str | Path, min_gap: float = 0.0, max_stills: int | None = None,
                hi: int = 64 * 12, lo: int = 64 * 5, frac: float = 0.33) -> list[dict]:
    """The distinct frames of a choppy recording as clean PNG stills (ffmpeg mpdecimate).

    min_gap keeps at most one still per that many seconds (the first; the last distinct frame is always kept,
    since a demo's end state usually matters). Writes still_NNN_<t>s.png, stills.json and stills_sheet.jpg.
    """
    video, out_dir = Path(video), Path(out_dir)
    if not video.exists():
        raise EditorError(f"no such video: {video}")
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir / ".stills_tmp"
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir()
    proc = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-i", str(video), "-vf",
                           f"mpdecimate=hi={hi}:lo={lo}:frac={frac},showinfo", "-fps_mode", "vfr",
                           str(tmp / "f_%05d.png")], capture_output=True, text=True)
    if proc.returncode != 0:
        shutil.rmtree(tmp, ignore_errors=True)
        raise EditorError("ffmpeg mpdecimate failed:\n" + "\n".join(proc.stderr.strip().splitlines()[-10:]))
    times = [float(m) for m in re.findall(r"pts_time:\s*([-\d.]+)", proc.stderr)]
    frames = sorted(tmp.glob("f_*.png"))
    pairs = list(zip(frames, times))
    keep = []
    for f, t in pairs:
        if not keep or t - keep[-1][1] >= min_gap:
            keep.append((f, t))
    if pairs and keep[-1][0] != pairs[-1][0]:
        if pairs[-1][1] - keep[-1][1] < min_gap and len(keep) > 1:
            keep.pop()
        keep.append(pairs[-1])
    if max_stills and len(keep) > max_stills:       # spread evenly, first and last included
        idx = sorted({round(k * (len(keep) - 1) / (max_stills - 1)) for k in range(max_stills)}) \
            if max_stills > 1 else [len(keep) - 1]
        keep = [keep[i] for i in idx]
    for old in out_dir.glob("still_*.png"):
        old.unlink()
    stills = []
    for n, (f, t) in enumerate(keep, 1):
        dst = out_dir / f"still_{n:03d}_{t:07.2f}s.png"
        f.replace(dst)
        stills.append({"file": dst.name, "t": round(t, 3)})
    shutil.rmtree(tmp, ignore_errors=True)
    save_json(out_dir / "stills.json", {"video": str(video), "distinct": len(pairs), "min_gap": min_gap,
                                        "stills": stills})
    contact_sheet([(out_dir / s["file"], f"{s['t']:.2f}s") for s in stills], out_dir / "stills_sheet.jpg", cols=4,
                  tile_w=480)
    log(f"stills: {len(pairs)} distinct frames, kept {len(stills)} -> {out_dir} (sheet: stills_sheet.jpg)")
    return stills


__all__ = ["shots", "stills_from", "contact_sheet", "load_spec", "gl_args"]
