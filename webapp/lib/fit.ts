// Fit to a length ("make it under 60 seconds"), without AI: first the pauses get tighter, then the sentences that grip
// least go: a line said again earlier first, then the cold open's rules (no number, no strong word, not to "you",
// long; a line naming something counts for more). The first sentence (the hook) and
// the last (the ending, the call to action) always stay, and at least three sentences are left. It's a proposal: the
// lines it cuts are listed, and each one can be brought back in the words below.
import { sameLine } from "./analyze";
import { grip, sentences } from "./coldopen";
import { cutWords } from "./crutch";
import { buildTimeline } from "./timeline";
import type { Edit, Project } from "./types";

export const FIT_TARGETS = [30, 45, 60, 90] as const;
const TIGHT_GAP = 0.12;

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
      const again = all.slice(0, k + 1).some((o) => sameLine(o.text, s.text));
      const first = timeOf.get(s.ids[0])!, last = timeOf.get(s.ids[s.ids.length - 1])!;
      // a line that names something (a capitalised word mid-sentence: an app, a person, a place) carries content
      const names = s.text.split(/\s+/).slice(1).some((w) => /^[A-Z][a-z]/.test(w.replace(/^[^A-Za-z]+/, "")) && !/^I('|$)/.test(w));
      return { ...s, seconds: last.oe - first.os, score: grip(s.text, s.ids.length).score + (names ? 2 : 0) - (again ? 10 : 0) };
    });
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
