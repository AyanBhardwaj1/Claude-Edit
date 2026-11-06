// The mix rules shared by the live player and the reel check: how far the song sits under the voice.
// The lesson behind the check: on a skit the music was mixed like a voice-over bed and the team "couldn't hear
// ourselves". Under talking, the song should stay at least MIN_GAP dB below the voice.

import { spanOf, type Timeline } from "./timeline";
import type { Edit } from "./types";

export const LEVEL_GAP = { "under-voice": 19, quiet: 24, "loud-intro": 19 } as const;
export const MIN_GAP = 12;                 // dB below the voice while someone is talking
export const QUIET_VOICE_RMS = 0.03;       // a take's speech level below this sounds far away or noisy

/** The smallest gap (dB) between voice and song while words are spoken, after word-anchored lifts, and where. */
export function speechGap(e: Edit, tl: Timeline): { gap: number; at: number | null } {
  let gap: number = LEVEL_GAP[e.music.level], at: number | null = null;
  for (const a of e.music.automation) {
    if (a.db <= 0) continue;
    const sp = spanOf(tl, a.anchor);
    if (!sp) continue;
    const talking = tl.words.find((w) => w.oe > sp[0] && w.os < sp[1]);
    if (talking && LEVEL_GAP[e.music.level] - a.db < gap) { gap = LEVEL_GAP[e.music.level] - a.db; at = talking.os; }
  }
  if (e.music.level === "loud-intro" && tl.words.length) {
    const first = tl.words[0];
    if (first.os < 0.25 && LEVEL_GAP[e.music.level] - 9 < gap) { gap = LEVEL_GAP[e.music.level] - 9; at = first.os; }
  }
  return { gap, at };
}
