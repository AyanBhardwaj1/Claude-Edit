/** The scroll test: what someone scrolling past sees in the first 3 seconds with the sound off (how most people meet a
 *  reel). Four things decide whether they stop: a hook written on screen, the words readable without sound, the
 *  picture moving, and an opening that is the point (no throat clearing). From the edit alone, no AI. */
import { changeTimes } from "./attention";
import { hookOf } from "./hooks";
import { spanOf, type Timeline } from "./timeline";
import type { Edit } from "./types";

export const SCROLL_SECONDS = 3;
export type ScrollLine = { id: "hook" | "read" | "moves" | "open" | "loop"; ok: boolean; text: string; fix?: string };

const WEAK = ["so", "um", "uh", "okay", "ok", "hey", "hi", "hello", "today", "alright", "well", "like"];

export function scrollTest(tl: Timeline, e: Edit): { lines: ScrollLine[]; passed: number } {
  const lines: ScrollLine[] = [];
  const hookText = hookOf(e);
  const hook = e.broll.find((b) => b.treatment === "text-pop" && b.style === "label" && b.tilt === 0);
  const hs = hook ? spanOf(tl, hook.anchor) : null;
  lines.push(hs && hs[0] <= 0.5
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
  const moves = changeTimes(tl, e).filter((t) => t > 0.2 && t <= SCROLL_SECONDS).length
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
const GOODBYE = /\b(bye|see you|thanks for watching|that's it|peace|follow for more|subscribe)\b/i;

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
