/** Names said but never shown: apps, brands and products the speaker names ("I moved from Notion to Obsidian") with no
 *  picture on screen while they're said. Viewers remember what they see, and a logo on the name is the cheapest
 *  b-roll there is (the Reel Studio check `editor pacing` calls named_not_shown). Without AI: a capitalised word
 *  (or run of them, "Claude Code") that isn't the start of a sentence or a common word. */
import { spanOf, type OutWord, type Timeline } from "./timeline";
import type { Edit } from "./types";

const COMMON = new Set(["i", "i'm", "i've", "i'll", "i'd", "the", "a", "an", "and", "so", "but", "if", "it", "this", "that",
  "my", "you", "we", "when", "what", "okay", "ok", "yeah", "hey", "oh", "monday", "tuesday", "wednesday", "thursday", "friday",
  "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
  "november", "december", "god", "mr", "mrs", "ms", "dr"]);

export type Name = { text: string; from: string; to: string; at: number };

// curly apostrophes (scripts pasted from Notes or Docs) read as straight ones: "I’m" is a common word, not a name
// "Notion's" is Notion: a possessive is the same name (and the same logo search)
const core = (w: string) => w.trim().replace(/[‘’ʼ]/g, "'").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").replace(/'s$/i, "");
const capital = (w: string) => /^\p{Lu}/u.test(core(w)) && !COMMON.has(core(w).toLowerCase()) && core(w).length > 1;

const OPENERS = new Set(["the", "a", "an", "i", "so", "and", "but", "my", "our", "your", "this", "that", "then", "now", "when", "if",
  "it", "we", "you", "he", "she", "they", "what", "how", "why", "here", "there", "today", "yesterday", "also", "just", "okay", "ok",
  "well", "yes", "no", "hey", "hi", "use", "try", "get", "with", "in", "on", "at", "for", "from", "after", "before"]);

export function namedNotShown(tl: Timeline, e: Pick<Edit, "broll">, max = 6): Name[] {
  // what's on screen while a name is said: a picture or clip shows it; a text card only if it spells the name
  const shown = e.broll.map((b) => ({ b, sp: spanOf(tl, b.anchor) })).filter((x) => x.sp)
    .map(({ b, sp }) => ({ a: sp![0] - 0.3, z: sp![1] + 0.3, picture: !!b.asset, text: (b.text ?? b.card?.text ?? "").toLowerCase() }));
  const words = tl.words.filter((w) => w.w.trim());
  const mentions: (Name & { key: string; covered: boolean })[] = [];
  for (let i = 0; i < words.length; i++) {
    const prev = words[i - 1];
    const sentenceStart = !prev || /[.!?]["')]*$/.test(prev.w.trim()) || words[i].os - prev.oe > 1.0;
    if (!capital(words[i].w)) continue;
    let run: OutWord[] = [words[i]];
    while (i + 1 < words.length && capital(words[i + 1].w) && !/[.!?,;:]$/.test(run[run.length - 1].w.trim())) run.push(words[++i]);
    if (sentenceStart) {
      // any word is capitalised here: a name only when it runs on ("Claude Code changed…"), less an opening "The" or "So"
      if (OPENERS.has(core(run[0].w).toLowerCase())) run = run.slice(1);
      else if (run.length < 2) continue;
      if (!run.length) continue;
    }
    const text = run.map((w) => core(w.w)).join(" "), at = run[0].os;
    mentions.push({ text, key: text.toLowerCase(), from: run[0].id, to: run[run.length - 1].id, at,
      covered: shown.some((x) => at >= x.a && at <= x.z && (x.picture || x.text.includes(text.toLowerCase()))) });
  }
  // shown at any mention is enough; otherwise its first mention is where the logo goes
  const covered = new Set(mentions.filter((m) => m.covered).map((m) => m.key));
  const out: Name[] = [], seen = new Set<string>();
  for (const m of mentions) {
    if (covered.has(m.key) || seen.has(m.key)) continue;
    seen.add(m.key);
    out.push({ text: m.text, from: m.from, to: m.to, at: m.at });
    if (out.length >= max) break;
  }
  return out;
}
