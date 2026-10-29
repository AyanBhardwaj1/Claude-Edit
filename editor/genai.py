"""AI-generated content, only when the user asks for it: realistic B-roll video, images, sound effects,
music and voice, from the user's own API accounts (keys in .env, never pasted into chat).

  editor gen video "<prompt>" -o broll/ai/desk.mp4 --aspect 9:16 --dur 5 [--image first_frame.png]
  editor gen image "<prompt>" -o broll/ai/still.png --aspect 9:16
  editor gen sfx   "<prompt>" -o library/sfx/whoosh/air.mp3 --dur 1.2
  editor gen music "<prompt>" -o music/bed.mp3 --dur 30
  editor gen voice "<text>"   -o work/vo.mp3 --voice <elevenlabs voice id>
  editor gen models                       providers, keys and model aliases

Providers (the first with a key wins for each kind; --provider / --model pick one):
  video  gemini (Veo, GEMINI_API_KEY) · fal (FAL_KEY: Veo, Kling, Seedance, Hailuo...) · replicate (REPLICATE_API_TOKEN)
  image  openai (OPENAI_API_KEY: gpt-image) · fal (Flux...) · replicate
  sfx / music / voice  elevenlabs (ELEVENLABS_API_KEY)
--model takes an alias (see `gen models`) or any model id the provider hosts ("fal:fal-ai/...",
"replicate:owner/name", "gemini:veo-..."); --param key=value adds or overrides any input field.
Model catalogues move fast: aliases are a convenience, the provider's model page is the authority.

Every call costs money: run with --dry-run first (prints the request, spends nothing) and get the user's
yes on the plan. Every output gets a <file>.gen.json sidecar (provider, model, prompt, date) so the edit
knows what is AI-generated, for the platforms' AI-content labels.
"""
from __future__ import annotations

import base64
import json
import mimetypes
import time
from datetime import date
from pathlib import Path

from .util import EditorError, log

KEYS = {"fal": "FAL_KEY", "replicate": "REPLICATE_API_TOKEN", "openai": "OPENAI_API_KEY",
        "gemini": "GEMINI_API_KEY", "elevenlabs": "ELEVENLABS_API_KEY"}
ORDER = {"video": ["gemini", "fal", "replicate"], "image": ["openai", "fal", "replicate"],
         "sfx": ["elevenlabs"], "music": ["elevenlabs"], "voice": ["elevenlabs"]}
DEFAULT = {("video", "gemini"): "veo-3.1-generate-preview", ("video", "fal"): "fal-ai/veo3/fast",
           ("video", "replicate"): "google/veo-3-fast", ("image", "openai"): "gpt-image-1",
           ("image", "fal"): "fal-ai/flux-pro/v1.1-ultra", ("image", "replicate"): "black-forest-labs/flux-1.1-pro-ultra"}
ALIASES = {  # alias -> (kind, provider, model id)
    "veo": ("video", "gemini", "veo-3.1-generate-preview"),
    "veo-fast": ("video", "gemini", "veo-3.1-fast-generate-preview"),
    "veo-fal": ("video", "fal", "fal-ai/veo3"),
    "veo-fast-fal": ("video", "fal", "fal-ai/veo3/fast"),
    "kling": ("video", "fal", "fal-ai/kling-video/v2.1/master/text-to-video"),
    "kling-i2v": ("video", "fal", "fal-ai/kling-video/v2.1/master/image-to-video"),
    "veo-replicate": ("video", "replicate", "google/veo-3"),
    "kling-replicate": ("video", "replicate", "kwaivgi/kling-v2.1"),
    "gpt-image": ("image", "openai", "gpt-image-1"),
    "flux": ("image", "fal", "fal-ai/flux-pro/v1.1-ultra"),
    "flux-replicate": ("image", "replicate", "black-forest-labs/flux-1.1-pro-ultra"),
}
OPENAI_SIZES = {"9:16": "1024x1536", "4:5": "1024x1536", "16:9": "1536x1024", "1:1": "1024x1024"}
POLL_SECONDS = 5
TIMEOUT = 15 * 60


# ---------------------------------------------------------------- transport (tests swap these)

def _http(method: str, url: str, headers: dict, body: dict | None = None, raw: bool = False):
    import requests
    r = requests.request(method, url, headers=headers, json=body, timeout=120)
    if r.status_code >= 400:
        raise EditorError(f"{method} {url.split('?')[0]} -> HTTP {r.status_code}: {r.text[:500]}")
    return r.content if raw else r.json()


def _download(url: str, headers: dict | None = None) -> bytes:
    return _http("GET", url, headers or {}, raw=True)


# ---------------------------------------------------------------- helpers

def key_for(provider: str) -> str | None:
    from .transcribe import _api_key
    k = _api_key(KEYS[provider])
    if not k and provider == "gemini":
        k = _api_key("GOOGLE_API_KEY")
    return k


def pick(kind: str, provider: str | None = None, model: str | None = None) -> tuple[str, str]:
    """(provider, model id) for a request."""
    if model and model in ALIASES:
        k, provider, model = ALIASES[model]
        if k != kind:
            raise EditorError(f"model alias '{model}' makes {k}, not {kind}")
    elif model and ":" in model and model.split(":", 1)[0] in KEYS:
        provider, model = model.split(":", 1)
    if not provider:
        provider = next((p for p in ORDER[kind] if key_for(p)), None)
        if not provider:
            names = " or ".join(KEYS[p] for p in ORDER[kind])
            raise EditorError(f"no API key for {kind} generation: put {names} in .env (repo root). "
                              f"Never paste keys into the chat.")
    if provider not in ORDER[kind]:
        raise EditorError(f"{provider} does not do {kind} here (use one of {', '.join(ORDER[kind])})")
    return provider, model or DEFAULT.get((kind, provider), "")


def _data_uri(path: str | Path) -> str:
    mime = mimetypes.guess_type(str(path))[0] or "image/png"
    return f"data:{mime};base64,{base64.b64encode(Path(path).read_bytes()).decode()}"


def _params(pairs: list[str] | None) -> dict:
    out = {}
    for kv in pairs or []:
        k, sep, v = kv.partition("=")
        if not sep:
            raise EditorError(f"--param expects key=value, got '{kv}'")
        try:
            out[k] = json.loads(v)
        except json.JSONDecodeError:
            out[k] = v
    return out


def _redact(obj):
    if isinstance(obj, dict):
        return {k: _redact(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact(v) for v in obj]
    if isinstance(obj, str) and (obj.startswith("data:") or len(obj) > 400):
        return obj[:40] + f"...({len(obj)} chars)"
    return obj


def _sidecar(out: Path, **info) -> None:
    info = {"ai_generated": True, "date": date.today().isoformat(), **info}
    out.with_name(out.name + ".gen.json").write_text(json.dumps(_redact(info), indent=1) + "\n")


def provenance(path: str | Path) -> dict | None:
    """The .gen.json record of a generated file, or None for real footage."""
    p = Path(path)
    side = p.with_name(p.name + ".gen.json")
    return json.loads(side.read_text()) if side.exists() else None


def _poll(fetch, done, what: str):
    t0 = time.time()
    while True:
        state = fetch()
        result = done(state)
        if result is not None:
            return result
        if time.time() - t0 > TIMEOUT:
            raise EditorError(f"{what}: still not finished after {TIMEOUT // 60} min")
        time.sleep(POLL_SECONDS)


# ---------------------------------------------------------------- video

def _video_request(provider, model, prompt, aspect, dur, image, audio, extra):
    if "veo" in model:   # Veo makes 4, 6 or 8 second clips
        dur = min((4, 6, 8), key=lambda d: (abs(d - dur), -d))   # ties round up: trim, never stretch
    if provider == "fal":
        body = {"prompt": prompt, "aspect_ratio": aspect}
        if "veo" in model:
            body.update(duration=f"{int(dur)}s", generate_audio=audio)
        elif "kling" in model:
            body["duration"] = "10" if dur > 7 else "5"
        else:
            body["duration"] = int(dur)
        if image:
            body["image_url"] = _data_uri(image)
        return {"url": f"https://queue.fal.run/{model}", "body": {**body, **extra}}
    if provider == "replicate":
        body = {"prompt": prompt, "aspect_ratio": aspect, "duration": int(dur)}
        if image:
            body["image"] = _data_uri(image)
        return {"url": f"https://api.replicate.com/v1/models/{model}/predictions", "body": {"input": {**body, **extra}}}
    inst = {"prompt": prompt}
    if image:
        inst["image"] = {"bytesBase64Encoded": base64.b64encode(Path(image).read_bytes()).decode(),
                         "mimeType": mimetypes.guess_type(str(image))[0] or "image/png"}
    params = {"aspectRatio": aspect, "durationSeconds": int(dur), **extra}
    return {"url": f"https://generativelanguage.googleapis.com/v1beta/models/{model}:predictLongRunning",
            "body": {"instances": [inst], "parameters": params}}


def video(prompt: str, out: str | Path, aspect: str = "9:16", dur: float = 5.0, image: str | None = None,
          provider: str | None = None, model: str | None = None, audio: bool = True,
          params: list[str] | None = None, dry_run: bool = False) -> Path | dict:
    provider, model = pick("video", provider, model)
    req = _video_request(provider, model, prompt, aspect, dur, image, audio, _params(params))
    if dry_run:
        return _dry(provider, model, req)
    out = Path(out)
    url = _run(provider, req, kind="video")
    _save(out, _download(url, _auth(provider) if provider == "gemini" else None))
    _sidecar(out, kind="video", provider=provider, model=model, prompt=prompt, aspect=aspect, dur=dur,
             first_frame=str(image) if image else None)
    log(f"gen video ({provider}:{model}) -> {out}")
    return out


# ---------------------------------------------------------------- image

def image(prompt: str, out: str | Path, aspect: str = "9:16", provider: str | None = None, model: str | None = None,
          params: list[str] | None = None, dry_run: bool = False) -> Path | dict:
    provider, model = pick("image", provider, model)
    extra = _params(params)
    if provider == "openai":
        req = {"url": "https://api.openai.com/v1/images/generations",
               "body": {"model": model, "prompt": prompt, "size": OPENAI_SIZES.get(aspect, "1024x1536"),
                        "quality": "high", "n": 1, **extra}}
    elif provider == "fal":
        req = {"url": f"https://queue.fal.run/{model}", "body": {"prompt": prompt, "aspect_ratio": aspect, **extra}}
    else:
        req = {"url": f"https://api.replicate.com/v1/models/{model}/predictions",
               "body": {"input": {"prompt": prompt, "aspect_ratio": aspect, "output_format": "png", **extra}}}
    if dry_run:
        return _dry(provider, model, req)
    out = Path(out)
    if provider == "openai":
        res = _http("POST", req["url"], _auth(provider), req["body"])
        item = res["data"][0]
        data = base64.b64decode(item["b64_json"]) if item.get("b64_json") else _download(item["url"])
    else:
        data = _download(_run(provider, req, kind="image"))
    _save(out, data)
    _sidecar(out, kind="image", provider=provider, model=model, prompt=prompt, aspect=aspect)
    log(f"gen image ({provider}:{model}) -> {out}")
    return out


# ---------------------------------------------------------------- audio (ElevenLabs)

def sfx(prompt: str, out: str | Path, dur: float | None = None, influence: float = 0.5,
        dry_run: bool = False) -> Path | dict:
    body = {"text": prompt, "prompt_influence": influence}
    if dur:
        body["duration_seconds"] = round(float(dur), 2)
    return _eleven("sfx", "https://api.elevenlabs.io/v1/sound-generation", body, out, prompt, dry_run)


def music(prompt: str, out: str | Path, dur: float = 30.0, dry_run: bool = False) -> Path | dict:
    body = {"prompt": prompt, "music_length_ms": int(dur * 1000)}
    return _eleven("music", "https://api.elevenlabs.io/v1/music", body, out, prompt, dry_run)


def voice(text: str, out: str | Path, voice_id: str, model: str = "eleven_multilingual_v2",
          dry_run: bool = False) -> Path | dict:
    body = {"text": text, "model_id": model}
    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_192"
    return _eleven("voice", url, body, out, text, dry_run)


def _eleven(kind, url, body, out, prompt, dry_run):
    provider, _ = pick(kind, "elevenlabs")
    req = {"url": url, "body": body}
    if dry_run:
        return _dry(provider, kind, req)
    out = Path(out)
    _save(out, _http("POST", url, {**_auth(provider), "Accept": "audio/mpeg"}, body, raw=True))
    _sidecar(out, kind=kind, provider=provider, model=body.get("model_id", kind), prompt=prompt)
    log(f"gen {kind} (elevenlabs) -> {out}")
    return out


# ---------------------------------------------------------------- provider plumbing

def _auth(provider: str) -> dict:
    key = key_for(provider)
    if not key:
        raise EditorError(f"{KEYS[provider]} is not set: add it to .env (repo root). Never paste keys into the chat.")
    return {"fal": {"Authorization": f"Key {key}"}, "replicate": {"Authorization": f"Bearer {key}"},
            "openai": {"Authorization": f"Bearer {key}"}, "gemini": {"x-goog-api-key": key},
            "elevenlabs": {"xi-api-key": key}}[provider]


def _run(provider: str, req: dict, kind: str) -> str:
    """Submit a long-running job and return the URL of the finished file."""
    h = _auth(provider)
    if provider == "fal":
        sub = _http("POST", req["url"], h, req["body"])
        log(f"fal: queued {sub.get('request_id')}")
        _poll(lambda: _http("GET", sub["status_url"], h),
              lambda s: True if s.get("status") == "COMPLETED" else _fail_if(s, "status", ("ERROR", "FAILED")),
              "fal")
        res = _http("GET", sub["response_url"], h)
        if kind == "video":
            return (res.get("video") or res.get("videos", [{}])[0])["url"]
        return (res.get("images") or [res.get("image")])[0]["url"]
    if provider == "replicate":
        pred = _http("POST", req["url"], {**h, "Prefer": "wait"}, req["body"])
        pred = _poll(lambda: pred if pred.get("status") in ("succeeded", "failed", "canceled")
                     else _http("GET", pred["urls"]["get"], h),
                     lambda s: s if s.get("status") == "succeeded" else _fail_if(s, "status", ("failed", "canceled")),
                     "replicate")
        outp = pred["output"]
        return outp[0] if isinstance(outp, list) else outp
    op = _http("POST", req["url"], h, req["body"])
    log(f"gemini: started {op.get('name')}")
    op = _poll(lambda: op if op.get("done") else
               _http("GET", f"https://generativelanguage.googleapis.com/v1beta/{op['name']}", h),
               lambda s: s if s.get("done") else None, "gemini")
    if op.get("error"):
        raise EditorError(f"gemini: {op['error'].get('message', op['error'])}")
    resp = op["response"]
    samples = (resp.get("generateVideoResponse") or resp).get("generatedSamples") or resp.get("generatedVideos")
    if not samples:
        raise EditorError(f"gemini: no video in the response (filtered?): {json.dumps(resp)[:400]}")
    return samples[0]["video"]["uri"]


def _fail_if(state: dict, field: str, bad: tuple):
    if state.get(field) in bad:
        raise EditorError(f"generation failed: {json.dumps(_redact(state))[:600]}")
    return None


def _dry(provider, model, req):
    plan = {"provider": provider, "model": model, "POST": req["url"], "body": _redact(req["body"]),
            "key": KEYS[provider], "key_set": bool(key_for(provider))}
    print(json.dumps(plan, indent=1))
    return plan


def _save(out: Path, data: bytes) -> None:
    if not data:
        raise EditorError("the provider returned an empty file")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(data)


def models() -> str:
    lines = ["# AI generation: providers (key in .env -> available)"]
    for p, env in KEYS.items():
        kinds = [k for k, ps in ORDER.items() if p in ps]
        lines.append(f"- {p:<10} {env:<20} {'set' if key_for(p) else 'not set':<8} {', '.join(kinds)}")
    lines.append("# aliases (--model)")
    for a, (k, p, m) in ALIASES.items():
        lines.append(f"- {a:<16} {k:<6} {p}:{m}")
    lines.append("Any other model: --model fal:<id> | replicate:<owner/name> | gemini:<model>, plus --param k=v.")
    return "\n".join(lines)
