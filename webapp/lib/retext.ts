// "Paste your script": the script's words with the timing the recogniser heard. Speech recognition mishears names and
// brand words ("met his muse" for "Meta's Muse"); most creators have a script. Ported from this repo's editor/retext.py
// align(): a difflib-style alignment over normalised tokens (lowercase, no punctuation, apostrophes kept).
//
// The rules, chosen so nothing anchored on a word id can break and the cut plays exactly as before:
//  * Words are never added, removed or re-timed. Every heard word keeps its id, take, start and end; only its text
//    changes. So keep ranges, pictures, zooms, labels, music lifts and the cover still point at the same moments.
//  * Equal runs: each heard word takes the script's spelling, casing and punctuation.
//  * Replaced runs (heard "met his muse", script "Meta's Muse"): the same count maps 1:1. A different count spreads the
//    script's words over the heard words in order (token t -> heard word floor(t * n / m)): with more script words a heard
//    word holds two or more ("Chat GPT"), with fewer the extra heard words are left empty and their text merges into the
//    word before (subtitles show that word for the whole span). An ad-lib or filler next to a misheard word stays as it
//    was said when one part of the run clearly sounds like the script's words.
//  * Inserted script words (in the script, not heard): up to 3 squeeze into the neighbouring word (after the word before,
//    or before the next word when the script starts a sentence there); a longer run, or one before the first or after
//    the last word, wasn't said, so it is left out.
//  * Deleted words (said, not in the script: ad-libs, meta-talk): kept exactly as heard, never dropped.
//  * Retakes: the script lands on one take of a line; a second pass aligns each stretch it didn't land on against the
//    script again, taking runs of 4+ matching words (and the misheard words between them), so every take reads right.
//  * Runs that are wildly different sizes (a line said quite differently) keep what was said.
// Subtitles split a word holding several script words over its time (lib/text.ts captionWords).

import { analyze } from "./analyze";
import type { Project, Word } from "./types";

export type ScriptStats = {
  matched: number;    // heard words the script confirms (same word)
  replaced: number;   // script words that replaced misheard ones
  inserted: number;   // script words squeezed in that the recogniser missed
  kept: number;       // heard words not in the script (ad-libs, retakes), kept as said
  skipped: number;    // script words left out because they weren't said
  changed: number;    // heard words whose text is different now
};

/** Lowercase, curly quotes straightened, everything but letters, digits and apostrophes removed. */
export const norm = (t: string) => t.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[^\p{L}\p{N}']/gu, "");

const LABEL = /^\s*(hook|intro|body|cta|call to action|outro|script|what to say|scene \d+|beat \d+)\s*[:\-–]\s*/i;

/** The words of a script as they'd be said: no [blanks] or {notes}, no "Hook:" labels, no "On screen:" section. */
export function scriptTokens(script: string): string[] {
  const lines: string[] = [];
  for (const raw of script.replace(/\r/g, "").split("\n")) {
    if (/^\s*(on[- ]screen( text)?|words on screen|b-?roll|shot list)\s*:?\s*$/i.test(raw)) break;
    lines.push(raw.replace(LABEL, ""));
  }
  return lines.join("\n").replace(/\[[^\]]*\]|\{[^}]*\}/g, " ").split(/\s+/).filter((t) => norm(t) !== "");
}

// ------------------------------------------------------------------ difflib's SequenceMatcher (no junk heuristics)

type Op = ["equal" | "replace" | "delete" | "insert", number, number, number, number];

export const opcodes = (a: string[], b: string[]): Op[] => matcher(b)(a);

/** Aligns any stretch a[alo..ahi) against the whole of b (indexes in the ops are a's and b's own). */
export function matcher(b: string[]) {
  const b2j = new Map<string, number[]>();
  b.forEach((t, j) => { const l = b2j.get(t); if (l) l.push(j); else b2j.set(t, [j]); });
  let prev = new Int32Array(b.length + 1), cur = new Int32Array(b.length + 1);
  let prevSet: number[] = [], curSet: number[] = [];
  const first = (js: number[], lo: number) => { let l = 0, h = js.length; while (l < h) { const m = (l + h) >> 1; if (js[m] < lo) l = m + 1; else h = m; } return l; };
  // the longest run a[i..i+k) == b[j..j+k) inside the window; the earliest such run in a, then in b
  return (a: string[], alo0 = 0, ahi0 = a.length): Op[] => {
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let bi = alo, bj = blo, bk = 0;
    for (let i = alo; i < ahi; i++) {
      const js = b2j.get(a[i]);
      if (js) for (let x = first(js, blo); x < js.length && js[x] < bhi; x++) {
        const j = js[x], k = prev[j] + 1;          // prev[j] = run length ending at a[i-1], b[j-1]
        cur[j + 1] = k; curSet.push(j + 1);
        if (k > bk) { bi = i - k + 1; bj = j - k + 1; bk = k; }
      }
      for (const j of prevSet) prev[j] = 0;
      [prev, cur] = [cur, prev]; [prevSet, curSet] = [curSet, prevSet]; curSet.length = 0;
    }
    for (const j of prevSet) prev[j] = 0;
    prevSet.length = 0;
    return [bi, bj, bk];
  };
  const blocks: [number, number, number][] = [];
  const queue: [number, number, number, number][] = [[alo0, ahi0, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (!k) continue;
    blocks.push([i, j, k]);
    if (alo < i && blo < j) queue.push([alo, i, blo, j]);
    if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
  }
  blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const merged: [number, number, number][] = [];
  for (const blk of blocks) {
    const l = merged[merged.length - 1];
    if (l && l[0] + l[2] === blk[0] && l[1] + l[2] === blk[1]) l[2] += blk[2]; else merged.push([...blk]);
  }
  merged.push([ahi0, b.length, 0]);
  const ops: Op[] = [];
  let i = alo0, j = 0;
  for (const [ai, bj, k] of merged) {
    if (i < ai && j < bj) ops.push(["replace", i, ai, j, bj]);
    else if (i < ai) ops.push(["delete", i, ai, j, bj]);
    else if (j < bj) ops.push(["insert", i, ai, j, bj]);
    i = ai + k; j = bj + k;
    if (k) ops.push(["equal", ai, i, bj, j]);
  }
  return ops;
  };
}

// ------------------------------------------------------------------ how alike two bits of text sound (by letters)

function lcs(x: string, y: string): number {
  const dp = new Int32Array(y.length + 1);
  for (let i = 1; i <= x.length; i++) {
    let prev = 0;
    for (let j = 1; j <= y.length; j++) {
      const tmp = dp[j];
      dp[j] = x[i - 1] === y[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[y.length];
}
/** Shared letters count for, unshared ones against; and the share of letters in common (0-1). */
function likeness(x: string, y: string): { score: number; ratio: number } {
  const l = lcs(x, y);
  return { score: 4 * l - x.length - y.length, ratio: x.length + y.length ? (2 * l) / (x.length + y.length) : 0 };
}

// ------------------------------------------------------------------ the alignment

type Slot = { pre: string[]; body: string[] | null; post: string[] };

export function alignScript(words: Word[], script: string): { words: Word[]; stats: ScriptStats } {
  const toks = scriptTokens(script);
  const a = words.map((w) => norm(w.w)), b = toks.map(norm);
  const slots: Slot[] = words.map(() => ({ pre: [], body: null, post: [] }));
  const stats: ScriptStats = { matched: 0, replaced: 0, inserted: 0, kept: 0, skipped: 0, changed: 0 };
  const n = words.length;

  const insert = (i: number, j1: number, j2: number) => {      // script words j1..j2 belong between heard words i-1 and i
    const m = j2 - j1;
    if (!m) return;
    if (m > 3 || i === 0 || i === n) { stats.skipped += m; return; }
    stats.inserted += m;
    const sentenceStart = j1 > 0 && /[.!?]["')\]]?$/.test(toks[j1 - 1]);
    if (sentenceStart && words[i].src === words[i - 1].src) slots[i].pre.push(...toks.slice(j1, j2));
    else slots[i - 1].post.push(...toks.slice(j1, j2));
  };
  const spread = (i1: number, i2: number, j1: number, j2: number) => {
    const h = i2 - i1, m = j2 - j1;
    for (let i = i1; i < i2; i++) slots[i].body = [];
    for (let t = 0; t < m; t++) slots[i1 + Math.floor((t * h) / m)].body!.push(toks[j1 + t]);
    stats.replaced += m;
  };
  // strict (the edge of a retake): only words that sound like the script's are replaced
  const replace = (i1: number, i2: number, j1: number, j2: number, strict = false) => {
    const h = i2 - i1, m = j2 - j1;
    if (strict && likeness(a.slice(i1, i2).join(""), b.slice(j1, j2).join("")).ratio >= 0.6) { spread(i1, i2, j1, j2); return; }
    if (h === m && !strict) { spread(i1, i2, j1, j2); return; }
    // one part of the longer side sounds like the whole shorter side: replace just that part, keep the rest
    const heardLonger = h > m;
    const [lo, hi, short] = heardLonger ? [i1, i2, b.slice(j1, j2).join("")] : [j1, j2, a.slice(i1, i2).join("")];
    const side = heardLonger ? a : b, len = hi - lo, k = heardLonger ? m : h;
    if (len <= 40 && short.length <= 60) {
      const whole = likeness(side.slice(lo, hi).join(""), short);
      let best: { s: number; e: number; score: number; ratio: number; edge: number } | null = null;
      for (let L = Math.max(1, k - 1); L <= Math.min(len - 1, k + 2); L++) {
        for (let s = lo; s + L <= hi; s++) {
          const x = likeness(side.slice(s, s + L).join(""), short), edge = Math.min(s - lo, hi - s - L);
          // the best sounding part; on a tie, the one nearest an end of the run (next to the words that matched)
          if (!best || x.score > best.score || (x.score === best.score && edge < best.edge)) best = { s, e: s + L, score: x.score, ratio: x.ratio, edge };
        }
      }
      if (best && best.score > whole.score && best.ratio >= 0.5) {
        if (heardLonger) spread(best.s, best.e, j1, j2);
        else {
          insert(i1, j1, best.s);
          spread(i1, i2, best.s, best.e);
          insert(i2, best.e, j2);
        }
        return;
      }
    }
    if (!strict && Math.max(h, m) <= 2 * Math.min(h, m) + 2) { spread(i1, i2, j1, j2); return; }
    stats.skipped += m;                               // said quite differently from the script: keep what was said
  };
  const equal = (i1: number, i2: number, j1: number) => {
    for (let k = 0; k < i2 - i1; k++) slots[i1 + k].body = [toks[j1 + k]];
    stats.matched += i2 - i1;
  };

  const match = matcher(b);
  for (const [op, i1, i2, j1, j2] of match(a)) {
    if (op === "equal") equal(i1, i2, j1);
    else if (op === "insert") insert(i1, j1, j2);
    else if (op === "replace") replace(i1, i2, j1, j2);
  }                                                   // "delete": said, not in the script: kept as heard
  // Second pass: a stretch the script didn't land on (a retake, a line said twice) still gets the script's words where
  // 4 or more in a row match, and the misheard words between two such matches are fixed too, so whichever take the
  // edit keeps reads right. Ad-libs stay as said. Each round finds one more take of a line (up to 4 takes).
  const skipped = stats.skipped;
  const solid = (op?: Op) => !!op && op[0] === "equal" && op[2] - op[1] >= 4;
  const retakes = () => {
    for (let i = 0; i < n;) {
      if (slots[i].body) { i++; continue; }
      let e = i;
      while (e < n && !slots[e].body) e++;
      if (e - i >= 4) {
        const ops = match(a, i, e);
        ops.forEach((op, k) => {
          const [kind, i1, i2, j1, j2] = op;
          const before = solid(ops[k - 1]), after = solid(ops[k + 1]);
          if (solid(op)) equal(i1, i2, j1);
          else if (kind === "replace" && before && after) replace(i1, i2, j1, j2);
          else if (kind === "insert" && before && after) insert(i1, j1, j2);
          // at the start or end of the stretch, next to a match: only the few script words right beside it
          else if (kind === "replace" && after && k === 0) replace(i1, i2, Math.max(j1, j2 - (i2 - i1) - 2), j2, true);
          else if (kind === "replace" && before && k === ops.length - 1) replace(i1, i2, j1, Math.min(j2, j1 + (i2 - i1) + 2), true);
        });
      }
      i = e;
    }
  };
  const plausible = stats.matched >= 0.25 * Math.min(n, toks.length);      // else it's not this video's script: applyScript refuses
  for (let round = 0, was = -1; plausible && round < 4 && stats.matched !== was; round++) { was = stats.matched; retakes(); }
  stats.skipped = skipped;
  stats.kept = slots.filter((x) => !x.body).length;

  const out = words.map((w, i) => {
    const s = slots[i];
    if (!s.body && !s.pre.length && !s.post.length) return { ...w };
    const text = [...s.pre, ...(s.body ?? [w.w.trim()]), ...s.post].join(" ");
    if (text !== w.w) stats.changed++;
    return { ...w, w: text, p: s.body ? 1 : w.p };
  });
  return { words: out, stats };
}

// ------------------------------------------------------------------ on a project

export type ScriptResult = { ok: boolean; stats: ScriptStats; message: string };

/** Plain one-line result, e.g. "Fixed 23 words; kept 4 ad-libs it heard." */
export function scriptMessage(s: ScriptStats): string {
  const parts = [s.changed ? `Fixed ${s.changed} word${s.changed === 1 ? "" : "s"}` : "Your script matches what I heard: nothing to fix"];
  if (s.kept) parts.push(`kept ${s.kept} word${s.kept === 1 ? "" : "s"} you said that aren't in the script`);
  if (s.skipped) parts.push(`left out ${s.skipped} script word${s.skipped === 1 ? "" : "s"} you didn't say`);
  return parts.join("; ") + ".";
}

/** Use a script for the project's words. Always aligns against what was heard (so it can be redone with a better script),
 *  keeps the heard words in p.wordsHeard for "Use what it heard", and re-reads the takes for the next AI edit (the
 *  current versions keep their cut: ids and times don't change). The caller saves. */
export function applyScript(p: Project, script: string): ScriptResult {
  const heard = p.wordsHeard ?? p.words;
  const r = alignScript(heard, script);
  const toks = scriptTokens(script).length;
  if (toks < 2 || r.stats.matched < 0.25 * Math.min(heard.length, toks)) {
    return { ok: false, stats: r.stats, message: toks < 2 ? "Paste a few lines of your script first."
      : `Only ${r.stats.matched} of the script's ${toks} words match what I heard. Is it the script for this video?` };
  }
  if (!p.wordsHeard) p.wordsHeard = heard;
  p.words = r.words;
  p.script = script;
  p.analysis = analyze(p.words);
  return { ok: true, stats: r.stats, message: scriptMessage(r.stats) };
}

/** Back to the words exactly as heard. The script stays, to try again. */
export function restoreHeard(p: Project) {
  if (!p.wordsHeard) return;
  p.words = p.wordsHeard;
  delete p.wordsHeard;
  p.analysis = analyze(p.words);
}
