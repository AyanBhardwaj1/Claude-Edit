/** The scroll test: what someone scrolling past sees in the first 3 seconds with the sound off (how most people meet a
 *  reel). Four things decide whether they stop: a hook written on screen, the words readable without sound, the
 *  picture moving, and an opening that is the point (no throat clearing). From the edit alone, no AI. */
import { changeTimes } from "./attention";
import { hookOf } from "./hooks";
import { indexOf, keptIndexes, spanOf, type Timeline } from "./timeline";
import type { Edit, Range, Word } from "./types";

export const SCROLL_SECONDS = 3;
export type ScrollLine = { id: "hook" | "read" | "moves" | "open" | "loop"; ok: boolean; text: string; fix?: string };

const WEAK = ["so", "um", "uh", "okay", "ok", "hey", "hi", "hello", "today", "alright", "well", "like"];

/** About how long a short line takes to read on a phone: a moment to notice it, then ~4 words a second. */
export const readTime = (text: string) => 0.4 + 0.25 * text.trim().split(/\s+/).filter(Boolean).length;

/** How long the hook title is on screen, as the compositor shows it: its words plus a short hold, at least 2 s,
 *  unless the next picture or card starts sooner. */
function hookShown(tl: Timeline, e: Edit, hook: Edit["broll"][number]): number {
  // the compositor's rule (lib/compositor.ts buildScene): layers sorted by start; only the next one cuts a layer
  // short, and only when it starts more than 0.3 s after it
  const sorted = e.broll.map((b) => ({ b, sp: spanOf(tl, b.anchor, 0.13) })).filter((x) => x.sp).sort((x, y) => x.sp![0] - y.sp![0]);
  const k = sorted.findIndex((x) => x.b === hook);
  if (k < 0) return 0;
  const sp = sorted[k].sp!;
  let end = Math.max(sp[1] + 0.15, sp[0] + 2.0);
  const next = sorted[k + 1]?.sp;
  if (next && next[0] < end && next[0] > sp[0] + 0.3) end = next[0];
  return Math.min(end, tl.duration) - sp[0];
}

export function scrollTest(tl: Timeline, e: Edit): { lines: ScrollLine[]; passed: number } {
  const lines: ScrollLine[] = [];
  const hookText = hookOf(e);
  const hook = e.broll.find((b) => b.treatment === "text-pop" && b.style === "label" && b.tilt === 0);
  const hs = hook ? spanOf(tl, hook.anchor) : null;
  const up = hook && hs ? hookShown(tl, e, hook) : 0;
  const need = readTime(hookText);
  lines.push(hs && hs[0] <= 0.5 && up < need
    ? { id: "hook", ok: false, text: `“${hookText}” is up for ${up.toFixed(1)} s: ${hookText.split(/\s+/).length} words need about ${need.toFixed(1)} s to read.`,
        fix: up < 2 ? "The next picture or card cuts it short: start that one a little later." : "Shorten the hook (Try 5 hooks), or anchor it over more words." }
    : hs && hs[0] <= 0.5
    ? { id: "hook", ok: true, text: `They read “${hookText}” before the first word lands.` }
    : { id: "hook", ok: false, text: hs ? `The hook title only shows at ${hs[0].toFixed(1)} s: by then most have scrolled.` : "Nothing tells them why to stay: there's no hook title.",
        fix: "Try 5 hooks, or write a note: “add a hook title”." });
  const first = tl.words.find((w) => w.w.trim());
  const read = e.captions.enabled && !!first && first.os <= 0.6;
  lines.push(read
    ? { id: "read", ok: true, text: `Subtitles carry your words from ${first!.os.toFixed(1)} s, so silence costs nothing.` }
    : { id: "read", ok: false, text: !e.captions.enabled ? "With the sound off they see a mouth moving and no words."
        : first ? `The first word only comes at ${first.os.toFixed(1)} s: ${first.os.toFixed(1)} s of nothing to read.` : "No one speaks in the first seconds.",
        fix: !e.captions.enabled ? "Edit it myself → Subtitles → Show subtitles." : "Cut the silence at the start (Edit it myself → Cut)." });
  // the hook title is something to read, not the picture moving: it doesn't count here
  const moves = changeTimes(tl, { ...e, broll: e.broll.filter((b) => b !== hook) }).filter((t) => t > 0.2 && t <= SCROLL_SECONDS).length
    + e.zooms.filter((z) => { const s = spanOf(tl, z.anchor); return !!s && s[0] <= 0.2; }).length;
  lines.push(moves
    ? { id: "moves", ok: true, text: `The picture changes ${moves === 1 ? "once" : `${moves} times`} in the first ${SCROLL_SECONDS} seconds.` }
    : { id: "moves", ok: false, text: `The same still shot for ${SCROLL_SECONDS} seconds: it reads like a photo in a fast feed.`,
        fix: "Add a zoom or a picture on the first sentence, or turn on punch-in cuts (Motion)." });
  const opener = (first?.w ?? "").toLowerCase().replace(/[^a-z']/g, "");
  lines.push(first && WEAK.includes(opener)
    ? { id: "open", ok: false, text: `It opens with “${first.w.trim()}”: a warm-up, not the point.`, fix: "In Edit it myself → Cut, click the first words to cut them." }
    : { id: "open", ok: true, text: "The first word is already the point." });
  return { lines, passed: lines.filter((l) => l.ok).length };
}

/** The loop: a reel replays itself, so the last second runs straight into the first. Dead air or a trailing goodbye at
 *  the end is where people swipe instead of watching it again. */
export const LOOP_TAIL = 2.5, LOOP_HEAD = 2;
const GOODBYE = /\b(bye|see you|thanks for watching|that's it|peace out)\b/i;   // a CTA ("follow for more") is a choice, not a sign-off

export function loopCheck(tl: Timeline): ScrollLine & { id: "loop" } {
  const spoken = tl.words.filter((w) => w.w.trim());
  const last = spoken[spoken.length - 1];
  if (!last) return { id: "loop", ok: false, text: "Nothing is said, so there's nothing to loop.", fix: "Bring some words back (Edit it myself → Cut)." };
  const air = tl.duration - last.oe;
  const tail = spoken.filter((w) => w.os >= tl.duration - 3).map((w) => w.w.trim()).join(" ");
  if (GOODBYE.test(tail)) return { id: "loop", ok: false, text: `It ends on “${tail.split(" ").slice(-4).join(" ")}”: a sign-off tells people to swipe.`,
    fix: "End on your last real point: cut the sign-off (Edit it myself → Cut)." };
  if (air > 0.6) return { id: "loop", ok: false, text: `${air.toFixed(1)} s of nothing after the last word before it starts again.`,
    fix: "Cut the quiet ending, or lower the longest pause kept (Edit it myself → Cut)." };
  return { id: "loop", ok: true, text: "It goes straight from the last word back to the hook: easy to watch twice." };
}

/** The edit without the warm-up words it opens with ("so", "um", "today", ...): up to 3 words, only from the start of
 *  the opening, and anything anchored on them (the hook title, zooms, music lifts) moves to the new first word.
 *  Null when it doesn't open with one, or too little would be left. */
export function cutWarmUp(words: Word[], e: Edit): { edit: Edit; cut: string } | null {
  const runs = keptIndexes(words, e.keep);
  const opening = runs[0];
  if (!opening) return null;
  const gone: number[] = [];
  for (const i of opening) {
    const w = words[i].w.trim();
    if (!w) { gone.push(i); continue; }                       // an empty word (pasted script) goes with the cut
    if (gone.filter((g) => words[g].w.trim()).length >= 3 || !WEAK.includes(w.toLowerCase().replace(/[^a-z']/g, ""))) break;
    gone.push(i);
  }
  while (gone.length && !words[gone[gone.length - 1]].w.trim()) gone.pop();   // keep trailing empties with what stays
  const said = gone.filter((g) => words[g].w.trim());
  const left = runs.flat().filter((i) => words[i].w.trim()).length - said.length;
  if (!said.length || left < 3) return null;
  const idx = indexOf(words);
  const cut = new Set(gone.map((i) => words[i].id));
  const first = words[opening[gone.length]]?.id ?? words[runs[1][0]].id;
  const next = structuredClone(e);
  const r0 = next.keep.find((r) => cut.has(r.from) || cut.has(r.to));
  // the opening run lies inside one keep range: move its start past the cut words (drop it if nothing is left)
  if (r0) {
    const a = idx.get(r0.from)!, b = idx.get(r0.to)!;
    // the first word left in this range: in the opening run, or the next take's when the range runs on into it
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const after = opening[gone.length] ?? runs.slice(1).flat().find((i) => i > opening[opening.length - 1] && i >= lo && i <= hi);
    if (after === undefined) next.keep.splice(next.keep.indexOf(r0), 1);
    else if (a <= b) r0.from = words[after].id; else r0.to = words[after].id;
  }
  const move = (r: Range) => { if (cut.has(r.from)) r.from = first; if (cut.has(r.to)) r.to = first; };
  next.broll.forEach((b) => move(b.anchor));
  next.zooms.forEach((z) => move(z.anchor));
  next.music?.automation?.forEach((m) => move(m.anchor));
  next.translation?.lines.forEach((l) => move(l));          // translated subtitles start on the new first word too
  return { edit: next, cut: said.map((i) => words[i].w.trim()).join(" ") };
}
