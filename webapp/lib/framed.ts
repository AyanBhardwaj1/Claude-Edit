// The "framed" treatment: an app screenshot or screen recording at 92% of the frame on a soft backdrop, 18 px rounded
// corners, a soft drop shadow (0 24px 60px, 18% black), a slow Ken Burns push and an optional punch-in toward a focus
// point. The same look as editor/overlay/frame.py (the hackathon demo videos). Pure maths only, so it is unit-tested and
// the compositor (lib/compositor.ts) draws from it for both the live preview and the export.

export type Box = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };
export type Punch = { at: number; zoom: number };

/** The protected eyes-to-chin zone, in output pixels. */
export type FaceZone = { x0: number; x1: number; y0: number; y1: number };

export type FramedLayout = {
  mode: "full" | "split";       // full: the backdrop covers the frame; split: a backdrop band on top, the speaker below
  region: Box;                  // where the backdrop is painted
  screen: Box;                  // the picture, at its own shape
  radius: number; shadow: { blur: number; dy: number; alpha: number };
  bandFrom: number;             // split: where in the speaker's frame (fraction of its height) the band below starts
};

export const IVORY = "#f4f1e6";
export const FRAME = { scale: 0.92, radius: 18, shadowBlur: 60, shadowDy: 24, shadowAlpha: 0.18, kenBurns: 0.07, punchTime: 0.35 };

/** Where the screen goes. 16:9 (and any landscape frame): full frame at 92%. Taller frames: full frame only when no face
 *  is on screen (face null) or the brief asks (full); otherwise a backdrop band on top holds the screen at full width
 *  minus margins and the speaker moves into the band below, so the eyes-to-chin zone is never covered. */
export function framedLayout(o: { W: number; H: number; aw: number; ah: number; face: FaceZone | null; full?: boolean }): FramedLayout {
  const { W, H } = o;
  const U = Math.min(W, H), k = U / 1080;
  const aspect = Math.min(2.4, Math.max(0.45, (o.aw || 16) / (o.ah || 9)));
  const radius = FRAME.radius * k;
  const shadow = { blur: FRAME.shadowBlur * k, dy: FRAME.shadowDy * k, alpha: FRAME.shadowAlpha };
  const fit = (bw: number, bh: number) => { const w = Math.min(bw, bh * aspect); return { w, h: w / aspect }; };
  if (W > H || o.full || !o.face) {
    const { w, h } = fit(FRAME.scale * W, FRAME.scale * H);
    // tall frames keep the screen a little above the middle, clear of the subtitles and the platform's bottom bar
    const cy = W > H ? H / 2 : Math.max(h / 2 + (1 - FRAME.scale) / 2 * H, Math.min(0.45 * H, H / 2));
    return { mode: "full", region: { x: 0, y: 0, w: W, h: H }, screen: { x: (W - w) / 2, y: cy - h / 2, w, h }, radius, shadow, bandFrom: 0 };
  }
  const f = o.face;
  const side = (1 - FRAME.scale) / 2 * W;                              // 4% each side: "full width minus margins"
  const top = Math.max(side, 0.05 * H);                                // clear of the very top edge
  const bottom = Math.max(side, shadow.dy + 1.3 * shadow.blur);        // room under the screen for the whole shadow
  const faceH = f.y1 - f.y0;
  const maxRegion = Math.max(0.34 * H, H - faceH - 0.1 * H);           // the band below keeps the whole face plus air
  const { w, h } = fit(W - 2 * side, Math.min(0.6 * H, maxRegion) - top - bottom);
  const regionH = Math.round(top + h + bottom);
  // the speaker band starts a little above the eyes-to-chin zone, so the zone lands just under the backdrop
  const bandFrom = Math.min(0.45, Math.max(0, (f.y0 - 0.05 * H) / H));
  return { mode: "split", region: { x: 0, y: 0, w: W, h: regionH }, screen: { x: (W - w) / 2, y: top, w, h }, radius, shadow, bandFrom };
}

/** Where a point of the speaker's (un-split) frame lands once a split moves them into the band below the backdrop. */
export const inBand = (L: FramedLayout, y: number, H: number) => (L.mode === "split" ? L.region.h + y - L.bandFrom * H : y);

/** Smooth 0..1 (ease-in-out), the curve the punch-in uses. */
export const smooth = (k: number) => { const x = Math.min(1, Math.max(0, k)); return x * x * (3 - 2 * x); };

/** Ken Burns push (1 -> 1.07, linear over the shot) times the punch-in (eased over 0.35 s from `at`). Pure function of time,
 *  so it is the same at any frame rate and in preview and export. */
export function framedZoom(local: number, dur: number, punch?: Punch, kenBurns = FRAME.kenBurns, punchTime = FRAME.punchTime): number {
  const kb = 1 + kenBurns * Math.min(1, Math.max(0, local / Math.max(0.5, dur)));
  return kb * (punch ? 1 + (punch.zoom - 1) * punchK(local, punch, punchTime) : 1);
}
export const punchK = (local: number, punch?: Punch, punchTime = FRAME.punchTime) => (punch ? smooth((local - punch.at) / punchTime) : 0);

/** The source rectangle (asset pixels) to draw into the screen box: cover-fit, zoomed, anchored on the focus point the way
 *  ffmpeg's zoompan is (x = fx * (iw - iw/zoom)), so it never shows past the picture's edge. Drawing this straight from
 *  the source keeps it at native resolution (one resample, no blurry double scaling). */
export function framedView(aw: number, ah: number, box: { w: number; h: number }, local: number, dur: number,
                           focus?: Point, punch?: Punch, kenBurns = FRAME.kenBurns, punchTime = FRAME.punchTime): Box {
  const ba = box.w / box.h, a = aw / ah;
  // cover: crop the picture to the box's shape (a tall page keeps its top unless a focus says otherwise)
  let cw = aw, ch = ah, cx = 0, cy = 0;
  if (a > ba) { cw = ah * ba; cx = (aw - cw) * (focus?.x ?? 0.5); }
  else if (a < ba) { ch = aw / ba; cy = (ah - ch) * (focus?.y ?? (a < 0.8 * ba ? 0 : 0.5)); }
  const z = framedZoom(local, dur, punch, kenBurns, punchTime);
  const k = punchK(local, punch, punchTime);
  // the push drifts toward the focus; the punch-in arrives on it
  const f = focus ? { x: (focus.x * aw - cx) / cw, y: (focus.y * ah - cy) / ch } : { x: 0.5, y: 0.5 };
  const fx = clamp01(0.5 + (f.x - 0.5) * (punch ? 0.35 + 0.65 * k : 1));
  const fy = clamp01(0.5 + (f.y - 0.5) * (punch ? 0.35 + 0.65 * k : 1));
  const vw = cw / z, vh = ch / z;
  return { x: cx + fx * (cw - vw), y: cy + fy * (ch - vh), w: vw, h: vh };
}
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A soft backdrop from the brand's accent (a light tint on ivory), or ivory itself. */
export function backdropFor(accent?: string | null): string {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return IVORY;
  const n = parseInt(accent.slice(1), 16), base = parseInt(IVORY.slice(1), 16);
  const mix = (sh: number) => Math.round(0.88 * ((base >> sh) & 255) + 0.12 * ((n >> sh) & 255));
  return `#${[16, 8, 0].map((sh) => mix(sh).toString(16).padStart(2, "0")).join("")}`;
}

// ------------------------------------------------------------------ is it a screen?

const SCREEN_ASPECTS = [16 / 9, 16 / 10, 3 / 2, 4 / 3, 9 / 16, 10 / 16, 2 / 3, 3 / 4, 9 / 19.5, 1170 / 2532, 1290 / 2796, 1179 / 2556,
  1080 / 2400, 2560 / 1080, 21 / 9];

/** Does a picture look like a screenshot / screen recording frame? A cheap heuristic on a small RGBA sample (draw the
 *  picture at about 160 px wide and pass getImageData's data): screens are mostly flat colour (many neighbouring pixels
 *  exactly equal, a few colours cover much of the picture); photos have sensor noise and gradients. A common screen shape
 *  (16:9, 16:10, a phone's 19.5:9...) lowers the bar a little. */
export function looksLikeScreen(data: ArrayLike<number>, w: number, h: number, srcW?: number, srcH?: number): boolean {
  const s = screenStats(data, w, h);
  const r = (srcW ?? w) / (srcH ?? h);
  const screenShape = SCREEN_ASPECTS.some((x) => Math.abs(Math.log(r / x)) < 0.02);
  return screenShape ? s.flat >= 0.42 && s.top >= 0.3 : s.flat >= 0.55 && s.top >= 0.4;
}

export function screenStats(data: ArrayLike<number>, w: number, h: number): { flat: number; top: number } {
  let equal = 0, pairs = 0;
  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = 4 * (y * w + x);
      const q = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);     // 5 bits a channel absorbs JPEG wobble
      counts.set(q, (counts.get(q) ?? 0) + 1);
      if (x + 1 < w) {
        const j = i + 4;
        pairs++;
        if (Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) <= 1) equal++;
      }
    }
  }
  const top = [...counts.values()].sort((a, b) => b - a).slice(0, 6).reduce((a, b) => a + b, 0) / Math.max(1, w * h);
  return { flat: equal / Math.max(1, pairs), top };
}
