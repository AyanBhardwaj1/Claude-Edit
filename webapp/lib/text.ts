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

// curly apostrophes (iOS / macOS smart punctuation, some recognisers) read as straight ones: "don’t" is "don't"
export const bare = (t: string) => t.toLowerCase().replace(/[’‘ʼ]/g, "'").replace(/[^\p{L}\p{N}'%$€£]/gu, "");
const split = (t: string) => { const m = t.match(/^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/su)!; return [m[1], m[2], m[3]] as const; };   // é is a letter

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

/** The number a run of spoken number words says, and how many words it used. Words only combine the way numbers are
 *  said (twenty + four, three + hundred, two hundred + fifty, ... thousand), so "three two one" stays three numbers
 *  and "seven eleven" two; "twenty twenty four" and "nineteen ninety five" are years. A run stops at punctuation
 *  ("two, three ideas"), and a number followed by "point" is left as words ("one point five"). */
function numberRun(tokens: string[], raws: string[] = []): [number, number, boolean?] | null {
  type Kind = "ones" | "teen" | "tens" | "scale" | null;
  const kindOf = (t: string): Kind => t in TENS ? "tens" : t in SCALES ? "scale" : t in ONES ? (ONES[t] >= 10 ? "teen" : "ones") : null;
  let total = 0, cur = 0, used = 0, last: Kind = null;
  let beforeAnd: [number, number, number] | null = null;      // "two hundred and three hundred" is two numbers
  let lastScale = 0, andScale = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i], k = kindOf(t);
    if (i > 0 && /[,.;:!?]$/.test(raws[i - 1] ?? "")) break;          // "two, three ideas"
    if (t === "and" && last === "scale" && i + 1 < tokens.length && ["ones", "teen", "tens"].includes(kindOf(tokens[i + 1]) ?? "")) {
      beforeAnd = [total, cur, used]; andScale = lastScale; used++; continue;   // "two hundred and fifty"
    }
    if (!k) break;
    const ok = last === null ? k !== "scale" || false
      : k === "ones" ? last === "tens" || last === "scale"
      : k === "teen" || k === "tens" ? last === "scale"
      : (cur || total) > 0;                                          // a scale after any number word
    if (!ok) {
      // a year said in two halves: nineteen | ninety five, twenty | twenty four (only right after 19 or 20)
      if (used && total === 0 && (cur === 19 || cur === 20) && (k === "tens" || k === "teen")) {
        const rest = numberRun(tokens.slice(i), raws.slice(i));
        const g = rest && rest[0] >= 10 && rest[0] <= 99 && tokens.slice(i, i + rest[1]).every((x) => !(x in SCALES)) ? rest : null;
        if (g) return tokens[i + g[1]] === "point" ? null : [cur * 100 + g[0], used + g[1], true];   // a year: no comma
      }
      break;
    }
    // "...and three hundred": two numbers; "...and fifty thousand" (a bigger scale) is one
    if (k === "scale" && beforeAnd && SCALES[t] <= andScale) { [total, cur, used] = beforeAnd; break; }
    if (k === "scale" && SCALES[t] < 1000 && cur >= SCALES[t]) break;            // "two hundred three hundred"
    if (k === "scale") { lastScale = SCALES[t]; cur = Math.max(cur, 1) * SCALES[t]; if (SCALES[t] >= 1000) { total += cur; cur = 0; } }
    else cur += k === "tens" ? TENS[t] : ONES[t];
    last = k; used++;
  }
  if (!used || tokens[used] === "point") return null;              // "one point five": leave as said
  const value = total + cur;
  // "two thousand (and) twenty four" is a year: 2024, not 2,024
  return [value, used, value >= 2001 && value <= 2099 && tokens[0] === "two" && tokens[1] === "thousand" && used > 2];
}

const fmt = (n: number) => (n >= 1000 ? n.toLocaleString("en-US") : String(n));

export function digits(words: CapWord[]): CapWord[] {
  const out: CapWord[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    const toks = words.slice(i, i + 8).map((x) => bare(x.text));
    const afterPoint = out.length > 0 && bare(out[out.length - 1].text) === "point";   // "one point five": as said
    const run = afterPoint ? null : numberRun(toks, words.slice(i, i + 8).map((x) => x.text));
    const loneOne = run && toks[0] === "one" && run[1] === 1 && !(out.length && ONE_AFTER.has(bare(out[out.length - 1].text)));
    if (run && !loneOne) {
      const [value, used, year] = run;
      let n = used;
      const [lead] = split(w.text);
      let [, , trail] = split(words[i + n - 1].text);
      let text = year ? String(value) : fmt(value), oe = words[i + n - 1].oe;
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
    if (next) c.end = Math.min(c.end, Math.max(c.start + 0.05, next.start - 0.02));   // a short cue never runs into the next
  });
  return cues;
}

export function captionWords(words: OutWord[], corrections: { from: string; to: string }[], bleeps?: string[]): CapWord[] {
  const out = digits(applyCorrections(spokenWords(words), corrections));
  if (!bleeps?.length) return out;
  const hide = new Set(bleeps);
  return out.map((w) => (hide.has(w.id) ? { ...w, text: maskWord(w.text) } : w));
}

/** A bleeped word as subtitles show it: the first letter, then stars ("fucking," -> "f******,"). */
export function maskWord(text: string): string {
  let first = true;
  return text.replace(/\p{L}/gu, (c) => { if (first) { first = false; return c; } return "*"; });
}

/** One caption word per written word. A pasted script (lib/retext.ts) can leave a heard word holding several script words
 *  ("Chat GPT": split over its time by length) or none (its text merged into the word before: that word stays up). */
export function spokenWords(words: OutWord[]): CapWord[] {
  const out: CapWord[] = [];
  for (const w of words) {
    const toks = w.w.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) {
      const prev = out[out.length - 1];
      if (prev && prev.seg === w.seg) prev.oe = w.oe;
      continue;
    }
    if (toks.length === 1) { out.push({ id: w.id, text: toks[0], os: w.os, oe: w.oe, seg: w.seg }); continue; }
    const weights = toks.map((t) => t.length + 1), total = weights.reduce((x, y) => x + y, 0);
    let acc = 0;
    toks.forEach((t, k) => {
      const os = w.os + ((w.oe - w.os) * acc) / total;
      acc += weights[k];
      out.push({ id: k ? `${w.id}.${k}` : w.id, text: t, os, oe: w.os + ((w.oe - w.os) * acc) / total, seg: w.seg });
    });
  }
  return out;
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
    if (next) c.end = Math.min(c.end, Math.max(c.start + 0.05, next.start - 0.02));   // never into the next line
  });
  return cues;
}

/** How many characters a boxed line holds in this frame at this type size (42 where it fits, fewer on a narrow reel). */
export const boxedChars = (frameW: number, size: number) => Math.max(18, Math.min(42, Math.floor((0.86 * frameW) / (0.5 * size))));

/** About how long a short line takes to read on a phone: a moment to notice it, then ~4 words a second. */
export const readTime = (text: string) => 0.4 + 0.25 * text.trim().split(/\s+/).filter(Boolean).length;

/** Hashtags from what was typed: spaces, commas or a new # split them ("#reels#editing" is two). */
export const parseTags = (text: string) => text.split(/[\s,#]+/).filter(Boolean).map((h) => "#" + h);
