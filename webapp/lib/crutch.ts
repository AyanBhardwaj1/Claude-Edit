// Crutch words: "basically", "literally", "you know," … said out of habit. Counted in what the cut plays, and cut
// everywhere in one click. Only the forms that are safe to drop: "you know" and "I mean" with a comma or a pause
// after them ("do you know" stays), "actually" and "like" only set off by a comma ("it actually works" stays).
import { bare } from "./text";
import { indexOf } from "./timeline";
import { played, ranges } from "./takes";
import type { Project, Range, Word } from "./types";

export type Crutch = { name: string; hits: string[][] };     // each hit: the word ids said

const ALWAYS = ["basically", "literally", "honestly", "obviously"];
const pauseAfter = (ws: Word[], i: number) => i + 1 < ws.length && ws[i + 1].src === ws[i].src && ws[i + 1].s - ws[i].e > 0.25;
const comma = (w: Word) => /[,;—–-]$/.test(w.w.trim());
const setOff = (ws: Word[], i: number) => comma(ws[i]) || pauseAfter(ws, i) || /[.!?]$/.test(ws[i].w.trim());

export function crutches(p: Project, keep: Range[]): Crutch[] {
  const ws = p.words;
  const seq = played(p, keep, indexOf(ws));
  const on = new Set(seq);
  const found = new Map<string, string[][]>();
  const add = (name: string, ids: string[]) => found.set(name, [...(found.get(name) ?? []), ids]);
  for (const i of seq) {
    const w = bare(ws[i].w), next = on.has(i + 1) && ws[i + 1]?.src === ws[i].src ? i + 1 : -1;
    if (ALWAYS.includes(w)) add(w, [ws[i].id]);
    else if ((w === "actually" || w === "like") && (comma(ws[i]) && (i === 0 || comma(ws[i - 1]) || !on.has(i - 1) || /[.!?]$/.test(ws[i - 1].w.trim()))))
      add(w, [ws[i].id]);                                  // ", like," / "Actually, …": set off on both sides
    else if (next >= 0 && ((w === "you" && bare(ws[next].w) === "know") || (w === "i" && bare(ws[next].w) === "mean")) && setOff(ws, next)
      && !(i > 0 && on.has(i - 1) && /^(do|did|don't|if|what|as|would|could)$/.test(bare(ws[i - 1].w))))
      add(`${w === "i" ? "I" : "you"} ${bare(ws[next].w)}`, [ws[i].id, ws[next].id]);
  }
  return [...found].map(([name, hits]) => ({ name, hits })).sort((a, b) => b.hits.length - a.hits.length);
}

/** The cut without these words, in the same order. */
export function cutWords(p: Project, keep: Range[], ids: string[]): Range[] {
  const idx = indexOf(p.words);
  return ranges(p, played(p, keep, idx).filter((i) => !withBlanks(p, ids.map((id) => idx.get(id))).has(i)));
}

/** These word indices and the blank words after each: a pasted script's word can hold the sound of the empty words
 *  that follow it (lib/retext.ts), so they're cut and brought back with it, as clicking the word does. */
function withBlanks(p: Project, at: (number | undefined)[]): Set<number> {
  const out = new Set<number>();
  for (const i of at) {
    if (i == null) continue;
    out.add(i);
    for (let j = i + 1; j < p.words.length && !p.words[j].w.trim() && p.words[j].src === p.words[i].src; j++) out.add(j);
  }
  return out;
}

/** Every place the words of `query` are said, in order (its last word may be the start of one: "sub" finds
 *  "subscribe"), as word ids. Case and punctuation don't matter. */
export function findWords(p: Project, query: string): string[][] {
  const q = query.split(/\s+/).map(bare).filter(Boolean);
  if (!q.length) return [];
  const spoken = p.words.map((w, i) => ({ i, b: bare(w.w) })).filter((x) => x.b);
  const out: string[][] = [];
  for (let k = 0; k + q.length <= spoken.length; k++) {
    let ok = true;
    for (let j = 0; j < q.length && ok; j++) {
      const b = spoken[k + j].b;
      ok = j === q.length - 1 ? b.startsWith(q[j]) : b === q[j];
      if (ok && j > 0 && p.words[spoken[k + j].i].src !== p.words[spoken[k].i].src) ok = false;
    }
    if (ok) out.push(q.map((_, j) => p.words[spoken[k + j].i].id));
  }
  return out;
}

/** The cut with these words back in: each next to the word said before or after it, so a re-ordered cut keeps its
 *  order; a word with no neighbour playing goes where it was filmed. */
export function restoreWords(p: Project, keep: Range[], ids: string[]): Range[] {
  const idx = indexOf(p.words);
  const seq = played(p, keep, idx);
  const on = new Set(seq);
  const add = [...withBlanks(p, ids.map((id) => idx.get(id)))].filter((i) => !on.has(i)).sort((a, b) => a - b);
  // whole runs of consecutive words go back together, next to the word said before or after the run
  const runs: number[][] = [];
  for (const i of add) {
    const r = runs[runs.length - 1];
    if (r && r[r.length - 1] === i - 1 && p.words[i - 1].src === p.words[i].src) r.push(i); else runs.push([i]);
  }
  for (const r of runs) {
    const a = r[0], b = r[r.length - 1];
    const before = a > 0 && p.words[a - 1].src === p.words[a].src ? seq.indexOf(a - 1) : -1;
    const after = b + 1 < p.words.length && p.words[b + 1].src === p.words[b].src ? seq.indexOf(b + 1) : -1;
    let at: number;
    if (before >= 0) at = before + 1;
    else if (after >= 0) at = after;
    else { at = seq.findIndex((x) => x > b); if (at < 0) at = seq.length; }
    seq.splice(at, 0, ...r);
  }
  return ranges(p, seq);
}
