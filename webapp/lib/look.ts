// "My look": how this person's videos look and move, saved once and used on every new video (and on any old one with
// a click): the subtitle style, the motion (animations, transitions, colour look), the pace (pauses, talking speed) and
// the music level. Never what's said, cut or shown: those belong to each video. Kept in Settings, so it follows the
// account between devices.
import { motionOf } from "./edit";
import type { Edit } from "./types";

export type Look = Pick<Edit, "captions" | "gapCap"> & { motion: NonNullable<Edit["motion"]>; musicLevel: Edit["music"]["level"];
  speed?: number; savedAt: string };

export function lookOf(e: Edit): Look {
  return { captions: { ...e.captions }, gapCap: e.gapCap, motion: { ...motionOf(e) }, musicLevel: e.music.level,
    speed: e.speed, savedAt: new Date().toISOString() };
}

/** The edit wearing the look: everything else (cut, pictures, words, music choice, post) as it was. */
export function withLook(e: Edit, look: Look): Edit {
  return { ...e, captions: { ...look.captions }, gapCap: look.gapCap, motion: { ...look.motion },
    music: { ...e.music, level: look.musicLevel }, speed: look.speed && look.speed !== 1 ? look.speed : undefined };
}

/** Whether an edit already wears this look (the button then says so instead of offering it again). */
export function wears(e: Edit, look: Look): boolean {
  const a = lookOf(e), b = look;
  // keys in a fixed order: a look that came back from the server (jsonb reorders object keys) must still match
  return stable([a.captions, a.gapCap, a.motion, a.musicLevel, a.speed ?? 1]) === stable([b.captions, b.gapCap, b.motion, b.musicLevel, b.speed ?? 1]);
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_, x) => (x && typeof x === "object" && !Array.isArray(x)
    ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));
}

export function lookSummary(l: Look): string {
  const c = l.captions;
  return [c.enabled ? `${c.preset} subtitles, ${c.textCase === "upper" ? "upper case" : c.textCase === "lower" ? "lower case" : "as said"}, ` +
    (c.preset === "boxed" ? "a phrase at a time" : `${c.maxWords} word${c.maxWords === 1 ? "" : "s"} at a time`) : "no subtitles", `${l.motion.look} colour`,
    l.speed && l.speed !== 1 ? `${l.speed}× talking` : "", `music ${l.musicLevel.replace("-", " ")}`].filter(Boolean).join(" · ");
}
