// Words the recogniser wasn't sure it heard (a low confidence), in what the cut plays: names, jargon and mumbles are
// where subtitles go wrong, so they're listed with the words around them to check and fix in one step.
import { FILLERS } from "./analyze";
import { bare } from "./text";
import type { Timeline } from "./timeline";

export type Unsure = { id: string; word: string; p: number; at: number; before: string; after: string };

export function unsureWords(tl: Timeline, corrections: { from: string; to: string }[], limit = 12, below = 0.6): Unsure[] {
  const fixed = new Set(corrections.map((c) => bare(c.from)));
  const ws = tl.words.filter((w) => w.w.trim());
  const seen = new Set<string>();
  const out: Unsure[] = [];
  ws.forEach((w, i) => {
    const b = bare(w.w);
    if (w.p == null || w.p >= below || !b || FILLERS.has(b) || fixed.has(b) || seen.has(b)) return;
    seen.add(b);                                            // once per word: a fix applies everywhere it's said
    out.push({ id: w.id, word: w.w.trim(), p: w.p, at: w.os,
      before: ws.slice(Math.max(0, i - 3), i).map((x) => x.w.trim()).join(" "), after: ws.slice(i + 1, i + 4).map((x) => x.w.trim()).join(" ") });
  });
  return out.sort((a, b) => a.p - b.p).slice(0, limit).sort((a, b) => a.at - b.at);
}
