#!/usr/bin/env bash
# One-time setup: ffmpeg, Python deps, caption fonts, Whisper model warm-up.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

say "ffmpeg"
if ! command -v ffmpeg >/dev/null 2>&1; then
  if [[ "$(uname)" == "Darwin" ]]; then
    command -v brew >/dev/null || { echo "Install Homebrew first: https://brew.sh"; exit 1; }
    brew install ffmpeg
  elif command -v apt-get >/dev/null; then
    sudo apt-get update && sudo apt-get install -y ffmpeg fontconfig
  elif command -v dnf >/dev/null; then
    sudo dnf install -y ffmpeg fontconfig
  else
    echo "Install ffmpeg (with libass, libx264, zimg) from https://ffmpeg.org/download.html"; exit 1
  fi
fi
ffmpeg -hide_banner -version | head -1

say "Python packages"
PY=${PYTHON:-python3}
"$PY" -m pip install -r requirements.txt

say "Caption fonts (Montserrat, SIL Open Font License)"
mkdir -p assets/fonts
base="https://github.com/JulietaUla/Montserrat/raw/master"
for w in Black ExtraBold Bold Medium; do
  f="assets/fonts/Montserrat-$w.ttf"
  [[ -s "$f" ]] || curl -fsSL -o "$f" "$base/fonts/ttf/Montserrat-$w.ttf" || echo "  (could not fetch $w; Inter/Arial fallback will be used)"
done
[[ -s assets/fonts/OFL.txt ]] || curl -fsSL -o assets/fonts/OFL.txt "$base/OFL.txt" || true

if [[ "${SKIP_MODEL:-0}" != "1" ]]; then
  say "Whisper model warm-up (${WHISPER_MODEL:-small}; set SKIP_MODEL=1 to skip)"
  "$PY" -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL:-small}', device='cpu', compute_type='int8')" \
    || echo "  model download failed; it will retry on first transcribe"
fi

say "Doctor"
"$PY" -m editor doctor
