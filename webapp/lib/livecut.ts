// The landing page's live demo: Cutmind's real first-pass rules (lib/analyze.ts, lib/text.ts) run on typed text.
// A typed take has no timings, so each line becomes a phrase with even word timings and a pause between lines.

import { analyze } from "./analyze";
import { captionWords, chunk } from "./text";
import { buildTimeline } from "./timeline";
import type { Word } from "./types";

export type Mark = "kept" | "retake" | "false start" | "meta-talk" | "filler" | "stutter";
export type CutLine = { text: string; mark: Mark; words: { id: string; w: string; cut: boolean }[]; seconds: number; captions: string[] };
export type CutResult = { lines: CutLine[]; captions: string[]; keptWords: number; totalWords: number; rawSeconds: number; keptSeconds: number };

const WORD = 0.32, GAP = 0.05, PAUSE = 0.9;

export function textToWords(text: string): Word[] {
  const lines = text.replace(/([.!?])\s+/g, "$1\n").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const words: Word[] = [];
  let t = 0;
  for (const line of lines) {
    for (const w of line.split(/\s+/)) {
      words.push({ id: `w${words.length}`, src: 0, s: +t.toFixed(3), e: +(t + WORD).toFixed(3), w });
      t += WORD + GAP;
    }
    t += PAUSE;
  }
  return words;
}

export function liveCut(text: string): CutResult {
  const words = textToWords(text);
  if (!words.length) return { lines: [], captions: [], keptWords: 0, totalWords: 0, rawSeconds: 0, keptSeconds: 0 };
  const a = analyze(words);
  const index = new Map(words.map((w, i) => [w.id, i]));
  const kept = new Set<number>();
  for (const r of a.defaultKeep) for (let i = index.get(r.from)!; i <= index.get(r.to)!; i++) kept.add(i);
  const why = new Map(a.dropped.map((d) => [d.from, d.reason as Mark]));
  const lines: CutLine[] = a.phrases.map((p) => {
    const from = index.get(p.from)!, to = index.get(p.to)!;
    const ws = words.slice(from, to + 1).map((w, k) => ({ id: w.id, w: w.w, cut: !kept.has(from + k) }));
    const dropped = why.get(p.from);
    const partly = !dropped && ws.some((w) => w.cut);
    const filler = partly && ws.filter((w) => w.cut).every((w) => /^(um+|uh+|erm|er|hmm|mm|ah)[,.]?$/i.test(w.w));
    return { text: p.text, words: ws, seconds: +(p.e - p.s).toFixed(1), captions: [] as string[],
      mark: dropped ?? (partly ? (filler ? "filler" : "stutter") : "kept") };
  });
  const tl = buildTimeline(words, { keep: a.defaultKeep, gapCap: 0.12 }, [words[words.length - 1].e + 1]);
  const cues = chunk(captionWords(tl.words, []), 3).map((c) => ({ id: c.words[0].id,
    text: c.words.map((w) => w.text.replace(/[.,!?]+$/, "")).join(" ").toUpperCase() }));
  for (const c of cues) lines.find((l) => l.words.some((w) => w.id === c.id))?.captions.push(c.text);
  const captions = cues.map((c) => c.text);
  return { lines, captions, keptWords: kept.size, totalWords: words.length, rawSeconds: +words[words.length - 1].e.toFixed(1),
    keptSeconds: +tl.duration.toFixed(1) };
}

export const SAMPLE_TAKE = `Okay so. Um, the thing nobody tells you about editing is.
Wait, let me try that again.
The thing nobody tells you about editing is that it takes three hours.
The thing nobody tells you about editing is that it takes three hours for a one minute video.
So I I stopped doing it myself.
Now I just talk, and the cut is done before my coffee is.`;
