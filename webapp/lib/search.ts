// Search My videos by what was said, not only by title: "the one where I talked about Notion".
import { findWords, spokenOf, type Spoken } from "./crutch";
import type { Project } from "./types";

// My videos loads its projects fresh each visit: each one's words are bared once there, not on every keystroke
const CACHE = new WeakMap<Project, Spoken>();
const cached = (p: Project) => { let v = CACHE.get(p); if (!v) { v = spokenOf(p.words); CACHE.set(p, v); } return v; };

export type Said = { before: string; match: string; after: string; at: number; count: number };

/** Where a project's takes say `query` (its words in order; the last may be the start of a word), with the words around
 *  the first place and how many places there are. */
export function saidIn(p: Project, query: string): Said | null {
  if (!query.trim() || !p.words?.length) return null;
  const hits = findWords(p, query, cached(p));
  if (!hits.length) return null;
  const first = hits[0][0], last = hits[0][hits[0].length - 1];
  const a = p.words.findIndex((w) => w.id === first), b = p.words.findIndex((w, i) => i >= a && w.id === last);
  const text = (i: number, j: number) => p.words.slice(Math.max(0, i), Math.max(0, j)).map((w) => w.w.trim()).filter(Boolean).join(" ");
  return { before: text(a - 4, a), match: text(a, b + 1), after: text(b + 1, b + 5), at: p.words[a].s, count: hits.length };
}
