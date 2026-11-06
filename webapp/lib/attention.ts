/** Where viewers may drift: a second-by-second risk (0 calm .. 1 likely to scroll away) from what the edited reel
 *  shows and says. Three causes, the ones short-form retention data keeps pointing at:
 *    still  the same picture for too long (nothing new on screen for more than ~3 s)
 *    quiet  dead air (no word for more than ~0.7 s)
 *    slow   talking slowly (under ~110 words a minute over 4 s)
 *  It uses the same "something new" events as the reel check (cuts with a transition, pictures, zooms), so the two
 *  agree. A heuristic to point at weak moments, not a prediction of anyone's watch time. */
import { motionOf } from "./edit";
import { spanOf, type Timeline } from "./timeline";
import type { Edit } from "./types";

export type Cause = "still" | "quiet" | "slow";
export type Spot = { from: number; to: number; cause: Cause; risk: number; text: string; fix: string };
export type Attention = { step: number; risk: number[]; spots: Spot[] };

const STEP = 0.5;
const clamp = (x: number) => Math.max(0, Math.min(1, x));

/** The moments something new arrives on screen (output seconds), as the reel check counts them. */
export function changeTimes(tl: Timeline, e: Pick<Edit, "broll" | "zooms" | "motion">): number[] {
  const m = motionOf(e as Edit);
  return [0, ...(m.transition !== "none" ? tl.segments.slice(1).map((s) => s.outStart) : []),
    ...e.broll.map((b) => spanOf(tl, b.anchor)?.[0]).filter((x): x is number => x !== undefined),
    ...e.zooms.map((z) => spanOf(tl, z.anchor)?.[0]).filter((x): x is number => x !== undefined)].sort((a, b) => a - b);
}

export function attention(tl: Timeline, e: Pick<Edit, "broll" | "zooms" | "motion">): Attention {
  const dur = tl.duration, n = Math.max(0, Math.ceil(dur / STEP));
  const changes = changeTimes(tl, e);
  const words = tl.words.filter((w) => w.w.trim());
  const risk: number[] = [], cause: Cause[] = [];
  let ci = 0;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * STEP;
    while (ci + 1 < changes.length && changes[ci + 1] <= t) ci++;
    const still = clamp((t - changes[ci] - 3) / 4);                  // 0 up to 3 s of the same picture, 1 at 7 s
    const near = words.some((w) => w.os - 0.35 <= t && t <= w.oe + 0.35);
    const quiet = near ? 0 : 0.7;                                        // a gap of ~0.7 s or more with no word
    const inWin = words.filter((w) => w.os >= t - 2 && w.os < t + 2).length;
    const wpm = (inWin / Math.min(4, Math.max(1, Math.min(t + 2, dur) - Math.max(0, t - 2)))) * 60;
    const slow = near && wpm < 110 ? clamp((110 - wpm) / 80) * 0.5 : 0;
    const top = Math.max(still, quiet, slow);
    risk.push(+clamp(top + 0.25 * (still + quiet + slow - top)).toFixed(3));
    cause.push(top === still ? "still" : top === quiet ? "quiet" : "slow");
  }
  // weak spots: runs at or above 0.55, named by their most common cause
  const spots: Spot[] = [];
  for (let i = 0; i < n;) {
    if (risk[i] < 0.55) { i++; continue; }
    let j = i;
    while (j < n && risk[j] >= 0.55) j++;
    const counts = { still: 0, quiet: 0, slow: 0 } as Record<Cause, number>;
    for (let k = i; k < j; k++) counts[cause[k]]++;
    const c = (Object.keys(counts) as Cause[]).sort((a, b) => counts[b] - counts[a])[0];
    let from = i * STEP;
    const to = Math.min(dur, j * STEP), peak = Math.max(...risk.slice(i, j));
    if (c === "still") from = changes.filter((x) => x <= from).pop() ?? from;   // the stretch starts at the last change
    if (to - from >= 1) spots.push({ from, to, cause: c, risk: peak, ...describe(c, from, to, changes) });
    i = j;
  }
  spots.sort((a, b) => b.risk * (b.to - b.from) - a.risk * (a.to - a.from));
  return { step: STEP, risk, spots: spots.slice(0, 3) };
}

function describe(c: Cause, from: number, to: number, changes: number[]): { text: string; fix: string } {
  if (c === "still") {
    const since = changes.filter((x) => x <= from).pop() ?? 0;
    return { text: `${Math.floor(to - since)} s of the same picture`, fix: "Add a zoom, a picture or a card there." };
  }
  if (c === "quiet") return { text: `${(to - from).toFixed(1)} s with nothing said`, fix: "Tighten the pause (Edit it myself → Cut), or put a picture over it." };
  return { text: "Slow talking", fix: "Cut a few words there, or speed the video up a little (Edit it myself)." };
}

/** One-click fix for a "same picture" spot: alternating punch-in zooms about every 3 s across it, each on the word
 *  being said there and held ~1.5 s (the same kind of zoom the AI editor places). Other spots return null. */
export function zoomsFor(tl: Timeline, e: Edit, spot: Spot): Edit | null {
  if (spot.cause !== "still") return null;
  const words = tl.words.filter((w) => w.w.trim());
  const zooms = [...e.zooms];
  let k = 0;
  for (let t = Math.max(0, spot.from); t < spot.to - 0.5; t += 3) {
    const first = words.find((w) => w.os >= t);
    if (!first || first.os > spot.to) break;
    const last = [...words].reverse().find((w) => w.oe <= first.os + 1.6 && w.os >= first.os) ?? first;
    if (zooms.some((z) => z.anchor.from === first.id)) continue;
    zooms.push({ anchor: { from: first.id, to: last.id }, scale: k++ % 2 ? 1.25 : 1.15 });
  }
  return zooms.length > e.zooms.length ? { ...e, zooms } : null;
}

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** The weak spots as a note for the AI editor, with times it pins to the words there (lib/moments.ts). */
export function spotsNote(spots: Spot[]): string {
  const what = (s: Spot) => s.cause === "still" ? `the same picture for ${Math.floor(s.to - s.from)} seconds`
    : s.cause === "quiet" ? `nothing said for ${Math.max(1, Math.floor(s.to - s.from))} seconds` : "slow talking";
  const parts = spots.map((s) => `at ${mmss(s.from)} to ${mmss(s.to)} (${what(s)})`);
  return `Viewers may drift ${parts.join("; and ")}. Keep them watching there: a picture, a card or a zoom on what I'm ` +
    "saying, or a tighter cut. Don't cut any of my points.";
}
