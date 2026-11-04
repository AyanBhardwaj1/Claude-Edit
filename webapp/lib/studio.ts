// Motion Studio: any text becomes an animated video. A plan is a list of scenes (title, statement, number, list, quote,
// compare, bars, call to action); the renderer draws every frame on a canvas (kinetic type, counters, charts, wipes),
// so preview and export are the same pixels. With an AI key the AI plans the scenes; without one, planScenes() does.

import { FORMATS } from "./compositor";
import { clamp01, ease } from "./motion";
import type { Format } from "./types";

export type SceneKind = "title" | "statement" | "number" | "list" | "quote" | "compare" | "bars" | "cta";
export type Scene = {
  id: string; kind: SceneKind; text: string; sub?: string; items?: string[];
  value?: number; prefix?: string; suffix?: string; emphasis?: string[]; duration: number;
  say?: string;                         // what the voiceover reads for this scene (defaults to its words)
};
export type PaletteId = "midnight" | "sunset" | "mint" | "paper" | "electric" | "ocean";
export type FontId = "grotesk" | "serif" | "heavy" | "mono" | "book";
export type Anim = {
  id: string; title: string; createdAt: string; updatedAt: string; source: string;
  palette: PaletteId; font: FontId; format: Format; scenes: Scene[];
  music?: string;                       // media key of a song (IndexedDB)
  voice?: { name: string; keys: Record<string, string> };   // scene id -> media key of its voiceover
  owner?: string;
};

export const PALETTES: Record<PaletteId, { name: string; bg: string; bg2: string; ink: string; muted: string; accent: string; accent2: string; dark: boolean }> = {
  midnight: { name: "Midnight", bg: "#0b1020", bg2: "#18224a", ink: "#f4f6ff", muted: "#9aa6d6", accent: "#6ee7ff", accent2: "#a78bfa", dark: true },
  sunset: { name: "Sunset", bg: "#1d0f1f", bg2: "#3a1838", ink: "#fff4ec", muted: "#d9a7b0", accent: "#ff8a4c", accent2: "#ffd166", dark: true },
  mint: { name: "Mint", bg: "#05261f", bg2: "#0d4237", ink: "#eafff8", muted: "#8cc9b6", accent: "#39f0b6", accent2: "#f4ff7a", dark: true },
  electric: { name: "Electric", bg: "#0a0a0a", bg2: "#1d1d1d", ink: "#ffffff", muted: "#a3a3a3", accent: "#c6ff3d", accent2: "#ff3d9a", dark: true },
  paper: { name: "Paper", bg: "#f4efe6", bg2: "#e6dccb", ink: "#1d1a16", muted: "#6f665a", accent: "#e4572e", accent2: "#2b59c3", dark: false },
  ocean: { name: "Ocean", bg: "#eaf4ff", bg2: "#cfe3ff", ink: "#0b1f3a", muted: "#4d6a91", accent: "#1f6feb", accent2: "#00b3a4", dark: false },
};
export const FONTS: Record<FontId, { name: string; family: string; weight: number; track: number }> = {
  grotesk: { name: "Grotesk", family: '"Bricolage Grotesque", "Montserrat", sans-serif', weight: 800, track: -0.03 },
  serif: { name: "Serif", family: '"Fraunces", Georgia, serif', weight: 600, track: -0.02 },
  heavy: { name: "Heavy", family: '"Montserrat", sans-serif', weight: 900, track: -0.02 },
  mono: { name: "Mono", family: '"JetBrains Mono", monospace', weight: 700, track: -0.01 },
  book: { name: "Book", family: '"Literata", Georgia, serif', weight: 600, track: -0.02 },
};
export const KIND_NAME: Record<SceneKind, string> = { title: "Title", statement: "Statement", number: "Big number", list: "List", quote: "Quote",
  compare: "Before and after", bars: "Bar chart", cta: "Call to action" };

const uid = () => Math.random().toString(36).slice(2, 9);
const STOP = new Set("the a an and or but of to in on at for with from by is are was were be been it this that these those your you our we my i me they them their his her its as so if then than just very really more most into over about what when how why who".split(" "));

/** Seconds a scene stays up: long enough to read twice. */
export function readTime(s: Pick<Scene, "kind" | "text" | "sub" | "items">): number {
  const words = [s.text, s.sub ?? "", ...(s.items ?? [])].join(" ").split(/\s+/).filter(Boolean).length;
  const base = s.kind === "number" ? 2.6 : s.kind === "statement" || s.kind === "quote" ? 1.6 : 2.2;
  return +Math.min(s.kind === "title" ? 5 : 7, Math.max(2.4, base + 0.24 * words)).toFixed(1);
}

function emphasisOf(text: string): string[] {
  const ws = text.replace(/[^\p{L}\p{N}$%' -]/gu, " ").split(/\s+/)
    .filter((w) => w.length > 4 && !STOP.has(w.toLowerCase()) && !/(ing|ed|ly)$/i.test(w));   // things, not doings
  const num = text.match(/[$£€]?\d[\d,.]*\s?(%|x|k|m|bn)?/i)?.[0];
  return [...(num ? [num.trim()] : []), ...ws.sort((a, b) => b.length - a.length).slice(0, num ? 1 : 2)];
}

const NUM = /([$£€])?\s?(\d[\d,]*(?:\.\d+)?)\s?(%|hours?\b|hrs?\b|minutes?\b|mins?\b|seconds?\b|days?\b|weeks?\b|months?\b|years?\b|times\b|people\b|users\b|creators\b|videos\b|x\b|k\b|m\b|bn\b)?/i;
const numPhrase = (u: string) => { const n = u.match(NUM); return n ? `${n[1] ?? ""}${n[2]}${n[3] ? (n[3] === "%" ? "%" : ` ${n[3]}`) : ""}` : null; };

/** The no-AI planner: reads the text's shape (a short first line, bullet lists, numbers, "before / after", quotes). */
export function planScenes(text: string): Scene[] {
  const lines = text.replace(/\r/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const units: string[] = [];
  for (const l of lines) {
    if (/^([-*•]|\d+[.)])\s+/.test(l)) units.push(l);
    else units.push(...(l.match(/[^.!?]+[.!?]*/g) ?? [l]).map((x) => x.trim()).filter(Boolean));
  }
  const out: Scene[] = [];
  let i = 0;
  const push = (s: Omit<Scene, "id" | "duration">) => out.push({ id: uid(), ...s, duration: readTime(s) });
  while (i < units.length) {
    const u = units[i];
    const bullet = (x: string) => /^([-*•]|\d+[.)])\s+/.test(x);
    if (bullet(u)) {
      const items: string[] = [];
      while (i < units.length && bullet(units[i]) && items.length < 5) items.push(units[i++].replace(/^([-*•]|\d+[.)])\s+/, ""));
      const head = out.length && out[out.length - 1].kind === "statement" && out[out.length - 1].text.endsWith(":") ? out.pop()!.text.replace(/:$/, "") : "";
      push({ kind: "list", text: head || "In short", items });
      continue;
    }
    const words = u.split(/\s+/).length;
    const q = u.match(/^["“](.+)["”]\s*(?:[-—–]\s*(.+))?$/);
    const cmp = u.match(/^from\s+(.+?)\s+to\s+(.+?)[.!]?$/i) ?? u.match(/^(.+?)\s+(?:vs\.?|versus|→|->|instead of)\s+(.+?)[.!]?$/i);
    const nextU = units[i + 1];
    // "It took 3 hours. Now it takes 20 minutes." -> before and after
    if (nextU && NUM.test(u) && NUM.test(nextU) && /^(now|today|after|these days|then)\b/i.test(nextU)) {
      push({ kind: "compare", text: "", items: [numPhrase(u)!, numPhrase(nextU)!], say: `${u} ${nextU}` }); i += 2; continue;
    }
    const n = u.match(NUM);
    if (out.length === 0 && words <= 10) {
      const next = units[i + 1];
      const sub = next && !bullet(next) && next.split(/\s+/).length <= 10 && !NUM.test(next) ? next : undefined;
      push({ kind: "title", text: u.replace(/[.]$/, ""), sub, emphasis: emphasisOf(u) });
      i += sub ? 2 : 1;
      continue;
    }
    if (q) { push({ kind: "quote", text: q[1], sub: q[2] }); i++; continue; }
    if (cmp && words <= 16 && /\d|before|after|old|new|vs|versus|instead/i.test(u)) {
      push({ kind: "compare", text: "", items: [cmp[1].replace(/^from\s+/i, ""), cmp[2]] }); i++; continue;
    }
    if (n && words <= 18 && +n[2].replace(/,/g, "") > 0) {
      const value = +n[2].replace(/,/g, "");
      push({ kind: "number", text: u.replace(/[.]$/, ""), value, prefix: n[1] ?? "", suffix: n[3] ? (n[3] === "%" ? "%" : ` ${n[3]}`) : "" });
      i++; continue;
    }
    const last = i === units.length - 1;
    if (last && /\b(try|start|sign up|join|follow|get|download|book|visit|subscribe|learn more)\b/i.test(u)) {
      push({ kind: "cta", text: u.replace(/[.!]$/, ""), sub: "Start now" }); i++; continue;
    }
    push({ kind: "statement", text: u, emphasis: emphasisOf(u) });
    i++;
  }
  if (out.length && out[out.length - 1].kind !== "cta") push({ kind: "cta", text: out[0].text.split(/\s+/).slice(0, 6).join(" "), sub: "Follow for more" });
  return out.slice(0, 14);
}

export function newAnim(text: string, scenes: Scene[], opts: Partial<Anim> = {}): Anim {
  const now = new Date().toISOString();
  return { id: uid(), title: (scenes[0]?.text || text.slice(0, 40) || "Animation").slice(0, 60), createdAt: now, updatedAt: now, source: text,
    palette: "midnight", font: "grotesk", format: "9:16", scenes, ...opts };
}

export function cleanScenes(raw: unknown): Scene[] {
  const kinds = Object.keys(KIND_NAME) as SceneKind[];
  const arr = Array.isArray(raw) ? raw : [];
  return arr.slice(0, 16).map((x) => {
    const s = (x ?? {}) as Partial<Scene>;
    const kind = kinds.includes(s.kind as SceneKind) ? (s.kind as SceneKind) : "statement";
    const sc: Scene = { id: uid(), kind, text: String(s.text ?? "").slice(0, 140), sub: s.sub ? String(s.sub).slice(0, 100) : undefined,
      items: Array.isArray(s.items) ? s.items.slice(0, 6).map((v) => String(v).slice(0, 60)) : undefined,
      value: Number.isFinite(Number(s.value)) ? Number(s.value) : undefined, prefix: s.prefix ? String(s.prefix).slice(0, 3) : undefined,
      suffix: s.suffix ? String(s.suffix).slice(0, 12) : undefined,
      emphasis: Array.isArray(s.emphasis) ? s.emphasis.slice(0, 3).map(String) : undefined, duration: 3,
      say: s.say ? String(s.say).slice(0, 400) : undefined };
    sc.duration = Number.isFinite(Number(s.duration)) ? Math.min(8, Math.max(1.8, Number(s.duration))) : readTime(sc);
    return sc;
  }).filter((s) => s.text || s.items?.length);
}

export const timeline = (a: Anim) => { let t = 0; return a.scenes.map((s) => { const r = { s, start: t, end: t + s.duration }; t += s.duration; return r; }); };
export const total = (a: Anim) => a.scenes.reduce((n, s) => n + s.duration, 0);

// ------------------------------------------------------------------ drawing

type Ctx = CanvasRenderingContext2D;
type P = (typeof PALETTES)[PaletteId];

export function frameSize(f: Format) { const d = FORMATS[f] ?? FORMATS["9:16"]; return { W: d.w, H: d.h }; }

function wrapLines(g: Ctx, words: string[], maxW: number): string[][] {
  const lines: string[][] = [[]];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    const test = [...cur, w].join(" ");
    if (cur.length && g.measureText(test).width > maxW) lines.push([w]); else cur.push(w);
  }
  return lines;
}

/** Biggest font size (<= max) at which the text fits in maxW x maxH. */
function fit(g: Ctx, font: (s: number) => string, text: string, maxW: number, maxH: number, max: number, lh = 1.05): { size: number; lines: string[][] } {
  let size = max;
  const words = text.split(/\s+/).filter(Boolean);
  for (let k = 0; k < 40; k++) {
    g.font = font(size);
    const lines = wrapLines(g, words, maxW);
    if (lines.length * size * lh <= maxH && lines.every((l) => g.measureText(l.join(" ")).width <= maxW * 1.001)) return { size, lines };
    size *= 0.92;
  }
  g.font = font(size);
  return { size, lines: wrapLines(g, words, maxW) };
}

const bare = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}$%]/gu, "");

function background(g: Ctx, p: P, W: number, H: number, t: number) {
  g.fillStyle = p.bg; g.fillRect(0, 0, W, H);
  const blobs = [[0.2, 0.25, 0.55, p.bg2, 0.9], [0.85, 0.7, 0.5, p.accent, 0.10], [0.4, 0.95, 0.45, p.accent2, 0.08]] as const;
  blobs.forEach(([x, y, r, c, a], i) => {
    const cx = (x + 0.06 * Math.sin(t * 0.35 + i * 2)) * W, cy = (y + 0.05 * Math.cos(t * 0.28 + i)) * H, rr = r * Math.max(W, H);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
    gr.addColorStop(0, hexA(c, a)); gr.addColorStop(1, hexA(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  });
  // a slow accent ring and drifting shapes, so the frame is never still
  const U = Math.min(W, H);
  g.save(); g.strokeStyle = hexA(p.accent, p.dark ? 0.16 : 0.22); g.lineWidth = 0.018 * U;
  g.setLineDash([0.06 * U, 0.04 * U]); g.lineDashOffset = -t * 0.05 * U;
  g.beginPath(); g.arc(W * 0.92, H * 0.08, 0.36 * U, 0, Math.PI * 2); g.stroke(); g.restore();
  for (let i = 0; i < 9; i++) {
    const r0 = ((i * 0.6180339) % 1), sp = 0.012 + 0.01 * ((i * 0.37) % 1);
    const x = (0.08 + 0.84 * r0 + 0.02 * Math.sin(t * 0.6 + i)) * W, y = (1.1 - ((t * sp + i * 0.13) % 1.2)) * H, sz = (0.012 + 0.012 * ((i * 0.71) % 1)) * U;
    g.save(); g.translate(x, y); g.rotate(t * 0.4 + i); g.fillStyle = hexA(i % 2 ? p.accent : p.accent2, p.dark ? 0.28 : 0.35);
    g.beginPath(); g.roundRect(-sz / 2, -sz / 2, sz, sz, sz * 0.25); g.fill(); g.restore();
  }
  // a quiet dot grid that drifts
  g.fillStyle = hexA(p.ink, p.dark ? 0.06 : 0.08);
  const step = Math.min(W, H) / 18, off = (t * 8) % step;
  for (let y = -step + off; y < H; y += step) for (let x = step / 2; x < W; x += step) g.fillRect(x, y, 2.2, 2.2);
}

function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Words rising out of their own line masks, staggered; emphasised words get an accent sweep behind them. */
function kinetic(g: Ctx, a: Anim, p: P, text: string, emphasis: string[], box: { x: number; y: number; w: number; h: number }, max: number,
                 local: number, opts: { align?: "left" | "center"; lh?: number; stagger?: number; colour?: string } = {}) {
  const F = FONTS[a.font];
  const font = (s: number) => `${F.weight} ${s}px ${F.family}`;
  const lh = opts.lh ?? 1.04;
  const { size, lines } = fit(g, font, text, box.w, box.h, max, lh);
  g.font = font(size);
  (g as Ctx & { letterSpacing?: string }).letterSpacing = `${(F.track * size).toFixed(1)}px`;
  const em = new Set(emphasis.flatMap((e) => e.split(/\s+/)).map(bare));
  const blockH = lines.length * size * lh;
  let y0 = box.y + (box.h - blockH) / 2;
  let idx = 0;
  const stagger = opts.stagger ?? 0.07;
  g.textBaseline = "alphabetic";
  for (const line of lines) {
    const lw = g.measureText(line.join(" ")).width;
    let x = opts.align === "left" ? box.x : box.x + (box.w - lw) / 2;
    const base = y0 + size * 0.86;
    for (const w of line) {
      const ww = g.measureText(w).width;
      const k = clamp01((local - 0.15 - idx * stagger) / 0.55);
      const e = ease.out(k);
      if (em.has(bare(w))) {
        const sweep = clamp01((local - 0.45 - idx * stagger) / 0.4);
        if (sweep > 0) {
          g.fillStyle = p.accent;
          const pad = size * 0.08;
          g.beginPath(); g.roundRect(x - pad, base - size * 0.82, (ww + 2 * pad) * ease.inOut(sweep), size * 0.98, size * 0.12); g.fill();
        }
      }
      g.save();
      g.beginPath(); g.rect(x - size, base - size * 1.05, ww + 2 * size, size * 1.32); g.clip();
      g.globalAlpha = Math.min(1, k * 1.6);
      g.fillStyle = em.has(bare(w)) && clamp01((local - 0.45 - idx * stagger) / 0.4) > 0.5 ? (p.dark ? p.bg : "#fff") : (opts.colour ?? p.ink);
      g.fillText(w, x, base + (1 - e) * size * 1.1);
      g.restore();
      x += ww + g.measureText(" ").width;
      idx++;
    }
    y0 += size * lh;
  }
  (g as Ctx & { letterSpacing?: string }).letterSpacing = "0px";
  return { size, bottom: y0 };
}

function fade(g: Ctx, text: string, font: string, colour: string, x: number, y: number, maxW: number, alpha: number, align: CanvasTextAlign = "center") {
  g.save(); g.globalAlpha = alpha; g.font = font; g.fillStyle = colour; g.textAlign = align; g.textBaseline = "alphabetic";
  const words = text.split(/\s+/); const lines = wrapLines(g, words, maxW);
  const m = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? "40");
  lines.forEach((l, i) => g.fillText(l.join(" "), x, y + i * m * 1.3));
  g.restore();
  return y + lines.length * m * 1.3;
}

const fmtNum = (v: number, done: boolean, target: number) => {
  const dec = Math.abs(target % 1) > 0 ? 1 : 0;
  const n = done ? target : v;
  return n >= 1000 ? Math.round(n).toLocaleString("en-US") : n.toFixed(dec);
};

export function drawScene(g: Ctx, a: Anim, s: Scene, local: number, W: number, H: number, index: number, count: number) {
  const p = PALETTES[a.palette];
  const F = FONTS[a.font];
  const U = Math.min(W, H);
  const tall = H > W * 1.2;
  const m = 0.08 * W;
  const body = (sz: number, w = 500) => `${w} ${sz}px ${F.family.includes("Mono") ? F.family : '"Plus Jakarta Sans", "Inter", sans-serif'}`;
  const sub = 0.054 * U;
  const inA = clamp01((local - 0.5) / 0.5);
  const box = { x: m, y: tall ? 0.27 * H : 0.17 * H, w: W - 2 * m, h: tall ? 0.36 * H : 0.48 * H };
  g.textAlign = "left";
  switch (s.kind) {
    case "title": {
      const r = kinetic(g, a, p, s.text, s.emphasis ?? [], { ...box, h: box.h * 0.9 }, 0.17 * U, local, { stagger: 0.07 });
      const lw = clamp01((local - 0.5) / 0.6);
      g.fillStyle = p.accent; g.fillRect(W / 2 - 0.12 * W * ease.out(lw), r.bottom + 0.03 * H, 0.24 * W * ease.out(lw), Math.max(6, 0.008 * U));
      if (s.sub) fade(g, s.sub, body(sub), p.muted, W / 2, r.bottom + 0.1 * H, W - 2 * m, inA);
      break;
    }
    case "statement": {
      kinetic(g, a, p, s.text, s.emphasis ?? [], box, 0.125 * U, local, { stagger: 0.045, lh: 1.1 });
      if (s.sub) fade(g, s.sub, body(sub), p.muted, W / 2, box.y + box.h + 0.06 * H, W - 2 * m, inA);
      break;
    }
    case "number": {
      const target = s.value ?? 0;
      const k = ease.out(clamp01((local - 0.2) / 1.3));
      const str = `${s.prefix ?? ""}${fmtNum(target * k, k >= 0.999, target)}${s.suffix ?? ""}`;
      const cx = W / 2, cy = tall ? 0.42 * H : 0.42 * H, R = 0.3 * U;
      g.lineWidth = 0.025 * U; g.lineCap = "round";
      g.strokeStyle = hexA(p.ink, 0.12); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = p.accent; g.beginPath(); g.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.82 * k); g.stroke();
      const F2 = (sz: number) => `${F.weight} ${sz}px ${F.family}`;
      let size = 0.2 * U; g.font = F2(size);
      while (g.measureText(str).width > 1.6 * R && size > 0.06 * U) { size *= 0.92; g.font = F2(size); }
      g.fillStyle = p.ink; g.textAlign = "center"; g.textBaseline = "middle";
      g.save(); g.translate(cx, cy); const pop = 0.85 + 0.15 * ease.back(clamp01(local / 0.5)); g.scale(pop, pop); g.fillText(str, 0, 0); g.restore();
      g.textBaseline = "alphabetic";
      if (s.text) fade(g, s.text, `${F.weight} ${0.06 * U}px ${F.family}`, p.ink, W / 2, cy + R + 0.1 * U, W - 2 * m, clamp01((local - 0.5) / 0.5));
      if (s.sub) fade(g, s.sub, body(sub), p.muted, W / 2, cy + R + 0.2 * U, W - 2 * m, inA);
      break;
    }
    case "list": {
      const items = s.items ?? [];
      const itemSize = (tall ? 0.072 : 0.062) * U, gap = itemSize * (tall ? 2.1 : 1.75);
      const headH = s.text ? 0.16 * U : 0;
      const blockH = headH + 0.04 * H + items.length * gap;
      const top = Math.max(0.1 * H, (H - blockH) / 2 - 0.02 * H);
      const r = s.text ? kinetic(g, a, p, s.text, [], { x: m, y: top, w: W - 2 * m, h: headH }, 0.11 * U, local, { align: "left" }) : { bottom: top };
      const per = Math.max(0.3, Math.min(0.7, (s.duration - 1.2) / Math.max(1, items.length)));
      items.forEach((it, i) => {
        const k = ease.out(clamp01((local - 0.35 - i * per) / 0.45));
        if (k <= 0) return;
        const y = r.bottom + 0.04 * H + (i + 0.5) * gap;
        const d = itemSize * 1.05;
        g.save(); g.globalAlpha = k; g.translate((1 - k) * 0.08 * W, 0);
        g.fillStyle = p.accent; g.beginPath(); g.arc(m + d / 2, y, d / 2, 0, Math.PI * 2); g.fill();
        g.strokeStyle = p.dark ? p.bg : "#fff"; g.lineWidth = d * 0.13; g.lineCap = "round"; g.lineJoin = "round";
        g.beginPath(); g.moveTo(m + d * 0.28, y); g.lineTo(m + d * 0.45, y + d * 0.17); g.lineTo(m + d * 0.74, y - d * 0.2); g.stroke();
        let fs = itemSize;
        g.font = `${Math.min(F.weight, 700)} ${fs}px ${F.family}`; g.fillStyle = p.ink; g.textBaseline = "middle";
        while (g.measureText(it).width > W - 2 * m - d * 1.5 && fs > itemSize * 0.7) { fs *= 0.94; g.font = `${Math.min(F.weight, 700)} ${fs}px ${F.family}`; }
        let txt = it; while (g.measureText(txt).width > W - 2 * m - d * 1.5 && txt.length > 4) txt = txt.slice(0, -2);
        g.fillText(txt === it ? it : txt + "…", m + d * 1.45, y);
        g.restore();
      });
      g.textBaseline = "alphabetic";
      break;
    }
    case "quote": {
      const k = ease.back(clamp01(local / 0.5));
      g.save(); g.translate(m, (tall ? 0.22 : 0.16) * H); g.scale(k, k);
      g.fillStyle = p.accent; g.font = `900 ${0.32 * U}px Georgia, serif`; g.fillText("“", -0.02 * U, 0.2 * U); g.restore();
      const letters = Math.floor(s.text.length * clamp01((local - 0.3) / Math.max(0.6, s.duration * 0.55)));
      const shown = s.text.slice(0, letters);
      const F3 = (sz: number) => `${Math.min(F.weight, 700)} ${sz}px ${F.family}`;
      const { size, lines } = fit(g, F3, s.text, W - 2 * m, box.h, 0.085 * U, 1.25);
      g.font = F3(size); g.fillStyle = p.ink; g.textAlign = "left";
      let c = 0, y = box.y + 0.08 * H;
      for (const l of lines) { const str = l.join(" "); const part = shown.slice(c, c + str.length); g.fillText(part, m, y); c += str.length + 1; y += size * 1.25; }
      if (s.sub) fade(g, `— ${s.sub}`, body(sub, 600), p.muted, m, y + 0.03 * H, W - 2 * m, clamp01((local - s.duration * 0.6) / 0.4), "left");
      break;
    }
    case "compare": {
      const [A = "Before", B = "After"] = s.items ?? [];
      if (s.text) kinetic(g, a, p, s.text, [], { x: m, y: tall ? 0.13 * H : 0.08 * H, w: W - 2 * m, h: 0.12 * H }, 0.09 * U, local);
      const two = tall ? [[m, 0.29 * H, W - 2 * m, 0.25 * H], [m, 0.57 * H, W - 2 * m, 0.25 * H]] : [[m, 0.26 * H, (W - 3 * m) / 2, 0.56 * H], [2 * m + (W - 3 * m) / 2, 0.26 * H, (W - 3 * m) / 2, 0.56 * H]];
      [A, B].forEach((label, i) => {
        const k = ease.out(clamp01((local - 0.1 - i * 0.4) / 0.5));
        const [x, y, w, h] = two[i];
        g.save(); g.globalAlpha = k; g.translate((i ? 1 : -1) * (1 - k) * 0.15 * W, 0);
        g.fillStyle = i ? p.accent : hexA(p.ink, 0.08);
        g.beginPath(); g.roundRect(x, y, w, h, 0.03 * U); g.fill();
        g.fillStyle = i ? (p.dark ? p.bg : "#fff") : p.muted; g.font = body(0.036 * U, 700); g.textAlign = "left";
        g.fillText(i ? "AFTER" : "BEFORE", x + 0.04 * U, y + 0.075 * U);
        const F4 = (sz: number) => `${F.weight} ${sz}px ${F.family}`;
        const { size, lines } = fit(g, F4, label, w - 0.08 * U, h - 0.15 * U, 0.14 * U, 1.05);
        g.font = F4(size); g.fillStyle = i ? (p.dark ? p.bg : "#fff") : p.ink;
        lines.forEach((l, j) => g.fillText(l.join(" "), x + 0.04 * U, y + 0.12 * U + size * (j + 0.85) * 1.05));
        g.restore();
      });
      break;
    }
    case "bars": {
      const rows = (s.items ?? []).map((it) => { const mm = it.match(/^(.*?)[:=\s]+([$£€]?)(\d[\d,.]*)\s*(%|[a-z]+)?$/i);
        return mm ? { label: mm[1].trim(), pre: mm[2], v: +mm[3].replace(/,/g, ""), suf: mm[4] ?? "" } : { label: it, pre: "", v: 0, suf: "" }; });
      const maxV = Math.max(1, ...rows.map((r) => r.v));
      const top = tall ? 0.16 * H : 0.1 * H;
      const r0 = kinetic(g, a, p, s.text || "", [], { x: m, y: top, w: W - 2 * m, h: 0.12 * H }, 0.08 * U, local, { align: "left" });
      const bh = Math.min(0.09 * H, (0.6 * H) / Math.max(1, rows.length) - 0.03 * H);
      rows.forEach((row, i) => {
        const k = ease.out(clamp01((local - 0.4 - i * 0.18) / 1));
        const y = r0.bottom + 0.06 * H + i * (bh + 0.045 * H);
        g.font = body(0.04 * U, 700); g.fillStyle = p.muted; g.textAlign = "left"; g.fillText(row.label, m, y - 0.012 * H);
        g.fillStyle = hexA(p.ink, 0.08); g.beginPath(); g.roundRect(m, y, W - 2 * m, bh, bh / 2); g.fill();
        const w = Math.max(bh, (W - 2 * m) * (row.v / maxV) * k);
        g.fillStyle = i === rows.indexOf(rows.reduce((x, y2) => (y2.v > x.v ? y2 : x))) ? p.accent : p.accent2;
        g.beginPath(); g.roundRect(m, y, w, bh, bh / 2); g.fill();
        g.font = `${F.weight} ${0.05 * U}px ${F.family}`; g.fillStyle = p.dark ? p.bg : "#fff"; g.textBaseline = "middle";
        const label = `${row.pre}${fmtNum(row.v * k, k >= 0.999, row.v)}${row.suf}`;
        if (w > g.measureText(label).width + bh) g.fillText(label, m + w - g.measureText(label).width - bh * 0.45, y + bh / 2);
        g.textBaseline = "alphabetic";
      });
      break;
    }
    case "cta": {
      const r = kinetic(g, a, p, s.text, s.emphasis ?? [], { ...box, y: box.y + 0.04 * H, h: box.h * 0.7 }, 0.13 * U, local);
      if (s.sub) {
        const k = ease.back(clamp01((local - 0.6) / 0.5));
        const pulse = 1 + 0.03 * Math.sin(local * 5);
        g.font = body(0.05 * U, 800);
        const tw = g.measureText(s.sub).width;
        const bw = tw + 0.12 * U, bh = 0.11 * U, cx = W / 2, cy = r.bottom + 0.1 * H;
        g.save(); g.translate(cx, cy); g.scale(k * pulse, k * pulse);
        g.fillStyle = p.accent; g.beginPath(); g.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2); g.fill();
        g.fillStyle = p.dark ? p.bg : "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(s.sub, 0, 2);
        g.restore(); g.textBaseline = "alphabetic";
      }
      break;
    }
  }
  // scene dots along the bottom
  const dotW = 0.04 * U, gapD = 0.014 * U, totalW = count * dotW + (count - 1) * gapD;
  for (let i = 0; i < count; i++) {
    g.fillStyle = i === index ? p.accent : hexA(p.ink, 0.2);
    g.beginPath(); g.roundRect(W / 2 - totalW / 2 + i * (dotW + gapD), H - 0.06 * H, dotW, Math.max(6, 0.008 * U), 4); g.fill();
  }
}

/** One frame of the whole animation at time t: background, the scene (with its exit), and a wipe between scenes. */
export function drawAnim(g: Ctx, a: Anim, t: number) {
  const { W, H } = frameSize(a.format);
  const p = PALETTES[a.palette];
  background(g, p, W, H, t);
  const tl = timeline(a);
  const i = Math.max(0, tl.findIndex((x) => t >= x.start && t < x.end));
  const cur = tl[i] ?? tl[tl.length - 1];
  if (!cur) return;
  const local = t - cur.start;
  const out = clamp01((cur.end - t) / 0.35);
  g.save();
  if (out < 1 && i < tl.length - 1) { g.globalAlpha = out; g.translate(0, -(1 - out) * 0.05 * H); }
  drawScene(g, a, cur.s, local, W, H, i, tl.length);
  g.restore();
  // an accent wipe that crosses at each scene change
  const next = tl[i + 1];
  const w = next ? clamp01((t - (cur.end - 0.25)) / 0.5) : 0;
  const w2 = i > 0 ? clamp01((t - (cur.start - 0.25)) / 0.5) : 1;
  const k = w > 0 ? w : w2 < 1 ? w2 : 0;
  if (k > 0 && k < 1) {
    const x = (-0.3 + 1.6 * ease.inOut(k)) * W;
    g.save(); g.fillStyle = p.accent; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 0.25 * W, 0); g.lineTo(x + 0.05 * W, H); g.lineTo(x - 0.2 * W, H); g.closePath(); g.fill(); g.restore();
  }
}

/** The words a voiceover reads for a scene. */
export function narration(s: Scene): string {
  if (s.say?.trim()) return s.say.trim();
  if (s.kind === "number") return `${s.prefix ?? ""}${s.value ?? ""}${s.suffix ?? ""} ${s.text}`.trim();
  if (s.kind === "compare") return `From ${s.items?.[0] ?? ""} to ${s.items?.[1] ?? ""}.`;
  return [s.text, ...(s.items ?? []), s.kind === "cta" ? "" : s.sub ?? ""].filter(Boolean).join(". ");
}
