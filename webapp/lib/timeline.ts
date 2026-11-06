// Cut ranges -> playable segments, and every kept word's time on the output timeline.
// Same rules as the engine: a pause longer than gapCap (+ a minimum saving) is cut down to gapCap,
// a little air before the first word and after the last, never a cut inside a word.

import type { Edit, Range, Word } from "./types";

export type Segment = { src: number; start: number; end: number; outStart: number; outEnd: number; words: string[]; speed: number };
export type OutWord = Word & { os: number; oe: number; seg: number };
export type Timeline = { segments: Segment[]; words: OutWord[]; duration: number; byId: Map<string, OutWord> };

const HEAD = 0.1, TAIL = 0.35, MIN_SAVING = 0.08;

export function indexOf(words: Word[]): Map<string, number> {
  const m = new Map<string, number>();
  words.forEach((w, i) => m.set(w.id, i));
  return m;
}

/** Kept word indexes in output order. Ranges that span two takes are split at the take change. */
export function keptIndexes(words: Word[], keep: Range[]): number[][] {
  const idx = indexOf(words);
  const runs: number[][] = [];
  for (const r of keep) {
    const a = idx.get(r.from), b = idx.get(r.to);
    if (a === undefined || b === undefined) continue;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    let cur: number[] = [];
    for (let i = lo; i <= hi; i++) {
      if (cur.length && words[i].src !== words[cur[cur.length - 1]].src) { runs.push(cur); cur = []; }
      cur.push(i);
    }
    if (cur.length) runs.push(cur);
  }
  return runs;
}

/** The talking speed an edit plays at: 1 as filmed, up to 1.3. */
export const speedOf = (e: { speed?: number }) => Math.min(1.3, Math.max(1, Number.isFinite(e.speed) ? e.speed! : 1));

/** The source time shown at an output time inside a segment, and back. */
export const srcAt = (s: Segment, t: number) => s.start + (t - s.outStart) * s.speed;
export const outAt = (s: Segment, src: number) => s.outStart + (src - s.start) / s.speed;

export function buildTimeline(words: Word[], edit: Pick<Edit, "keep" | "gapCap" | "speed">, durations: number[]): Timeline {
  const sp = speedOf(edit);
  const runs = keptIndexes(words, edit.keep);
  const segments: Segment[] = [];
  const out: OutWord[] = [];
  let t = 0;
  const cap = Math.max(0.02, edit.gapCap);
  for (const run of runs) {
    // split the run wherever a pause is longer than the cap
    let pieces: number[][] = [[run[0]]];
    for (let k = 1; k < run.length; k++) {
      const gap = words[run[k]].s - words[run[k - 1]].e;
      if (gap > cap + MIN_SAVING) pieces.push([run[k]]); else pieces[pieces.length - 1].push(run[k]);
    }
    pieces.forEach((p, pi) => {
      const first = words[p[0]], last = words[p[p.length - 1]];
      const src = first.src;
      const dur = durations[src] > 0 ? durations[src] : last.e + 1;      // 0: a length the browser couldn't read
      const lead = pi === 0 ? HEAD : cap * 0.92;          // most of the kept air leads into the next word
      const tail = pi === pieces.length - 1 ? TAIL : cap * 0.08;
      // the air around a piece never reaches into the words next to it: a word that was cut stays cut
      const prev = words[p[0] - 1], next = words[p[p.length - 1] + 1];
      const start = Math.max(0, first.s - lead, prev && prev.src === src && prev.e <= first.s ? prev.e : 0);
      const end = Math.max(start, Math.min(dur, last.e + tail, next && next.src === src && next.s >= last.e ? next.s : Infinity));
      const seg: Segment = { src, start, end, outStart: t, outEnd: t + (end - start) / sp, words: p.map((i) => words[i].id), speed: sp };
      for (const i of p) {
        const w = words[i];
        out.push({ ...w, os: t + (w.s - start) / sp, oe: t + (w.e - start) / sp, seg: segments.length });
      }
      segments.push(seg);
      t = seg.outEnd;
    });
  }
  return { segments, words: out, duration: t, byId: new Map(out.map((w) => [w.id, w])) };
}

/** Output [start, end] for a word range, or null when those words were cut. */
export function spanOf(tl: Timeline, r: Range, lead = 0): [number, number] | null {
  const a = tl.byId.get(r.from), b = tl.byId.get(r.to);
  if (!a || !b) return null;
  const s = Math.min(a.os, b.os), e = Math.max(a.oe, b.oe);
  return [Math.max(0, s - lead), e];
}

/** The source time shown at an output time (for seeking and frame grabs). */
export function sourceAt(tl: Timeline, t: number): { seg: number; src: number; time: number } | null {
  const i = tl.segments.findIndex((s) => t >= s.outStart && t < s.outEnd);
  const k = i >= 0 ? i : tl.segments.length - 1;
  const s = tl.segments[k];
  if (!s) return null;
  return { seg: k, src: s.src, time: srcAt(s, Math.min(t, s.outEnd)) };
}
