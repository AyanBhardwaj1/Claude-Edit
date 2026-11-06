/** Notes with a time in them ("at 0:12 the music is too loud", "cut what I say at 41s"): the times in the note, and
 *  what the edited video has at each one (the words being said, with their ids, and the pictures and zooms on screen),
 *  so the AI editor changes the right moment instead of guessing from the clock. Same idea as `editor produce --at`. */
import type { Timeline } from "./timeline";
import type { Edit } from "./types";

const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Times mentioned in a note, in seconds of the edited video: "0:12", "1:05.5", "12s", "12 sec", "12 seconds". */
export function noteTimes(note: string): number[] {
  const out: number[] = [];
  const re = /\b(\d{1,2}):([0-5]\d(?:\.\d+)?)\b|\b(\d{1,3}(?:\.\d+)?)\s*(?:s|secs?|seconds?)\b/gi;
  for (const m of note.matchAll(re)) {
    const t = m[1] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[3]);
    if (Number.isFinite(t) && !out.some((x) => Math.abs(x - t) < 0.05)) out.push(t);
  }
  return out.slice(0, 6);
}

/** What the edited video has around each time in the note, as lines for the AI editor ("" when the note has no time). */
export function momentsText(tl: Timeline, e: Pick<Edit, "broll" | "zooms">, note: string, around = 1.5): string {
  const times = noteTimes(note).filter((t) => t <= tl.duration + 1);
  if (!times.length || !tl.words.length) return "";
  const span = (from: string, to: string) => {
    const a = tl.byId.get(from), b = tl.byId.get(to);
    return a && b ? [a.os, b.oe] as const : null;
  };
  return times.map((t) => {
    const near = tl.words.filter((w) => w.oe >= t - around && w.os <= t + around && w.w.trim());
    const at = tl.words.find((w) => w.os <= t && t <= w.oe + 0.25) ?? near[0];
    const lines = [`AT ${clock(t)} (${t.toFixed(1)} s into the edited video):`];
    lines.push(near.length ? `  words said around then: ${near.map((w) => `${w.id}:${w.w.replace(/[<>]/g, "")}`).join(" ")}`
      : "  no words are said around then (a pause or the end)");
    if (at) lines.push(`  the word at that moment: ${at.id} "${at.w.replace(/[<>]/g, "")}"`);
    for (const b of e.broll) {
      const s = span(b.anchor.from, b.anchor.to);
      if (s && s[0] <= t && t <= s[1]) lines.push(`  on screen: picture ${b.id} (${b.treatment}${b.asset ? `, "${b.asset}"` : ""}${b.text ? `, "${b.text}"` : ""}) on ${b.anchor.from}-${b.anchor.to}`);
    }
    for (const z of e.zooms) {
      const s = span(z.anchor.from, z.anchor.to);
      if (s && s[0] <= t && t <= s[1]) lines.push(`  zoom ${z.scale}x on ${z.anchor.from}-${z.anchor.to}`);
    }
    return lines.join("\n");
  }).join("\n");
}

/** A spoken note that points at "here" ("cut this part", "the music's too loud here") means where the player is:
 *  prefix that time, unless the note already says a time. */
export function anchorSpoken(text: string, playerAt: number): string {
  if (noteTimes(text).length || !/\b(here|this (part|bit|moment|spot|line|word|shot)|right now|at this point|just now)\b/i.test(text)) return text;
  const at = `${Math.floor(playerAt / 60)}:${String(Math.floor(playerAt % 60)).padStart(2, "0")}`;
  return `At ${at}, ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
