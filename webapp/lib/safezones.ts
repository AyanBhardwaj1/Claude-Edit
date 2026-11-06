/** What Reels, TikTok and Shorts draw over a vertical post (approximate, from the platforms' creator guides; the
 *  same zones as `editor safezone`), and whether the subtitles reach under them. */
import type { Edit } from "./types";

export type Platform = "reels" | "tiktok" | "shorts";
export type Zone = { x0: number; y0: number; x1: number; y1: number; what: string };

export const ZONES: Record<Platform, Zone[]> = {
  reels: [{ x0: 0, y0: 0, x1: 1, y1: 0.09, what: "Top bar" }, { x0: 0.88, y0: 0.40, x1: 1, y1: 0.88, what: "Buttons" },
    { x0: 0, y0: 0.79, x1: 0.86, y1: 1, what: "Name, caption, audio" }],
  tiktok: [{ x0: 0, y0: 0, x1: 1, y1: 0.07, what: "Tabs" }, { x0: 0.86, y0: 0.36, x1: 1, y1: 0.84, what: "Buttons" },
    { x0: 0, y0: 0.77, x1: 0.84, y1: 1, what: "Name, caption, sound" }],
  shorts: [{ x0: 0, y0: 0, x1: 1, y1: 0.07, what: "Top bar" }, { x0: 0.85, y0: 0.42, x1: 1, y1: 0.88, what: "Buttons" },
    { x0: 0, y0: 0.80, x1: 0.85, y1: 1, what: "Channel, title, sound" }],
};
export const PLATFORM_NAMES: Record<Platform, string> = { reels: "Reels", tiktok: "TikTok", shorts: "Shorts" };

/** The subtitles' vertical band on a 9:16 frame (0-1): one line (a few words at a time), as the compositor draws it. */
export function captionBand(e: Pick<Edit, "captions">): [number, number] {
  const half = (e.captions.size * 0.82 * 1.15) / 2 / 1920;  // a line is ~1.15 x the drawn size, centred on position
  return [e.captions.position - half, e.captions.position + half];
}

/** Platforms whose bottom block covers a good part (30%+) of the subtitles' band. */
export function subtitlesCovered(e: Pick<Edit, "captions">): Platform[] {
  if (!e.captions.enabled) return [];
  const [a, b] = captionBand(e);
  return (Object.keys(ZONES) as Platform[]).filter((pl) => {
    const bottom = ZONES[pl][2];
    return Math.max(0, b - Math.max(a, bottom.y0)) / (b - a) >= 0.3;
  });
}
