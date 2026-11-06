// Fit to a length ("make it under 60 seconds"), without AI: first the pauses get tighter, then the sentences that grip
// least go: a line said again earlier first, then the cold open's rules (no number, no strong word, not to "you",
// long; a line naming something counts for more). A list item ("the first one", "step 2", "finally") is never cut. The first sentence (the hook) and
// the last (the ending, the call to action) always stay, and at least three sentences are left. It's a proposal: the
// lines it cuts are listed, and each one can be brought back in the words below.
import { FILLERS } from "./analyze";
import { bare } from "./text";
import { grip, sentences } from "./coldopen";
import { cutWords } from "./crutch";
import { buildTimeline } from "./timeline";
import type { Edit, Project } from "./types";

/** The same sentence said again: near-identical whole lines (not just the same opening, as a retake test allows).
 *  Lines of four core words or fewer must match exactly; longer ones must share the last word and 85% of their words
 *  in order. "So I use Notion." / "And I use Figma." and "I love this." / "I love you." are different lines. */
export function sameSentence(a: string, b: string): boolean {
  const core = (t: string) => t.split(/\s+/).map(bare).filter((w) => w && !FILLERS.has(w));
  const x = core(a), y = core(b);
  if (!x.length || !y.length) return false;
  if (x.join(" ") === y.join(" ")) return true;
  if (Math.min(x.length, y.length) <= 4 || x[x.length - 1] !== y[y.length - 1]) return false;
  const dp = Array.from({ length: x.length + 1 }, () => new Array<number>(y.length + 1).fill(0));
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    dp[i][j] = x[i - 1] === y[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[x.length][y.length] >= 0.85 * Math.max(x.length, y.length);
}

export const FIT_TARGETS = [30, 45, 60, 90] as const;
const TIGHT_GAP = 0.12;
const LIST = /\b(first|second|third|fourth|fifth|number (one|two|three|four|five|\d+)|step|tip|part|finally|lastly)\b/i;

export type FitLine = { ids: string[]; text: string; at: number; seconds: number };
export type FitPlan = { target: number; now: number; after: number; gapCap: number; drop: FitLine[]; reached: boolean };

const durationOf = (p: Project, e: Pick<Edit, "keep" | "gapCap" | "speed">) =>
  buildTimeline(p.words, e, p.sources.map((s) => s.duration)).duration;

export function planFit(p: Project, e: Edit, target: number): FitPlan {
  const now = durationOf(p, e);
  const gapCap = Math.min(e.gapCap, TIGHT_GAP);
  let cur = { keep: e.keep, gapCap, speed: e.speed };
  let after = durationOf(p, cur);
  const drop: FitLine[] = [];
  if (now <= target) return { target, now, after: now, gapCap: e.gapCap, drop, reached: true };
  if (after > target) {
    const tl = buildTimeline(p.words, cur, p.sources.map((s) => s.duration));
    const all = sentences(tl);
    const timeOf = new Map(tl.words.map((w) => [w.id, w]));
    const middle = all.slice(1, -1).map((s, k) => {
      // said already, earlier in the cut: the repeat goes first
      const again = all.slice(0, k + 1).some((o) => sameSentence(o.text, s.text));
      const first = timeOf.get(s.ids[0])!, last = timeOf.get(s.ids[s.ids.length - 1])!;
      // a line that names something (a capitalised word mid-sentence: an app, a person, a place) carries content
      const names = s.text.split(/\s+/).slice(1).some((w) => /^[A-Z][a-z]/.test(w.replace(/^[^A-Za-z]+/, "")) && !/^I('|$)/.test(w));
      // a list item ("The first one is", "Number two", "Step 3", "Finally") is structure: the others lean on it
      const listed = LIST.test(s.text.split(/\s+/).slice(0, 5).join(" "));
      return { ...s, listed: listed && !again, seconds: last.oe - first.os, score: grip(s.text, s.ids.length).score + (names ? 2 : 0) - (again ? 10 : 0) };
    }).filter((s) => !s.listed);                       // never a list item: the others lean on it
    // the least gripping first; between equals, the longest (one cut saves more)
    middle.sort((a, b) => a.score - b.score || b.seconds - a.seconds);
    for (const s of middle) {
      if (after <= target || all.length - drop.length <= 3) break;
      const keep = cutWords(p, cur.keep, s.ids);
      cur = { ...cur, keep };
      after = durationOf(p, cur);
      drop.push({ ids: s.ids, text: s.text, at: s.at, seconds: s.seconds });
    }
    drop.sort((a, b) => a.at - b.at);
  }
  return { target, now, after, gapCap, drop, reached: after <= target + 0.05 };
}

/** The edit with the plan applied: tighter pauses, the listed sentences cut. */
export function applyFit(p: Project, e: Edit, plan: FitPlan): Edit {
  return { ...e, gapCap: plan.gapCap, keep: cutWords(p, e.keep, plan.drop.flatMap((d) => d.ids)) };
}

export type Repeat = { first: FitLine; again: FitLine };

/** Lines the cut plays twice (the same line said again later, not a retake the cut dropped): the later one is
 *  usually the one to go. */
export function repeats(p: Project, e: Pick<Edit, "keep" | "gapCap" | "speed">): Repeat[] {
  const tl = buildTimeline(p.words, e, p.sources.map((s) => s.duration));
  const all = sentences(tl);
  const at = new Map(tl.words.map((w) => [w.id, w]));
  const line = (s: (typeof all)[number]): FitLine =>
    ({ ids: s.ids, text: s.text, at: s.at, seconds: at.get(s.ids[s.ids.length - 1])!.oe - at.get(s.ids[0])!.os });
  const out: Repeat[] = [];
  all.forEach((s, k) => {
    if (s.ids.length < 3) return;                         // "Yes." twice isn't a repeat worth a panel
    const j = all.slice(0, k).findIndex((o) => o.ids.length >= 3 && sameSentence(o.text, s.text));
    if (j >= 0) out.push({ first: line(all[j]), again: line(s) });
  });
  return out;
}
