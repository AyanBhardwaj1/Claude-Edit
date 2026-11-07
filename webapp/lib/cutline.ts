/** The timeline editor's moves (components/Timeline.tsx), as plain functions on an edit: each kept range is a clip on the
 *  video track; split, delete, move, trim and nudge change `keep` (and what's anchored on it) the way the drawer does,
 *  always on whole words, so subtitles, pictures and zooms stay on the words they belong to. */
import { keepAnchors } from "./crutch";
import { played } from "./takes";
import { indexOf, type Timeline } from "./timeline";
import type { Edit, Project, Range } from "./types";

export type Clip = { k: number; from: string; to: string; start: number; end: number; src: number; text: string };

/** Each kept range as a clip, where it plays in the edited video. */
export function clipsOf(p: Project, e: Edit, tl: Timeline): Clip[] {
  const idx = indexOf(p.words);
  return e.keep.flatMap((r, k) => {
    const a = idx.get(r.from), b = idx.get(r.to);
    if (a == null || b == null) return [];
    // the clip's own words as they play (a word kept twice, by a cold open, is the clip's own occurrence: closest in order)
    const ws = tl.words.filter((w) => { const i = idx.get(w.id)!; return i >= a && i <= b; });
    if (!ws.length) return [];
    const text = p.words.slice(a, b + 1).map((w) => w.w).filter(Boolean).join(" ");
    return [{ k, from: r.from, to: r.to, start: ws[0].os, end: ws[ws.length - 1].oe, src: p.words[a].src, text }];
  });
}

const withKeep = (p: Project, e: Edit, keep: Range[]): Edit => keepAnchors(p, { ...e, keep });

/** Split the clip under the playhead at the word being said there (or the next one). Null when there's nothing to split. */
export function splitAt(p: Project, e: Edit, tl: Timeline, t: number): Edit | null {
  const idx = indexOf(p.words);
  const w = tl.words.find((x) => x.w.trim() && x.oe > t);
  if (!w) return null;
  const at = idx.get(w.id)!;
  const k = e.keep.findIndex((r) => { const a = idx.get(r.from)!, b = idx.get(r.to)!; return at > a && at <= b; });
  if (k < 0) return null;                                             // at a clip's first word: it's split there already
  const r = e.keep[k];
  const keep = [...e.keep.slice(0, k), { from: r.from, to: p.words[at - 1].id }, { from: w.id, to: r.to }, ...e.keep.slice(k + 1)];
  return { ...e, keep };
}

/** Take a clip out (the last one stays: a video needs something in it). */
export function deleteClip(p: Project, e: Edit, k: number): Edit | null {
  if (e.keep.length < 2 || k < 0 || k >= e.keep.length) return null;
  return withKeep(p, e, e.keep.filter((_, i) => i !== k));
}

/** Move a clip to another place in the order (a cold open is a later clip moved to the front). */
export function moveClip(e: Edit, k: number, to: number): Edit | null {
  if (k < 0 || k >= e.keep.length) return null;
  const n = Math.max(0, Math.min(e.keep.length - 1, to));
  if (n === k) return null;
  const keep = [...e.keep];
  const [c] = keep.splice(k, 1);
  keep.splice(n, 0, c);
  return { ...e, keep };
}

/** Trim one end of a clip by whole words: + moves that end later, − earlier. It stays within its take and never takes
 *  words another clip already plays. Null when it can't move. */
export function trimClip(p: Project, e: Edit, k: number, end: "from" | "to", words: number): Edit | null {
  const idx = indexOf(p.words);
  const r = e.keep[k];
  if (!r || !words) return null;
  let a = idx.get(r.from)!, b = idx.get(r.to)!;
  const others = new Set(played(p, e.keep.filter((_, i) => i !== k), idx));
  const src = p.words[a].src;
  const step = Math.sign(words);
  for (let n = 0; n < Math.abs(words); n++) {
    if (end === "from") {
      const x = a + step;
      if (x > b || x < 0 || p.words[x].src !== src || (step < 0 && others.has(x))) break;
      a = x;
    } else {
      const x = b + step;
      if (x < a || x >= p.words.length || p.words[x].src !== src || (step > 0 && others.has(x))) break;
      b = x;
    }
  }
  if (a === idx.get(r.from) && b === idx.get(r.to)) return null;
  const keep = e.keep.map((x, i) => (i === k ? { from: p.words[a].id, to: p.words[b].id } : x));
  return withKeep(p, e, keep);
}

/** Trim an end to a time in its take (dragging a clip's edge): the word nearest that time. */
export function trimToTime(p: Project, e: Edit, k: number, end: "from" | "to", srcTime: number): Edit | null {
  const idx = indexOf(p.words);
  const r = e.keep[k];
  if (!r) return null;
  const a = idx.get(r.from)!, b = idx.get(r.to)!;
  const src = p.words[a].src;
  let best = end === "from" ? a : b, gap = Infinity;
  p.words.forEach((w, i) => {
    if (w.src !== src || !w.w.trim()) return;
    const d = Math.abs((end === "from" ? w.s : w.e) - srcTime);
    if (d < gap) { gap = d; best = i; }
  });
  const delta = best - (end === "from" ? a : b);
  return delta ? trimClip(p, e, k, end, delta) : null;
}

export type LayerKind = "broll" | "zoom";

/** Nudge a picture or a zoom earlier or later by whole played words, keeping its length. */
export function nudgeLayer(p: Project, e: Edit, kind: LayerKind, i: number, words: number): Edit | null {
  const idx = indexOf(p.words);
  const seq = played(p, e.keep, idx);
  const r = kind === "broll" ? e.broll[i]?.anchor : e.zooms[i]?.anchor;
  if (!r) return null;
  const pa = seq.indexOf(idx.get(r.from)!), pb = seq.indexOf(idx.get(r.to)!);
  if (pa < 0 || pb < 0) return null;
  const d = Math.max(-pa, Math.min(seq.length - 1 - pb, words));
  if (!d) return null;
  const anchor = { from: p.words[seq[pa + d]].id, to: p.words[seq[pb + d]].id };
  const next = structuredClone(e);
  if (kind === "broll") next.broll[i].anchor = anchor; else next.zooms[i].anchor = anchor;
  return next;
}

export function deleteLayer(e: Edit, kind: LayerKind, i: number): Edit {
  return kind === "broll" ? { ...e, broll: e.broll.filter((_, j) => j !== i) } : { ...e, zooms: e.zooms.filter((_, j) => j !== i) };
}

/** A text card at the playhead, on the word being said there and the next few (a title, a label, a number). */
export function addText(p: Project, e: Edit, tl: Timeline, t: number, text: string, words = 4): Edit | null {
  const say = text.trim();
  if (!say) return null;
  const idx = indexOf(p.words);
  const seq = played(p, e.keep, idx);
  const w = tl.words.find((x) => x.w.trim() && x.oe > t) ?? tl.words[tl.words.length - 1];
  if (!w) return null;
  const a = seq.indexOf(idx.get(w.id)!);
  if (a < 0) return null;
  const b = Math.min(seq.length - 1, a + Math.max(0, words - 1));
  const id = `text-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return { ...e, broll: [...e.broll, { id, anchor: { from: p.words[seq[a]].id, to: p.words[seq[b]].id }, treatment: "text-pop", text: say.slice(0, 80), style: "label" }] };
}

/** Change a text card's words. */
export function setText(e: Edit, i: number, text: string): Edit | null {
  const b = e.broll[i];
  if (!b || b.treatment !== "text-pop" || !text.trim() || text.trim() === b.text) return null;
  const next = structuredClone(e);
  next.broll[i].text = text.trim().slice(0, 80);
  return next;
}

/** Play a clip twice: a copy right after it (a line said again for effect, or moved to the front as a cold open). */
export function duplicateClip(e: Edit, k: number): Edit | null {
  const r = e.keep[k];
  if (!r) return null;
  return { ...e, keep: [...e.keep.slice(0, k + 1), { ...r }, ...e.keep.slice(k + 1)] };
}
