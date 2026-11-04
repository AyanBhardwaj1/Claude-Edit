// The shapes a video or animation can be made in.
import type { Format } from "./types";

export const FORMATS: Record<Format, { w: number; h: number; name: string; for: string }> = {
  "9:16": { w: 1080, h: 1920, name: "Reel", for: "Reels, TikTok, Shorts" },
  "4:5": { w: 1080, h: 1350, name: "Feed", for: "Instagram and Facebook feed" },
  "1:1": { w: 1080, h: 1080, name: "Square", for: "Feeds and LinkedIn" },
  "16:9": { w: 1920, h: 1080, name: "Wide", for: "YouTube and websites" },
};
