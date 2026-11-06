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

/** The subtitles' vertical band on a 9:16 frame (0-1), as the compositor draws them at their tallest: word captions
 *  (one line in its box, 1.35 x the size), boxed subtitles (up to 2 lines at 0.56 x the size, padded) or translated
 *  lines (up to 2 at 0.82 x the size). */
export function captionBand(e: Pick<Edit, "captions"> & { translation?: Edit["translation"] }): [number, number] {
  const size = e.captions.size;
  const half = e.captions.preset === "boxed" ? (3.2 * 0.56 * size) / 2
    : e.translation?.lines.length ? (2.45 * 0.82 * size) / 2 : 0.7 * size;
  return [e.captions.position - half / 1920, e.captions.position + half / 1920];
}

/** Platforms whose bottom block covers a good part (30%+) of the subtitles' band. */
export function subtitlesCovered(e: Pick<Edit, "captions"> & { translation?: Edit["translation"] }): Platform[] {
  if (!e.captions.enabled) return [];
  const [a, b] = captionBand(e);
  return (Object.keys(ZONES) as Platform[]).filter((pl) => {
    const bottom = ZONES[pl][2];
    return Math.max(0, b - Math.max(a, bottom.y0)) / (b - a) >= 0.3;
  });
}

/** The lowest subtitle position (closest to where they were) that every platform's bottom block leaves clear, below the
 *  top bars; null when they are already clear or too big to fit anywhere. */
export function clearPosition(e: Pick<Edit, "captions"> & { translation?: Edit["translation"] }): number | null {
  if (!subtitlesCovered(e).length) return null;
  const [a, b] = captionBand(e);
  const half = (b - a) / 2;
  const floor = Math.min(...(Object.keys(ZONES) as Platform[]).map((pl) => ZONES[pl][2].y0));
  const roof = Math.max(...(Object.keys(ZONES) as Platform[]).map((pl) => ZONES[pl][0].y1));
  const pos = Math.floor((floor - half - 0.01) * 100) / 100;     // the whole line above the highest bottom block
  return pos - half >= roof ? pos : null;
}
