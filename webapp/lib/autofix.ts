/** Fix what I can: every one-click fix that doesn't change what is said or shown about the speaker, applied
 *  together as one version: subtitles on, the warm-up opener cut, movement in the first seconds and wherever the
 *  picture sits still, subtitles raised clear of the apps' caption block. Editorial calls (a cold open, bleeps,
 *  logos, the hook's words) stay with the user. */
import { attention, zoomsFor } from "./attention";
import { clearPosition } from "./safezones";
import { cutWarmUp, SCROLL_SECONDS, scrollTest } from "./scrolltest";
import { buildTimeline } from "./timeline";
import type { Edit, Project } from "./types";

export function fixWhatICan(p: Project, start: Edit, vertical: boolean): { edit: Edit; done: string[] } | null {
  const durs = p.sources.map((s) => s.duration);
  const done: string[] = [];
  let e = start;
  if (!e.captions.enabled) { e = { ...e, captions: { ...e.captions, enabled: true } }; done.push("subtitles on"); }
  const warm = cutWarmUp(p.words, e);
  if (warm) { e = warm.edit; done.push(`cut the warm-up “${warm.cut}”`); }
  let tl = buildTimeline(p.words, e, durs);
  if (!scrollTest(tl, e).lines.find((l) => l.id === "moves")?.ok) {
    const z = zoomsFor(tl, e, { from: 0.4, to: SCROLL_SECONDS, cause: "still", risk: 1, text: "", fix: "" });
    if (z) { e = z; done.push("a zoom in the first seconds"); tl = buildTimeline(p.words, e, durs); }
  }
  let still = 0;
  for (const sp of attention(tl, e).spots.filter((s) => s.cause === "still")) {
    const z = zoomsFor(tl, e, sp);
    if (z) { e = z; still++; }
  }
  if (still) done.push(`zooms where the picture sat still (${still} place${still > 1 ? "s" : ""})`);
  if (vertical) {
    const pos = clearPosition(e);
    if (pos !== null) { e = { ...e, captions: { ...e.captions, position: pos } }; done.push("subtitles raised clear of the app buttons"); }
  }
  return done.length ? { edit: e, done } : null;
}
