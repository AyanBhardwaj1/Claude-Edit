// Draws one output frame of an edit (1080x1920 for a reel; 4:5, 1:1 and 16:9 too): the face-following reframe with punch-in zooms, b-roll in
// Reel Studio's treatments placed clear of the eyes-to-chin zone, text cards, then captions on top of everything.

import { drawWatermark } from "./brand";
import { motionOf } from "./edit";
import { faceAt } from "./face";
import { clamp01, cutFx, ease, enter, LOOK_FILTER, lookOverlay, lightColour, rnd } from "./motion";
import { activeBrand, hasBrand } from "./brand";
import { backdropFor, framedLayout, framedView, type FaceZone, type FramedLayout } from "./framed";
import { clipPlan, type Piece } from "./screenrec";
import { drawBackground, drawScene, type Anim, type Scene as CardScene } from "./studio";
import { boxedChars, boxedCues, boxedLines, captionWords, chunk, readTime, type Cue } from "./text";
import { spanOf, type Timeline } from "./timeline";
import type { Asset, Broll, Edit, Format, Project } from "./types";

export { FORMATS } from "./formats";
import { FORMATS } from "./formats";

// The frame being drawn. Every size below is relative to it; U (the short side, 1080 in every format) keeps type and
// cards at the same readable size whichever shape is chosen.
export let W = 1080, H = 1920;
let U = 1080, SAFE_TOP = 0.17 * H, SIDE = 0.035 * W;
export function setFormat(f: Format = "9:16") {
  const d = FORMATS[f] ?? FORMATS["9:16"];
  W = d.w; H = d.h; U = Math.min(W, H);
  SAFE_TOP = (H > W ? 0.17 : 0.08) * H; SIDE = 0.035 * W;
}

export type Layer = {
  b: Broll; start: number; end: number; asset?: Asset;
  el?: HTMLImageElement | HTMLVideoElement;
  plan?: Piece[] | null;          // a trimmed / sped-through clip: shot time -> clip time (lib/screenrec.ts), followed by the player
  place?: { x: number; y: number; w: number; h: number; tilt: number; mode: "card" | "split" | "phone" | "framed"; frame?: FramedLayout };
};

/** Boxed subtitles' type size: the caption size setting scaled to a clean subtitle line (105 -> about 59 px). */
const boxedSize = (e: Edit) => e.captions.size * 0.56 * (U / 1080);

export type Scene = { tl: Timeline; cues: Cue[]; layers: Layer[]; zooms: { s: number; e: number; scale: number }[]; cuts: number[]; emph: Set<string> };

export function buildScene(p: Project, e: Edit, tl: Timeline, media: Map<string, HTMLImageElement | HTMLVideoElement>): Scene {
  const cw = e.captions.enabled ? captionWords(tl.words, e.corrections, e.bleeps) : [];
  let cues = e.captions.preset === "boxed" ? boxedCues(cw, boxedChars(W, boxedSize(e))) : chunk(cw, e.captions.maxWords);
  if (e.captions.enabled && e.translation?.lines.length) {
    // translated subtitles: one cue per phrase, the whole line as one "word" (drawn wrapped, see drawCaptions)
    cues = e.translation.lines.map((l) => { const a = tl.byId.get(l.from), b = tl.byId.get(l.to);
      return a && b ? { start: a.os, end: b.oe + 0.12, words: [{ id: l.from, text: l.text, os: a.os, oe: b.oe, seg: a.seg }] } : null; })
      .filter(Boolean) as Cue[];
  }
  const zooms = e.zooms.map((z) => { const s = spanOf(tl, z.anchor); return s ? { s: s[0], e: s[1] + 0.05, scale: z.scale } : null; })
    .filter(Boolean) as Scene["zooms"];
  const layers: Layer[] = [];
  const sorted = [...e.broll].map((b) => ({ b, span: spanOf(tl, b.anchor, 0.13) })).filter((x) => x.span)
    .sort((a, b) => a.span![0] - b.span![0]);
  sorted.forEach(({ b, span }, k) => {
    const asset = b.asset ? p.library.find((a) => a.key === b.asset) : undefined;
    const isVideo = asset?.kind === "video";
    // the hook title stays up long enough to read (lib/scrolltest.ts checks the same)
    const hold = isVideo ? 0.6 : b.treatment === "text-pop" && b.style === "label" && b.tilt === 0 ? Math.max(2.0, readTime(b.text ?? "")) : 2.0;
    let start = span![0], end = Math.max(span![1] + (b.treatment === "text-pop" ? 0.15 : 0.05), start + hold);
    const next = sorted[k + 1]?.span;
    if (next && next[0] < end && next[0] > start + 0.3) end = next[0];              // the next visual cuts this one short
    const layer: Layer = { b, start, end: Math.min(end, tl.duration), asset, el: b.asset ? media.get(b.asset) : undefined, plan: clipPlan(asset) };
    layer.place = placeLayer(p, tl, layer);
    layers.push(layer);
  });
  const cuts = tl.segments.slice(1).map((s) => s.outStart);
  // words worth a highlight: numbers, money, percentages and the post's keywords
  const emph = new Set(e.post.keywords.flatMap((k) => k.toLowerCase().split(/\s+/)).filter((w) => w.length > 3));
  return { tl, cues, layers, zooms, cuts, emph };
}

// ------------------------------------------------------------------ reframe

type Crop = { x: number; y: number; w: number; h: number; sw: number; sh: number };

export function cropFor(p: Project, tl: Timeline, src: number, srcTime: number, zoom: number): Crop {
  const s = p.sources[src];
  const sw = s.width, sh = s.height;
  const ar = W / H;
  let cw = sw / sh > ar ? sh * ar : sw, ch = sw / sh > ar ? sh : sw / ar;
  const f = faceAt(p.faces, src, srcTime);
  const fx = f ? f.cx * sw : sw / 2, fy = f ? (f.cy - 0.12 * f.h) * sh : sh * 0.42;
  cw /= zoom; ch /= zoom;
  const x = Math.min(Math.max(fx - cw / 2, 0), sw - cw);
  const y = Math.min(Math.max(fy - 0.4 * ch, 0), sh - ch);
  return { x, y, w: cw, h: ch, sw, sh };
}

/** The face in output pixels for a layer's window, and its eyes-to-chin zone. */
function faceOut(p: Project, tl: Timeline, t: number) {
  const seg = tl.segments.find((s) => t >= s.outStart && t < s.outEnd) ?? tl.segments[0];
  if (!seg) return null;
  const st = seg.start + (t - seg.outStart);
  const f = faceAt(p.faces, seg.src, st);
  const c = cropFor(p, tl, seg.src, st, 1);
  const fw = f ? (f.w * c.sw / c.w) * W : 0.36 * W;
  const fh = f ? (f.h * c.sh / c.h) * H : fw * 1.3;
  const cx = f ? ((f.cx * c.sw - c.x) / c.w) * W : W / 2;
  const cy = f ? ((f.cy * c.sh - c.y) / c.h) * H : 0.38 * H;
  const eyes = f?.eyesY !== undefined ? ((f.eyesY * c.sh - c.y) / c.h) * H : cy - 0.12 * fh;
  const eyeD = 0.42 * fw;
  return { cx, cy, fw, fh, core: { x0: cx - eyeD, x1: cx + eyeD, y0: eyes - 0.5 * eyeD, y1: cy + fh / 2 } };
}

/** The eyes-to-chin zone over a layer's window (the union of its start, middle and end), or null when the face is known to
 *  be off screen: faces were tracked and none was seen then. Untracked footage (Fast effort) assumes a centred speaker. */
function faceZone(p: Project, tl: Timeline, start: number, end: number): FaceZone | null {
  const tracked = !!p.faces?.length;
  let z: FaceZone | null = null;
  for (const t of [start + 0.02, (start + end) / 2, Math.max(start, end - 0.05)]) {
    const seg = tl.segments.find((s) => t >= s.outStart && t < s.outEnd) ?? tl.segments[0];
    if (!seg) continue;
    if (tracked && !faceAt(p.faces, seg.src, seg.start + (t - seg.outStart))) continue;
    const f = faceOut(p, tl, t);
    if (!f) continue;
    z = z ? { x0: Math.min(z.x0, f.core.x0), x1: Math.max(z.x1, f.core.x1), y0: Math.min(z.y0, f.core.y0), y1: Math.max(z.y1, f.core.y1) } : { ...f.core };
  }
  return z;
}

function placeLayer(p: Project, tl: Timeline, L: Layer): Layer["place"] {
  const t = L.b.treatment;
  if (t === "framed") {
    const frame = framedLayout({ W, H, aw: L.asset?.width ?? 16, ah: L.asset?.height ?? 9, face: faceZone(p, tl, L.start, L.end), full: L.b.full });
    return { ...frame.region, tilt: 0, mode: frame.mode === "split" ? "split" : "framed", frame };
  }
  if (t === "full-frame" || t === "text-pop" || t === "motion") return undefined;
  if (t === "split-top") return { x: 0, y: 0, w: W, h: H * 0.42, tilt: 0, mode: "split" };
  const face = faceOut(p, tl, (L.start + L.end) / 2);
  const aw = L.asset?.width ?? 16, ah = L.asset?.height ?? 9;
  const phone = t === "phone-card";
  const aspect = phone ? 9 / 19.5 : aw / ah;
  const kind = L.asset?.credit?.source === "simple-icons" ? "logo" : "photo";
  const minW = (kind === "logo" ? 0.22 : 0.3) * U;
  const capTop = 0.75 * H - 1.35 * 105;
  const still = L.asset?.kind === "image" && !phone;
  const core = face?.core ?? { x0: W * 0.3, x1: W * 0.7, y0: H * 0.3, y1: H * 0.5 };
  const fit = (zw: number, zh: number) => { const w = Math.min(zw, zh * aspect, 0.88 * W, 0.88 * U * Math.max(1, aspect)); return { w, h: w / aspect }; };
  // on a reel the apps draw their like / comment / share column down the right (from ~85% across, 36-88% down):
  // a card reaching that low stays left of it (lib/safezones.ts)
  const right = H > 1.5 * W ? 0.84 * W : W - SIDE, buttonsTop = 0.35 * H;
  if (t === "card-above-head") {
    const top = SAFE_TOP, bottom = core.y0 - 0.01 * H;
    if (bottom - top > 0.06 * H) {
      const edge = bottom > buttonsTop ? right : W - SIDE;
      const { w, h } = fit(edge - SIDE, bottom - top);
      if (w >= minW) {
        const cx = Math.min(Math.max(face?.cx ?? W / 2, SIDE + w / 2), edge - w / 2);
        return { x: cx - w / 2, y: bottom - h, w, h, tilt: still ? -2.5 : 0, mode: "card" };
      }
    }
  }
  // beside the face (side cards, phones, and above-head cards that can't read above)
  const sides = { left: [SIDE, core.x0 - 0.01 * W], right: [core.x1 + 0.01 * W, right] } as const;
  const order = L.b.side === "left" || L.b.side === "right" ? [L.b.side] :
    (Object.keys(sides) as ("left" | "right")[]).sort((a, b) => (sides[b][1] - sides[b][0]) - (sides[a][1] - sides[a][0]));
  for (const k of order) {
    const [x0, x1] = sides[k];
    const top = SAFE_TOP, bottom = capTop - 0.01 * H;
    const { w, h } = fit(x1 - x0, bottom - top);
    if (w >= (phone ? 0.28 * U : Math.min(minW, 0.22 * U))) {
      const cy = Math.min(Math.max(face?.cy ?? H * 0.4, top + h / 2), bottom - h / 2);
      return { x: (x0 + x1) / 2 - w / 2, y: cy - h / 2, w, h, tilt: still ? (k === "left" ? 2 : -2) : 0, mode: phone ? "phone" : "card" };
    }
  }
  return { x: 0, y: 0, w: W, h: H * 0.42, tilt: 0, mode: "split" };    // last resort: a split view
}

// ------------------------------------------------------------------ drawing

export function zoomAt(scene: Scene, t: number): number {
  return scene.zooms.find((z) => t >= z.s && t < z.e)?.scale ?? 1;
}

function rounded(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.roundRect(x, y, w, h, r);
}

function drawCover(g: CanvasRenderingContext2D, el: CanvasImageSource, iw: number, ih: number, x: number, y: number, w: number, h: number, contain = false) {
  const s = contain ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
  const dw = iw * s, dh = ih * s;
  g.drawImage(el, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

const dims = (el: HTMLImageElement | HTMLVideoElement) =>
  el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight];

export function drawFrame(g: CanvasRenderingContext2D, p: Project, e: Edit, scene: Scene, t: number,
                          video: HTMLVideoElement | null, src: number, srcTime: number) {
  const m = motionOf(e);
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const active = scene.layers.filter((L) => t >= L.start && t < L.end);
  const split = active.find((L) => L.place?.mode === "split");
  // a full-frame picture or a framed screen holds the speaker's zoom still (a framed split also keeps the face where placed)
  const full = active.some((L) => L.b.treatment === "full-frame" || L.b.treatment === "framed");
  const seg = scene.tl.segments.findIndex((s) => t >= s.outStart && t < s.outEnd);
  let zoom = full ? 1 : zoomAt(scene, t);
  if (!full && m.transition === "punch" && seg % 2 === 1) zoom *= 1.07;          // jump cuts alternate a punch-in
  const fx = cutFx(m.transition, scene.cuts, t);
  if (video && video.readyState >= 2) {
    const c = cropFor(p, scene.tl, src, srcTime, zoom);
    const drawVideo = (dx = 0, alpha = 1, filter = LOOK_FILTER[m.look]) => {
      g.save();
      g.globalAlpha = alpha;
      g.filter = filter;
      if (p.sources[src]?.mirror) { g.translate(W, 0); g.scale(-1, 1); }
      g.translate(p.sources[src]?.mirror ? -dx : dx, 0);
      if (split) {   // the speaker moves under the picture: a band from the hair line down
        const band = H - split.place!.h;
        const bandH = c.w * band / W;
        const y = Math.min(Math.max(c.y + (split.place!.frame?.bandFrom ?? 0.1) * c.h, 0), c.sh - bandH);
        g.drawImage(video, c.x, y, c.w, bandH, 0, split.place!.h, W, band);
      } else g.drawImage(video, c.x, c.y, c.w, c.h, 0, 0, W, H);
      g.restore();
    };
    if (fx?.kind === "whip") {
      const dx = (fx.d < 0 ? -1 : 1) * ease.out(fx.k) * 0.28 * W;
      const f = `${LOOK_FILTER[m.look] === "none" ? "" : LOOK_FILTER[m.look] + " "}blur(${(fx.k * 16).toFixed(1)}px)`;
      drawVideo(dx, 1, f);
      drawVideo(dx - Math.sign(dx) * W, 1, f);            // the frame wraps round, like a fast pan, instead of showing black
    } else drawVideo();
    if (fx?.kind === "glitch") {
      const seed = Math.floor(t * 60);
      drawVideo(14 * fx.k, 0.45 * fx.k, "hue-rotate(120deg) saturate(2)");
      drawVideo(-12 * fx.k, 0.35 * fx.k, "hue-rotate(-120deg) saturate(2)");
      for (let i = 0; i < 6; i++) {
        const y = rnd(seed + i) * H, h = (0.02 + 0.05 * rnd(seed + i + 9)) * H, dx = (rnd(seed + i + 3) - 0.5) * 0.12 * W * fx.k;
        g.drawImage(g.canvas, 0, y, W, h, dx, y, W, h);
      }
    }
    lookOverlay(g, m.look, W, H);
  }
  for (const L of active) drawLayer(g, L, t, m.brollIn, m.kenBurns);
  drawCaptions(g, e, scene, t, !!split);
  if (fx?.kind === "flash") { g.fillStyle = `rgba(255,255,255,${(0.85 * fx.k ** 1.5).toFixed(3)})`; g.fillRect(0, 0, W, H); }
  if (fx?.kind === "fade") { g.fillStyle = `rgba(0,0,0,${(0.92 * fx.k ** 1.2).toFixed(3)})`; g.fillRect(0, 0, W, H); }
  drawWatermark(g, W, H);
  if (m.progress && scene.tl.duration > 0) {
    const h = Math.max(6, 0.006 * H);
    g.fillStyle = "rgba(255,255,255,0.22)"; g.fillRect(0, 0, W, h);
    g.fillStyle = m.accent; g.fillRect(0, 0, W * clamp01(t / scene.tl.duration), h);
  }
}

function popIn(t: number, start: number) {        // opaque on the first frame, 86% -> 100% with a little overshoot
  const k = Math.min(1, Math.max(0, (t - start) / 0.22));
  const c1 = 1.70158;
  return 0.86 + 0.14 * (1 + (c1 + 1) * (k - 1) ** 3 + c1 * (k - 1) ** 2);
}

function drawLayer(g: CanvasRenderingContext2D, L: Layer, t: number, brollIn: Parameters<typeof enter>[0], kenBurns: boolean) {
  const b = L.b;
  if (b.treatment === "text-pop") return drawTextPop(g, L, t);
  if (b.treatment === "motion") return drawCard(g, L, t);
  if (b.treatment === "framed") return drawFramed(g, L, t, kenBurns);
  const el = L.el;
  if (!el) return;
  const [iw, ih] = dims(el);
  if (!iw) return;
  const still = el instanceof HTMLImageElement;
  const kb = kenBurns && still ? 1 + 0.07 * clamp01((t - L.start) / Math.max(0.5, L.end - L.start)) : 1;
  if (b.treatment === "full-frame") {
    g.fillStyle = "#101010"; g.fillRect(0, 0, W, H);
    const near = Math.abs(Math.log((iw / ih) / (W / H))) < 0.22;
    g.save(); g.translate(W / 2, H / 2); g.scale(kb, kb); g.translate(-W / 2, -H / 2);
    drawCover(g, el, iw, ih, near ? 0 : W * 0.02, near ? 0 : H * 0.1, near ? W : W * 0.96, near ? H : H * 0.8, !near);
    g.restore();
    return;
  }
  const P = L.place!;
  if (P.mode === "split") {
    g.fillStyle = "#EDEBE7"; g.fillRect(0, 0, W, P.h);
    drawCover(g, el, iw, ih, W * 0.03, P.h * 0.04, W * 0.94, P.h * 0.92, true);
    return;
  }
  const a = enter(brollIn, t, L.start, L.end, H);
  g.save();
  g.globalAlpha = a.alpha;
  g.translate(P.x + P.w / 2 + a.dx, P.y + P.h / 2 + a.dy);
  g.rotate(((P.tilt + a.rot) * Math.PI) / 180);
  g.scale(a.s, a.s);
  if (P.mode === "phone") {
    const bez = P.w * 0.045, r = P.w * 0.14;
    g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 40; g.shadowOffsetY = 14;
    g.fillStyle = "#121214"; rounded(g, -P.w / 2 - bez, -P.h / 2 - bez, P.w + 2 * bez, P.h + 2 * bez, r); g.fill();
    g.shadowColor = "transparent";
    g.save(); rounded(g, -P.w / 2, -P.h / 2, P.w, P.h, P.w * 0.11); g.clip();
    drawCover(g, el, iw, ih, -P.w / 2, -P.h / 2, P.w, P.h);
    g.restore();
    g.fillStyle = "#000"; rounded(g, -P.w * 0.15, -P.h / 2 + P.w * 0.035, P.w * 0.3, P.w * 0.085, P.w * 0.05); g.fill();
  } else {
    const r = Math.min(P.w, P.h) * 0.06;
    g.shadowColor = "rgba(0,0,0,0.38)"; g.shadowBlur = 0.45 * Math.max(10, 0.03 * U) * 2; g.shadowOffsetY = 12;
    g.fillStyle = "#fff"; rounded(g, -P.w / 2, -P.h / 2, P.w, P.h, r); g.fill();
    g.shadowColor = "transparent";
    g.save(); rounded(g, -P.w / 2, -P.h / 2, P.w, P.h, r); g.clip();
    g.scale(kb, kb);
    drawCover(g, el, iw, ih, -P.w / 2, -P.h / 2, P.w, P.h);
    g.restore();
  }
  g.restore();
}

/** An app screen on a soft backdrop (lib/framed.ts): rounded corners, a soft shadow, a slow push and an optional punch-in.
 *  The picture is drawn once, straight from the source rectangle into the screen box, so it stays at native sharpness. */
function drawFramed(g: CanvasRenderingContext2D, L: Layer, t: number, kenBurns: boolean) {
  const F = L.place?.frame;
  if (!F) return;
  const { brand } = activeBrand();
  const bg = L.b.backdrop && /^#[0-9a-f]{6}$/i.test(L.b.backdrop) ? L.b.backdrop : backdropFor(hasBrand(brand) ? brand.accent : null);
  const local = t - L.start, dur = L.end - L.start;
  const S = F.screen, cx = S.x + S.w / 2, cy = S.y + S.h / 2;
  g.save();
  g.beginPath(); g.rect(F.region.x, F.region.y, F.region.w, F.region.h); g.clip();
  g.fillStyle = bg; g.fillRect(F.region.x, F.region.y, F.region.w, F.region.h);
  // opaque from the first frame (it cuts in and out like the backdrop); the screen settles 96.5% -> 100% over 0.3 s
  const s = 0.965 + 0.035 * ease.out(clamp01(local / 0.3));
  g.translate(cx, cy); g.scale(s, s); g.translate(-cx, -cy);
  g.shadowColor = `rgba(0,0,0,${F.shadow.alpha})`; g.shadowBlur = F.shadow.blur; g.shadowOffsetY = F.shadow.dy;
  g.fillStyle = bg; rounded(g, S.x, S.y, S.w, S.h, F.radius); g.fill();
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
  const el = L.el;
  const [iw, ih] = el ? dims(el) : [0, 0];
  if (el && iw) {
    const v = framedView(iw, ih, S, local, dur, L.b.focus, L.b.punch, kenBurns ? undefined : 0);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    rounded(g, S.x, S.y, S.w, S.h, F.radius); g.clip();
    g.drawImage(el, v.x, v.y, v.w, v.h, S.x, S.y, S.w, S.h);
  }
  g.restore();
}

/** An animated card (Motion Studio's engine) over the video on the words that say it: a counter, a list, a before and after. */
function drawCard(g: CanvasRenderingContext2D, L: Layer, t: number) {
  const c = L.b.card;
  if (!c) return;
  const dur = Math.max(0.8, L.end - L.start), local = t - L.start;
  const a = { palette: L.b.palette ?? (hasBrand(activeBrand().brand) ? "brand" : "midnight"), font: "grotesk", format: "9:16", scenes: [] } as unknown as Anim;
  const sc: CardScene = { id: L.b.id, kind: c.kind, text: c.text, sub: c.sub, items: c.items, value: c.value, prefix: c.prefix, suffix: c.suffix, duration: dur };
  const k = Math.min(clamp01(local / 0.25), clamp01((dur - local) / 0.2));
  g.save();
  g.globalAlpha = k;
  g.translate(W / 2, H / 2); const s = 0.94 + 0.06 * ease.out(clamp01(local / 0.35)); g.scale(s, s); g.translate(-W / 2, -H / 2);
  drawBackground(g, a, W, H, t);
  drawScene(g, a, sc, local, W, H, 0, 0);
  g.restore();
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/);
  if (g.measureText(text).width <= maxW || words.length < 2) return [text];
  let best = [text], bestD = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" "), b = words.slice(k).join(" ");
    const d = Math.abs(g.measureText(a).width - g.measureText(b).width);
    if (Math.max(g.measureText(a).width, g.measureText(b).width) <= maxW && d < bestD) { best = [a, b]; bestD = d; }
  }
  return best;
}

function drawTextPop(g: CanvasRenderingContext2D, L: Layer, t: number) {
  const label = L.b.style !== "pop";
  const text = label ? (L.b.text ?? "") : (L.b.text ?? "").toUpperCase();
  let size = label ? 0.075 * U : 0.11 * U;
  let lines: string[] = [];
  for (let i = 0; i < 12; i++) {
    g.font = `${label ? 700 : 900} ${size}px Montserrat, Inter, Arial, sans-serif`;
    lines = wrap(g, text, W * 0.82);
    if (lines.every((l) => g.measureText(l).width <= W * 0.86) || size < 0.045 * U) break;
    size *= 0.9;
  }
  const lh = size * 1.12;
  const tw = Math.max(...lines.map((l) => g.measureText(l).width));
  const padX = label ? 0.42 * size : 0, padY = label ? 0.26 * size : 0;
  const bw = tw + 2 * padX, bh = lh * lines.length + 2 * padY;
  const cy = SAFE_TOP + bh / 2 + 0.02 * H;
  g.save();
  g.translate(W / 2, cy);
  g.rotate(((L.b.tilt ?? (label ? 0 : -3)) * Math.PI) / 180);
  const s = popIn(t, L.start);
  g.scale(s, s);
  g.textAlign = "center"; g.textBaseline = "middle";
  if (label) { g.fillStyle = "#fff"; rounded(g, -bw / 2, -bh / 2, bw, bh, 0.25 * size); g.fill(); }
  lines.forEach((l, i) => {
    const y = -bh / 2 + padY + lh * (i + 0.5);
    if (label) { g.fillStyle = "#111"; g.fillText(l, 0, y); }
    else { g.lineJoin = "round"; g.lineWidth = 0.18 * size; g.strokeStyle = "#000"; g.strokeText(l, 0, y); g.fillStyle = "#fff"; g.fillText(l, 0, y); }
  });
  g.restore();
}

const PRESET = {
  studio: { weight: 600, active: null, outline: 8, box: false },
  bold: { weight: 900, active: "#FFE600", outline: 9, box: false },
  white: { weight: 800, active: null, outline: 4, box: false },
  block: { weight: 700, active: null, outline: 0, box: true },
  boxed: { weight: 600, active: null, outline: 0, box: true },      // drawn by drawBoxed: a phrase at a time
  minimal: { weight: 500, active: null, outline: 0, box: false },
} as const;

const NUMERIC = /[0-9$£€%]/;
export const BOXED = { fill: "rgba(31,36,28,0.6)", radius: 10, font: "Figtree" };   // #1f241c at 60%, 10 px corners

/** Boxed subtitles: the whole phrase at once in a clean sans, white on one dark rounded box, bottom centre, at most 2 lines
 *  of about 42 characters (fewer on a narrow reel). It fades in over 0.12 s; no word pops. */
function drawBoxed(g: CanvasRenderingContext2D, e: Edit, text: string, alpha: number, split: boolean) {
  const caseFn = (x: string) => (e.captions.textCase === "upper" ? x.toUpperCase() : e.captions.textCase === "lower" ? x.toLowerCase() : x);
  const phrase = caseFn(text.trim());
  if (!phrase) return;
  let size = boxedSize(e);
  const font = (sz: number) => `600 ${sz}px "${e.captions.font}", ${BOXED.font}, "DM Sans", Geist, Inter, Arial, sans-serif`;
  let lines: string[] = [phrase];
  for (let k = 0; k < 12; k++) {
    g.font = font(size);
    lines = boxedLines(phrase, boxedChars(W, size), 2) ?? wrap(g, phrase, W * 0.86);
    if (lines.every((l) => g.measureText(l).width <= W * 0.88) || size < 0.028 * U) break;
    size *= 0.92;
  }
  const lh = 1.28 * size, padX = 0.55 * size, padY = 0.32 * size;
  const bw = Math.max(...lines.map((l) => g.measureText(l).width)) + 2 * padX, bh = lines.length * lh + 2 * padY;
  // wide: bottom centre; a reel with a split view: under the face; square and feed splits: on the bottom edge
  const low = split && H / W < 1.5;
  const cy = W > H ? 0.88 * H : (split ? 0.82 : e.captions.position) * H;
  const top = low ? H - 0.03 * U - bh : Math.min(cy - bh / 2, H - 0.03 * H - bh);
  g.save(); g.globalAlpha = alpha;
  g.fillStyle = BOXED.fill; rounded(g, W / 2 - bw / 2, top, bw, bh, BOXED.radius * (U / 1080)); g.fill();
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#fff";
  lines.forEach((l, i) => g.fillText(l, W / 2, top + padY + lh * (i + 0.5) + 0.04 * size));
  g.restore();
}

function drawTranslated(g: CanvasRenderingContext2D, e: Edit, text: string, alpha: number, split: boolean) {
  if (e.captions.preset === "boxed") return drawBoxed(g, e, text, alpha, split);
  const st = PRESET[e.captions.preset];
  const caseFn = (x: string) => (e.captions.textCase === "upper" ? x.toUpperCase() : e.captions.textCase === "lower" ? x.toLowerCase() : x);
  let size = e.captions.size * 0.82 * (U / 1080);
  const font = (sz: number) => `${st.weight} ${sz}px "${e.captions.font}", Montserrat, "Noto Sans", Arial, sans-serif`;
  let lines: string[] = [];
  for (let k = 0; k < 10; k++) {
    g.font = font(size);
    lines = wrap(g, caseFn(text), W * 0.84);
    if (lines.length <= 2 && lines.every((l) => g.measureText(l).width <= W * 0.9)) break;
    size *= 0.9;
  }
  const y0 = (split ? 0.8 : e.captions.position) * H - ((lines.length - 1) * size * 1.15) / 2;
  g.save(); g.globalAlpha = alpha; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
  lines.forEach((l, i) => {
    const y = y0 + i * size * 1.15;
    if (st.box) { const w = g.measureText(l).width; g.fillStyle = "#000"; rounded(g, W / 2 - w / 2 - 0.3 * size, y - 0.68 * size, w + 0.6 * size, 1.3 * size, 0.18 * size); g.fill(); }
    if (st.outline) { g.lineWidth = st.outline * 1.8 * (size / e.captions.size); g.strokeStyle = "#000"; g.strokeText(l, W / 2, y); }
    else if (!st.box) { g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 8; }
    g.fillStyle = "#fff"; g.fillText(l, W / 2, y);
  });
  g.restore();
}

function drawCaptions(g: CanvasRenderingContext2D, e: Edit, scene: Scene, t: number, split: boolean) {
  const cue = scene.cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return;
  if (e.translation?.lines.length) return drawTranslated(g, e, cue.words[0].text, clamp01((t - cue.start) / 0.12), split);
  if (e.captions.preset === "boxed") {
    // fade in only after a gap: back-to-back phrases swap in place, so the box doesn't blink
    const prev = scene.cues[scene.cues.indexOf(cue) - 1];
    const alpha = prev && cue.start - prev.end < 0.1 ? 1 : ease.out(clamp01((t - cue.start) / 0.12));
    return drawBoxed(g, e, cue.words.map((w) => w.text).join(" "), alpha, split);
  }
  const m = motionOf(e);
  const anim = m.captionAnim;
  const st = PRESET[e.captions.preset];
  const caseFn = (s: string) => (e.captions.textCase === "upper" ? s.toUpperCase() : e.captions.textCase === "lower" ? s.toLowerCase() : s);
  const words = cue.words.map((w) => caseFn(w.text.replace(/^[^\p{L}\p{N}$£€]+|[,.;:]+$/gu, "")));
  const base = e.captions.size * (U / 1080);
  let size = base;
  const font = (sz: number) => `${st.weight} ${sz}px "${e.captions.font}", Montserrat, Inter, Arial, sans-serif`;
  g.font = font(size);
  const full = words.join(" ");
  const gaps = Math.max(0, words.length - 1);
  while (g.measureText(full).width + 0.12 * size * gaps > W * 0.87 && size > 0.62 * base) { size *= 0.94; g.font = font(size); }
  const y = (split ? 0.8 : e.captions.position) * H;
  // the spoken word grows (up to ~8%) and has an outline: a plain space between words would vanish next to it
  const space = g.measureText(" ").width + 0.12 * size;
  const total = words.reduce((sum, w) => sum + g.measureText(w).width, 0) + space * Math.max(0, words.length - 1);
  let x = W / 2 - total / 2;
  const since = t - cue.start;
  const cueAlpha = anim === "fade" ? clamp01(since / 0.16) : 1;
  if (st.box) {
    g.save(); g.globalAlpha = cueAlpha;
    g.fillStyle = "#000"; rounded(g, x - 0.3 * size, y - 0.7 * size, total + 0.6 * size, 1.35 * size, 0.18 * size); g.fill();
    g.restore();
  }
  g.textBaseline = "middle"; g.textAlign = "left"; g.lineJoin = "round";
  const pop = anim === "pop" ? ease.back(clamp01(since / 0.12)) : 1;
  // typewriter: letters arrive across the first 70% of the cue
  const letters = anim === "typewriter" ? Math.floor(full.length * clamp01(since / Math.max(0.25, 0.7 * (cue.end - cue.start)))) + 1 : Infinity;
  let shown = 0;
  const accentDark = lightColour(m.accent);
  words.forEach((w, i) => {
    const cw = cue.words[i];
    const spoken = t >= cw.os;
    const on = t >= cw.os && (i + 1 >= cue.words.length || t < cue.words[i + 1].os);
    const ww = g.measureText(w).width;
    let text = w;
    if (anim === "typewriter") { text = w.slice(0, Math.max(0, letters - shown)); shown += w.length + 1; }
    const hidden = ((anim === "words" || anim === "bounce") && !spoken) || !text;
    if (!hidden) {
      g.save();
      g.globalAlpha = cueAlpha;
      g.translate(x + ww / 2, y);
      let s = 0.92 + 0.08 * pop;
      if (st.active || anim === "pop") s *= on ? 1.08 : 1;
      if (anim === "bounce" || anim === "words") {
        const k = clamp01((t - cw.os) / (anim === "bounce" ? 0.2 : 0.12));
        if (anim === "bounce") g.translate(0, -(1 - ease.back(k)) * 0.32 * size);
        s *= anim === "bounce" ? 0.8 + 0.2 * ease.back(k) : 0.9 + 0.1 * ease.out(k);
        g.globalAlpha = cueAlpha * Math.min(1, k * 2);
      }
      g.scale(s, s);
      const emph = m.emphasis && (NUMERIC.test(w) || scene.emph.has(w.toLowerCase()));
      let fill = "#fff";
      if (anim === "karaoke" && on) {
        g.fillStyle = m.accent;
        rounded(g, -ww / 2 - 0.18 * size, -0.62 * size, ww + 0.36 * size, 1.2 * size, 0.2 * size); g.fill();
        fill = accentDark ? "#111" : "#fff";
      } else if ((st.active && on) || emph) fill = m.accent;
      const tw = g.measureText(text).width;
      if (st.outline && !(anim === "karaoke" && on)) { g.lineWidth = st.outline * 2 * (size / e.captions.size); g.strokeStyle = "#000"; g.strokeText(text, -ww / 2, 0); }
      if (!st.outline && !st.box) { g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 8; }
      g.fillStyle = fill;
      g.fillText(text, -ww / 2, 0);
      if (anim === "typewriter" && text.length < w.length && Math.floor(t * 4) % 2 === 0) g.fillRect(-ww / 2 + tw + 4, -0.42 * size, 0.08 * size, 0.84 * size);
      g.restore();
    }
    x += ww + space;
  });
}
