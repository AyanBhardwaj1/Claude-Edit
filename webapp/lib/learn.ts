/** Learning the user's taste from what they change before exporting (the web twin of `editor style learn`): the
 *  first AI draft of a video is compared with the version they export. A change made in two different videos becomes
 *  a suggested style rule ("Make the subtitles bigger"), offered once with "Remember this for next time?". Nothing is
 *  learned from one video, and nothing is saved without a yes. */
import { readLocal, writeLocal } from "./store";
import type { Edit, Project, StyleRule } from "./types";

const KEY = "ce.learn";
type Tally = Record<string, string[]>;           // signal -> the project ids it was seen in (newest last)

/** The lasting preferences a change from the AI's first draft (a) to the exported edit (b) suggests. */
export function signals(a: Edit, b: Edit): string[] {
  const out: string[] = [];
  const ca = a.captions, cb = b.captions;
  if (ca.enabled && !cb.enabled) out.push("No subtitles");
  if (cb.enabled) {
    if (ca.preset !== cb.preset) out.push(`Use the ${cb.preset} subtitle style`);
    if (cb.size >= ca.size * 1.1) out.push("Make the subtitles bigger");
    if (cb.size <= ca.size * 0.9) out.push("Make the subtitles smaller");
    if (cb.position <= ca.position - 0.08) out.push("Put the subtitles higher");
    if (cb.position >= ca.position + 0.08) out.push("Put the subtitles lower");
    if (ca.textCase !== cb.textCase) out.push(cb.textCase === "upper" ? "Subtitles in capitals" : cb.textCase === "lower" ? "Subtitles in lower case" : "Subtitles as I say them, not in capitals");
    if (ca.font !== cb.font) out.push(`Subtitles in ${cb.font}`);
    if (cb.maxWords < ca.maxWords) out.push("Fewer words on screen at a time");
  }
  if (a.music.level !== b.music.level) out.push(b.music.level === "quiet" ? "Keep the music quiet" : b.music.level === "loud-intro" ? "Start the music loud, then under my voice" : "Music under my voice");
  if (a.music.asset && !b.music.asset) out.push("No music");
  if (a.zooms.length >= 2 && b.zooms.length <= a.zooms.length / 2) out.push("Fewer zooms");
  if (b.zooms.length >= Math.max(2, a.zooms.length * 2)) out.push("More zooms");
  if (a.broll.length >= 2 && b.broll.length <= a.broll.length / 2) out.push("Fewer pictures over me");
  if (b.broll.length >= Math.max(2, a.broll.length * 2)) out.push("More pictures and labels");
  if (a.sfx && !b.sfx) out.push("No sound effects");
  if (b.gapCap >= a.gapCap + 0.1) out.push("Keep more of my pauses");
  if (b.gapCap <= a.gapCap - 0.1) out.push("Tighter cuts with shorter pauses");
  return out;
}

function load(): Tally {
  try { const t = JSON.parse(readLocal(KEY) || "{}"); return t && typeof t === "object" ? t : {}; } catch { return {}; }
}

/** Record an export and return a rule to offer, if a change has now been made in two different videos and isn't a
 *  rule yet (and wasn't declined). */
export function learnFromExport(p: Project, rules: StyleRule[]): string | null {
  const first = p.versions.find((v) => v.n === 1) ?? p.versions[0];
  const cur = p.versions.find((v) => v.n === p.current);
  if (!first || !cur || first === cur) return null;
  const book = load();
  const seen = signals(first.edit, cur.edit);
  for (const s of seen) {
    const own = p.id.replace(/-copy-\w+$/, "");         // a copy is the same video, not a second one
    const ids = (book[s] ?? []).filter((id) => id !== own);
    book[s] = [...ids, own].slice(-8);
  }
  writeLocal(KEY, JSON.stringify(book));
  const have = new Set(rules.map((r) => r.text.toLowerCase()));
  const declined = new Set(book["__declined"] ?? []);
  return seen.find((s) => (book[s]?.length ?? 0) >= 2 && !have.has(s.toLowerCase()) && !declined.has(s)) ?? null;
}

/** "No, just these videos": don't offer this one again. */
export function declineLearned(rule: string) {
  const book = load();
  book["__declined"] = [...new Set([...(book["__declined"] ?? []), rule])];
  writeLocal(KEY, JSON.stringify(book));
}
