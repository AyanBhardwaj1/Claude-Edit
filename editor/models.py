"""Offline speech models that don't depend on huggingface.co.

Vosk (Kaldi) runs on CPU with no GPU or torch, gives word timestamps, and is the last-resort
engine when Whisper models can't be downloaded and no ElevenLabs key is set.

Sources, tried in order:
  1. $VOSK_MODEL (a model folder you already have)
  2. library/models/<name>/ (downloaded before)
  3. alphacephei.com, the official host
  4. the npm registry: the `transcribe2texts` package ships the official
     vosk-model-small-en-us-0.15 (Apache-2.0). Only its model folder is extracted;
     no package code is installed or run.
"""
from __future__ import annotations

import io
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from .util import EditorError, log

MODELS_DIR = Path(os.environ.get("CLAUDE_EDIT_MODELS", Path(__file__).resolve().parent.parent / "library" / "models"))
VOSK_MODELS = {
    # name: (official zip url, approx MB, note)
    "vosk-model-small-en-us-0.15": ("https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip", 40,
                                    "small, fast, okay accuracy"),
    "vosk-model-en-us-0.22-lgraph": ("https://alphacephei.com/vosk/models/vosk-model-en-us-0.22-lgraph.zip", 128,
                                     "better accuracy, still CPU friendly"),
}
NPM_FALLBACK = {"vosk-model-small-en-us-0.15": "transcribe2texts"}


def vosk_model(name: str | None = None) -> Path:
    env = os.environ.get("VOSK_MODEL")
    if env and Path(env).is_dir():
        return Path(env)
    names = [name] if name else list(VOSK_MODELS)
    for n in names:  # anything already on disk wins, best first
        for cand in sorted(MODELS_DIR.glob(f"{n}*"), reverse=True):
            if (cand / "am").is_dir() or (cand / "conf").is_dir():
                return cand
    n = name or "vosk-model-small-en-us-0.15"
    return download_vosk(n)


def download_vosk(name: str) -> Path:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    dest = MODELS_DIR / name
    url = VOSK_MODELS.get(name, (None,))[0]
    if url:
        try:
            log(f"downloading {name} from alphacephei.com")
            with urllib.request.urlopen(url, timeout=60) as r:
                data = r.read()
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                z.extractall(MODELS_DIR)
            if dest.is_dir():
                return dest
        except Exception as e:
            log(f"official download failed ({e}); trying the npm copy")
    pkg = NPM_FALLBACK.get(name)
    if pkg and shutil.which("npm"):
        with tempfile.TemporaryDirectory() as tmp:
            # `npm pack` only downloads the tarball; it runs no install scripts
            proc = subprocess.run(["npm", "pack", pkg, "--silent", "--pack-destination", tmp],
                                  capture_output=True, text=True)
            tgz = next(Path(tmp).glob("*.tgz"), None)
            if proc.returncode == 0 and tgz:
                with tarfile.open(tgz) as t:
                    prefix = f"package/{name}/"
                    members = [m for m in t.getmembers() if m.name.startswith(prefix) and m.isfile()
                               and ".." not in m.name]
                    for m in members:
                        target = dest / m.name[len(prefix):]
                        target.parent.mkdir(parents=True, exist_ok=True)
                        with t.extractfile(m) as src, open(target, "wb") as out:
                            shutil.copyfileobj(src, out)
                if (dest / "am").is_dir():
                    (dest / "SOURCE.json").write_text(json.dumps({"from": f"npm:{pkg}", "model": name}))
                    log(f"installed {name} from npm package {pkg} -> {dest}")
                    return dest
    raise EditorError(f"could not get Vosk model {name}. Download {url} and unzip it into {MODELS_DIR}/, "
                      f"or set VOSK_MODEL to a model folder.")


# RNNoise models for ffmpeg's arnndn (neural speech denoise). Not copyrightable per their README
# (github.com/GregorR/rnnoise-models). "somnolent-hogwash" = speech in recorded noise.
RNNOISE_URL = "https://raw.githubusercontent.com/GregorR/rnnoise-models/master/somnolent-hogwash-2018-09-01/sh.rnnn"


def rnnoise_model(download: bool = True) -> str | None:
    dest = MODELS_DIR / "rnnoise" / "sh.rnnn"
    if dest.exists() and dest.stat().st_size > 1000:
        return str(dest)
    if not download:
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    log("downloading the RNNoise speech model (about 0.3 MB)")
    try:
        with urllib.request.urlopen(RNNOISE_URL, timeout=60) as r:
            dest.write_bytes(r.read())
    except Exception as e:
        raise EditorError(f"could not download {RNNOISE_URL}: {e}") from e
    return str(dest)
