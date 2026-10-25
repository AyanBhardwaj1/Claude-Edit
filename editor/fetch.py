"""Download media from a link (Instagram, TikTok, YouTube, X, Drive and ~1800 other sites) with yt-dlp.

Used for: pulling a raw video someone sent as a link into raw/, saving a track
into the music library, or grabbing reference footage. The post's caption and
metadata are saved next to the file, since a caption often holds the context.
"""
from __future__ import annotations

from pathlib import Path

from .util import EditorError, log, save_json


def fetch(url: str, dest: str | Path, audio_only: bool = False, cookies_from_browser: str | None = None,
          name: str | None = None) -> list[Path]:
    try:
        import yt_dlp
    except ImportError as e:
        raise EditorError("yt-dlp is not installed. Run: pip install -r requirements.txt") from e
    dest = Path(dest)
    dest.mkdir(parents=True, exist_ok=True)
    template = f"{name}.%(ext)s" if name else "%(title).60B [%(id)s].%(ext)s"
    opts = {
        "outtmpl": str(dest / template),
        "restrictfilenames": True,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "merge_output_format": "mp4",
        # best quality: separate best video + best audio, merged; fall back to best single file
        "format": "bestaudio/best" if audio_only else "bv*+ba/b",
    }
    if audio_only:
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]
    if cookies_from_browser:
        opts["cookiesfrombrowser"] = (cookies_from_browser,)
    log(f"fetching {url} -> {dest}")
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
    except Exception as e:
        hint = (" Instagram/TikTok often need a login: add --cookies-from-browser chrome (or safari/firefox)."
                if not cookies_from_browser else "")
        raise EditorError(f"download failed: {e}.{hint}") from e
    entries = info.get("entries") or [info]
    paths = []
    for entry in entries:
        for req in entry.get("requested_downloads") or [entry]:
            fp = req.get("filepath") or req.get("_filename")
            if fp:
                p = Path(fp)
                if audio_only:
                    p = p.with_suffix(".m4a")
                paths.append(p)
        meta = {k: entry.get(k) for k in ("id", "title", "description", "uploader", "uploader_id", "upload_date",
                                         "duration", "webpage_url", "like_count", "comment_count", "track", "artist")}
        if paths:
            save_json(paths[-1].with_suffix(".info.json"), meta)
    for p in paths:
        log(f"  saved {p}")
    return paths
