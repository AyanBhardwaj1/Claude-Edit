// Caption text: corrections for misheard phrases, spoken numbers as digits, and 2-3 word chunks.
// Ported from this repo's editor/wordfix.py and captions.py.

import type { OutWord } from "./timeline";

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };
const ONE_AFTER = new Set(["number", "step", "day", "week", "month", "year", "level", "part", "chapter", "rule", "tip",
  "page", "round", "season", "episode", "version", "top", "plus", "minus", "times", "of"]);
const CURRENCY: Record<string, string> = { dollars: "$", dollar: "$", pounds: "£", euros: "€" };

export const bare = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}'%$€£]/gu, "");
const split = (t: string) => { const m = t.match(/^(\W*)(.*?)(\W*)$/su)!; return [m[1], m[2], m[3]] as const; };

export type CapWord = { id: string; text: string; os: number; oe: number; seg: number };

export function applyCorrections(words: CapWord[], corrections: { from: string; to: string }[]): CapWord[] {
  let out = words.map((w) => ({ ...w }));
  const sorted = [...corrections].sort((a, b) => b.from.split(/\s+/).length - a.from.split(/\s+/).length);
  for (const c of sorted) {
    const frm = c.from.split(/\s+/).map(bare).filter(Boolean);
    if (!frm.length) continue;
    for (let i = 0; i <= out.length - frm.length; i++) {
      if (frm.every((f, k) => bare(out[i + k].text) === f)) {
        const [lead] = split(out[i].text);
        const [, , trail] = split(out[i + frm.length - 1].text);
        out[i] = { ...out[i], text: `${lead}${c.to}${trail}`, oe: out[i + frm.length - 1].oe };
        out.splice(i + 1, frm.length - 1);
      }
    }
  }
  return out;
}

function numberRun(tokens: string[]): [number, number] | null {
  let total = 0, cur = 0, used = 0;
  for (const t of tokens) {
    if (t in ONES) cur += ONES[t];
    else if (t in TENS) cur += TENS[t];
    else if (t in SCALES && (cur || total)) { cur = Math.max(cur, 1) * SCALES[t]; if (SCALES[t] >= 1000) { total += cur; cur = 0; } }
    else break;
    used++;
  }
  return used ? [total + cur, used] : null;
}

const fmt = (n: number) => (n >= 1000 ? n.toLocaleString("en-US") : String(n));

export function digits(words: CapWord[]): CapWord[] {
  const out: CapWord[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const toks = words.slice(i, i + 8).map((x) => bare(x.text));
    const run = numberRun(toks);
    const loneOne = run && toks[0] === "one" && run[1] === 1 && !(out.length && ONE_AFTER.has(bare(out[out.length - 1].text)));
    if (run && !loneOne) {
      let [value, n] = run;
      const [lead] = split(w.text);
      let [, , trail] = split(words[i + n - 1].text);
      let text = fmt(value), oe = words[i + n - 1].oe;
      const nxt = i + n < words.length ? bare(words[i + n].text) : "";
      if (nxt === "percent" || nxt === "%") { trail = split(words[i + n].text)[2]; text += "%"; oe = words[i + n].oe; n++; }
      else if (CURRENCY[nxt]) { trail = split(words[i + n].text)[2]; text = CURRENCY[nxt] + text; oe = words[i + n].oe; n++; }
      out.push({ ...w, text: `${lead}${text}${trail}`, oe });
      i += n;
      continue;
    }
    const raw = w.text.trim();
    const prev = out[out.length - 1];
    if (prev && /^,\d{3}\W*$/.test(raw) && /\d$/.test(prev.text)) out[out.length - 1] = { ...prev, text: prev.text + raw, oe: w.oe };
    else if (prev && (bare(raw) === "%" || bare(raw) === "percent") && /\d$/.test(prev.text))
      out[out.length - 1] = { ...prev, text: prev.text + "%", oe: w.oe };
    else out.push(w);
    i++;
  }
  return out;
}

export type Cue = { start: number; end: number; words: CapWord[] };

/** 2-3 word cues, never across a long silence or a sentence end; a cue stays up until the next one starts. */
export function chunk(words: CapWord[], maxWords: number): Cue[] {
  const cues: Cue[] = [];
  for (const w of words) {
    const c = cues[cues.length - 1];
    const prev = c?.words[c.words.length - 1];
    const boundary = !prev || c.words.length >= maxWords || w.os - prev.oe > 0.8 || /[.!?]$/.test(prev.text.trim()) ||
      (w.seg !== prev.seg && w.os - prev.oe > 0.15);
    if (boundary) cues.push({ start: w.os, end: w.oe, words: [w] });
    else { c.words.push(w); c.end = w.oe; }
  }
  cues.forEach((c, k) => {
    const next = cues[k + 1];
    if (next && next.start - c.end < 2) c.end = next.start - 0.02; else c.end += 0.15;
    c.end = Math.max(c.end, c.start + 0.3);
  });
  return cues;
}

export function captionWords(words: OutWord[], corrections: { from: string; to: string }[]): CapWord[] {
  const cw = words.map((w) => ({ id: w.id, text: w.w.trim(), os: w.os, oe: w.oe, seg: w.seg }));
  return digits(applyCorrections(cw, corrections));
}

// ------------------------------------------------------------------ boxed subtitles: a phrase at a time

/** Break a phrase into at most `maxLines` lines of at most `maxChars` characters, as evenly as it will go (a single word
 *  longer than a line stays whole). Returns null when the phrase doesn't fit. */
export function boxedLines(text: string, maxChars = 42, maxLines = 2): string[] | null {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const one = words.join(" ");
  if (one.length <= maxChars || words.length === 1) return [one];
  if (maxLines < 2) return null;
  let best: string[] | null = null, bestD = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ");
    const rest = boxedLines(words.slice(k).join(" "), maxChars, maxLines - 1);
    if (a.length > maxChars || !rest) continue;
    const lens = [a.length, ...rest.map((l) => l.length)];
    const d = Math.max(...lens) - Math.min(...lens) + (a.length <= rest[0].length ? 0 : 0.5);   // on a tie, the shorter line on top
    if (d < bestD) { best = [a, ...rest]; bestD = d; }
  }
  return best;
}

/** Phrase cues for the boxed style: as many words as fit in `maxLines` lines of `maxChars`; a new cue at a sentence end,
 *  a long pause or a cut, and at a comma once a line is full. */
export function boxedCues(words: CapWord[], maxChars = 42, maxLines = 2): Cue[] {
  const cues: Cue[] = [];
  for (const w of words) {
    const c = cues[cues.length - 1];
    const prev = c?.words[c.words.length - 1];
    const sofar = c ? c.words.map((x) => x.text).join(" ") : "";
    const boundary = !prev || !boxedLines(`${sofar} ${w.text}`, maxChars, maxLines) || w.os - prev.oe > 0.8 ||
      /[.!?]["')\]]?$/.test(prev.text.trim()) || (w.seg !== prev.seg && w.os - prev.oe > 0.15) ||
      (/[,;:]$/.test(prev.text.trim()) && sofar.length >= maxChars);
    if (boundary) cues.push({ start: w.os, end: w.oe, words: [w] });
    else { c.words.push(w); c.end = w.oe; }
  }
  cues.forEach((c, k) => {
    const next = cues[k + 1];
    if (next && next.start - c.end < 1.2) c.end = next.start - 0.02; else c.end += 0.3;
    c.end = Math.max(c.end, c.start + 0.6);
  });
  return cues;
}

/** How many characters a boxed line holds in this frame at this type size (42 where it fits, fewer on a narrow reel). */
export const boxedChars = (frameW: number, size: number) => Math.max(18, Math.min(42, Math.floor((0.86 * frameW) / (0.5 * size))));
