"""Original music: a sectioned bed, a lo-fi loop and a riser, synthesized from scratch.

Ported from the Walk-Free demo's synth (a 156 s warm electronic bed the user liked) and generalised:
any length, tempo, key, mode and mood; sections on a bar grid anchored on the final chord, so the
chord lands exactly where the edit needs it (an end card) and the groove still falls on downbeats.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

import numpy as np

from ..util import EditorError
from .dsp import SR, add, addp, chorus, delay, filt, mtof, pan, reverb, sidechain, sweep_bp, tt
from .instruments import Kit

# ---------------------------------------------------------------- theory

PC = {"C": 0, "C#": 1, "DB": 1, "D": 2, "D#": 3, "EB": 3, "E": 4, "F": 5, "F#": 6, "GB": 6, "G": 7, "G#": 8,
      "AB": 8, "A": 9, "A#": 10, "BB": 10, "B": 11}
SCALES = {"major": [0, 2, 4, 5, 7, 9, 11], "minor": [0, 2, 3, 5, 7, 8, 10], "harmonic": [0, 2, 3, 5, 7, 8, 11]}

MOODS = {
    # bpm, mode, chord order (indices into CHORDS: I vi IV V, ends on V), pad brightness offset,
    # swing (0 = straight), lo-fi finish, lead melody, four-on-the-floor grooves
    "warm": dict(bpm=100, mode="major", prog=[0, 1, 2, 3], bright=0.0, swing=0.0, lofi=False, lead=True, four=False),
    "uplifting": dict(bpm=112, mode="major", prog=[1, 2, 0, 3], bright=0.15, swing=0.0, lofi=False, lead=True,
                      four=True),
    "tense": dict(bpm=92, mode="harmonic", prog=[0, 0, 1, 3], bright=-0.2, swing=0.0, lofi=False, lead=False,
                  four=False),
    "lofi": dict(bpm=86, mode="major", prog=[0, 1, 2, 3], bright=-0.15, swing=0.62, lofi=True, lead=True, four=False),
}

# Written in D major (as the Walk-Free bed); transposed to the key, mapped into minor modes by degree.
CHORDS = [[50, 54, 57, 61], [47, 54, 57, 62], [55, 59, 62, 66], [52, 57, 61, 64]]  # Dmaj7 Bm7 Gmaj7 A/E
ROOTS = [38, 35, 31, 33]
MOTIF = [(0, 78, 1.5), (1.5, 76, 0.5), (2, 74, 2), (4, 71, 1), (5, 74, 1), (6, 76, 2),
         (8, 78, 1), (9, 81, 1), (10, 78, 1.5), (11.5, 76, 0.5), (12, 74, 3)]  # (beat, note, beats)
FINAL_PAD = [38, 50, 57, 62, 64, 66, 69, 74]
FINAL_KEYS = [62, 66, 69, 73, 76, 81]  # Dmaj9 spread


def parse_key(key: str = "D", mode: str | None = None) -> tuple[int, str]:
    """'D', 'F#', 'Bb', 'Dm', 'D minor' -> (pitch class, mode)."""
    m = re.fullmatch(r"\s*([A-Ga-g])([#b]?)\s*(m|min|minor|maj|major)?\s*", key or "D")
    if not m:
        raise EditorError(f"key '{key}' not understood (e.g. D, F#, Bb, Am)")
    pc = PC[(m.group(1) + m.group(2)).upper()]
    implied = {"m": "minor", "min": "minor", "minor": "minor", "maj": "major", "major": "major"}.get(m.group(3) or "")
    mode = mode or implied
    if mode and mode not in SCALES:
        raise EditorError(f"mode must be one of {list(SCALES)}")
    return pc, mode or ""


def _shift(pc: int, ref: int) -> int:
    d = (pc - ref) % 12
    return d - 12 if d > 6 else d


def to_mode(note: int, tonic: int, mode: str) -> int:
    """Map a note written in `tonic` major onto the same scale degree of `mode`."""
    if mode == "major":
        return note
    octave, rel = divmod(note - tonic, 12)
    if rel not in SCALES["major"]:
        return note
    return tonic + 12 * octave + SCALES[mode][SCALES["major"].index(rel)]


class Harmony:
    def __init__(self, written_tonic: int, key: str, mode: str):
        self.tonic, self.mode = written_tonic, mode
        pc, _ = parse_key(key)
        self.shift = _shift(pc, written_tonic % 12)

    def __call__(self, notes):
        return [to_mode(m, self.tonic, self.mode) + self.shift for m in notes]


# ---------------------------------------------------------------- structure

SECTION_NAMES = ["intro", "groove", "fill", "groove2", "lead", "build", "peak", "breakdown", "resolve"]
ALIASES = {"a": "groove", "verse": "groove", "b": "groove2", "a2": "lead", "brk": "breakdown", "drop": "peak",
           "res": "resolve", "outro": "resolve", "chorus": "peak", "bridge": "breakdown"}
# (minimum bars, [(section, weight in bars)]): shaped on the Walk-Free bed, scaled to the length
TEMPLATES = [
    (40, [("intro", 4), ("groove", 13), ("fill", 1), ("groove2", 9), ("lead", 11), ("build", 4), ("peak", 5),
          ("breakdown", 5), ("resolve", 9)]),
    (20, [("intro", 3), ("groove", 7), ("fill", 1), ("build", 3), ("peak", 5), ("breakdown", 3), ("resolve", 5)]),
    (10, [("intro", 2), ("groove", 4), ("build", 2), ("peak", 3), ("resolve", 3)]),
    (5, [("intro", 1), ("groove", 2), ("peak", 2), ("resolve", 2)]),
    (3, [("intro", 1), ("groove", 1), ("resolve", 1)]),
    (2, [("intro", 1), ("resolve", 1)]),
    (0, [("resolve", 1)]),
]
FIXED = {"fill": 1}


def grid_offset(end_chord_at: float, unit: float) -> float:
    """The grid is anchored on the final chord: downbeats at offset + k * unit."""
    off = end_chord_at % unit
    return 0.0 if off < 1e-3 or unit - off < 1e-3 else off


def auto_sections(end_chord_at: float, bar: float) -> list[dict]:
    off = grid_offset(end_chord_at, bar)
    partial = 1 if off >= 0.5 * bar else 0  # a half-bar or more before the first downbeat counts as a bar
    n = int(round((end_chord_at - off) / bar)) + partial
    tmpl = next(t for need, t in TEMPLATES if n >= need)
    if n == 0:
        return [{"name": "intro", "at": 0.0}]
    flex = [(s, w) for s, w in tmpl if s not in FIXED]
    room = n - sum(FIXED.get(s, 0) for s, _ in tmpl)
    total = sum(w for _, w in flex)
    raw = {s: max(1.0, w * room / total) for s, w in flex}
    bars = {s: int(np.floor(v)) for s, v in raw.items()}
    for s in sorted(raw, key=lambda s: raw[s] - bars[s], reverse=True):  # largest remainder
        if sum(bars.values()) >= room:
            break
        bars[s] += 1
    while sum(bars.values()) > room:  # tiny lengths: trim the biggest
        big = max(bars, key=bars.get)
        bars[big] -= 1
    out, k = [], -partial
    for s, _ in tmpl:
        b = FIXED.get(s, bars.get(s, 0))
        if b <= 0:
            continue
        out.append({"name": s, "at": 0.0 if not out else round(off + k * bar, 4)})
        k += b
    return out


def snap_sections(sections, end_chord_at: float, bar: float, beat: float, snap: str = "bar") -> list[dict]:
    """Explicit sections ([{"at": 10.8, "name": "groove"}, ...]) snapped to the grid; first one at 0."""
    unit = {"bar": bar, "beat": beat, "none": None}.get(snap, bar)
    out = []
    for s in sections:
        name = str(s["name"]).lower()
        name = ALIASES.get(name, name)
        if name not in SECTION_NAMES:
            raise EditorError(f"unknown section '{s['name']}' (use {', '.join(SECTION_NAMES)})")
        at = float(s["at"])
        if unit:
            off = grid_offset(end_chord_at, unit)
            at = off + round((at - off) / unit) * unit
        if at >= end_chord_at - 1e-6:
            continue
        out.append({"name": name, "at": round(max(at, 0.0), 4)})
    out.sort(key=lambda s: s["at"])
    dedup = []
    for s in out:
        if dedup and abs(dedup[-1]["at"] - s["at"]) < 1e-6:
            dedup[-1] = s
        else:
            dedup.append(s)
    if not dedup:
        raise EditorError("no sections before the final chord")
    dedup[0]["at"] = 0.0
    return dedup


def parse_sections(text: str) -> list[dict]:
    """CLI form: JSON list, a .json file, or 'intro@0,groove@10.8,build@94.2'."""
    import json
    from pathlib import Path
    text = text.strip()
    if text.endswith(".json") and Path(text).exists():
        text = Path(text).read_text()
    if text.startswith("["):
        return json.loads(text)
    out = []
    for part in text.split(","):
        name, _, at = part.strip().partition("@")
        if not at:
            raise EditorError(f"section '{part}' needs name@seconds")
        out.append({"name": name.strip(), "at": float(at)})
    return out


# ---------------------------------------------------------------- the bed

BRIGHT = {"intro": (0.05, 0.3), "groove": (0.3, 0.3), "fill": (0.3, 0.45), "groove2": (0.45, 0.4),
          "lead": (0.4, 0.4), "build": (0.4, 1.0), "peak": (1.0, 1.0), "breakdown": (1.0, 0.55),
          "resolve": (0.55, 0.75)}
PAD_GAIN = {"intro": (0.5, 0.38), "groove": (0.38, 0.38), "fill": (0.38, 0.38), "groove2": (0.38, 0.38),
            "lead": (0.38, 0.38), "build": (0.38, 0.5), "peak": (0.5, 0.48), "breakdown": (0.48, 0.4),
            "resolve": (0.4, 0.45)}
GROOVES = ("groove", "groove2", "lead", "build", "peak", "resolve")
SECTION_CRASH = {"groove": 0.15, "groove2": 0.25, "peak": 0.4, "resolve": 0.22}


def plan(length: float, bpm: float | None = None, mood: str = "warm", sections=None, end_chord_at: float | None = None,
         ring: float | None = None, snap: str = "bar") -> dict:
    """Timing only (cheap): tempo, grid, sections with start/end/bars, the final chord time."""
    if mood not in MOODS:
        raise EditorError(f"mood must be one of {list(MOODS)}")
    bpm = float(bpm or MOODS[mood]["bpm"])
    beat, bar = 60.0 / bpm, 240.0 / bpm
    if end_chord_at is None:
        ring = float(np.clip(0.25 * length, 1.5, 6.0)) if ring is None else float(ring)
        end_chord_at = length - ring
    end_chord_at = float(end_chord_at)
    ring = length - end_chord_at
    if not 0 < end_chord_at < length - 0.3:
        raise EditorError(f"the final chord ({end_chord_at:.2f} s) must land inside the bed and >= 0.3 s "
                          f"before its end ({length:.2f} s)")
    secs = snap_sections(sections, end_chord_at, bar, beat, snap) if sections else auto_sections(end_chord_at, bar)
    for i, s in enumerate(secs):
        s["end"] = round(secs[i + 1]["at"] if i + 1 < len(secs) else end_chord_at, 4)
        s["bars"] = round((s["end"] - s["at"]) / bar, 2)
    return {"bpm": bpm, "beat": beat, "bar": bar, "grid_offset": round(grid_offset(end_chord_at, bar), 4),
            "end_chord_at": round(end_chord_at, 4), "ring": round(ring, 4), "length": length, "sections": secs}


def bed(length: float, bpm: float | None = None, key: str = "D", mode: str | None = None, mood: str = "warm",
        sections=None, seed: int = 7, end_chord_at: float | None = None, ring: float | None = None,
        snap: str = "bar") -> tuple[np.ndarray, dict]:
    """Synthesize the bed. Returns (stereo mix before mastering, plan)."""
    P = plan(length, bpm, mood, sections, end_chord_at, ring, snap)
    M = MOODS[mood]
    _, key_mode = parse_key(key)
    mode = mode or key_mode or M["mode"]
    H = Harmony(38, key, mode)
    kit = Kit(seed)
    BEAT, BAR, END, RING = P["beat"], P["bar"], P["end_chord_at"], P["ring"]
    N = int(round(length * SR))
    secs = P["sections"]
    starts = np.array([s["at"] for s in secs])

    def sec_of(t: float) -> dict:
        return secs[max(0, int(np.searchsorted(starts, t, side="right")) - 1)]

    sw = M["swing"]

    def swing(o: float) -> float:  # o in beats; swings 8ths (and 16ths proportionally)
        if not sw:
            return o * BEAT
        w, f = divmod(o, 1)
        f = f / 0.5 * sw if f < 0.5 else sw + (f - 0.5) / 0.5 * (1 - sw)
        return (w + f) * BEAT

    off = P["grid_offset"]
    n_bars = int(round((END - off) / BAR))
    chords = [H(c) for c in CHORDS]
    roots = [H([r])[0] for r in ROOTS]
    prog = M["prog"]

    drums, keys, pads, arp, ld, fx = (np.zeros((N, 2)) for _ in range(6))
    bass = np.zeros(N)
    kicks, ghosts = [], []

    k0 = -4 if off > 0 else 0  # the partial bar before the first downbeat (sounds clipped at 0)
    k1 = int(round((END - off) / BEAT))
    for k in range(k0, k1):
        t0 = off + k * BEAT
        S = sec_of(max(t0, 0.0))
        s = S["name"]
        pos, bi = k % 4, k // 4
        c = prog[(bi - n_bars) % 4]  # aligned so the bar before the final chord is the V
        groove = s in GROOVES
        # kick
        kt = []
        if s in ("groove", "lead", "resolve"):
            kt = [0, 2.5] if pos == 1 else ([0] if pos in (0, 2) else [])
        if s == "groove2":
            kt = {0: [0], 1: [0.5], 2: [0], 3: [0.75]}[pos]
        if s in ("build", "peak"):
            kt = [0] + ([0.75] if s == "peak" and pos == 3 else [])
        if M["four"] and s in ("groove", "groove2", "lead", "resolve"):
            kt = [0] + ([0.75] if pos == 3 and s != "resolve" else [])
        if s == "fill" and pos == 0:
            kt = [0]
        for o in kt:
            tk = t0 + swing(o)
            addp(drums, kit.kick((1.0 if o == 0 else 0.7) * (1.1 if s == "peak" else 1.0)), tk, 0)
            kicks.append(tk)
        if s in ("intro", "breakdown"):
            ghosts.append(t0)
        # snare + clap on 2 and 4 (the build's last bars are a roll instead)
        roll_from = S["end"] - (2 if S["bars"] >= 3 else 1) * BAR
        if groove and pos in (1, 3) and not (s == "build" and t0 >= roll_from - 1e-6):
            addp(drums, kit.snare(0.42 if s == "peak" else 0.32), t0, 0.05)
            if s in ("groove2", "peak", "build") or (M["four"] and s != "resolve"):
                addp(drums, kit.clap(0.25), t0 + 0.004, -0.1)
        # hats
        if groove or s == "breakdown":
            sub_n = 4 if s in ("groove2", "build", "peak") else 2
            for j in range(sub_n):
                if s == "breakdown" and j != 1:
                    continue
                o = j / sub_n
                v = (0.16 if o in (0, 0.5) else 0.10) * (1.25 if s == "peak" else 1) * (0.8 if s == "resolve" else 1)
                addp(drums, kit.hat(v), t0 + swing(o), 0.3)
            if s in ("groove2", "peak") and pos == 3:
                addp(drums, kit.hat(0.12, 0.14), t0 + swing(0.5), 0.35)
        # sub bass
        if groove and pos == 0:
            r = mtof(roots[c])
            for o, L in ((0, 1.4), (1.5, 0.45), (2, 1.9)):
                add(bass, kit.sub(r, L * BEAT, 0.9 if s == "peak" else 0.75), t0 + swing(o))
        # Rhodes comping
        if s != "intro" and pos == 0:
            vel = {"breakdown": 0.45, "resolve": 0.6, "peak": 0.7}.get(s, 0.55)
            hits = ((0, 3.6, 1.0),) if s == "breakdown" else ((0, 1.3, 1.0), (1.5, 0.35, 0.7), (2.5, 1.3, 0.85))
            notes = chords[c] + ([chords[c][-1] + 12] if s == "resolve" else [])
            for o, L, a in hits:
                for j, m in enumerate(notes):
                    addp(keys, kit.rhodes(mtof(m), L * BEAT, vel * a), t0 + swing(o) + j * 0.006, -0.4 + 0.25 * j)
        # pad: one per bar
        if pos == 0:
            add(pads, kit.saw_pad(chords[c] + [chords[c][0] - 12], BAR, att=0.5, rel=0.9), t0)
        # 16th arpeggio
        if s in ("groove2", "build", "peak", "breakdown", "resolve") or (s == "lead" and not M["lead"]):
            tones = [m + 12 for m in chords[c]]
            pat = [0, 1, 2, 3, 2, 1, 3, 2]
            for j in range(4):
                if s == "resolve" and j % 2:
                    continue
                idx = pat[(pos * 2 + j) % 8] if s == "breakdown" else pat[(pos * 4 + j) % 8]
                v = {"groove2": 0.22, "lead": 0.22, "build": 0.24, "peak": 0.27, "breakdown": 0.25,
                     "resolve": 0.18}[s]
                addp(arp, kit.pluck(mtof(tones[idx]), 0.35, 0.11), t0 + swing(j / 4), 0.5 if j % 2 else -0.5, v)
        # intro pulse: soft 8th plucks on tonic and fifth
        if s == "intro":
            for j, m in enumerate(H([62, 69])):
                addp(arp, kit.pluck(mtof(m), 0.4, 0.15, 0.2), t0 + swing(j / 2), 0.2 - 0.4 * j, 0.14)

    # lead motif (4 bars, looped) over lead / peak / resolve
    if M["lead"]:
        motif = [(o, H([m])[0], L) for o, m, L in MOTIF]
        for S in secs:
            if S["name"] not in ("lead", "peak", "resolve"):
                continue
            end = S["end"] - (2 * BEAT if S["name"] == "resolve" else 0)
            v = {"lead": 0.22, "peak": 0.24, "resolve": 0.2}[S["name"]]
            p0 = S["at"]
            while p0 < end - 1:
                for o, m, L in motif:
                    tn = p0 + o * BEAT
                    if tn + L * BEAT > end:
                        break
                    addp(ld, kit.lead(mtof(m), L * BEAT * 0.95, v), tn, 0.1)
                p0 += 4 * BAR

    # fills, swells, rolls, crashes at section changes
    for i, S in enumerate(secs):
        s, a, e = S["name"], S["at"], S["end"]
        if s == "fill":
            n16 = int(round((e - a) / (BEAT / 4)))
            for j in range(n16):
                addp(drums, kit.snare(0.12 + 0.36 * j / max(n16 - 1, 1)), a + j * BEAT / 4, 0.1)
            add(fx, kit.swell(e - a, 400, 7000, 0.25), a)
        if s == "build":
            rb = 2 if S["bars"] >= 3 else 1
            r0 = e - rb * BAR
            for j in range(16 * rb):
                tk = r0 + j * BEAT / 4
                addp(drums, kit.snare(0.08 + 0.38 * j / (16 * rb)), tk, 0.0)
                if j >= 16 * (rb - 1):  # last bar doubles to 32nds
                    addp(drums, kit.snare(0.05 + 0.3 * j / (16 * rb)), tk + BEAT / 8, 0.0)
            add(fx, kit.swell(e - a, 200, 9000, 0.3), a)
        if i and s in SECTION_CRASH:
            add(drums, kit.crash(SECTION_CRASH[s]), a)

    # final tonic chord, ringing out
    add(pads, kit.saw_pad(H(FINAL_PAD), min(3.0, 0.5 * RING), att=0.05, rel=min(2.5, 0.42 * RING)) * 1.3, END)
    for j, m in enumerate(H(FINAL_KEYS)):
        addp(keys, kit.rhodes(mtof(m), min(4.5, 0.75 * RING), 0.75), END + j * 0.012, -0.5 + 0.2 * j)
    add(bass, kit.sub(mtof(roots[0]), min(3.5, 0.58 * RING), 0.85), END)
    addp(drums, kit.kick(1.0, 0.5), END, 0)
    add(drums, kit.crash(0.3, min(2.0, RING / 3)), END)

    t = tt(N)
    # pads: dark/bright filter crossfade per section (opens in the build) + sidechain + chorus
    bx, by, gy = [], [], []
    for S in secs:
        b0, b1 = BRIGHT[S["name"]]
        g0, g1 = PAD_GAIN[S["name"]]
        bx += [S["at"], max(S["at"], S["end"] - 0.05)]
        by += [b0, b1]
        gy += [g0, g1]
    bx += [END, length]
    by += [0.75, 0.8]
    gy += [0.45, 0.45]
    duck = np.minimum(sidechain(N, kicks, 0.55), sidechain(N, ghosts, 0.25, 0.25))
    res_at = next((S["at"] for S in secs if S["name"] == "resolve"), END)

    def pad_chain():
        bright = np.clip(np.interp(t, bx, by) + M["bright"], 0.0, 1.0)[:, None]
        y = filt(pads, 700, "low", 2) * (1 - bright) + filt(pads, 3200, "low", 2) * bright
        return chorus(y, 0.3, 0.002, 0.01, 0.4) * (np.interp(t, bx, gy) * duck)[:, None]

    def keys_chain():  # auto-pan tremolo (4 per bar) + chorus, lifting a little into the end
        trem = 0.18 * np.sin(2 * np.pi * 4.0 / BAR * t)
        y = np.stack([keys[:, 0] * (1 + trem), keys[:, 1] * (1 - trem)], 1)
        y = chorus(filt(y, 120, "high", 1), 0.7, 0.0015, 0.008, 0.35) * 0.2
        return y * np.interp(t, [0, res_at, END], [1.0, 1.0, 1.15])[:, None]

    def drums_chain():
        y = filt(drums, 30, "high", 2) * 0.55
        return filt(np.tanh(2.0 * y), 7000, "low", 2) * 0.3 if M["lofi"] else y

    with ThreadPoolExecutor(4) as ex:  # independent stems in parallel (numpy/scipy release the GIL)
        jobs = [ex.submit(pad_chain), ex.submit(keys_chain), ex.submit(drums_chain),
                ex.submit(lambda: (arp + delay(arp, 0.75 * BEAT, 0.35, 4, 3500)) * duck[:, None]),
                ex.submit(lambda: ld + delay(ld, 1.5 * BEAT, 0.3, 3, 3000)),
                ex.submit(lambda: filt(bass * np.minimum(duck + 0.25, 1), 220, "low", 2) * 0.45)]
        pads, keys, drums, arp, ld, bass = (j.result() for j in jobs)
    music = pads + keys + arp * 0.9 + ld * 0.8 + fx
    music = music - 0.25 * filt(music, [900, 3000], "band", 1)  # leave room for the voice
    mix = music + pan(bass, 0) + drums
    mix = mix + 0.3 * reverb(pads * 0.6 + keys + arp + ld + drums * 0.15 + fx, 2.6)
    if M["lofi"]:
        mix = _lofi_finish(mix, kit)
    # ring out, silent at the very end
    silent = min(0.2, max(0.05, 0.033 * RING))
    a, b = int((END + 0.42 * RING) * SR), int((length - silent) * SR)
    fade = np.ones(N)
    fade[a:b] = 0.5 * (1 + np.cos(np.linspace(0, np.pi, max(b - a, 0))))
    fade[b:] = 0
    fade[:240] *= np.linspace(0, 1, 240)
    P.update({"key": key, "mode": mode, "mood": mood, "seed": seed, "silent_from": round(length - silent, 4)})
    return mix * fade[:, None], P


def _lofi_finish(mix: np.ndarray, kit: Kit, crackle_per_s: float = 45) -> np.ndarray:
    """Tape wow, a 9.5 kHz roll-off and vinyl (crackle + hiss)."""
    N = len(mix)
    rng = kit.rng
    cr = np.zeros(N)
    k = max(1, int(crackle_per_s * N / SR))
    cr[rng.integers(0, N, k)] = rng.standard_normal(k) * rng.uniform(0.2, 1, k) ** 3
    cr = filt(cr, [1500, 9000], "band", 1) * 0.5 + filt(rng.standard_normal(N), [3000, 8000], "band", 1) * 0.006
    mix = chorus(mix, 0.45, 0.0012, 0.004, 1.0)
    return filt(mix, 9500, "low", 2) + pan(cr, 0)


# ---------------------------------------------------------------- lo-fi loop

LOFI_CHORDS = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]]  # Fmaj7 Em7 Dm7 Cmaj7 (C)
LOFI_ROOTS = [41, 40, 38, 36]
LOFI_MELODY = [[(0.5, 77), (1.0, 79), (1.5, 81), (3.0, 84), (3.5, 81)], [(0.5, 76), (1.5, 79), (2.0, 74), (3.5, 72)],
               [(0.5, 77), (1.0, 81), (2.5, 79), (3.0, 77)], [(1.0, 76), (1.5, 74), (2.0, 72), (3.0, 67)]]


def lofi(length: float = 20.0, bpm: float = 86, key: str = "C", mode: str | None = None, seed: int = 7,
         swing: float = 0.62) -> tuple[np.ndarray, dict]:
    """Lo-fi loop: Rhodes IV-iii-ii-I, swung drums, sub, a pluck melody, vinyl crackle and tape wow."""
    _, key_mode = parse_key(key)
    mode = mode or key_mode or "major"
    H = Harmony(36, key, mode)
    kit = Kit(seed)
    rng = kit.rng
    BEAT = 60.0 / bpm
    BAR = 4 * BEAT
    N = int(round(length * SR))
    drums, keys, mel = (np.zeros((N, 2)) for _ in range(3))
    bass = np.zeros(N)
    kicks = []

    def sw(o: float) -> float:
        return (np.floor(o) + (swing if abs(o % 1 - 0.5) < 1e-6 else o % 1)) * BEAT

    chords = [H(c) for c in LOFI_CHORDS]
    roots = H(LOFI_ROOTS)
    melody = [[(o, H([m])[0]) for o, m in bar] for bar in LOFI_MELODY]
    for b in range(int(np.ceil(length / BAR))):
        t0 = b * BAR
        c = b % 4
        for o in (0, 1.5 if b % 2 else 2.5, 2.5 if b % 2 else 2.75):
            addp(drums, kit.kick(0.9, 0.22), t0 + sw(o), 0)
            kicks.append(t0 + sw(o))
        for o in (1, 3):
            addp(drums, kit.snare(0.45), t0 + o * BEAT + 0.01, 0.05)
        for j in range(8):
            v = (0.13 if j % 2 == 0 else 0.08) * rng.uniform(0.8, 1.1)
            addp(drums, kit.hat(v, 0.025), t0 + sw(j / 2), 0.25)
        for o, L, a in ((0, 1.3, 1.0), (1.5, 0.4, 0.75), (3.0, 0.9, 0.85)):
            for j, m in enumerate(chords[c]):
                addp(keys, kit.rhodes(mtof(m), L * BEAT, 0.55 * a), t0 + sw(o) + j * 0.008, -0.35 + 0.23 * j)
        for o, L in ((0, 1.4), (2, 0.4), (2.5, 1.3)):
            add(bass, kit.sub(mtof(roots[c]), L * BEAT, 0.8), t0 + sw(o))
        for o, m in melody[c]:
            addp(mel, kit.pluck(mtof(m), 0.45, 0.16, 0.5), t0 + sw(o), 0.25, 0.3)
    t = tt(N)
    trem = 0.15 * np.sin(2 * np.pi * 3.0 * t)
    keys = np.stack([keys[:, 0] * (1 + trem), keys[:, 1] * (1 - trem)], 1) * 0.22
    mel = mel + delay(mel, BEAT * 0.75, 0.35, 3, 2500)
    music = (keys + mel) * sidechain(N, kicks, 0.35, 0.15)[:, None]
    drums = filt(np.tanh(2.0 * drums) * 0.5, 7000, "low", 2)
    mix = music + pan(filt(bass, 200, "low", 2) * 0.4, 0) + drums
    mix = mix + 0.22 * reverb(music + drums * 0.1, 1.6, bright=4000)
    mix = _lofi_finish(mix, kit, crackle_per_s=45)
    fade = np.ones(N)
    k = min(int(0.3 * SR), N // 4)
    fade[-k:] = np.linspace(1, 0, k)
    fade[:240] = np.linspace(0, 1, 240)
    return mix * fade[:, None], {"bpm": bpm, "beat": BEAT, "bar": BAR, "key": key, "mode": mode, "seed": seed,
                                 "swing": swing, "length": length}


# ---------------------------------------------------------------- riser

def riser(length: float = 2.0, seed: int = 7, hit: bool = True) -> tuple[np.ndarray, dict]:
    """Noise + tone rising for (length - 0.2) s, then a soft hit on the downbeat at length - 0.2."""
    kit = Kit(seed)
    rng = kit.rng
    N = int(round(length * SR))
    t = tt(N)
    rise = max(length - 0.2, 0.2) if hit else length
    nz = sweep_bp(rng.standard_normal(N), 300 * 30 ** np.minimum(t / rise, 1), 2.0)
    tone = np.sin(2 * np.pi * np.cumsum(150 * 8 ** np.minimum(t / rise, 1)) / SR) * 0.3
    env = np.clip(t / rise, 0, 1) ** 2.2 * (t < rise)
    x = pan((nz + tone) * env, 0)
    x[:, 0] *= 1 + 0.3 * np.sin(2 * np.pi * 3 * t)
    x[:, 1] *= 1 - 0.3 * np.sin(2 * np.pi * 3 * t)
    if hit:
        n = int(0.2 * SR)
        hn = filt(rng.standard_normal((n, 2)), 2000, "low", 1) * np.exp(-tt(n) / 0.05)[:, None] * 0.6
        add(x, pan(kit.kick(0.9, 0.12)[:n], 0) * 1.2 + hn, rise)
    x = x + 0.25 * reverb(x, 1.2)
    k = int(0.05 * SR)
    x[-k:] *= np.linspace(1, 0, k)[:, None]
    return x, {"length": length, "hit_at": round(rise, 4) if hit else None, "seed": seed}
