// "Make music": an original, royalty-free music bed composed in the browser, fitted to the video. No key, no network.
// A port of the desktop composer (editor/compose/music.py): four moods, any key and mode, sections on a bar grid
// (intro, groove, build, peak, breakdown, resolve) anchored on the final chord so it lands exactly where asked,
// an FM electric piano, detuned saw pads, sub bass, soft drums, sidechain pumping, reverb and a dip at 1-3 kHz that
// leaves room for the voice. The plan and the score are pure (tested in node); renderBed() plays the score through
// OfflineAudioContexts (the parts as stems in parallel, then a mix pass with the reverb, glue and fade), normalises to
// about -16 LUFS with a -1.5 dBFS peak ceiling (lib/loudness.ts) and writes a WAV. A 60 s bed renders in about 3 s.

import { normalise } from "./loudness";
import { wav } from "./media";

// ---------------------------------------------------------------- theory

export type Mood = "warm" | "uplifting" | "tense" | "lofi";
export type Mode = "major" | "minor" | "harmonic";

export const SCALES: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11] };

type MoodSpec = { name: string; line: string; bpm: number; mode: Mode; prog: number[]; bright: number; swing: number;
  lofi: boolean; lead: boolean; four: boolean };

/** Chord order indexes CHORDS (I vi IV V written in D; every progression ends on the V before the final chord). */
export const MOODS: Record<Mood, MoodSpec> = {
  warm: { name: "Warm", line: "Electric piano and soft drums", bpm: 100, mode: "major", prog: [0, 1, 2, 3], bright: 0, swing: 0, lofi: false, lead: true, four: false },
  uplifting: { name: "Uplifting", line: "Brighter, four on the floor", bpm: 112, mode: "major", prog: [1, 2, 0, 3], bright: 0.15, swing: 0, lofi: false, lead: true, four: true },
  tense: { name: "Tense", line: "Dark, minor, no melody", bpm: 92, mode: "harmonic", prog: [0, 0, 1, 3], bright: -0.2, swing: 0, lofi: false, lead: false, four: false },
  lofi: { name: "Lo-fi", line: "Swung, dusty, vinyl crackle", bpm: 86, mode: "major", prog: [0, 1, 2, 3], bright: -0.15, swing: 0.62, lofi: true, lead: true, four: false },
};
export const MOOD_IDS = Object.keys(MOODS) as Mood[];

const PC: Record<string, number> = { C: 0, "C#": 1, DB: 1, D: 2, "D#": 3, EB: 3, E: 4, F: 5, "F#": 6, GB: 6, G: 7, "G#": 8,
  AB: 8, A: 9, "A#": 10, BB: 10, B: 11 };
/** The keys offered in the UI: 12 major and 12 minor ("Am"). */
export const KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const KEYS = [...KEY_NAMES, ...KEY_NAMES.map((k) => k + "m")];

const CHORDS = [[50, 54, 57, 61], [47, 54, 57, 62], [55, 59, 62, 66], [52, 57, 61, 64]];   // Dmaj7 Bm7 Gmaj7 A/E
const ROOTS = [38, 35, 31, 33];
const MOTIF: [number, number, number][] = [[0, 78, 1.5], [1.5, 76, 0.5], [2, 74, 2], [4, 71, 1], [5, 74, 1], [6, 76, 2],
  [8, 78, 1], [9, 81, 1], [10, 78, 1.5], [11.5, 76, 0.5], [12, 74, 3]];                 // (beat, note, beats)
const FINAL_PAD = [38, 50, 57, 62, 64, 66, 69, 74];
const FINAL_KEYS = [62, 66, 69, 73, 76, 81];                                              // Dmaj9 spread
const WRITTEN_TONIC = 38;                                                                 // everything above is written in D

export const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** "D", "F#", "Bb", "Dm", "D minor" -> pitch class and the mode it names ("" when it names none). */
export function parseKey(key = "D"): { pc: number; mode: Mode | "" } {
  const m = /^\s*([A-Ga-g])([#b]?)\s*(m|min|minor|maj|major)?\s*$/.exec(key);
  if (!m) throw new Error(`key "${key}" not understood (e.g. D, F#, Bb, Am)`);
  const pc = PC[(m[1] + m[2]).toUpperCase()];
  const mode = ({ m: "minor", min: "minor", minor: "minor", maj: "major", major: "major" } as Record<string, Mode>)[m[3] ?? ""] ?? "";
  return { pc, mode };
}

/** Map a note written in `tonic` major onto the same scale degree of `mode`. */
export function toMode(note: number, tonic: number, mode: Mode): number {
  if (mode === "major") return note;
  const octave = Math.floor((note - tonic) / 12), rel = mod(note - tonic, 12);
  const deg = SCALES.major.indexOf(rel);
  return deg < 0 ? note : tonic + 12 * octave + SCALES[mode][deg];
}

/** Transposes notes written in D into the key, then into the mode, degree by degree. */
export function harmony(key: string, mode: Mode): (notes: number[]) => number[] {
  const d = mod(parseKey(key).pc - (WRITTEN_TONIC % 12), 12);
  const shift = d > 6 ? d - 12 : d;
  return (notes) => notes.map((n) => toMode(n, WRITTEN_TONIC, mode) + shift);
}

export function modeOf(mood: Mood, key: string, mode?: Mode): Mode {
  return mode || parseKey(key).mode || MOODS[mood].mode;
}

/** The four chords and bass roots in the mood's order, in the key and mode (the last is the V into the final chord). */
export function progression(mood: Mood, key: string, mode?: Mode): { chords: number[][]; roots: number[]; mode: Mode } {
  const md = modeOf(mood, key, mode);
  const H = harmony(key, md);
  return { chords: MOODS[mood].prog.map((c) => H(CHORDS[c])), roots: MOODS[mood].prog.map((c) => H([ROOTS[c]])[0]), mode: md };
}

// ---------------------------------------------------------------- structure

export type SectionName = "intro" | "groove" | "fill" | "groove2" | "lead" | "build" | "peak" | "breakdown" | "resolve";
export type Section = { name: SectionName; at: number; end: number; bars: number };

const TEMPLATES: [number, [SectionName, number][]][] = [
  [40, [["intro", 4], ["groove", 13], ["fill", 1], ["groove2", 9], ["lead", 11], ["build", 4], ["peak", 5], ["breakdown", 5], ["resolve", 9]]],
  [20, [["intro", 3], ["groove", 7], ["fill", 1], ["build", 3], ["peak", 5], ["breakdown", 3], ["resolve", 5]]],
  [10, [["intro", 2], ["groove", 4], ["build", 2], ["peak", 3], ["resolve", 3]]],
  [5, [["intro", 1], ["groove", 2], ["peak", 2], ["resolve", 2]]],
  [3, [["intro", 1], ["groove", 1], ["resolve", 1]]],
  [2, [["intro", 1], ["resolve", 1]]],
  [0, [["resolve", 1]]],
];
const FIXED: Partial<Record<SectionName, number>> = { fill: 1 };
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/** The grid is anchored on the final chord: downbeats at offset + k * unit. */
export function gridOffset(endChordAt: number, unit: number): number {
  const off = mod(endChordAt, unit);
  return off < 1e-3 || unit - off < 1e-3 ? 0 : off;
}

export function autoSections(endChordAt: number, bar: number): { name: SectionName; at: number }[] {
  const off = gridOffset(endChordAt, bar);
  const partial = off >= 0.5 * bar ? 1 : 0;          // half a bar or more before the first downbeat counts as a bar
  const n = Math.round((endChordAt - off) / bar) + partial;
  if (n === 0) return [{ name: "intro", at: 0 }];
  const tmpl = TEMPLATES.find(([need]) => n >= need)![1];
  const flex = tmpl.filter(([s]) => FIXED[s] === undefined);
  const room = n - tmpl.reduce((a, [s]) => a + (FIXED[s] ?? 0), 0);
  const total = flex.reduce((a, [, w]) => a + w, 0);
  const raw = new Map(flex.map(([s, w]) => [s, Math.max(1, (w * room) / total)]));
  const bars = new Map([...raw].map(([s, v]) => [s, Math.floor(v)]));
  const sum = () => [...bars.values()].reduce((a, b) => a + b, 0);
  for (const s of [...raw.keys()].sort((a, b) => (raw.get(b)! - bars.get(b)!) - (raw.get(a)! - bars.get(a)!))) {   // largest remainder
    if (sum() >= room) break;
    bars.set(s, bars.get(s)! + 1);
  }
  while (sum() > room) {                              // tiny lengths: trim the biggest
    const big = [...bars].reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    bars.set(big, bars.get(big)! - 1);
  }
  const out: { name: SectionName; at: number }[] = [];
  let k = -partial;
  for (const [s] of tmpl) {
    const b = FIXED[s] ?? bars.get(s) ?? 0;
    if (b <= 0) continue;
    out.push({ name: s, at: out.length ? r4(off + k * bar) : 0 });
    k += b;
  }
  return out;
}

export type Plan = { bpm: number; beat: number; bar: number; gridOffset: number; endChordAt: number; ring: number; length: number;
  sections: Section[] };

/** Timing only: tempo, the bar grid, sections with start / end / bars, and the final chord's time. */
export function planBed(o: { length: number; bpm?: number; mood?: Mood; endChordAt?: number; ring?: number }): Plan {
  const mood = o.mood ?? "warm";
  if (!MOODS[mood]) throw new Error(`mood must be one of ${MOOD_IDS.join(", ")}`);
  const bpm = o.bpm ?? MOODS[mood].bpm;
  const beat = 60 / bpm, bar = 240 / bpm, length = o.length;
  const end = o.endChordAt ?? length - (o.ring ?? Math.min(6, Math.max(1.5, 0.25 * length)));
  if (!(end > 0 && end < length - 0.3)) throw new Error(`the final chord (${end.toFixed(2)} s) must land inside the bed and at least 0.3 s before its end (${length.toFixed(2)} s)`);
  const secs = autoSections(end, bar);
  const sections = secs.map((s, i) => {
    const e = i + 1 < secs.length ? secs[i + 1].at : r4(end);
    return { ...s, end: e, bars: Math.round(((e - s.at) / bar) * 100) / 100 };
  });
  return { bpm, beat, bar, gridOffset: r4(gridOffset(end, bar)), endChordAt: end, ring: length - end, length, sections };
}

/** Fit a bed to a video: as long as the edit, the final chord a beat or two before the end so it rings out under the last words. */
export function fitToVideo(duration: number): { length: number; endChordAt: number } {
  const length = Math.max(4, Math.round(duration * 100) / 100);
  const ring = Math.min(3.5, Math.max(1.5, 0.12 * length));
  return { length, endChordAt: r4(length - ring) };
}

/** A mood for the video's energy, from how fast the words come (words a minute); warm when unknown. */
export function suggestMood(wordsPerMinute?: number | null): Mood {
  if (!wordsPerMinute || !Number.isFinite(wordsPerMinute)) return "warm";
  return wordsPerMinute >= 185 ? "uplifting" : wordsPerMinute <= 120 ? "lofi" : "warm";
}

// ---------------------------------------------------------------- the score

export type Inst = "kick" | "snare" | "clap" | "hat" | "crash" | "swell" | "sub" | "rhodes" | "pad" | "pluck" | "lead";
/** One note or hit. `t` and `dur` in seconds; `notes` are MIDI numbers; `vel` the level; `pan` -1..1. */
export type Ev = { i: Inst; t: number; dur: number; vel: number; pan: number; notes: number[];
  dec?: number; bright?: number; att?: number; rel?: number; f0?: number; f1?: number };

export type Score = { plan: Plan; mood: Mood; key: string; mode: Mode; events: Ev[]; kicks: number[]; ghosts: number[];
  /** pad brightness 0-1 and level, as breakpoints [time, value] */ bright: [number, number][]; padGain: [number, number][];
  resolveAt: number };

const BRIGHT: Record<SectionName, [number, number]> = { intro: [0.05, 0.3], groove: [0.3, 0.3], fill: [0.3, 0.45], groove2: [0.45, 0.4],
  lead: [0.4, 0.4], build: [0.4, 1], peak: [1, 1], breakdown: [1, 0.55], resolve: [0.55, 0.75] };
const PAD_GAIN: Record<SectionName, [number, number]> = { intro: [0.5, 0.38], groove: [0.38, 0.38], fill: [0.38, 0.38], groove2: [0.38, 0.38],
  lead: [0.38, 0.38], build: [0.38, 0.5], peak: [0.5, 0.48], breakdown: [0.48, 0.4], resolve: [0.4, 0.45] };
const GROOVES: SectionName[] = ["groove", "groove2", "lead", "build", "peak", "resolve"];
const SECTION_CRASH: Partial<Record<SectionName, number>> = { groove: 0.15, groove2: 0.25, peak: 0.4, resolve: 0.22 };
const ARP_VEL: Partial<Record<SectionName, number>> = { groove2: 0.22, lead: 0.22, build: 0.24, peak: 0.27, breakdown: 0.25, resolve: 0.18 };

export type ComposeOptions = { length: number; mood?: Mood; bpm?: number; key?: string; mode?: Mode; endChordAt?: number; ring?: number; seed?: number };

/** Every note of the bed, in time order of writing (not sorted). */
export function scoreBed(o: ComposeOptions): Score {
  const mood = o.mood ?? "warm", key = o.key ?? "D";
  const P = planBed({ length: o.length, bpm: o.bpm, mood, endChordAt: o.endChordAt, ring: o.ring });
  const M = MOODS[mood];
  const mode = modeOf(mood, key, o.mode);
  const H = harmony(key, mode);
  const { beat: BEAT, bar: BAR, endChordAt: END, ring: RING } = P;
  const secs = P.sections;
  const secOf = (t: number) => { let s = secs[0]; for (const x of secs) if (x.at <= t) s = x; return s; };
  const sw = M.swing;
  const swing = (o: number) => {                     // o in beats; swings 8ths (16ths proportionally)
    if (!sw) return o * BEAT;
    const w = Math.floor(o), f0 = o - w;
    const f = f0 < 0.5 ? (f0 / 0.5) * sw : sw + ((f0 - 0.5) / 0.5) * (1 - sw);
    return (w + f) * BEAT;
  };
  const off = P.gridOffset;
  const nBars = Math.round((END - off) / BAR);
  const chords = CHORDS.map((c) => H(c)), roots = ROOTS.map((r) => H([r])[0]);
  const prog = M.prog;
  const ev: Ev[] = [];
  const kicks: number[] = [], ghosts: number[] = [];
  const add = (e: Omit<Ev, "pan" | "notes"> & { pan?: number; notes?: number[] }) => ev.push({ pan: 0, notes: [], ...e });

  const k0 = off > 0 ? -4 : 0;                       // the partial bar before the first downbeat (clipped at 0)
  const k1 = Math.round((END - off) / BEAT);
  for (let k = k0; k < k1; k++) {
    const t0 = off + k * BEAT;
    const S = secOf(Math.max(t0, 0)), s = S.name;
    const pos = mod(k, 4), bi = Math.floor(k / 4);
    const c = prog[mod(bi - nBars, 4)];             // aligned so the bar before the final chord is the V
    const groove = GROOVES.includes(s);
    // kick
    let kt: number[] = [];
    if (s === "groove" || s === "lead" || s === "resolve") kt = pos === 1 ? [0, 2.5] : pos === 0 || pos === 2 ? [0] : [];
    if (s === "groove2") kt = [[0], [0.5], [0], [0.75]][pos];
    if (s === "build" || s === "peak") kt = [0, ...(s === "peak" && pos === 3 ? [0.75] : [])];
    if (M.four && (s === "groove" || s === "groove2" || s === "lead" || s === "resolve")) kt = [0, ...(pos === 3 && s !== "resolve" ? [0.75] : [])];
    if (s === "fill" && pos === 0) kt = [0];
    for (const o of kt) {
      const tk = t0 + swing(o);
      add({ i: "kick", t: tk, dur: 0.5, vel: (o === 0 ? 1 : 0.7) * (s === "peak" ? 1.1 : 1), dec: 0.3 });
      kicks.push(tk);
    }
    if (s === "intro" || s === "breakdown") ghosts.push(t0);
    // snare + clap on 2 and 4 (the build's last bars are a roll instead)
    const rollFrom = S.end - (S.bars >= 3 ? 2 : 1) * BAR;
    if (groove && (pos === 1 || pos === 3) && !(s === "build" && t0 >= rollFrom - 1e-6)) {
      add({ i: "snare", t: t0, dur: 0.35, vel: s === "peak" ? 0.42 : 0.32, pan: 0.05 });
      if (s === "groove2" || s === "peak" || s === "build" || (M.four && s !== "resolve")) add({ i: "clap", t: t0 + 0.004, dur: 0.4, vel: 0.25, pan: -0.1 });
    }
    // hats
    if (groove || s === "breakdown") {
      const subN = s === "groove2" || s === "build" || s === "peak" ? 4 : 2;
      for (let j = 0; j < subN; j++) {
        if (s === "breakdown" && j !== 1) continue;
        const o = j / subN;
        const v = (o === 0 || o === 0.5 ? 0.16 : 0.1) * (s === "peak" ? 1.25 : 1) * (s === "resolve" ? 0.8 : 1);
        add({ i: "hat", t: t0 + swing(o), dur: 0.25, vel: v, dec: 0.03, pan: 0.3 });
      }
      if ((s === "groove2" || s === "peak") && pos === 3) add({ i: "hat", t: t0 + swing(0.5), dur: 0.25, vel: 0.12, dec: 0.14, pan: 0.35 });
    }
    // sub bass
    if (groove && pos === 0)
      for (const [o, L] of [[0, 1.4], [1.5, 0.45], [2, 1.9]]) add({ i: "sub", t: t0 + swing(o), dur: L * BEAT, vel: s === "peak" ? 0.9 : 0.75, notes: [roots[c]] });
    // electric piano comping
    if (s !== "intro" && pos === 0) {
      const vel = ({ breakdown: 0.45, resolve: 0.6, peak: 0.7 } as Partial<Record<SectionName, number>>)[s] ?? 0.55;
      const hits = s === "breakdown" ? [[0, 3.6, 1]] : [[0, 1.3, 1], [1.5, 0.35, 0.7], [2.5, 1.3, 0.85]];
      const notes = [...chords[c], ...(s === "resolve" ? [chords[c][chords[c].length - 1] + 12] : [])];
      for (const [o, L, a] of hits) notes.forEach((m, j) =>
        add({ i: "rhodes", t: t0 + swing(o) + j * 0.006, dur: L * BEAT, vel: vel * a, pan: -0.4 + 0.25 * j, notes: [m] }));
    }
    // pad: one per bar
    if (pos === 0) add({ i: "pad", t: t0, dur: BAR, vel: 1, notes: [...chords[c], chords[c][0] - 12], att: 0.5, rel: 0.9 });
    // 16th arpeggio
    if (s === "groove2" || s === "build" || s === "peak" || s === "breakdown" || s === "resolve" || (s === "lead" && !M.lead)) {
      const tones = chords[c].map((m) => m + 12), pat = [0, 1, 2, 3, 2, 1, 3, 2];
      for (let j = 0; j < 4; j++) {
        if (s === "resolve" && j % 2) continue;
        const idx = s === "breakdown" ? pat[(pos * 2 + j) % 8] : pat[(pos * 4 + j) % 8];
        add({ i: "pluck", t: t0 + swing(j / 4), dur: 0.35, dec: 0.11, bright: 0.4, vel: ARP_VEL[s] ?? 0.22, pan: j % 2 ? 0.5 : -0.5, notes: [tones[idx]] });
      }
    }
    // intro pulse: soft 8th plucks on tonic and fifth
    if (s === "intro") H([62, 69]).forEach((m, j) =>
      add({ i: "pluck", t: t0 + swing(j / 2), dur: 0.4, dec: 0.15, bright: 0.2, vel: 0.14, pan: 0.2 - 0.4 * j, notes: [m] }));
  }

  // lead motif (4 bars, looped) over lead / peak / resolve
  if (M.lead) {
    for (const S of secs) {
      if (S.name !== "lead" && S.name !== "peak" && S.name !== "resolve") continue;
      const end = S.end - (S.name === "resolve" ? 2 * BEAT : 0);
      const v = S.name === "lead" ? 0.22 : S.name === "peak" ? 0.24 : 0.2;
      for (let p0 = S.at; p0 < end - 1; p0 += 4 * BAR) {
        for (const [o, m, L] of MOTIF) {
          const tn = p0 + o * BEAT;
          if (tn + L * BEAT > end) break;
          add({ i: "lead", t: tn, dur: L * BEAT * 0.95, vel: v, pan: 0.1, notes: H([m]) });
        }
      }
    }
  }

  // fills, swells, rolls, crashes at section changes
  secs.forEach((S, i) => {
    const { name: s, at: a, end: e } = S;
    if (s === "fill") {
      const n16 = Math.round((e - a) / (BEAT / 4));
      for (let j = 0; j < n16; j++) add({ i: "snare", t: a + (j * BEAT) / 4, dur: 0.35, vel: 0.12 + (0.36 * j) / Math.max(n16 - 1, 1), pan: 0.1 });
      add({ i: "swell", t: a, dur: e - a, vel: 0.25, f0: 400, f1: 7000 });
    }
    if (s === "build") {
      const rb = S.bars >= 3 ? 2 : 1, r0 = e - rb * BAR;
      for (let j = 0; j < 16 * rb; j++) {
        const tk = r0 + (j * BEAT) / 4;
        add({ i: "snare", t: tk, dur: 0.35, vel: 0.08 + (0.38 * j) / (16 * rb) });
        if (j >= 16 * (rb - 1)) add({ i: "snare", t: tk + BEAT / 8, dur: 0.35, vel: 0.05 + (0.3 * j) / (16 * rb) });   // last bar doubles to 32nds
      }
      add({ i: "swell", t: a, dur: e - a, vel: 0.3, f0: 200, f1: 9000 });
    }
    if (i && SECTION_CRASH[s]) add({ i: "crash", t: a, dur: 4.2, vel: SECTION_CRASH[s]!, dec: 1.4 });
  });

  // the final tonic chord, ringing out, exactly at END
  add({ i: "pad", t: END, dur: Math.min(3, 0.5 * RING), vel: 1.3, notes: H(FINAL_PAD), att: 0.05, rel: Math.min(2.5, 0.42 * RING) });
  H(FINAL_KEYS).forEach((m, j) => add({ i: "rhodes", t: END + j * 0.012, dur: Math.min(4.5, 0.75 * RING), vel: 0.75, pan: -0.5 + 0.2 * j, notes: [m] }));
  add({ i: "sub", t: END, dur: Math.min(3.5, 0.58 * RING), vel: 0.85, notes: [roots[0]] });
  add({ i: "kick", t: END, dur: 0.5, vel: 1, dec: 0.5 });
  add({ i: "crash", t: END, dur: 3 * Math.min(2, RING / 3), vel: 0.3, dec: Math.min(2, RING / 3) });

  const bright: [number, number][] = [], padGain: [number, number][] = [];
  for (const S of secs) {
    const [b0, b1] = BRIGHT[S.name], [g0, g1] = PAD_GAIN[S.name];
    const e = Math.max(S.at, S.end - 0.05);
    bright.push([S.at, b0], [e, b1]);
    padGain.push([S.at, g0], [e, g1]);
  }
  bright.push([END, 0.75], [P.length, 0.8]);
  padGain.push([END, 0.45], [P.length, 0.45]);
  return { plan: P, mood, key, mode, events: ev, kicks: kicks.sort((a, b) => a - b), ghosts, bright, padGain,
    resolveAt: secs.find((S) => S.name === "resolve")?.at ?? END };
}

// ---------------------------------------------------------------- control curves (pure)

/** Linear interpolation through [time, value] breakpoints, sampled at `rate` per second for `seconds`. */
export function curve(points: [number, number][], seconds: number, rate: number, map: (v: number) => number = (v) => v): Float32Array {
  const n = Math.max(2, Math.ceil(seconds * rate) + 1);
  const out = new Float32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    while (k + 1 < points.length && points[k + 1][0] <= t) k++;
    const [t0, v0] = points[k], [t1, v1] = points[Math.min(k + 1, points.length - 1)];
    const v = t <= t0 || t1 <= t0 ? v0 : v0 + (v1 - v0) * Math.min(1, (t - t0) / (t1 - t0));
    out[i] = map(v);
  }
  return out;
}

/** Kick pumping: a gain that dips by `depth` at each time and recovers with time constant `tau` (dsp.sidechain). */
export function duckCurve(times: number[], seconds: number, rate: number, depth: number, tau: number): Float32Array {
  const n = Math.max(2, Math.ceil(seconds * rate) + 1);
  const out = new Float32Array(n);
  const sorted = [...times].sort((a, b) => a - b);
  const a = Math.exp(-1 / (tau * rate));
  let e = 0, j = 0;
  for (let i = 0; i < n; i++) {
    e *= a;
    while (j < sorted.length && sorted[j] * rate <= i) { if (sorted[j] >= 0) e += 1; j++; }
    out[i] = 1 - depth * Math.min(1, e);
  }
  return out;
}

// ---------------------------------------------------------------- the renderer (browser)

export const RATE = 48000;
const CONTROL = 500;                                  // control-curve points a second
const CHUNK = 1;                                      // seconds of notes placed per pause of an offline render
const STEMS_UP_TO = 150;                              // seconds; longer beds render in one context (stems hold every part in memory)

function rng(seed: number) {                          // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export type Bed = { wav: Blob; seconds: number; plan: Plan; mood: Mood; key: string; mode: Mode; bpm: number; lufs: number; peakDb: number;
  renderMs: number; timings: { schedule: number; render: number; mix: number; master: number }; nodes: number; stems: boolean;
  channels: Float32Array[] };

export type ComposeProgress = (msg: string, pct: number) => void;

let suspendable: Promise<boolean> | null = null;
/** Whether this browser can pause an OfflineAudioContext at a time (Chrome, Edge, Safari; checked once on a tiny render). */
function canSuspend(): Promise<boolean> {
  suspendable ??= (async () => {
    try {
      const c = new OfflineAudioContext(1, 512, RATE);
      if (typeof c.suspend !== "function") return false;
      let hit = false;
      const p = c.suspend(256 / RATE).then(() => { hit = true; return c.resume(); });
      await c.startRendering();
      await p;
      return hit;
    } catch { return false; }
  })();
  return suspendable;
}

type Part = "drums" | "bass" | "keys" | "pads" | "melody";
const PART_OF: Record<Inst, Part> = { kick: "drums", snare: "drums", clap: "drums", hat: "drums", crash: "drums", sub: "bass",
  rhodes: "keys", pad: "pads", pluck: "melody", lead: "melody", swell: "melody" };
const SEND: Record<Part, number> = { drums: 0.15, bass: 0, keys: 1, pads: 0.6, melody: 1 };   // into the reverb
const MUSIC: Record<Part, boolean> = { drums: false, bass: false, keys: true, pads: true, melody: true };   // gets the voice dip

type Kit = ReturnType<typeof toolkit>;

/** Node helpers bound to one context. Every node a note makes is remembered, so the note leaves the graph when its last
 *  source ends: a finished note otherwise stays connected and is walked on every render quantum to the end of the song. */
function toolkit(ctx: OfflineAudioContext, seed: number) {
  const R = rng(seed);
  const len = ctx.length / RATE;
  let made: AudioNode[] | null = null, last: AudioScheduledSourceNode | null = null, lastEnd = -1, nodes = 0;
  const keep = <T extends AudioNode>(n: T): T => { made?.push(n); return n; };
  const ends = (n: AudioScheduledSourceNode, end: number) => { if (made && end > lastEnd) { last = n; lastEnd = end; } };
  let noiseBuf: AudioBuffer | null = null;
  const noise = () => {                                // 4 s of stereo white noise, unit variance, sliced at random offsets
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(2, RATE * 4, RATE);
      for (let c = 0; c < 2; c++) { const d = noiseBuf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (R() * 2 - 1) * 1.732; }
    }
    return noiseBuf;
  };
  const g = (v = 1) => { const n = keep(ctx.createGain()); n.gain.value = v; return n; };
  const f = (type: BiquadFilterType, freq: number, q = 0.7071, gainDb = 0) => {
    const n = keep(ctx.createBiquadFilter()); n.type = type; n.frequency.value = freq; n.Q.value = q; n.gain.value = gainDb; return n; };
  const pan = (p: number) => { const n = ctx.createStereoPanner(); n.pan.value = Math.max(-1, Math.min(1, p)); return n; };
  const shaper = (k: number) => { const s = ctx.createWaveShaper(); const c = new Float32Array(1025);
    for (let i = 0; i < c.length; i++) c[i] = Math.tanh(k * (i / 512 - 1));
    s.curve = c; s.oversample = "2x"; return s; };
  const chain = (...ns: AudioNode[]) => { for (let i = 0; i + 1 < ns.length; i++) ns[i].connect(ns[i + 1]); return ns[ns.length - 1]; };
  const setCurve = (p: AudioParam, c: Float32Array) => { p.value = c[0]; p.setValueCurveAtTime(c, 0, len); };
  const osc = (type: OscillatorType, freq: number, t: number, end: number) => {
    nodes++;
    const o = keep(ctx.createOscillator()); o.type = type; o.frequency.value = freq; o.start(t); o.stop(end); ends(o, end); return o; };
  const noiseAt = (t: number, dur: number, dest: AudioNode, gain: GainNode) => {
    const src = keep(ctx.createBufferSource()); src.buffer = noise(); ends(src, t + dur);
    src.connect(gain); gain.connect(dest);
    src.start(t, R() * (4 - Math.min(3.9, dur + 0.05)));
    src.stop(t + dur);
  };
  /** Chorus: two modulated delays in anti-phase, mixed with the dry signal. */
  const chorus = (input: AudioNode, out: AudioNode, rate: number, depth: number, base: number, mix: number) => {
    input.connect(g(1 - mix)).connect(out);
    const lfo = ctx.createOscillator(); lfo.frequency.value = rate;
    const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2);
    input.connect(sp);
    [1, -1].forEach((sign, ch) => {
      const d = ctx.createDelay(0.1); d.delayTime.value = base;
      const amt = g(sign * depth); lfo.connect(amt); amt.connect(d.delayTime);
      sp.connect(d, ch); d.connect(mg, 0, ch);
    });
    mg.connect(g(mix)).connect(out);
    lfo.start(0); lfo.stop(len);
  };
  /** Ping-pong feedback delay (wet only), each repeat darker. */
  const delay = (input: AudioNode, out: AudioNode, dt: number, fbk: number, lpf: number) => {
    const dl = ctx.createDelay(4), dr = ctx.createDelay(4);
    dl.delayTime.value = dt; dr.delayTime.value = dt;
    const fl = f("lowpass", lpf, 0.5), fr = f("lowpass", lpf, 0.5);
    input.connect(g(fbk)).connect(fl);
    chain(fl, dl, g(fbk), fr); chain(fr, dr, g(fbk), fl);   // bounce: L -> R -> L
    const ml = ctx.createChannelMerger(2);
    dl.connect(ml, 0, 0); dr.connect(ml, 0, 1);
    ml.connect(out);
  };
  /** Make one note; its nodes disconnect when its longest source ends. */
  const note = (make: () => void) => {
    made = []; last = null; lastEnd = -1;
    make();
    const mine = made as AudioNode[], src = last as AudioScheduledSourceNode | null;
    made = null;
    if (src) src.onended = () => { for (const n of mine) n.disconnect(); };
  };
  /** A stereo bus: mono parts (the bass) are spread to both sides, as a speaker would. */
  const bus = () => { const n = ctx.createGain(); n.channelCount = 2; n.channelCountMode = "explicit"; n.channelInterpretation = "speakers"; return n; };
  return { ctx, R, len, g, f, pan, shaper, chain, setCurve, osc, noiseAt, chorus, delay, note, bus, count: () => nodes };
}

/** One part's instruments and effects, playing into `out`. Returns how to place one of its notes. */
function buildPart(T: Kit, S: Score, part: Part, out: AudioNode): (e: Ev) => void {
  const { ctx, g, f, pan, shaper, chain, setCurve, osc, noiseAt, chorus, delay, len } = T;
  const P = S.plan, M = MOODS[S.mood], END = P.endChordAt;
  const duck = () => { const a = duckCurve(S.kicks, len, CONTROL, 0.55, 0.16), b = duckCurve(S.ghosts, len, CONTROL, 0.25, 0.25);
    return a.map((v, i) => Math.min(v, b[i])); };
  const panners = new Map<string, StereoPannerNode>();
  const panInto = (to: AudioNode, p: number) => {
    let n = panners.get(p.toFixed(2));
    if (!n) { n = pan(p); n.connect(to); panners.set(p.toFixed(2), n); }
    return n;
  };

  if (part === "drums") {                             // high-pass; lo-fi: saturated and dark
    const drums = g(1), drumsOut = g(M.lofi ? 0.3 : 0.55);
    if (M.lofi) chain(drums, f("highpass", 30), g(0.55), shaper(2), f("lowpass", 7000), drumsOut); else chain(drums, f("highpass", 30), drumsOut);
    drumsOut.connect(out);
    const kickBus = g(1); chain(kickBus, shaper(1.6), pan(0), drums);      // mono hits sit in the centre at equal power
    const hatBus = f("highpass", 7500); chain(hatBus, pan(0.3), drums);
    const snareBus = f("bandpass", 2900, 0.5); chain(snareBus, pan(0.05), drums);
    const clapBus = f("bandpass", 2100, 0.5); chain(clapBus, pan(-0.1), drums);
    const crashBus = f("highpass", 4500); crashBus.connect(drums);
    const clickBus = f("highpass", 2500); clickBus.connect(kickBus);
    const snareBody = pan(0.05); snareBody.connect(drums);
    return (e) => {
      const t = e.t;
      if (e.i === "kick") {
        const dec = e.dec ?? 0.3, end = Math.min(len, t + Math.min(0.5, dec * 5));
        const o = osc("sine", 141, t, end);
        o.frequency.setValueAtTime(141, t); o.frequency.setTargetAtTime(46, t, 0.032);
        const a = g(0); a.gain.setValueAtTime(e.vel, t); a.gain.setTargetAtTime(0, t, dec);
        o.connect(a).connect(kickBus);
        const c = g(0); c.gain.setValueAtTime(0.25 * e.vel, t); c.gain.setTargetAtTime(0, t, 0.003);
        noiseAt(t, 0.03, clickBus, c);
      } else if (e.i === "hat") {
        const a = g(0); a.gain.setValueAtTime(e.vel, t); a.gain.setTargetAtTime(0, t, e.dec ?? 0.03);
        noiseAt(t, Math.min(0.25, (e.dec ?? 0.03) * 6), hatBus, a);
      } else if (e.i === "snare") {
        const o = osc("sine", 225, t, t + 0.3);
        o.frequency.setValueAtTime(225, t); o.frequency.setTargetAtTime(185, t, 0.01);
        const a = g(0); a.gain.setValueAtTime(0.6 * e.vel, t); a.gain.setTargetAtTime(0, t, 0.05);
        o.connect(a).connect(snareBody);
        const nz = g(0); nz.gain.setValueAtTime(0.8 * e.vel, t); nz.gain.setTargetAtTime(0, t, 0.11);
        noiseAt(t, 0.35, snareBus, nz);
      } else if (e.i === "clap") {
        const a = g(0);
        [0, 0.009, 0.018].forEach((o, k) => { a.gain.setValueAtTime(e.vel, t + o); a.gain.setTargetAtTime(0, t + o, k < 2 ? 0.006 : 0.12); });
        noiseAt(t, 0.4, clapBus, a);
      } else if (e.i === "crash") {
        const dec = e.dec ?? 1.4;
        const a = g(0); a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(e.vel, t + 0.003); a.gain.setTargetAtTime(0, t + 0.003, dec);
        noiseAt(t, Math.min(3 * dec, len - t), crashBus, a);
      }
    };
  }

  if (part === "bass") {                              // saturation, low-pass, a little pumping, centred
    const bass = g(1), bassDuck = g(0);
    setCurve(bassDuck.gain, duck().map((v) => Math.min(v + 0.25, 1) * 0.45));
    chain(bass, shaper(1.4), f("lowpass", 220, 0.6), bassDuck, pan(0), out);
    return (e) => {
      const t = e.t, fq = mtof(e.notes[0]), end = Math.min(len, t + e.dur + 0.15);
      const a = g(0);
      a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(e.vel, t + 0.006);
      a.gain.setValueAtTime(e.vel, t + e.dur); a.gain.setTargetAtTime(0, t + e.dur, 0.025);
      osc("sine", fq, t, end).connect(a);
      osc("sine", fq * 2, t, end).connect(g(0.12)).connect(a);
      a.connect(bass);
    };
  }

  if (part === "keys") {                              // FM electric piano: high-pass, auto-pan tremolo, chorus, a lift into the end
    const keys = g(1), trem = ctx.createStereoPanner(), keysLvl = g(0.2);
    const tremLfo = ctx.createOscillator(); tremLfo.frequency.value = 4 / P.bar;
    tremLfo.connect(g(0.18)).connect(trem.pan); tremLfo.start(0); tremLfo.stop(len);
    chain(keys, f("highpass", 120, 0.6), trem);
    chorus(trem, keysLvl, 0.7, 0.0015, 0.008, 0.35);
    keysLvl.gain.setValueAtTime(0.2, 0); keysLvl.gain.setValueAtTime(0.2, S.resolveAt); keysLvl.gain.linearRampToValueAtTime(0.23, END);
    keysLvl.connect(out);
    return (e) => {
      const t = e.t, fq = mtof(e.notes[0]), v = e.vel, end = Math.min(len, t + e.dur + 0.6);
      const to = panInto(keys, e.pan);
      const car = osc("sine", fq, t, end), modu = osc("sine", fq, t, end);
      const idx = g(0); idx.gain.setValueAtTime((0.8 + 2.2 * v + 0.3) * fq, t); idx.gain.setTargetAtTime(0.3 * fq, t, 0.3);
      modu.connect(idx).connect(car.frequency);
      const amp = g(0);
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(v, t + 0.002);
      amp.gain.setTargetAtTime(0, t + 0.002, fq < 300 ? 2.2 : 1.4);
      amp.gain.setTargetAtTime(0, t + e.dur, 0.12);
      car.connect(amp).connect(to);
      const tine = osc("sine", Math.min(fq * 14, 18000), t, Math.min(end, t + 0.15)), tg = g(0);   // the tine's ping
      tg.gain.setValueAtTime(0.3 * v * v, t); tg.gain.setTargetAtTime(0, t, 0.018);
      tine.connect(tg).connect(to);
      const bark = osc("sine", fq * 2, t, Math.min(end, t + 0.6)), bg = g(0);                          // and its bark
      bg.gain.setValueAtTime(0.25 * v * v, t); bg.gain.setTargetAtTime(0, t, 0.12);
      bark.connect(bg).connect(to);
    };
  }

  if (part === "pads") {                              // detuned saws: brightness filter, level x pumping, chorus
    // dark and bright low-passes crossfaded by the section's brightness (the build opens up)
    const pads = g(1), dark = g(0), bright = g(0), padVca = g(0);
    const b = curve(S.bright, len, CONTROL, (v) => Math.max(0, Math.min(1, v + M.bright)));
    setCurve(dark.gain, b.map((v) => 1 - v)); setCurve(bright.gain, b);
    chain(pads, f("lowpass", 700, 0.6), dark, padVca); chain(pads, f("lowpass", 3200, 0.6), bright, padVca);
    const d = duck();
    setCurve(padVca.gain, curve(S.padGain, len, CONTROL).map((v, i) => v * d[i]));
    chorus(padVca, out, 0.3, 0.002, 0.01, 0.4);
    const padPans = [-0.7, 0, 0.7].map((p) => { const n = pan(p); n.connect(pads); return n; });
    return (e) => {
      const t = e.t, att = e.att ?? 0.5, rel = e.rel ?? 0.9, end = Math.min(len, t + e.dur + rel);
      const scale = e.vel / Math.sqrt(e.notes.length * 3), hold = Math.max(t + att, t + e.dur);
      const envs = padPans.map((pp) => {
        const a = g(0);
        a.gain.setValueAtTime(0, t); a.gain.linearRampToValueAtTime(scale, t + att);
        a.gain.setValueAtTime(scale, hold); a.gain.setTargetAtTime(0, hold, rel / 3);
        a.connect(pp); return a;
      });
      for (const m of e.notes) [-9, 0, 8].forEach((cents, k) => { const o = osc("sawtooth", mtof(m), t, end); o.detune.value = cents; o.connect(envs[k]); });
    };
  }

  // melody: the arpeggio and its delay (both pumped), the lead and its delay, the swells
  const arp = g(1), arpDuck = g(0);
  setCurve(arpDuck.gain, duck());
  arp.connect(arpDuck); delay(arp, arpDuck, 0.75 * P.beat, 0.35, 3500);
  arpDuck.connect(g(0.9)).connect(out);
  const lead = g(1), leadOut = g(0.8);
  lead.connect(leadOut); delay(lead, leadOut, 1.5 * P.beat, 0.3, 3000);
  leadOut.connect(out);
  const fx = g(1); fx.connect(out);
  return (e) => {
    const t = e.t;
    if (e.i === "pluck") {
      const fq = mtof(e.notes[0]), d = e.dur, end = Math.min(len, t + d);
      const car = osc("sine", fq, t, end), modu = osc("sine", 2 * fq, t, end);
      const idx = g(0); idx.gain.setValueAtTime((e.bright ?? 0.4) * 2 * fq, t); idx.gain.setTargetAtTime(0, t, 0.03);
      modu.connect(idx).connect(car.frequency);
      const amp = g(0);
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(e.vel, t + 0.002);
      amp.gain.setTargetAtTime(0, t + 0.002, e.dec ?? 0.12);
      amp.gain.setTargetAtTime(0, Math.max(t + 0.003, t + d - 0.02), 0.006);
      car.connect(amp).connect(panInto(arp, e.pan));
    } else if (e.i === "lead") {
      const fq = mtof(e.notes[0]), end = Math.min(len, t + e.dur + 0.3);
      const car = osc("sine", fq, t, end), modu = osc("sine", fq, t, end), vib = osc("sine", 5.2, t, end);
      const vd = g(0); vd.gain.setValueAtTime(0, t); vd.gain.linearRampToValueAtTime(0.004 * fq, t + 0.4);
      vib.connect(vd).connect(car.frequency);
      const idx = g(0); idx.gain.setValueAtTime(0.7 * fq, t); idx.gain.setTargetAtTime(0.35 * fq, t, 0.2);
      modu.connect(idx).connect(car.frequency);
      const amp = g(0);
      amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(e.vel, t + 0.03);
      amp.gain.setTargetAtTime(0.85 * e.vel, t + 0.03, 0.2);
      amp.gain.setTargetAtTime(0, t + e.dur, 0.08);
      car.connect(amp).connect(panInto(lead, e.pan));
    } else if (e.i === "swell") {
      const d = Math.max(0.05, e.dur);
      const bp = f("bandpass", e.f0 ?? 300, 1.5);
      bp.frequency.setValueAtTime(e.f0 ?? 300, t); bp.frequency.exponentialRampToValueAtTime(e.f1 ?? 6000, t + d);
      const a = g(0); a.gain.setValueCurveAtTime(new Float32Array(32).map((_, i) => (i / 31) ** 2 * e.vel * 2), t, d);
      bp.connect(fx);
      noiseAt(t, d, bp, a);
    }
  };
}

/** The mix: music through the voice dip, drums and bass straight, one reverb on the sends, then the lo-fi roll-off and
 *  vinyl, the glue compressor and the ending's fade. `input` plugs a part in. */
function buildMix(T: Kit, S: Score) {
  const { ctx, R, g, f, chain, len } = T;
  const P = S.plan, M = MOODS[S.mood], N = ctx.length;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 2; comp.knee.value = 8; comp.attack.value = 0.02; comp.release.value = 0.25;
  const fade = g(0), master = g(0.5);
  chain(master, f("highpass", 20, 0.6), comp, fade, ctx.destination);       // no DC from the saturated lows
  const END = P.endChordAt, RING = P.ring;
  const silent = Math.min(0.2, Math.max(0.05, 0.033 * RING));
  const fa = END + 0.42 * RING, fb = len - silent;              // ring out, silent at the very end
  fade.gain.setValueAtTime(0, 0); fade.gain.linearRampToValueAtTime(1, 0.005);
  if (fb - fa > 0.01) fade.gain.setValueCurveAtTime(new Float32Array(64).map((_, i) => 0.5 * (1 + Math.cos((Math.PI * i) / 63))), fa, fb - fa);
  fade.gain.setValueAtTime(0, Math.max(fb, fa + 0.01) + 0.001);
  let toMaster: AudioNode = master;
  if (M.lofi) {                                        // tape roll-off, then vinyl: sparse crackle and a little hiss
    toMaster = f("lowpass", 9500); toMaster.connect(master);
    const cr = ctx.createBuffer(1, N, RATE), d = cr.getChannelData(0);
    for (let j = 0, k = Math.max(1, Math.round((45 * N) / RATE)); j < k; j++) { const u = R(); d[Math.floor(R() * N)] = (R() * 2 - 1) * (0.2 + 0.8 * u) ** 3; }
    const src = ctx.createBufferSource(); src.buffer = cr;
    chain(src, f("bandpass", 3700, 0.6), g(0.5), master); src.start(0);
    const hiss = ctx.createBuffer(1, RATE * 2, RATE), h = hiss.getChannelData(0);
    for (let i = 0; i < h.length; i++) h[i] = (R() * 2 - 1) * 1.732;
    const hs = ctx.createBufferSource(); hs.buffer = hiss; hs.loop = true;
    chain(hs, f("bandpass", 4900, 1.2), g(0.006), master); hs.start(0); hs.stop(len);
  }
  const music = g(1);                                  // leave room for the voice: a gentle dip at 1-3 kHz
  chain(music, f("peaking", 1650, 0.8, -2.5), toMaster);
  // reverb: a generated decaying-noise impulse, stereo, low-passed, energy-normalised (RT60 2.2 s, cut 1.5 s in, at -41 dB)
  const rt = 2.2, irN = Math.round(1.5 * RATE), pre = Math.round(0.02 * RATE);
  const ir = ctx.createBuffer(2, irN + pre, RATE);
  const lpA = Math.exp((-2 * Math.PI * 6000) / RATE);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let y = 0, e = 0;
    for (let i = 0; i < irN; i++) {
      y = (1 - lpA) * (R() * 2 - 1) + lpA * y;
      const v = y * Math.exp(((-i / RATE) * 6.9) / rt) * Math.min(1, i / (0.004 * RATE), (irN - i) / (0.1 * RATE));
      d[pre + i] = v; e += v * v;
    }
    const s = 1 / Math.sqrt(e || 1);
    for (let i = 0; i < d.length; i++) d[i] *= s;
  }
  const verb = ctx.createConvolver(); verb.normalize = false; verb.buffer = ir;
  const verbIn = g(1);
  chain(verbIn, verb, g(0.3), toMaster);
  return {
    input(part: Part, node: AudioNode) {
      node.connect(MUSIC[part] ? music : toMaster);
      if (SEND[part]) node.connect(g(SEND[part])).connect(verbIn);
    },
  };
}

/** Render a context, placing its notes a second at a time where the browser can pause the render. */
async function play(T: Kit, events: Ev[], place: (e: Ev) => void, chunked: boolean, onPct: (x: number) => void): Promise<AudioBuffer> {
  const { ctx, len } = T;
  let next = 0;
  const until = (t: number) => { while (next < events.length && events[next].t < t) { const e = events[next++]; T.note(() => place(e)); } };
  const chunks = chunked ? Math.max(1, Math.ceil(len / CHUNK)) : 1;
  const at = (k: number) => (Math.floor((k * CHUNK * RATE) / 128) * 128) / RATE;   // on a render quantum (128 frames)
  const upTo = (k: number) => (k < chunks ? at(k) : Infinity);
  until(upTo(1));
  for (let k = 1; k < chunks; k++) {
    void ctx.suspend(at(k)).then(() => { until(upTo(k + 1)); onPct(k / chunks); return ctx.resume(); })
      .catch(() => until(upTo(k + 1)));
  }
  const buf = await ctx.startRendering();
  onPct(1);
  return buf;
}

/** Compose and render a bed: stereo 48 kHz, about -16 LUFS, peaks at most -1.5 dBFS, as a 16-bit WAV.
 *  Up to STEMS_UP_TO seconds, the parts render as stems in parallel offline contexts (the browser gives each its own
 *  thread), then a mix pass adds the reverb, the glue and the fade. */
export async function renderBed(o: ComposeOptions & { stems?: boolean }, onProgress: ComposeProgress = () => undefined,
  targetLufs = -16, ceilingDb = -1.5): Promise<Bed> {
  const t0 = performance.now();
  onProgress("Writing the parts", 2);
  const S = scoreBed(o);
  const len = S.plan.length, N = Math.round(len * RATE), seed = o.seed ?? 7;
  // the partial bar before 0: sustained parts start clipped, hits are dropped
  const events = S.events.flatMap((e) => (e.t >= 0 ? [e] : (e.i === "pad" || e.i === "rhodes" || e.i === "sub" || e.i === "lead") && e.t + e.dur > 0.05
    ? [{ ...e, dur: e.dur + e.t, t: 0, att: 0.02 }] : [])).filter((e) => e.t < len).sort((a, b) => a.t - b.t);
  const chunked = await canSuspend();
  const stems = (o.stems ?? true) && len <= STEMS_UP_TO;
  const groups: Part[][] = stems ? [["keys"], ["pads"], ["melody"], ["drums", "bass"]] : [["drums", "bass", "keys", "pads", "melody"]];
  const done = groups.map(() => 0);
  const report = () => onProgress("Playing it through", 6 + ((stems ? 72 : 80) * done.reduce((a, b) => a + b, 0)) / groups.length);
  let nodes = 0, t2: number;
  const t1 = performance.now();
  onProgress("Playing it through", 6);
  let buf: AudioBuffer;
  if (!stems) {
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: N, sampleRate: RATE });
    const T = toolkit(ctx, seed), mix = buildMix(T, S);
    const places = new Map(groups[0].map((part) => { const b = T.bus(); mix.input(part, b); return [part, buildPart(T, S, part, b)] as const; }));
    buf = await play(T, events, (e) => places.get(PART_OF[e.i])!(e), chunked, (x) => { done[0] = x; report(); });
    nodes = T.count(); t2 = performance.now();
  } else {
    const rendered = await Promise.all(groups.map(async (parts, gi) => {
      const ctx = new OfflineAudioContext({ numberOfChannels: 2 * parts.length, length: N, sampleRate: RATE });
      ctx.destination.channelCount = 2 * parts.length; ctx.destination.channelCountMode = "explicit"; ctx.destination.channelInterpretation = "discrete";
      const T = toolkit(ctx, seed + 101 * gi);
      const merger = ctx.createChannelMerger(2 * parts.length); merger.connect(ctx.destination);
      const places = new Map(parts.map((part, k) => {
        const b = T.bus(), sp = ctx.createChannelSplitter(2);
        b.connect(sp); sp.connect(merger, 0, 2 * k); sp.connect(merger, 1, 2 * k + 1);
        return [part, buildPart(T, S, part, b)] as const;
      }));
      const mine = events.filter((e) => parts.includes(PART_OF[e.i]));
      const b = await play(T, mine, (e) => places.get(PART_OF[e.i])!(e), chunked, (x) => { done[gi] = x; report(); });
      nodes += T.count();
      return { parts, b };
    }));
    t2 = performance.now();
    onProgress("Mixing", 80);
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: N, sampleRate: RATE });
    const T = toolkit(ctx, seed + 999), mix = buildMix(T, S);
    for (const { parts, b } of rendered) {
      const src = ctx.createBufferSource(); src.buffer = b;
      const sp = ctx.createChannelSplitter(b.numberOfChannels);
      src.connect(sp);
      parts.forEach((part, k) => { const m = ctx.createChannelMerger(2); sp.connect(m, 2 * k, 0); sp.connect(m, 2 * k + 1, 1); mix.input(part, m); });
      src.start(0);
    }
    buf = await ctx.startRendering();
  }
  const t3 = performance.now();
  onProgress("Mastering", 90);
  await new Promise((ok) => setTimeout(ok, 0));
  const channels = [new Float32Array(buf.getChannelData(0)), new Float32Array(buf.getChannelData(1))];
  const m = normalise(channels, RATE, targetLufs, ceilingDb);
  onProgress("Done", 100);
  return { wav: wav(channels, RATE), seconds: len, plan: S.plan, mood: S.mood, key: S.key, mode: S.mode, bpm: S.plan.bpm, lufs: m.lufs, peakDb: m.peakDb,
    renderMs: performance.now() - t0, timings: { schedule: t1 - t0, render: t2 - t1, mix: t3 - t2, master: performance.now() - t3 }, nodes, stems, channels };
}

/** The library name of a composed bed. */
export const bedName = (mood: Mood, bpm: number) => `Original – ${mood} ${Math.round(bpm)} BPM`;
