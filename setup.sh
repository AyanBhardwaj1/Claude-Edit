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
"$PY" -m pip install -r requirements.txt || {
  # vosk's `srt` dependency is a single pure-Python file; some distro setuptools can't build it
  "$PY" -m pip install --no-deps vosk && "$PY" -m pip install srt || true
  grep -v '^vosk' requirements.txt > /tmp/claude-edit-req.txt && "$PY" -m pip install -r /tmp/claude-edit-req.txt
}

# microphone recording for launch-video's teleprompter (desktop only; needs PortAudio on Linux)
"$PY" -m pip install sounddevice >/dev/null 2>&1 || echo "  sounddevice not installed: launch-video recording unavailable"

say "Offline speech model (Vosk, used when Whisper models or an API key aren't available)"
"$PY" -m editor models vosk || echo "  skipped; run: python3 -m editor models vosk"

say "Node (only for HyperFrames / Remotion motion graphics)"
if command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
  echo "node $(node -v) ok"
  (cd .claude/skills/launch-video/engine && npm ci --ignore-scripts --no-audit --no-fund) \
    || echo "  launch-video engine install failed; run: cd .claude/skills/launch-video/engine && npm ci"
else
  echo "  Node 22+ not found: built-in graphics still work; for claude-video-studio install it from https://nodejs.org"
fi

say "Playwright Chromium (for web b-roll capture)"
"$PY" -m playwright install chromium || echo "  skipped; web capture will need it later"

if [[ "${WHISPERX:-0}" == "1" ]]; then
  say "WhisperX (word-level forced alignment)"
  "$PY" -m pip install whisperx
else
  echo "Tip: WHISPERX=1 ./setup.sh installs WhisperX for the tightest word timestamps (large, pulls in torch)."
fi

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

echo "Optional: ELEVENLABS_API_KEY=... in .env enables hosted Scribe transcription (speakers, laughs, verbatim fillers)."

say "Doctor"
"$PY" -m editor doctor
