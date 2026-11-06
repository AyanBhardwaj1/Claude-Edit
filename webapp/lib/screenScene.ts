// Motion Studio's "App screen" scene: a screenshot as a premium product shot. The app screen sits on a soft backdrop at
// up to 92% of the frame (the framed look of lib/framed.ts: 18 px corners scaled, a soft shadow, a slow 100% -> 107%
// push), punches in to about 160% on the part being talked about, and a small callout pill points at it. The caption
// goes above or below the screen, on the side away from the focus, so it never covers what the video is showing.
// Pure maths only (layout, timing, the busy-region focus finder, focus hints), so it is unit-tested in
// tests/studio_screen.test.ts and the canvas renderer in lib/studio.ts draws from it for preview and export alike.

import { FRAME, framedLayout, framedView, smooth, type Box, type Point, type Punch } from "./framed";
import { clamp01, ease } from "./motion";

export const SCREEN = {
  zoom: 1.6,           // the punch-in on the focus
  punchTime: 0.55,     // seconds the punch-in takes (eased in and out)
  enter: 0.6,          // seconds the screen takes to rise and settle
  calloutIn: 0.35,     // seconds the callout takes to arrive once the punch has landed
  protect: 0.07,       // half the side of the focus box (fraction of the frame's short side) nothing may cover
};

export type ScreenLayout = {
  screen: Box;                 // the picture, at its own shape
  caption: Box | null;         // where the caption's words go (never over the screen)
  side: "top" | "bottom" | "left" | "right";   // the caption's side (left / right: a phone screen in a wide frame)
  capSize: number;             // the caption's largest type size
  radius: number; shadow: { blur: number; dy: number; alpha: number };
};

/** Where the screen and its caption go. With no caption it is exactly the framed look (92% of the frame). With one, the
 *  screen shrinks just enough to leave a caption band above it (focus in the lower half) or below it (focus in the
 *  upper half); tall frames have room to spare, so the screen stays at 92% of the width there. A phone screenshot in a
 *  wide frame stands at 86% of the height with the caption beside it. */
export function screenLayout(o: { W: number; H: number; aw: number; ah: number; caption: boolean; focusY?: number; focusX?: number }): ScreenLayout {
  const { W, H } = o;
  const base = framedLayout({ W, H, aw: o.aw, ah: o.ah, face: null });
  const U = Math.min(W, H);
  const wide = W >= 1.2 * H, tall = H >= 1.2 * W;
  const capSize = (tall ? 0.072 : wide ? 0.062 : 0.064) * U;
  if (!o.caption) return { screen: base.screen, caption: null, side: "bottom", capSize, radius: base.radius, shadow: base.shadow };
  const aspect = Math.min(2.4, Math.max(0.45, (o.aw || 16) / (o.ah || 9)));
  if (wide && aspect < 0.9) {
    // a phone screen in a wide frame: the caption beside it, on the side away from the focus
    const sh = 0.86 * H, sw = sh * aspect, gap = 0.04 * W, cw = Math.min(0.4 * W, W - sw - gap - 0.12 * W);
    const x0 = (W - (sw + gap + cw)) / 2;
    const side: "left" | "right" = (o.focusX ?? 0.5) >= 0.5 ? "left" : "right";
    const sx = side === "left" ? x0 + cw + gap : x0, cx = side === "left" ? x0 : x0 + sw + gap;
    const y = 0.06 * H;
    return { screen: { x: sx, y, w: sw, h: sh }, caption: { x: cx, y: y + 0.15 * sh, w: cw, h: 0.7 * sh }, side, capSize: 0.07 * U,
      radius: base.radius, shadow: base.shadow };
  }
  const capH = (tall ? 0.15 : wide ? 0.16 : 0.17) * H;          // two lines of the caption with air
  const gap = (tall ? 0.03 : 0.025) * H;
  const mt = (tall ? 0.07 : 0.045) * H, mb = (tall ? 0.09 : 0.05) * H;   // tall frames: clear of the platform's top and bottom bars
  const maxH = Math.min(tall ? 0.6 * H : Infinity, H - mt - mb - capH - gap);
  const sw = Math.min(FRAME.scale * W, maxH * aspect), sh = sw / aspect;
  const blockH = capH + gap + sh;
  const blockTop = tall ? Math.min(H - mb - blockH, Math.max(mt, 0.47 * H - blockH / 2)) : mt + (H - mt - mb - blockH) / 2;
  const side: "top" | "bottom" = (o.focusY ?? 0.5) >= 0.5 ? "top" : "bottom";
  const cw = Math.min(0.86 * W, Math.max(sw, 0.7 * W));
  const screenY = side === "top" ? blockTop + capH + gap : blockTop;
  const capY = side === "top" ? blockTop : blockTop + sh + gap;
  return { screen: { x: (W - sw) / 2, y: screenY, w: sw, h: sh }, caption: { x: (W - cw) / 2, y: capY, w: cw, h: capH }, side, capSize,
    radius: base.radius, shadow: base.shadow };
}

/** When the punch-in lands: the scene's own time, or a little over a third of the way in (after the caption has been
 *  read once, with time left to look). Null when the scene has no punch (zoom 1). */
export function punchOf(s: { duration: number; punch?: number; zoom?: number }): Punch | undefined {
  const zoom = s.zoom ?? SCREEN.zoom;
  if (!(zoom > 1.01)) return undefined;
  const auto = Math.min(Math.max(0.9, 0.38 * s.duration), Math.max(0.9, s.duration - 1.6));
  const at = Number.isFinite(s.punch) ? Math.min(Math.max(0, s.punch!), Math.max(0, s.duration - 0.4)) : auto;
  return { at, zoom };
}

/** 0 -> 1 as the screen rises in (ease-out); a pure function of the scene's time, so any frame rate gives the same frame. */
export const screenEnter = (local: number) => ease.out(clamp01(local / SCREEN.enter));
/** 0 -> 1 as the punch-in happens (smooth step over SCREEN.punchTime). */
export const screenPunchK = (local: number, punch?: Punch) => (punch ? smooth((local - punch.at) / SCREEN.punchTime) : 0);
/** 0 -> 1 as the callout arrives: once the punch has landed, or at 0.8 s with no punch. */
export function calloutK(local: number, punch?: Punch): number {
  const from = punch ? punch.at + SCREEN.punchTime * 0.7 : 0.8;
  return ease.out(clamp01((local - from) / SCREEN.calloutIn));
}

/** The source rectangle to draw (lib/framed.ts framedView: cover-fit, push, punch toward the focus, never past the edge). */
export const screenView = (aw: number, ah: number, S: Box, local: number, dur: number, focus: Point | undefined, punch?: Punch) =>
  framedView(aw, ah, S, local, dur, focus, punch, FRAME.kenBurns, SCREEN.punchTime);

/** Where a point of the picture (0-1) is on screen, given the source rectangle being drawn into S. */
export function pointOnScreen(p: Point, aw: number, ah: number, v: Box, S: Box): Point {
  return { x: S.x + ((p.x * aw - v.x) / v.w) * S.w, y: S.y + ((p.y * ah - v.y) / v.h) * S.h };
}

/** The protected box around the focus point (what the punch-in is about), kept inside the screen. */
export function focusBox(pt: Point, S: Box, U: number): Box {
  const r = SCREEN.protect * U;
  const x0 = Math.max(S.x, pt.x - r), y0 = Math.max(S.y, pt.y - r), x1 = Math.min(S.x + S.w, pt.x + r), y1 = Math.min(S.y + S.h, pt.y + r);
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

/** Where the callout pill goes: above the focus point when there is room on the screen, else below, centred on it and
 *  kept inside the screen (or, on a very small screen, inside the frame). `anchor` is where its thin line starts. */
export function calloutPlace(o: { pt: Point; S: Box; W: number; H: number; pillW: number; pillH: number }): { box: Box; above: boolean; anchor: Point } {
  const { pt, S, W, H } = o;
  const U = Math.min(W, H), m = 0.025 * U, gap = Math.max(0.1 * U, SCREEN.protect * U + 0.02 * U);
  // the pill fits on the screen (its words are cut to the width it gets); only a tiny screen lets it out onto the backdrop
  const pillW = Math.min(o.pillW, S.w - 2 * m >= 0.2 * U ? S.w - 2 * m : W - 2 * m), pillH = o.pillH;
  const roomAbove = pt.y - gap - pillH - (S.y + m), roomBelow = S.y + S.h - m - (pt.y + gap + pillH);
  const above = roomAbove >= 0 || roomAbove >= roomBelow;
  let y = above ? pt.y - gap - pillH : pt.y + gap;
  y = Math.min(H - m - pillH, Math.max(m, y));
  const lo = pillW <= S.w - 2 * m ? S.x + m : m, hi = pillW <= S.w - 2 * m ? S.x + S.w - m - pillW : W - m - pillW;
  const x = Math.min(hi, Math.max(lo, pt.x - pillW / 2));
  const box = { x, y, w: pillW, h: pillH };
  const ax = Math.min(x + pillW - pillH / 2, Math.max(x + pillH / 2, pt.x));
  return { box, above, anchor: { x: ax, y: above ? y + pillH : y } };
}

export const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

// ------------------------------------------------------------------ focus with no input: the busiest region

/** The most "busy" region of a picture: the window (30% of each side) with the highest edge density (local contrast) on
 *  a small RGBA copy (draw the picture about 160 px wide and pass getImageData's data). A slight pull to the middle
 *  keeps a busy menu bar on the edge from winning over the content. Returns the centre of the edges in that window
 *  (0-1 of the picture) and the window. A flat picture gives its middle. */
export function busyRegion(data: ArrayLike<number>, w: number, h: number, win = 0.3): { x: number; y: number; box: Box; score: number } {
  const mid = { x: 0.5, y: 0.5, box: { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }, score: 0 };
  if (w < 3 || h < 3) return mid;
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2];
  // edge strength per pixel (capped, so one hard border doesn't outweigh a field of text), as a summed-area table
  const S = new Float64Array((w + 1) * (h + 1));
  let any = 0;
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const gx = x + 1 < w ? Math.abs(lum[i + 1] - lum[i]) : 0, gy = y + 1 < h ? Math.abs(lum[i + w] - lum[i]) : 0;
      const e = Math.min(1, (gx + gy) / 80);
      any += e; row += e;
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  if (any < 1e-6) return mid;
  const sum = (x0: number, y0: number, x1: number, y1: number) => S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0];
  const ww = Math.max(2, Math.round(w * win)), wh = Math.max(2, Math.round(h * win));
  let best = { x: 0, y: 0, score: -1 };
  for (let y = 0; y + wh <= h; y++) {
    for (let x = 0; x + ww <= w; x++) {
      const cx = (x + ww / 2) / w - 0.5, cy = (y + wh / 2) / h - 0.5;
      const score = (sum(x, y, x + ww, y + wh) / (ww * wh)) * (1 - 0.6 * (cx * cx + cy * cy));
      if (score > best.score) best = { x, y, score };
    }
  }
  // the centre of the edges inside the window (a chart in one corner of it pulls the focus onto the chart)
  let sx = 0, sy = 0, sw = 0;
  for (let y = best.y; y < best.y + wh; y++) {
    for (let x = best.x; x < best.x + ww; x++) {
      const e = sum(x, y, x + 1, y + 1);
      sx += e * (x + 0.5); sy += e * (y + 0.5); sw += e;
    }
  }
  const fx = sw ? sx / sw / w : (best.x + ww / 2) / w, fy = sw ? sy / sw / h : (best.y + wh / 2) / h;
  // halfway between the window's middle and the centre of its edges: steady, but drawn to the detail
  const x = clamp01(0.5 * fx + 0.5 * (best.x + ww / 2) / w), y = clamp01(0.5 * fy + 0.5 * (best.y + wh / 2) / h);
  return { x, y, box: { x: best.x / w, y: best.y / h, w: ww / w, h: wh / h }, score: best.score };
}

/** A focus point from words such as "top right", "the left sidebar", "bottom" (the AI's focus hint). Null when the words
 *  name no place, so the busy-region finder decides. */
export function hintFocus(hint?: string): Point | null {
  const h = (hint ?? "").toLowerCase();
  if (!h.trim()) return null;
  let x: number | null = null, y: number | null = null;
  if (/\b(left|sidebar|side bar|side menu)\b/.test(h)) x = 0.2;
  if (/\bright\b/.test(h)) x = 0.8;
  if (/\b(top|upper|header|nav|navigation|menu bar|toolbar|title bar)\b/.test(h)) y = 0.18;
  if (/\b(bottom|lower|footer|status bar)\b/.test(h)) y = 0.82;
  if (/\b(centre|center|middle|main)\b/.test(h)) { x ??= 0.5; y ??= 0.5; }
  if (x === null && y === null) return null;
  return { x: x ?? 0.5, y: y ?? 0.5 };
}
