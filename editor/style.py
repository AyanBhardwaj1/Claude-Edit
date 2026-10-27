"""Style memory: learn how this user likes videos edited, and use it for first drafts.

Signals, strongest first:
  note     the user said it ("captions bigger", "no vertical version")       weight 3
  change   the user had a draft setting changed before approving it          weight 2
  keep     a draft setting survived to the approved version unchanged        weight 0.5
Every observation decays the older evidence for that key (x0.9), so the profile follows the user's
taste as it moves, slowly. A preference is only applied once it is confident: enough total weight and,
for choices, a clear leader.

Scopes, most specific first: brand:<name> > kind:<reel|launch|...> > global.

Files (committed, so desktop and cloud sessions share them; never store secrets or personal data):
  library/style/profile.json   the learned preferences and the user's taste notes
  library/style/STYLE.md       the same, readable; Claude reads it before drafting

Draft/approve loop:
  editor style snapshot <edl.json|plan.json>   when the first draft is rendered
  editor style learn    <edl.json|plan.json>   when the user approves the final
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
from datetime import date
from pathlib import Path

from .util import EditorError, load_json, log, save_json

ROOT = Path(os.environ.get("CLAUDE_EDIT_STYLE", Path(__file__).resolve().parent.parent / "library" / "style"))
DECAY = 0.9
WEIGHTS = {"note": 3.0, "change": 2.0, "keep": 0.5}
CONFIDENT_WEIGHT = 2.0       # total evidence before a preference is applied
CONFIDENT_SHARE = 0.6        # for choices: the leading option's share of the votes
EVIDENCE_KEPT = 8
BRAND_ONLY = {"launch.theme.dark"}   # brand identity, not a habit: never generalised to other brands

# key -> (type, description). Keys are dotted and prefixed by the kind they belong to.
KEYS = {
    # reels / talking-head edits (EDL "settings" + EDL fields)
    "reel.preset": ("cat", "platform preset (reels, tiktok, shorts, youtube, feed, square)"),
    "reel.speed": ("num", "playback speed"),
    "reel.max_gap": ("num", "longest pause kept, seconds"),
    "reel.fillers": ("cat", "filler cutting: none, standard, aggressive"),
    "reel.captions.style": ("cat", "caption style"),
    "reel.captions.position": ("cat", "caption position"),
    "reel.punch_in": ("num", "jump-cut punch-in scale (1.0 = off)"),
    "reel.zooms_per_min": ("num", "emphasis zooms per minute"),
    "reel.grade": ("cat", "colour grade"),
    "reel.audio_preset": ("cat", "voice mastering preset"),
    "reel.music.db": ("num", "music level under the voice, dB"),
    "reel.sfx": ("cat", "sound effects: auto or none"),
    "reel.progress_bar": ("bool", "progress bar on top"),
    "reel.hook_title": ("bool", "on-screen hook title"),
    "reel.chapters": ("bool", "step pills for numbered videos"),
    # launch videos (launch-video plan.json)
    "launch.format": ("cat", "aspect ratio (16:9, 9:16, 1:1, 4:5)"),
    "launch.variants": ("cat", "how many formats to deliver (one, both)"),
    "launch.style": ("cat", "kinetic or app-ad"),
    "launch.look": ("cat", "default or clean"),
    "launch.voice": ("cat", "voiceover: none or voiced"),
    "launch.music.bpm": ("num", "music tempo"),
    "launch.music.key": ("num", "music transpose (semitones)"),
    "launch.music.gain": ("num", "music level"),
    "launch.mix.sfx": ("num", "sound-effects level"),
    "launch.theme.dark": ("cat", "dark background colour"),
    "launch.theme.accent_use": ("cat", "accent usage: sparing or bold (solid accent scenes)"),
    "launch.text_dur": ("num", "average text-scene length, seconds"),
    "launch.serif_accents": ("bool", "serif-italic accent words (_like this_)"),
    "launch.length": ("num", "total length, seconds"),
}


# ---------------------------------------------------------------- profile store

def _empty() -> dict:
    return {"version": 1, "prefs": {}, "notes": []}


def load() -> dict:
    p = ROOT / "profile.json"
    return load_json(p) if p.exists() else _empty()


def save(profile: dict) -> None:
    save_json(ROOT / "profile.json", profile)
    (ROOT / "STYLE.md").write_text(render_md(profile))


def scopes_for(kind: str | None, brand: str | None) -> list[str]:
    out = []
    if brand:
        out.append(f"brand:{brand.lower()}")
    if kind:
        out.append(f"kind:{kind}")
    out.append("global")
    return out


def observe(profile: dict, scope: str, key: str, value, signal: str, source: str = "") -> None:
    """Fold one observation into the profile (decaying what was there)."""
    if key not in KEYS:
        raise EditorError(f"unknown style key '{key}'. Known: {', '.join(sorted(KEYS))}")
    typ = KEYS[key][0]
    w = WEIGHTS[signal]
    pref = profile["prefs"].setdefault(scope, {}).setdefault(key, {"type": typ})
    if typ in ("cat", "bool"):
        votes = pref.setdefault("votes", {})
        for k in votes:
            votes[k] = round(votes[k] * DECAY, 4)
        v = str(bool(value)).lower() if typ == "bool" else str(value)
        votes[v] = round(votes.get(v, 0.0) + w, 4)
        pref["weight"] = round(sum(votes.values()), 4)
    else:
        value = float(value)
        W = pref.get("weight", 0.0) * DECAY
        mean = pref.get("mean", value)
        pref["mean"] = round((mean * W + value * w) / (W + w), 4)
        pref["weight"] = round(W + w, 4)
    ev = pref.setdefault("evidence", [])
    ev.append({"date": date.today().isoformat(), "value": value, "signal": signal, "source": source})
    del ev[:-EVIDENCE_KEPT]


def value_of(pref: dict):
    """(value, confidence 0..1, confident?) for one stored preference."""
    if pref["type"] in ("cat", "bool"):
        votes = pref.get("votes") or {}
        if not votes:
            return None, 0.0, False
        best, bw = max(votes.items(), key=lambda kv: kv[1])
        total = sum(votes.values()) or 1
        share = bw / total
        conf = min(1.0, total / (CONFIDENT_WEIGHT * 2)) * share
        val = (best == "true") if pref["type"] == "bool" else best
        return val, round(conf, 2), total >= CONFIDENT_WEIGHT and share >= CONFIDENT_SHARE
    if "mean" not in pref:
        return None, 0.0, False
    w = pref.get("weight", 0)
    return pref["mean"], round(min(1.0, w / (CONFIDENT_WEIGHT * 2)), 2), w >= CONFIDENT_WEIGHT


def resolve(key: str, kind: str | None = None, brand: str | None = None, profile: dict | None = None):
    """The confident learned value for key, most specific scope first, else None."""
    profile = profile or load()
    for scope in scopes_for(kind, brand):
        pref = profile["prefs"].get(scope, {}).get(key)
        if pref:
            val, _, ok = value_of(pref)
            if ok:
                return val
    return None


def learned(kind: str | None = None, brand: str | None = None, profile: dict | None = None) -> dict:
    """Every confident preference that applies, resolved across scopes: {key: (value, scope)}."""
    profile = profile or load()
    out = {}
    for scope in reversed(scopes_for(kind, brand)):          # general first, specific overrides
        for key, pref in profile["prefs"].get(scope, {}).items():
            if kind and not key.startswith(kind + "."):
                continue
            val, _, ok = value_of(pref)
            if ok:
                out[key] = (val, scope)
    return out


def notes_for(kind: str | None, brand: str | None, profile: dict | None = None) -> list[dict]:
    profile = profile or load()
    scopes = set(scopes_for(kind, brand))
    return [n for n in profile["notes"] if n["scope"] in scopes]


# ---------------------------------------------------------------- reading settings out of edits

def _launch_settings(plan: dict) -> dict:
    scenes = plan.get("scenes", [])
    texts = [s for s in scenes if s.get("type") == "text"]
    s = {
        "launch.format": plan.get("format", "16:9"),
        "launch.style": plan.get("style", "kinetic"),
        "launch.look": plan.get("look", "default"),
        "launch.voice": "none" if not any(sc.get("vo") for sc in scenes) else "voiced",
        "launch.theme.dark": (plan.get("theme") or {}).get("dark", "#000000"),
        "launch.theme.accent_use": "bold" if any(sc.get("bg") == "accent" for sc in scenes) else "sparing",
        "launch.serif_accents": any("_" in (sc.get("text") or sc.get("vo") or "") for sc in texts),
    }
    music = plan.get("music")
    if isinstance(music, dict) and music.get("synth"):
        for k in ("bpm", "key", "gain"):
            if k in music:
                s[f"launch.music.{k}"] = music[k]
    if isinstance(plan.get("mix"), dict) and "sfx" in plan["mix"]:
        s["launch.mix.sfx"] = plan["mix"]["sfx"]
    durs = [sc["dur"] for sc in texts if "dur" in sc and sc.get("text") != "@brand"]
    if durs:
        s["launch.text_dur"] = round(sum(durs) / len(durs), 2)
    total = sum(sc.get("dur", 0) for sc in scenes)
    if total:
        s["launch.length"] = round(total, 1)
    if "variants" in plan:
        s["launch.variants"] = plan["variants"]
    return s


def _reel_settings(edl: dict) -> dict:
    st = dict(edl.get("settings") or {})
    s = {f"reel.{k}": v for k, v in st.items() if f"reel.{k}" in KEYS}
    if "speed" in edl:
        s["reel.speed"] = edl["speed"]
    if "auto_punch_in" in edl:
        s["reel.punch_in"] = edl["auto_punch_in"]
    dur = (edl.get("stats") or {}).get("output_seconds")
    if dur:
        s["reel.zooms_per_min"] = round(len(edl.get("zooms", [])) / (dur / 60), 2)
    s["reel.sfx"] = "none" if edl.get("sfx") == "none" else "auto"
    s["reel.progress_bar"] = bool(edl.get("progress_bar"))
    s["reel.hook_title"] = bool(edl.get("title"))
    s["reel.chapters"] = bool(edl.get("chapters"))
    if isinstance(edl.get("music"), dict) and "db" in edl["music"]:
        s["reel.music.db"] = edl["music"]["db"]
    return s


def brand_of(doc: dict, kind: str, brand: str | None = None) -> str | None:
    """Brand scope for a document: explicit, then the EDL's "brand", then a launch plan's brand name."""
    if brand:
        return brand
    b = doc.get("brand")
    if isinstance(b, str):
        return b
    if kind == "launch" and isinstance(b, dict):
        return b.get("name")
    return None


def detect(doc: dict) -> tuple[str, dict]:
    if "scenes" in doc:
        return "launch", _launch_settings(doc)
    if "segments" in doc:
        return "reel", _reel_settings(doc)
    raise EditorError("not an edl.json (segments) or a launch plan.json (scenes)")


# ---------------------------------------------------------------- draft / approve loop

def _snap_path(path: Path) -> Path:
    h = hashlib.sha1(str(path.resolve()).encode()).hexdigest()[:10]
    return path.parent / ".style" / f"{path.stem}.{h}.draft.json"


def snapshot(path: str | Path) -> Path:
    path = Path(path)
    dst = _snap_path(path)
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, dst)
    log(f"style: first-draft snapshot -> {dst}")
    return dst


def learn(path: str | Path, brand: str | None = None, source: str | None = None) -> list[str]:
    """Compare the approved file with its first-draft snapshot and fold the differences in."""
    path = Path(path)
    final = load_json(path)
    kind, after = detect(final)
    snap = _snap_path(path)
    before = detect(load_json(snap))[1] if snap.exists() else {}
    brand = brand_of(final, kind, brand)
    profile = load()
    source = source or path.parent.name
    lines = []
    for key, val in after.items():
        changed = key in before and before[key] != val
        signal = "change" if changed else "keep"
        # brand-specific taste goes to the brand scope; plain style habits to the kind scope
        scopes = ([f"brand:{brand.lower()}"] if brand else []) + ([] if key in BRAND_ONLY else [f"kind:{kind}"])
        for scope in scopes:
            observe(profile, scope, key, val, signal, source)
        if changed:
            lines.append(f"{key}: {before[key]} -> {val}")
    save(profile)
    log(f"style: learned from {path.name} ({len(lines)} change(s) from the first draft, "
        f"{len(after) - len(lines)} kept)")
    for ln in lines:
        log(f"  {ln}")
    return lines


def note(text: str, kind: str | None = None, brand: str | None = None, sets: list[str] | None = None,
         source: str = "") -> dict:
    """Record what the user said. `sets` are key=value pairs it implies (weight 3 each)."""
    bad = [kv.partition("=")[0] for kv in sets or [] if kv.partition("=")[0] not in KEYS or "=" not in kv]
    if bad:
        raise EditorError(f"not KEY=VALUE with a known key: {', '.join(bad)} (see: editor style keys)")
    profile = load()
    scope = scopes_for(kind, brand)[0]
    entry = {"id": hashlib.sha1(f"{text}{scope}".encode()).hexdigest()[:8], "text": text, "scope": scope,
             "date": date.today().isoformat(), "source": source}
    if text and not any(n["id"] == entry["id"] for n in profile["notes"]):
        profile["notes"].append(entry)
    for kv in sets or []:
        key, _, raw = kv.partition("=")
        typ = KEYS.get(key, ("cat",))[0]
        val = raw.lower() in ("1", "true", "yes", "on") if typ == "bool" else raw
        observe(profile, scope, key, val, "note", source or "note")
    save(profile)
    return entry


def forget(target: str) -> int:
    """Drop a note (by id) or a learned key (in every scope)."""
    profile = load()
    n0 = len(profile["notes"])
    profile["notes"] = [n for n in profile["notes"] if n["id"] != target]
    removed = n0 - len(profile["notes"])
    for prefs in profile["prefs"].values():
        if target in prefs:
            del prefs[target]
            removed += 1
    save(profile)
    return removed


# ---------------------------------------------------------------- applying to a new draft

APPLY_LAUNCH = {
    "launch.format": ("format",), "launch.style": ("style",), "launch.look": ("look",),
    "launch.music.bpm": ("music", "bpm"), "launch.music.key": ("music", "key"),
    "launch.music.gain": ("music", "gain"), "launch.mix.sfx": ("mix", "sfx"), "launch.theme.dark": ("theme", "dark"),
}


def apply(path: str | Path, brand: str | None = None) -> list[str]:
    """Fill settings the draft doesn't set yet with confident learned values. Never overwrites."""
    path = Path(path)
    doc = load_json(path)
    kind, _ = detect(doc)
    prefs = learned(kind, brand_of(doc, kind, brand))
    done = []
    if kind == "launch":
        for key, where in APPLY_LAUNCH.items():
            if key not in prefs:
                continue
            node = doc
            for part in where[:-1]:
                if not isinstance(node.get(part, {}), dict):   # e.g. "music": false or a file path
                    node = None
                    break
                node = node.setdefault(part, {"synth": True} if part == "music" else {})
            if node is None or where[-1] in node:
                continue
            val = prefs[key][0]
            node[where[-1]] = int(val) if key in ("launch.music.bpm", "launch.music.key") else val
            done.append(f"{key} = {node[where[-1]]} ({prefs[key][1]})")
    else:
        st = doc.setdefault("settings", {})
        for key, (val, scope) in prefs.items():
            short = key[len("reel."):]
            if short in ("speed", "punch_in", "sfx", "progress_bar", "zooms_per_min", "hook_title", "chapters"):
                field = {"speed": "speed", "punch_in": "auto_punch_in", "sfx": "sfx", "progress_bar": "progress_bar"}.get(short)
                if field and field not in doc:
                    doc[field] = val
                    done.append(f"{key} = {val} ({scope})")
            elif short not in st:
                st[short] = val
                done.append(f"{key} = {val} ({scope})")
    if done:
        save_json(path, doc)
    log(f"style: applied {len(done)} learned default(s) to {path.name}")
    for d in done:
        log(f"  {d}")
    return done


def check(path: str | Path, brand: str | None = None) -> list[str]:
    """Where this draft differs from the user's confident preferences (for Claude to reconcile)."""
    doc = load_json(path)
    kind, settings = detect(doc)
    prefs = learned(kind, brand_of(doc, kind, brand))
    out = []
    for key, (val, scope) in prefs.items():
        if key not in settings:
            continue
        cur = settings[key]
        if KEYS[key][0] == "num":
            if abs(float(cur) - float(val)) > max(0.15 * abs(float(val)), 0.05):
                out.append(f"{key}: draft {cur}, usually {round(float(val), 2)} ({scope})")
        elif str(cur).lower() != str(val).lower():
            out.append(f"{key}: draft {cur}, usually {val} ({scope})")
    for ln in out:
        log(f"style: {ln}")
    if not out:
        log("style: draft matches the learned preferences")
    return out


# ---------------------------------------------------------------- readable view

def render_md(profile: dict) -> str:
    lines = ["# Editing style (learned)", "",
             "Read this before drafting. Confident preferences are applied to first drafts automatically",
             "(`editor style apply`, and `editor auto` for any flag you don't pass). Tentative ones are hints.",
             "Update it with `editor style note` (what the user says) and `editor style learn` (what they approve).",
             ""]
    order = sorted(profile["prefs"], key=lambda s: (s != "global", not s.startswith("kind:"), s))
    for scope in order:
        prefs = profile["prefs"][scope]
        if not prefs:
            continue
        lines.append(f"## {scope}")
        for key in sorted(prefs):
            val, conf, ok = value_of(prefs[key])
            if val is None:
                continue
            val = round(val, 2) if isinstance(val, float) else val
            tag = "applied" if ok else "tentative"
            lines.append(f"- `{key}` = **{val}**  ({tag}, confidence {conf:.0%}) — {KEYS.get(key, ('', ''))[1]}")
        lines.append("")
    if profile["notes"]:
        lines.append("## What the user has said")
        for n in profile["notes"]:
            lines.append(f"- [{n['scope']}] {n['text']}  `{n['id']}` ({n['date']})")
        lines.append("")
    return "\n".join(lines)


def show(kind: str | None = None, brand: str | None = None) -> str:
    profile = load()
    prefs = learned(kind, brand, profile)
    lines = [f"# Style for {kind or 'everything'}" + (f" / {brand}" if brand else "")]
    for key, (val, scope) in sorted(prefs.items()):
        lines.append(f"- {key} = {val}  [{scope}]")
    notes = notes_for(kind, brand, profile)
    if notes:
        lines.append("## Notes")
        lines += [f"- [{n['scope']}] {n['text']}" for n in notes]
    if len(lines) == 1:
        lines.append("(nothing learned yet)")
    return "\n".join(lines)
