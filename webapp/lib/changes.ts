/** What really changed between two versions of an edit, measured, in plain lines ("Cut 2.1 s: “about my cat”",
 *  "Music: Sunny Day → Night Drive"). Shown under the AI editor's own summary, so a note's result can be trusted: if
 *  the summary claims a change the edit doesn't have, the list says so (same idea as `editor produce --changes`). */
import { motionOf } from "./edit";
import { buildTimeline } from "./timeline";
import type { Broll, Edit, Project } from "./types";

const q = (s: string) => `“${s.length > 40 ? s.slice(0, 38).trimEnd() + "…" : s}”`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const secs = (s: number) => `${Math.abs(s) < 10 ? Math.abs(s).toFixed(1) : Math.round(Math.abs(s))} s`;
const len = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Runs of words in `ids` order that are in `inA` but not in `inB`, as text. */
function runs(p: Project, keepA: Set<string>, keepB: Set<string>): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of p.words) {
    if (keepA.has(w.id) && !keepB.has(w.id)) { if (w.w.trim()) cur.push(w.w.trim()); }
    else if (cur.length) { out.push(cur.join(" ")); cur = []; }
  }
  if (cur.length) out.push(cur.join(" "));
  return out;
}

const brollName = (p: Project, b: Broll) => b.text ? q(b.text) : b.asset ? (p.library.find((x) => x.key === b.asset)?.name ?? b.asset) : b.card ? "an animated card" : b.treatment;

export function changeList(p: Project, a: Edit, b: Edit): string[] {
  const out: string[] = [];
  const durs = p.sources.map((x) => x.duration);
  const ta = buildTimeline(p.words, a, durs), tb = buildTimeline(p.words, b, durs);
  if (!same(a.keep, b.keep) || a.gapCap !== b.gapCap) {
    const ka = new Set(ta.words.map((w) => w.id)), kb = new Set(tb.words.map((w) => w.id));
    const cut = runs(p, ka, kb), back = runs(p, kb, ka);
    const d = tb.duration - ta.duration;
    out.push(`Length ${len(ta.duration)} → ${len(tb.duration)}` + (Math.abs(d) >= 0.05 ? ` (${d < 0 ? "−" : "+"}${secs(d)})` : ""));
    if (cut.length) out.push(`Cut ${cut.slice(0, 3).map(q).join(", ")}${cut.length > 3 ? ` and ${cut.length - 3} more` : ""}`);
    if (back.length) out.push(`Brought back ${back.slice(0, 3).map(q).join(", ")}${back.length > 3 ? ` and ${back.length - 3} more` : ""}`);
    if (a.gapCap !== b.gapCap) out.push(`Pauses kept up to ${b.gapCap.toFixed(2)} s (was ${a.gapCap.toFixed(2)} s)`);
  }
  const ca = a.captions, cb = b.captions;
  if (ca.enabled !== cb.enabled) out.push(cb.enabled ? "Subtitles on" : "Subtitles off");
  const capBits: string[] = [];
  if (ca.preset !== cb.preset) capBits.push(`style ${ca.preset} → ${cb.preset}`);
  if (ca.font !== cb.font) capBits.push(`font ${ca.font} → ${cb.font}`);
  if (ca.size !== cb.size) capBits.push(cb.size > ca.size ? "bigger" : "smaller");
  if (ca.position !== cb.position) capBits.push(cb.position < ca.position ? "higher" : "lower");
  if (ca.textCase !== cb.textCase) capBits.push(cb.textCase === "upper" ? "capitals" : cb.textCase === "lower" ? "lower case" : "as said");
  if (ca.maxWords !== cb.maxWords) capBits.push(`${cb.maxWords} words at a time`);
  if (capBits.length) out.push(`Subtitles: ${capBits.join(", ")}`);
  if (!same(a.corrections, b.corrections)) {
    const added = b.corrections.filter((c) => !a.corrections.some((x) => same(x, c)));
    out.push(added.length ? `Spelling: ${added.slice(0, 3).map((c) => `${c.from} → ${c.to}`).join(", ")}` : "Spelling fixes changed");
  }
  if (!same(a.translation, b.translation)) out.push(b.translation ? `Subtitles in ${b.translation.lang}` : "Translation removed");
  const ma = a.music, mb = b.music;
  const song = (k: string | null) => (k ? p.library.find((x) => x.key === k)?.name ?? k : "none");
  if (ma.asset !== mb.asset) out.push(`Music: ${song(ma.asset)} → ${song(mb.asset)}`);
  if (ma.level !== mb.level) out.push(`Music level: ${ma.level.replace(/-/g, " ")} → ${mb.level.replace(/-/g, " ")}`);
  if (ma.startAt !== mb.startAt) out.push("Music starts at a different point");
  if (!same(ma.automation, mb.automation)) {
    const fresh = mb.automation.filter((x) => !ma.automation.some((y) => same(x, y)));
    const gone = ma.automation.filter((x) => !mb.automation.some((y) => same(x, y)));
    const down = fresh.filter((x) => x.db < 0).length, up = fresh.length - down;
    const pl = (k: number) => `${k} place${k === 1 ? "" : "s"}`;
    if (down) out.push(`Music turned down in ${pl(down)}`);
    if (up) out.push(`Music turned up in ${pl(up)}`);
    if (gone.length && !fresh.length) out.push(`Music back to normal in ${pl(gone.length)}`);
  }
  const ida = new Map(a.broll.map((x) => [x.id, x])), idb = new Map(b.broll.map((x) => [x.id, x]));
  const addedB = b.broll.filter((x) => !ida.has(x.id)), goneB = a.broll.filter((x) => !idb.has(x.id));
  const moved = b.broll.filter((x) => ida.has(x.id) && !same(ida.get(x.id), x));
  if (addedB.length) out.push(`Added ${addedB.slice(0, 3).map((x) => brollName(p, x)).join(", ")}${addedB.length > 3 ? ` and ${addedB.length - 3} more` : ""}`);
  if (goneB.length) out.push(`Removed ${goneB.slice(0, 3).map((x) => brollName(p, x)).join(", ")}${goneB.length > 3 ? ` and ${goneB.length - 3} more` : ""}`);
  if (moved.length) out.push(`Changed ${moved.length} picture${moved.length === 1 ? "" : "s"} (${moved.slice(0, 2).map((x) => brollName(p, x)).join(", ")})`);
  if (!same(a.zooms, b.zooms)) {
    const n = b.zooms.length - a.zooms.length;
    out.push(n ? `${Math.abs(n)} zoom${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "added" : "removed"}` : "Zooms moved");
  }
  if (!same(a.cover, b.cover)) out.push(b.cover.text !== a.cover.text ? `Hook title: ${q(b.cover.text)}` : "Cover frame changed");
  if (!same(a.post, b.post)) out.push("Post caption rewritten");
  if (a.sfx !== b.sfx) out.push(b.sfx ? "Sound effects on" : "Sound effects off");
  if (!same(motionOf(a), motionOf(b))) out.push("Motion changed");
  return out;
}
