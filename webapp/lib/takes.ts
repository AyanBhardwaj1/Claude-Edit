// Pick a take: for each line said more than once (the analysis's retake groups), which take plays now, and a cut
// that plays another one in its place. The cut's order is kept: the new take plays where the old one did.
import { FILLERS } from "./analyze";
import { isSwear } from "./bleep";
import { bare } from "./text";
import { indexOf } from "./timeline";
import type { Edit, Project, Range, RetakeGroup } from "./types";

export type Take = { range: Range; text: string; src: number; s: number; e: number; kept: number };
export type TakeLine = { group: RetakeGroup; takes: Take[]; playing: number };   // playing: -1 when none plays

/** The words the cut plays, by index into p.words, in play order. */
export function played(p: Project, keep: Range[], idx = indexOf(p.words)): number[] {
  const out: number[] = [];
  for (const r of keep) { const a = idx.get(r.from), b = idx.get(r.to); if (a == null || b == null) continue; for (let i = a; i <= b; i++) out.push(i); }
  return out;
}

/** Word indices back into ranges: consecutive words of one take join, anything else starts a new range. */
export function ranges(p: Project, seq: number[]): Range[] {
  const out: Range[] = [];
  let prev = -2;
  for (const i of seq) {
    const last = out[out.length - 1];
    if (last && i === prev + 1 && p.words[i].src === p.words[prev].src) last.to = p.words[i].id;
    else out.push({ from: p.words[i].id, to: p.words[i].id });
    prev = i;
  }
  return out;
}

/** A take's words without the "um" or blank words at its edges: what plays when it's picked. */
function trimmed(p: Project, a: number, b: number): [number, number] {
  const filler = (i: number) => !p.words[i].w.trim() || FILLERS.has(bare(p.words[i].w));
  while (a < b && filler(a)) a++;
  while (b > a && filler(b)) b--;
  return [a, b];
}

const spoken = (p: Project, a: number, b: number) => { let n = 0; for (let i = a; i <= b; i++) if (p.words[i].w.trim()) n++; return n; };

/** Every line said more than once, with how much of each take the cut plays. */
export function takeLines(p: Project, keep: Range[]): TakeLine[] {
  const idx = indexOf(p.words);
  const on = new Set(played(p, keep, idx));
  const out: TakeLine[] = [];
  for (const g of p.analysis?.retakes ?? []) {
    const takes: Take[] = [];
    g.phrases.forEach((r, k) => {
      const a = idx.get(r.from), b = idx.get(r.to);
      if (a == null || b == null) return;
      let n = 0;
      for (let i = a; i <= b; i++) if (on.has(i) && p.words[i].w.trim()) n++;
      const [x, y] = trimmed(p, a, b);
      const said = p.words.slice(x, y + 1).map((w) => w.w).filter((w) => w.trim()).join(" ");
      takes.push({ range: r, text: said ? said[0].toUpperCase() + said.slice(1) : g.texts[k], src: p.words[a].src, s: p.words[a].s, e: p.words[b].e, kept: n / Math.max(1, spoken(p, a, b)) });
    });
    if (takes.length < 2) continue;
    const best = takes.reduce((m, t, k) => (t.kept > takes[m].kept ? k : m), 0);
    out.push({ group: g, takes, playing: takes[best].kept > 0 ? best : -1 });
  }
  return out;
}

/** The cut with take `n` of the line playing in place of the others: whole, where the line played before (or, when
 *  no take played, where it falls in the order it was filmed). */
export function withTake(p: Project, keep: Range[], line: TakeLine, n: number): Range[] {
  const idx = indexOf(p.words);
  const seq = played(p, keep, idx);
  const inLine = new Set<number>();
  for (const t of line.takes) for (let i = idx.get(t.range.from)!; i <= idx.get(t.range.to)!; i++) inLine.add(i);
  // an "um" before or after the line stays out, as in the first cut
  const [a, b] = trimmed(p, idx.get(line.takes[n].range.from)!, idx.get(line.takes[n].range.to)!);
  let at = seq.findIndex((i) => inLine.has(i));
  const rest = seq.filter((i) => !inLine.has(i));
  if (at < 0) { at = rest.findIndex((i) => i > a); if (at < 0) at = rest.length; }
  else at = seq.slice(0, at).filter((i) => !inLine.has(i)).length;
  const take = Array.from({ length: b - a + 1 }, (_, k) => a + k);
  return ranges(p, [...rest.slice(0, at), ...take, ...rest.slice(at)]);
}

/** Take `n` plays in place of the others, and everything placed on the line goes with it: the hook title, pictures,
 *  zooms, music changes, translated lines, chapters and the cover word, moved word for word onto the new take (by
 *  position, clamped to its length). Without this, a title on the old take would silently vanish. */
export function pickTake(p: Project, e: Edit, line: TakeLine, n: number): Edit {
  const idx = indexOf(p.words);
  const next = structuredClone(e);
  next.keep = withTake(p, e.keep, line, n);
  const [na, nb] = trimmed(p, idx.get(line.takes[n].range.from)!, idx.get(line.takes[n].range.to)!);
  const olds = line.takes.filter((_, k) => k !== n).map((t) => trimmed(p, idx.get(t.range.from)!, idx.get(t.range.to)!));
  const move = (id: string): string => {
    const i = idx.get(id);
    if (i == null) return id;
    for (const [a, b] of olds) {
      if (i < a || i > b) continue;
      return p.words[Math.min(nb, na + (i - a))].id;
    }
    return id;
  };
  const fix = (r: Range) => {
    r.from = move(r.from); r.to = move(r.to);
    const a = idx.get(r.from)!, b = idx.get(r.to)!;
    if (a > b) [r.from, r.to] = [r.to, r.from];          // one end moved past the other: keep it a forward range
  };
  next.broll.forEach((b) => fix(b.anchor));
  next.zooms.forEach((z) => fix(z.anchor));
  next.music?.automation?.forEach((m) => fix(m.anchor));
  next.translation?.lines.forEach((l) => fix(l));
  next.chapters?.forEach((c) => { c.from = move(c.from); });
  if (next.cover.word) next.cover.word = move(next.cover.word);
  // a bleep on the old take: the new take's swears are bleeped too (they can sit anywhere in it)
  const bleeped = new Set(e.bleeps ?? []);
  const oldBleep = olds.some(([a, b]) => p.words.slice(a, b + 1).some((w) => bleeped.has(w.id)));
  if (oldBleep) {
    const add = p.words.slice(na, nb + 1).filter((w) => isSwear(w.w)).map((w) => w.id);
    next.bleeps = [...new Set([...(e.bleeps ?? []), ...add])];
  }
  return next;
}
