/** The cold open: the reel's most gripping line, found without AI, and the edit that opens on it. A line grips when
 *  it has a number, talks to "you", asks a question or uses a strong word ("never", "mistake", "secret"), and is
 *  short enough to land in the first seconds. Moving it to the front is the classic fix for a slow start; the rest
 *  plays in order after it. */
import { hookOf } from "./hooks";
import { indexOf, type Timeline } from "./timeline";
import type { Edit, Range, Word } from "./types";

export type Line = { ids: string[]; text: string; at: number; score: number; why: string[] };

const NUMBER = /\d|[$£€%]|\b(two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|fifty|hundred|thousand|million|billion|half|double|twice|triple)\b/i;
const STRONG = ["never", "always", "only", "biggest", "best", "worst", "mistake", "mistakes", "secret", "stop", "nobody",
  "everyone", "free", "wrong", "truth", "problem", "hack", "quit", "fired", "broke", "lost", "doubled", "tripled", "nothing"];

/** The spoken sentences of the edited reel (output order), split at sentence ends and long pauses. */
function sentences(tl: Timeline): { ids: string[]; text: string; at: number }[] {
  const out: { ids: string[]; text: string; at: number }[] = [];
  let cur: typeof out[number] | null = null, prevEnd = 0;
  for (const w of tl.words) {
    const t = w.w.trim();
    if (!t) continue;
    if (cur && w.os - prevEnd > 0.7) { out.push(cur); cur = null; }
    if (!cur) cur = { ids: [], text: "", at: w.os };
    cur.ids.push(w.id); cur.text += (cur.text ? " " : "") + t; prevEnd = w.oe;
    if (/[.!?]["')]*$/.test(t)) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}

// a line that leans on what came before ("Step two", "Then", "And so") makes no sense as the first thing said
const LEANS = /^(step|tip|part|number|first(ly)?|second(ly)?|third(ly)?|next|then|and|but|so|also|finally|plus|or|because|which|that|this|it|he|she|they|same|another)\b/i;

export function strongestLine(tl: Timeline): Line | null {
  let best: Line | null = null;
  sentences(tl).slice(1).forEach((s) => {                 // the first sentence already opens the reel
    const n = s.ids.length;
    if (n < 4 || n > 16 || LEANS.test(s.text.replace(/^[^a-z]+/i, ""))) return;
    const why: string[] = [];
    let score = 0;
    if (NUMBER.test(s.text)) { score += 2; why.push("a number"); }
    const strong = s.text.toLowerCase().replace(/[^a-z' ]/g, " ").split(/\s+/).find((x) => STRONG.includes(x));
    if (strong) { score += 2; why.push(`a strong word (“${strong}”)`); }
    if (/\byou(r|'re|'ll)?\b/i.test(s.text)) { score += 1; why.push("it talks to “you”"); }
    if (/\?["')]*$/.test(s.text)) { score += 1; why.push("a question"); }
    if (n <= 12) score += 1;
    if (score >= 3 && (!best || score > best.score)) best = { ...s, score, why };
  });
  return best;
}

/** The edit opening on that line: its words move to the front (the rest plays in order after it), and the hook title
 *  moves onto its first words so the reel still opens with something to read. */
export function openWith(words: Word[], e: Edit, line: Line): Edit {
  const idx = indexOf(words);
  const moved = new Set(line.ids);
  const at = line.ids.map((id) => idx.get(id)!).filter((i) => i !== undefined);
  // the line as ranges of consecutive source words (a retake cut inside it stays cut)
  const front: Range[] = [];
  for (const i of at) {
    const last = front[front.length - 1];
    const j = last ? idx.get(last.to)! : -2;
    // consecutive, or only empty (pasted script) words between: those go with the line
    const between = last ? words.slice(j + 1, i) : [];
    if (last && i > j && words[j].src === words[i].src && between.every((w) => !w.w.trim() && w.src === words[i].src)) {
      between.forEach((w) => moved.add(w.id));
      last.to = words[i].id;
    } else front.push({ from: words[i].id, to: words[i].id });
  }
  const rest: Range[] = [];
  for (const r of e.keep) {
    const a = idx.get(r.from), b = idx.get(r.to);
    if (a === undefined || b === undefined) continue;
    let run: Range | null = null;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
      if (moved.has(words[i].id)) { if (run) rest.push(run); run = null; continue; }
      if (run) run.to = words[i].id; else run = { from: words[i].id, to: words[i].id };
    }
    if (run) rest.push(run);
  }
  const next = structuredClone(e);
  next.keep = [...front, ...rest];
  const hook = next.broll.find((b) => b.treatment === "text-pop" && b.style === "label" && b.tilt === 0);
  if (hook && hookOf(e)) hook.anchor = { from: line.ids[0], to: line.ids[Math.min(3, line.ids.length - 1)] };
  return next;
}
