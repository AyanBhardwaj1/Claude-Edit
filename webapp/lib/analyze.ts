// Read the raw takes before anyone edits: phrases, pauses, retakes (lines said more than once),
// fillers, meta-talk and stutters, and a deterministic default cut (the last complete take of each line).
// The rules follow Reel Studio's engine (MIT) and this repo's editor/plan.py.

import type { Analysis, Range, Word } from "./types";
import { bare } from "./text";

const FILLERS = new Set(["um", "uh", "erm", "er", "hmm", "mm", "uhh", "umm", "ah"]);
const LEAD_SKIP = new Set(["so", "and", "but", "okay", "ok", "alright", "right", "well", "like", "now"]);
const DANGLING = new Set(["and", "the", "to", "a", "of", "but", "so", "because", "with", "or", "that", "i"]);
const META = [/\blet me (do|try|say) (that|this|it) again\b/, /\bone more time\b/, /\bfrom the top\b/, /\bcut (this|that) (out|bit)\b/,
  /\bis (this|it) recording\b/, /\bstart (over|again)\b/, /\bwait,? (wait|hold on)\b/, /\bsorry,? (let me|i)\b/,
  /\btake (two|2|three|3)\b/, /\bthree,? two,? one\b/, /\boops\b/, /\bteleprompter\b/];

type Phrase = Range & { text: string; src: number; s: number; e: number; idx: number[] };

export function phrases(words: Word[]): Phrase[] {
  const out: Phrase[] = [];
  words.forEach((w, i) => {
    const p = out[out.length - 1];
    const prev = words[i - 1];
    const gap = prev ? w.s - prev.e : 99;
    const restart = prev && /^(all right|alright|okay|ok)$/i.test(bare(w.w)) && gap > 0.3;
    if (!p || w.src !== p.src || gap >= 0.45 || (/[.!?]$/.test(prev.w.trim()) && gap >= 0.12) || restart) {
      out.push({ from: w.id, to: w.id, text: w.w, src: w.src, s: w.s, e: w.e, idx: [i] });
    } else {
      p.to = w.id; p.text += " " + w.w; p.e = w.e; p.idx.push(i);
    }
  });
  return out;
}

const tokens = (t: string) => t.split(/\s+/).map(bare).filter((x) => x && !FILLERS.has(x));
function core(t: string): string[] {
  const k = tokens(t);
  let skip = 0;
  while (skip < 2 && k.length > 1 && LEAD_SKIP.has(k[skip])) skip++;
  return k.slice(skip);
}

function matched(a: string[], b: string[]): number {   // longest common subsequence length
  const dp = Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function sameLine(a: string, b: string): boolean {
  const x = core(a), y = core(b);
  if (x.length < 2 || y.length < 2) return false;
  const shorter = Math.min(x.length, y.length);
  const m = matched(x, y);
  if (x[x.length - 1] !== y[y.length - 1] && m < 0.8 * shorter && x.length > 3 && y.length > 3) return false;
  return (x[0] === y[0] && x[1] === y[1] && m >= 0.6 * shorter) || (shorter >= 5 && m >= 0.85 * shorter);
}

export function analyze(words: Word[]): Analysis {
  const ph = phrases(words);
  const drop = new Map<number, string>();          // phrase index -> reason
  // meta-talk and filler-only phrases
  ph.forEach((p, i) => {
    const t = p.text.toLowerCase();
    if (tokens(p.text).length === 0) drop.set(i, "filler");
    else if (tokens(p.text).length <= 14 && META.some((r) => r.test(t))) drop.set(i, "meta-talk");
  });
  // retake groups: a line said again within 10 phrases / 75 s; the last complete take wins
  const parent = ph.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < ph.length; i++) {
    for (let j = i + 1; j < Math.min(ph.length, i + 11); j++) {
      if (ph[j].s - ph[i].e > 75 && ph[j].src === ph[i].src) break;
      if (drop.has(i) || drop.has(j)) continue;
      if (sameLine(ph[i].text, ph[j].text)) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, number[]>();
  ph.forEach((_, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  const retakes: Analysis["retakes"] = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const longest = Math.max(...members.map((i) => tokens(ph[i].text).length));
    const complete = (i: number) => tokens(ph[i].text).length >= 0.55 * longest &&
      !DANGLING.has(bare(ph[i].text.split(/\s+/).pop() ?? ""));
    const done = members.filter(complete);
    const chosen = done.length ? done[done.length - 1] : members.reduce((a, b) => (tokens(ph[b].text).length > tokens(ph[a].text).length ? b : a));
    members.forEach((i) => { if (i !== chosen) drop.set(i, "retake"); });
    retakes.push({ phrases: members.map((i) => ({ from: ph[i].from, to: ph[i].to })), texts: members.map((i) => ph[i].text),
      chosen: members.indexOf(chosen) });
  }
  // false starts: a short phrase right before a retake that was dropped
  ph.forEach((p, i) => {
    if (!drop.has(i) && tokens(p.text).length <= 3 && drop.get(i + 1) === "retake" && ph[i + 1].s - p.e < 1.0)
      drop.set(i, "false start");
  });
  // kept words: drop phrases, then stutters ("I was, I was") and edge fillers inside kept phrases
  const keepIdx: number[] = [];
  ph.forEach((p, i) => {
    if (drop.has(i)) return;
    const idx = p.idx.filter((k, n) => !(FILLERS.has(bare(words[k].w)) && (n === 0 || n === p.idx.length - 1)));
    for (let n = 0; n < idx.length; n++) {
      let stutter = false;
      for (const len of [3, 2, 1]) {
        const a = idx.slice(n, n + len).map((k) => bare(words[k].w)), b = idx.slice(n + len, n + 2 * len).map((k) => bare(words[k].w));
        if (a.length === len && b.length === len && a.join(" ") === b.join(" ") &&
            (len > 1 || ["i", "the", "a", "to", "and", "it", "we", "you"].includes(a[0])) &&
            words[idx[n + len]].s - words[idx[n + len - 1]].e <= 1.0) { stutter = true; break; }
      }
      if (!stutter) keepIdx.push(idx[n]);
    }
  });
  const defaultKeep: Range[] = [];
  keepIdx.forEach((k, n) => {
    const last = defaultKeep[defaultKeep.length - 1];
    if (last && n > 0 && keepIdx[n - 1] === k - 1 && words[k].src === words[k - 1].src) last.to = words[k].id;
    else defaultKeep.push({ from: words[k].id, to: words[k].id });
  });
  const pauses = words.slice(1).map((w, i) => ({ after: words[i].id, seconds: +(w.s - words[i].e).toFixed(2) }))
    .filter((p, i) => p.seconds >= 0.3 && words[i + 1].src === words[i].src);
  const names: string[] = [];
  words.forEach((w, i) => {
    const t = w.w.replace(/[^\p{L}\p{N}'.-]/gu, "");
    if (/^\p{Lu}/u.test(t) && i > 0 && !/[.!?]$/.test(words[i - 1].w) && !["I", "I'm", "I've", "I'll"].includes(t) && !names.includes(t))
      names.push(t);
  });
  const unsure = words.filter((w) => (w.p ?? 1) < 0.6 && !FILLERS.has(bare(w.w))).map((w) => `${w.id}:${w.w}`).slice(0, 40);
  return {
    phrases: ph.map(({ from, to, text, src, s, e }) => ({ from, to, text, src, s, e })),
    pauses, retakes, defaultKeep, names: names.slice(0, 30), unsure,
    dropped: [...drop.entries()].map(([i, reason]) => ({ from: ph[i].from, to: ph[i].to, reason, text: ph[i].text })),
  };
}
