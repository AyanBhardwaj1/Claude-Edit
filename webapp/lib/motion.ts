// The motion layer the compositor draws with: colour looks, transitions at cuts, picture entrances, easing.
// Canvas-only (no libraries), so preview and export are the same pixels.

import type { Look, Motion } from "./types";

export const ease = {
  out: (k: number) => 1 - (1 - k) ** 3,
  back: (k: number) => { const c = 1.70158; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2; },
  inOut: (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2),
};
export const clamp01 = (k: number) => Math.min(1, Math.max(0, k));

/** ctx.filter strings per look (browsers without canvas filters just show the natural picture). */
export const LOOK_FILTER: Record<Look, string> = {
  natural: "none",
  warm: "sepia(0.16) saturate(1.12) contrast(1.03) brightness(1.02)",
  cool: "saturate(0.92) contrast(1.05) brightness(1.01)",
  cinematic: "contrast(1.12) saturate(0.86) brightness(0.97)",
  mono: "grayscale(1) contrast(1.16) brightness(1.02)",
  vivid: "saturate(1.35) contrast(1.06)",
  film: "sepia(0.24) contrast(1.08) saturate(0.88)",
};
export const LOOK_NAME: Record<Look, string> = { natural: "Natural", warm: "Warm", cool: "Cool", cinematic: "Cinematic", mono: "Black and white",
  vivid: "Vivid", film: "Film" };

/** Colour washes and vignettes a look adds on top of the picture. */
export function lookOverlay(g: CanvasRenderingContext2D, look: Look, W: number, H: number) {
  if (look === "cool") { g.save(); g.globalCompositeOperation = "soft-light"; g.fillStyle = "rgba(40,110,190,0.22)"; g.fillRect(0, 0, W, H); g.restore(); }
  if (look === "warm") { g.save(); g.globalCompositeOperation = "soft-light"; g.fillStyle = "rgba(255,150,60,0.14)"; g.fillRect(0, 0, W, H); g.restore(); }
  if (look === "cinematic" || look === "film") {
    if (look === "cinematic") { g.save(); g.globalCompositeOperation = "soft-light"; g.fillStyle = "rgba(0,120,140,0.16)"; g.fillRect(0, 0, W, H); g.restore(); }
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, `rgba(0,0,0,${look === "film" ? 0.5 : 0.42})`);
    g.fillStyle = v; g.fillRect(0, 0, W, H);
  }
}

export type CutFx = { kind: Motion["transition"]; d: number; k: number };
const WIN: Record<Motion["transition"], number> = { none: 0, punch: 0, whip: 0.13, flash: 0.1, fade: 0.16, glitch: 0.1 };

/** The transition around the nearest cut: d = seconds from the cut (negative before), k = strength 0..1. */
export function cutFx(kind: Motion["transition"], cuts: number[], t: number): CutFx | null {
  const w = WIN[kind];
  if (!w) return null;
  let best = Infinity;
  for (const c of cuts) if (Math.abs(t - c) < Math.abs(best)) best = t - c;
  if (Math.abs(best) > w) return null;
  return { kind, d: best, k: 1 - Math.abs(best) / w };
}

/** A tiny deterministic random from a number (glitch slices stay the same in preview and export). */
export const rnd = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Picture entrance and exit: scale, offset, rotation and opacity at time t of a layer. */
export function enter(kind: Motion["brollIn"], t: number, start: number, end: number, H: number) {
  const k = clamp01((t - start) / 0.32), out = clamp01((end - t) / 0.14);
  const alpha = Math.min(1, out * 1.2);
  switch (kind) {
    case "slide": return { s: 1, dx: 0, dy: (1 - ease.out(k)) * 0.22 * H, rot: 0, alpha: Math.min(alpha, 0.2 + 0.8 * ease.out(k)) };
    case "zoom": return { s: 0.55 + 0.45 * ease.back(k), dx: 0, dy: 0, rot: 0, alpha: Math.min(alpha, ease.out(k) * 1.5) };
    case "spin": return { s: 0.6 + 0.4 * ease.back(k), dx: 0, dy: 0, rot: (1 - ease.out(k)) * -14, alpha };
    default: return { s: 0.86 + 0.14 * ease.back(clamp01((t - start) / 0.22)), dx: 0, dy: 0, rot: 0, alpha };
  }
}

/** Relative luminance, for choosing dark or light text on an accent colour. */
export function lightColour(hex: string): boolean {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4;
}
