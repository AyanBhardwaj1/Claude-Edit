/** What really changed between two versions of an edit, measured, in plain lines ("Cut 2.1 s: “about my cat”",
 *  "Music: Sunny Day → Night Drive"). Shown under the AI editor's own summary, so a note's result can be trusted: if
 *  the summary claims a change the edit doesn't have, the list says so (same idea as `editor produce --changes`). */
import { motionOf } from "./edit";
import { buildTimeline } from "./timeline";
import type { Broll, Edit, Project } from "./types";

const q = (s: string) => `“${s.length > 40 ? s.slice(0, 38).trimEnd() + "…" : s}”`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const secs = (s: number) => `${Math.abs(s) < 10 ? Math.abs(s).toFixed(1) : Math.round(Math.abs(s))} s`;
const len = (s: number) => { const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, "0")}`; };

/** Runs of words in the transcript's order that are in `inA` but not in `inB`: their text and first word. */
function runs(p: Project, keepA: Set<string>, keepB: Set<string>): { text: string; id: string }[] {
  const out: { text: string; id: string }[] = [];
  let cur: string[] = [], first = "";
  for (const w of p.words) {
    if (keepA.has(w.id) && !keepB.has(w.id)) { if (w.w.trim()) { if (!cur.length) first = w.id; cur.push(w.w.trim()); } }
    else if (cur.length) { out.push({ text: cur.join(" "), id: first }); cur = []; }
  }
  if (cur.length) out.push({ text: cur.join(" "), id: first });
  return out;
}

const brollName = (p: Project, b: Broll) => b.text ? q(b.text) : b.asset ? (p.library.find((x) => x.key === b.asset)?.name ?? b.asset) : b.card ? "an animated card" : b.treatment;

export type Change = { text: string; at?: string };   // at: a word of the new version where the change can be seen

export function changeList(p: Project, a: Edit, b: Edit): string[] { return changeItems(p, a, b).map((c) => c.text); }

export function changeItems(p: Project, a: Edit, b: Edit): Change[] {
  const out: Change[] = [];
  const add = (text: string, at?: string) => { out.push(at ? { text, at } : { text }); };
  const durs = p.sources.map((x) => x.duration);
  const ta = buildTimeline(p.words, a, durs), tb = buildTimeline(p.words, b, durs);
  if (!same(a.keep, b.keep) || a.gapCap !== b.gapCap) {
    const ka = new Set(ta.words.map((w) => w.id)), kb = new Set(tb.words.map((w) => w.id));
    const cut = runs(p, ka, kb), back = runs(p, kb, ka);
    const d = tb.duration - ta.duration;
    add(`Length ${len(ta.duration)} → ${len(tb.duration)}` + (Math.abs(d) >= 0.05 ? ` (${d < 0 ? "−" : "+"}${secs(d)})` : ""));
    if (cut.length) add(`Cut ${cut.slice(0, 3).map((x) => q(x.text)).join(", ")}${cut.length > 3 ? ` and ${cut.length - 3} more` : ""}`);
    if (back.length) add(`Brought back ${back.slice(0, 3).map((x) => q(x.text)).join(", ")}${back.length > 3 ? ` and ${back.length - 3} more` : ""}`, back[0].id);
    if (a.gapCap !== b.gapCap) add(`Pauses kept up to ${b.gapCap.toFixed(2)} s (was ${a.gapCap.toFixed(2)} s)`);
  }
  if ((a.loudness ?? 0) !== (b.loudness ?? 0)) add(`Loudness ${(b.loudness ?? 0) >= (a.loudness ?? 0) ? "up" : "down"} ${Math.abs((b.loudness ?? 0) - (a.loudness ?? 0)).toFixed(1)} dB`);
  if ((a.speed ?? 1) !== (b.speed ?? 1)) add(`Talking speed ${(a.speed ?? 1) === 1 ? "as filmed" : `${a.speed}×`} → ${(b.speed ?? 1) === 1 ? "as filmed" : `${b.speed}×`}`);
  const ba = new Set(a.bleeps ?? []), bb = new Set(b.bleeps ?? []);
  const bleeped = [...bb].filter((x) => !ba.has(x) && tb.byId.has(x)), unbleeped = [...ba].filter((x) => !bb.has(x) && tb.byId.has(x));
  if (bleeped.length) add(`Bleeped ${bleeped.length} word${bleeped.length > 1 ? "s" : ""}`, bleeped[0]);
  if (unbleeped.length) add(`Unbleeped ${unbleeped.length} word${unbleeped.length > 1 ? "s" : ""}`, unbleeped[0]);
  const ca = a.captions, cb = b.captions;
  if (ca.enabled !== cb.enabled) add(cb.enabled ? "Subtitles on" : "Subtitles off");
  const capBits: string[] = [];
  if (ca.preset !== cb.preset) capBits.push(`style ${ca.preset} → ${cb.preset}`);
  if (ca.font !== cb.font) capBits.push(`font ${ca.font} → ${cb.font}`);
  if (ca.size !== cb.size) capBits.push(cb.size > ca.size ? "bigger" : "smaller");
  if (ca.position !== cb.position) capBits.push(cb.position < ca.position ? "higher" : "lower");
  if (ca.textCase !== cb.textCase) capBits.push(cb.textCase === "upper" ? "capitals" : cb.textCase === "lower" ? "lower case" : "as said");
  if (ca.maxWords !== cb.maxWords) capBits.push(`${cb.maxWords} words at a time`);
  if (capBits.length) add(`Subtitles: ${capBits.join(", ")}`);
  if (!same(a.corrections, b.corrections)) {
    const added = b.corrections.filter((c) => !a.corrections.some((x) => same(x, c)));
    add(added.length ? `Spelling: ${added.slice(0, 3).map((c) => `${c.from} → ${c.to}`).join(", ")}` : "Spelling fixes changed");
  }
  if (!same(a.translation, b.translation)) add(b.translation ? `Subtitles in ${b.translation.lang}` : "Translation removed");
  const ma = a.music, mb = b.music;
  const song = (k: string | null) => (k ? p.library.find((x) => x.key === k)?.name ?? k : "none");
  if (ma.asset !== mb.asset) add(`Music: ${song(ma.asset)} → ${song(mb.asset)}`);
  if (ma.level !== mb.level) add(`Music level: ${ma.level.replace(/-/g, " ")} → ${mb.level.replace(/-/g, " ")}`);
  if (ma.startAt !== mb.startAt) add("Music starts at a different point");
  if (!same(ma.automation, mb.automation)) {
    const fresh = mb.automation.filter((x) => !ma.automation.some((y) => same(x, y)));
    const gone = ma.automation.filter((x) => !mb.automation.some((y) => same(x, y)));
    const down = fresh.filter((x) => x.db < 0).length, up = fresh.length - down;
    const pl = (k: number) => `${k} place${k === 1 ? "" : "s"}`;
    if (down) add(`Music turned down in ${pl(down)}`, fresh.find((x) => x.db < 0)?.anchor.from);
    if (up) add(`Music turned up in ${pl(up)}`, fresh.find((x) => x.db >= 0)?.anchor.from);
    if (gone.length && !fresh.length) add(`Music back to normal in ${pl(gone.length)}`);
  }
  const ida = new Map(a.broll.map((x) => [x.id, x])), idb = new Map(b.broll.map((x) => [x.id, x]));
  const addedB = b.broll.filter((x) => !ida.has(x.id)), goneB = a.broll.filter((x) => !idb.has(x.id));
  const moved = b.broll.filter((x) => ida.has(x.id) && !same(ida.get(x.id), x));
  if (addedB.length) add(`Added ${addedB.slice(0, 3).map((x) => brollName(p, x)).join(", ")}${addedB.length > 3 ? ` and ${addedB.length - 3} more` : ""}`, addedB[0].anchor.from);
  if (goneB.length) add(`Removed ${goneB.slice(0, 3).map((x) => brollName(p, x)).join(", ")}${goneB.length > 3 ? ` and ${goneB.length - 3} more` : ""}`);
  if (moved.length) add(`Changed ${moved.length} picture${moved.length === 1 ? "" : "s"} (${moved.slice(0, 2).map((x) => brollName(p, x)).join(", ")})`, moved[0].anchor.from);
  if (!same(a.zooms, b.zooms)) {
    const n = b.zooms.length - a.zooms.length;
    const newZoom = b.zooms.find((z) => !a.zooms.some((y) => same(y, z)));
    add(n ? `${Math.abs(n)} zoom${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "added" : "removed"}` : "Zooms moved", newZoom?.anchor.from);
  }
  if (!same(a.cover, b.cover)) add(b.cover.text !== a.cover.text ? `Hook title: ${q(b.cover.text)}` : "Cover frame changed");
  if (!same(a.post, b.post)) add("Post caption rewritten");
  if (a.sfx !== b.sfx) add(b.sfx ? "Sound effects on" : "Sound effects off");
  if (!same(motionOf(a), motionOf(b))) add("Motion changed");
  return out;
}
