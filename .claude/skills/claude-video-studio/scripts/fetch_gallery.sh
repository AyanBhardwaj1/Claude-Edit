#!/usr/bin/env bash
# fetch_gallery.sh: download the gallery's preview videos (about 60 MB) from the upstream repo.
# They are kept out of this repo's git history; run once before the first `gallery.py`.
# usage: bash scripts/fetch_gallery.sh
set -e
HERE=$(cd "$(dirname "$0")/.." && pwd)
DEST="$HERE/gallery/videos"
if [ -d "$DEST" ] && [ "$(ls "$DEST"/*.mp4 2>/dev/null | wc -l)" -ge 20 ]; then echo "gallery videos already present"; exit 0; fi
TMP=$(mktemp -d)
git clone --depth 1 --filter=blob:none --sparse https://github.com/ItsssssJack/claude-video-2 "$TMP/repo" >/dev/null 2>&1
git -C "$TMP/repo" sparse-checkout set gallery/videos >/dev/null 2>&1
mkdir -p "$DEST" && cp "$TMP/repo/gallery/videos/"*.mp4 "$DEST/"
rm -rf "$TMP"
echo "gallery videos: $(ls "$DEST"/*.mp4 | wc -l) files in $DEST"
