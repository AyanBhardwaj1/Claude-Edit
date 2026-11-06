"""Free, licensed pictures for b-roll: brand logos and real photos of the things a video names.

  editor images search "golden gate bridge photo"        Openverse + Wikimedia Commons (photos, places, objects)
  editor images search "spotify" --logo                   Simple Icons (CC0 brand logos)
  editor images fetch 2 --project projects/<name>         download result 2 into broll/web/, credit recorded

Only licences that allow reuse are returned: CC0, public domain, CC BY, CC BY-SA (no NC, ND or
"fair use"). Pictures that need a credit are listed in broll/web/credits.json and added to the post
caption ("Photo credits: ...") by `editor post`. Mature results are filtered out.
Downloads follow at most 5 redirects, every hop must resolve to a public address, files are capped
at 20 MB and must really be an image (checked from the bytes).
Look at every picture before placing it: a matching title can carry the wrong picture.
"""
from __future__ import annotations

import ipaddress
import json
import re
import socket
import urllib.parse
from pathlib import Path

from .util import EditorError, load_json, log, save_json

UA = "Claude-Edit/1.0 (video editing; https://github.com/AyanBhardwaj1/Claude-Edit)"
OK_LICENSES = {"cc0", "pdm", "by", "by-sa", "public domain", "cc by", "cc by-sa", "cc-by", "cc-by-sa", "pd"}
NEEDS_CREDIT = ("by",)
MAX_BYTES = 20 * 1024 * 1024
LAST = Path.home() / ".cache" / "claude-edit" / "last_image_search.json"


# ---------------------------------------------------------------- transport (tests swap these)

def _get_json(url: str) -> dict:
    import requests
    r = requests.get(url, headers={"User-Agent": UA}, timeout=30)
    if r.status_code >= 400:
        raise EditorError(f"{url.split('?')[0]} -> HTTP {r.status_code}")
    return r.json()


def _get_bytes(url: str) -> tuple[bytes, str]:
    """GET with a public-address check on every redirect hop and a size cap. Returns (bytes, final url)."""
    import requests
    for _ in range(6):
        _check_public(url)
        r = requests.get(url, headers={"User-Agent": UA}, timeout=30, stream=True, allow_redirects=False)
        if r.status_code in (301, 302, 303, 307, 308) and r.headers.get("location"):
            url = urllib.parse.urljoin(url, r.headers["location"])
            continue
        if r.status_code >= 400:
            raise EditorError(f"download failed: HTTP {r.status_code}")
        data = b""
        for chunk in r.iter_content(65536):
            data += chunk
            if len(data) > MAX_BYTES:
                raise EditorError("that file is over 20 MB")
        return data, url
    raise EditorError("too many redirects")


def _check_public(url: str) -> None:
    u = urllib.parse.urlparse(url)
    if u.scheme not in ("http", "https") or u.username or u.password or not u.hostname:
        raise EditorError(f"refusing {url}: only plain http(s) links to public sites")
    try:
        infos = socket.getaddrinfo(u.hostname, None)
    except OSError as e:
        raise EditorError(f"cannot reach {u.hostname} ({e})") from e
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or \
                ip.is_unspecified or (ip.version == 6 and ip.ipv4_mapped and not ip.ipv4_mapped.is_global):
            raise EditorError(f"refusing {url}: it points at a private or local address")


# ---------------------------------------------------------------- search

def _lic(s: str) -> str:
    s = (s or "").lower().replace("cc ", "").replace("cc-", "").strip()
    s = re.sub(r"\s+\d+(\.\d+)?$", "", s)          # "by-sa 4.0" -> "by-sa"
    return {"public domain": "pdm", "pd": "pdm", "cc0": "cc0"}.get(s, s)


def openverse(query: str, n: int = 8) -> list[dict]:
    q = urllib.parse.urlencode({"q": query, "license": "cc0,pdm,by,by-sa", "mature": "false", "page_size": n})
    res = _get_json(f"https://api.openverse.org/v1/images/?{q}").get("results", [])
    return [{"url": r["url"], "title": r.get("title") or query, "creator": r.get("creator") or "",
             "license": _lic(r.get("license", "")), "page": r.get("foreign_landing_url") or r["url"],
             "w": r.get("width"), "h": r.get("height"), "source": f"openverse/{r.get('source', '')}", "kind": "photo"}
            for r in res if r.get("url")]


def wikimedia(query: str, n: int = 8) -> list[dict]:
    q = urllib.parse.urlencode({"action": "query", "format": "json", "generator": "search", "gsrsearch": query,
                                "gsrnamespace": 6, "gsrlimit": n, "prop": "imageinfo",
                                "iiprop": "url|size|extmetadata|mime", "iiurlwidth": 1600})
    pages = (_get_json(f"https://commons.wikimedia.org/w/api.php?{q}").get("query") or {}).get("pages", {})
    out = []
    for p in sorted(pages.values(), key=lambda p: p.get("index", 0)):
        ii = (p.get("imageinfo") or [{}])[0]
        meta = ii.get("extmetadata") or {}
        if not ii.get("mime", "").startswith("image/") or ii.get("mime") == "image/svg+xml" and "logo" not in query:
            continue
        artist = re.sub(r"<[^>]+>", "", (meta.get("Artist") or {}).get("value", "")).strip()
        out.append({"url": ii.get("thumburl") or ii.get("url"), "title": p.get("title", "").removeprefix("File:"),
                    "creator": artist, "license": _lic((meta.get("LicenseShortName") or {}).get("value", "")),
                    "page": ii.get("descriptionurl", ""), "w": ii.get("width"), "h": ii.get("height"),
                    "source": "wikimedia", "kind": "photo"})
    return out


def logo(name: str) -> list[dict]:
    """A brand's logo from Simple Icons (CC0), in its brand colour."""
    slug = re.sub(r"[^a-z0-9]", "", name.lower().replace("+", "plus").replace(".", "dot").replace("&", "and"))
    return [{"url": f"https://cdn.simpleicons.org/{slug}", "title": f"{name} logo", "creator": "Simple Icons",
             "license": "cc0", "page": "https://simpleicons.org", "source": "simple-icons", "kind": "logo",
             "fallback": f"https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/{slug}.svg"}]


def search(query: str, want_logo: bool = False, n: int = 8) -> list[dict]:
    results: list[dict] = []
    if want_logo or query.lower().endswith(" logo"):
        results += logo(re.sub(r"\s+logo$", "", query, flags=re.I))
    if not want_logo:
        for fn in (openverse, wikimedia):
            try:
                results += fn(query, n)
            except Exception as e:  # noqa: BLE001 (one source down should not stop the other)
                log(f"images: {fn.__name__} unavailable ({e})")
    results = [r for r in results if r["license"] in {_lic(x) for x in OK_LICENSES}][: max(n, 1)]
    for i, r in enumerate(results, 1):
        r["n"] = i
    LAST.parent.mkdir(parents=True, exist_ok=True)
    LAST.write_text(json.dumps(results))
    return results


# ---------------------------------------------------------------- fetch

def _kind_from_bytes(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if b"<svg" in data[:2000]:
        return "svg"
    return None


def fetch(which: str | int, project: str | Path, name: str | None = None) -> dict:
    """Download a search result (its number) or an image URL into <project>/broll/web/ and record its credit."""
    project = Path(project)
    if str(which).isdigit():
        results = json.loads(LAST.read_text()) if LAST.exists() else []
        hit = next((r for r in results if r["n"] == int(which)), None)
        if not hit:
            raise EditorError(f"no result {which}: run `editor images search` first")
    else:
        hit = {"url": str(which), "title": name or Path(urllib.parse.urlparse(str(which)).path).stem, "creator": "",
               "license": "unknown", "page": str(which), "source": "link", "kind": "photo"}
    return save_hit(hit, project, name)


def save_hit(hit: dict, project: str | Path, name: str | None = None) -> dict:
    """Download one result (a dict from search/logo) into <project>/broll/web/ and record its credit."""
    project = Path(project)
    try:
        data, final = _get_bytes(hit["url"])
    except EditorError:
        if not hit.get("fallback"):
            raise
        data, final = _get_bytes(hit["fallback"])
    ext = _kind_from_bytes(data)
    if not ext:
        raise EditorError("that link is not a picture (PNG, JPG, GIF, WebP or SVG)")
    slug = re.sub(r"[^a-z0-9]+", "-", (name or hit["title"]).lower()).strip("-")[:40] or "picture"
    dest_dir = project / "broll" / "web"
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{slug}.{ext}"
    dest.write_bytes(data)
    if ext == "svg":
        dest = _rasterize(dest)
    credits = dest_dir / "credits.json"
    db = load_json(credits) if credits.exists() else {}
    db[dest.name] = {k: hit.get(k) for k in ("title", "creator", "license", "page", "source", "kind")} | {"url": final}
    save_json(credits, db)
    note = "credit needed" if hit["license"].startswith(NEEDS_CREDIT) else "no credit needed"
    if hit["license"] == "unknown":
        note = "licence unknown: only use it if the user owns it or it is clearly fine to use"
    log(f"images: {dest} ({hit['license']}, {note})")
    return {"path": str(dest), **db[dest.name]}


def _rasterize(svg: Path, size: int = 800) -> Path:
    """SVG -> PNG with the browser (Simple Icons logos are SVG)."""
    png = svg.with_suffix(".png")
    try:
        from .capture import _launch
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            b = _launch(p)
            page = b.new_page(viewport={"width": size, "height": size})
            page.set_content(f"<html><body style='margin:0;background:transparent'><img src='data:image/svg+xml;base64,"
                             f"{__import__('base64').b64encode(svg.read_bytes()).decode()}' style='width:{size}px;"
                             f"height:{size}px;object-fit:contain'></body></html>")
            page.screenshot(path=str(png), omit_background=True)
            b.close()
        svg.unlink()
        return png
    except Exception as e:  # noqa: BLE001
        log(f"images: kept the SVG ({e}); convert it to PNG before using it as b-roll")
        return svg


def credit_line(paths: list[str]) -> str:
    """'Photo credits: ...' for the pictures in a video that need one (CC BY / BY-SA)."""
    parts = []
    for p in paths:
        cred = Path(p).parent / "credits.json"
        if not cred.exists():
            continue
        c = load_json(cred).get(Path(p).name)
        if c and str(c.get("license", "")).startswith(NEEDS_CREDIT):
            who = c.get("creator") or "unknown"
            parts.append(f"{c.get('title', Path(p).stem)} by {who} ({c['license'].upper()})")
    return ("Photo credits: " + "; ".join(dict.fromkeys(parts))) if parts else ""
