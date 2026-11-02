"""Send a finished video to your phone: a QR code for a private link on your home Wi-Fi.

  editor share projects/<name>/out/export/"My reel - Version 2.mp4" [--caption projects/<name>/out/post.txt]

Starts a small web server on this computer for 15 minutes. The link carries a long random token, only
serves this one video (and a page with a Save button and the post caption to copy), supports the range
requests phones use to play video, and stops by itself. Scan the QR code (printed in the terminal and
saved as a PNG next to the video) with the phone's camera; phone and computer must be on the same Wi-Fi.
School, work and hotel Wi-Fi often block this: then AirDrop it, or use iCloud Drive / Google Drive.
Run it in the background (it blocks until the link expires or Ctrl+C). Desktop app only: from a cloud
session the link would point at the cloud machine, not your Wi-Fi.
"""
from __future__ import annotations

import hashlib
import hmac
import html
import ipaddress
import os
import secrets
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .util import EditorError, log

LIFETIME = 15 * 60


def lan_ip() -> str:
    """This computer's address on the home network (private IPv4; 192.168 before 10. before 172.16)."""
    cands = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.0.2.1", 9))          # no packet is sent; this just picks the outgoing interface
        cands.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        cands.update(i[4][0] for i in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET))
    except OSError:
        pass
    priv = [c for c in cands if ipaddress.ip_address(c).is_private and not c.startswith("127.")]
    rank = lambda ip: (0 if ip.startswith("192.168.") else 1 if ip.startswith("10.") else 2)  # noqa: E731
    if not priv:
        raise EditorError("this computer isn't on a home network (no private address found)")
    return sorted(priv, key=rank)[0]


def page(title: str, size_mb: float, caption: str) -> str:
    cap = (f"<h2>Your post caption</h2><textarea id=c readonly>{html.escape(caption)}</textarea>"
           "<button onclick=\"var c=document.getElementById('c');c.select();document.execCommand('copy');"
           "this.textContent='Copied'\">Copy caption</button>") if caption else ""
    return f"""<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Your video</title><style>body{{font:16px -apple-system,system-ui,sans-serif;margin:20px;background:#111;color:#eee}}
video{{width:100%;max-height:70vh;background:#000;border-radius:12px}}a.b,button{{display:block;width:100%;padding:14px;
margin:12px 0;border:0;border-radius:10px;background:#fff;color:#000;font-size:17px;text-align:center;text-decoration:none}}
textarea{{width:100%;height:9em;background:#222;color:#eee;border:0;border-radius:8px;padding:8px}}</style>
<h1>Your video is here</h1><p>{html.escape(title)} &middot; {size_mb:.0f} MB</p>
<video src="video.mp4" controls playsinline></video>
<a class=b href="video.mp4?save=1" download>Save video</a>
<p>iPhone: tap Save video, then the share icon and Save Video. Android: tap Save video, it lands in Downloads.</p>
{cap}<p><small>This link stops working by itself in 15 minutes and only works on your home Wi-Fi.</small></p>"""


def serve(video: str | Path, caption: str = "", port: int = 0, lifetime: int = LIFETIME,
          on_ready=None) -> None:
    video = Path(video)
    if not video.exists():
        raise EditorError(f"{video} not found")
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).digest()
    ip = lan_ip()
    body = page(video.stem, video.stat().st_size / 1e6, caption).encode()
    visited = threading.Event()

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _ok_token(self, part: str) -> bool:
            return hmac.compare_digest(hashlib.sha256(part.encode()).digest(), token_hash)

        def do_HEAD(self):
            self.do_GET(head=True)

        def do_GET(self, head=False):
            parts = self.path.split("?")[0].strip("/").split("/")
            if not parts or not self._ok_token(parts[0]) or len(parts) > 2:
                self.send_error(404)
                return
            common = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"}
            if len(parts) == 1:
                self.send_response(200)
                for k, v in {**common, "Content-Type": "text/html; charset=utf-8", "Content-Length": str(len(body)),
                             "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; "
                                                        "script-src 'unsafe-inline'; media-src 'self'"}.items():
                    self.send_header(k, v)
                self.end_headers()
                if not head:
                    self.wfile.write(body)
                visited.set()
                return
            if parts[1] != "video.mp4":
                self.send_error(404)
                return
            size = video.stat().st_size
            start, end = 0, size - 1
            rng = self.headers.get("Range", "")
            if rng.startswith("bytes="):
                a, _, b = rng[6:].partition("-")
                start = int(a) if a else max(0, size - int(b))
                end = int(b) if a and b else end
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            else:
                self.send_response(200)
            for k, v in {**common, "Content-Type": "video/mp4", "Accept-Ranges": "bytes",
                         "Content-Length": str(end - start + 1)}.items():
                self.send_header(k, v)
            if "save=1" in self.path:
                self.send_header("Content-Disposition", f'attachment; filename="{video.name}"')
            self.end_headers()
            if head:
                return
            with open(video, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(1 << 20, left))
                    if not chunk:
                        break
                    try:
                        self.wfile.write(chunk)
                    except (BrokenPipeError, ConnectionResetError):
                        return
                    left -= len(chunk)

    srv = ThreadingHTTPServer(("0.0.0.0", port), H)
    url = f"http://{ip}:{srv.server_address[1]}/{token}/"
    qr_png = video.with_name(video.stem + " - phone QR.png")
    try:
        import segno
        qr = segno.make(url, error="m")
        qr.save(str(qr_png), scale=10, border=3)
        qr.terminal(compact=True)
    except ImportError:
        qr_png = None
        log("install segno for a QR code (pip install segno); open the link on your phone instead")
    log(f"share: {url}  (QR: {qr_png})  stops in {lifetime // 60} min; phone and computer on the same Wi-Fi")
    if on_ready:
        on_ready(url, qr_png)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    t0 = time.time()
    try:
        while time.time() - t0 < lifetime:
            if visited.wait(1) and not getattr(serve, "_said", False):
                log("share: your phone opened it")
                serve._said = True
    except KeyboardInterrupt:
        pass
    finally:
        srv.shutdown()
        if qr_png and Path(qr_png).exists():
            os.remove(qr_png)
        log("share: link stopped")
