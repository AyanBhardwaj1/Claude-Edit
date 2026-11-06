// Motion Studio: any text becomes an animated video. A plan is a list of scenes (title, statement, number, list, quote,
// compare, bars, picture, app screen, call to action); the renderer draws every frame on a canvas (kinetic type, counters,
// charts, wipes, framed app screens), so preview and export are the same pixels. With an AI key the AI plans the scenes;
// without one, planScenes() does (and demoScenes() weaves the user's screenshots into the plan for a product demo).

import { activeBrand } from "./brand";
import { backdropFor, type Point } from "./framed";
import { FORMATS } from "./formats";
import { clamp01, ease } from "./motion";
import { busyRegion, calloutK, calloutPlace, hintFocus, pointOnScreen, punchOf, screenEnter, screenLayout, screenView } from "./screenScene";
import type { Format } from "./types";

export type SceneKind = "title" | "statement" | "number" | "list" | "quote" | "compare" | "bars" | "image" | "screen" | "cta";
export type Scene = {
  id: string; kind: SceneKind; text: string; sub?: string; items?: string[];
  value?: number; prefix?: string; suffix?: string; emphasis?: string[]; duration: number;
  say?: string;                         // what the voiceover reads for this scene (defaults to its words)
  image?: string;                       // picture scenes: media key of the picture
  picture?: string;                     // picture scenes: a description an AI image model can make
  // app screen scenes (a screenshot, framed): `image` is the screenshot's media key
  focus?: Point;                        // the part being talked about, 0-1 of the picture (default: the busiest region)
  focusAuto?: boolean;                  // the focus was picked automatically, not by the user
  punch?: number;                       // seconds into the scene the punch-in lands (default: a little over a third in)
  zoom?: number;                        // how far the punch-in goes (default 1.6; 1 = no punch-in)
  callout?: string;                     // a small pill with a thin line pointing at the focus
  shot?: number; hint?: string;         // an AI plan only: which screenshot (1-based) and where to look ("top right")
};
export type Pace = "calm" | "normal" | "hype";
export const PACE_NAME: Record<Pace, string> = { calm: "Calm", normal: "Normal", hype: "Hype" };
export type PaletteId = "midnight" | "sunset" | "mint" | "paper" | "electric" | "ocean" | "brand";
export type FontId = "grotesk" | "serif" | "heavy" | "mono" | "book" | "brand";
export type Anim = {
  id: string; title: string; createdAt: string; updatedAt: string; source: string;
  palette: PaletteId; font: FontId; format: Format; scenes: Scene[];
  music?: string;                       // media key of a song (IndexedDB)
  pace?: Pace;                          // calm (slower, softer), normal, hype (one huge word at a time)
  voice?: { name: string; keys: Record<string, string> };   // scene id -> media key of its voiceover
  screenLook?: ScreenLook;              // app screens on a soft light backdrop (default) or on the palette's own ground
  owner?: string;
};
export type ScreenLook = "soft" | "theme";

export const PALETTES: Record<Exclude<PaletteId, "brand">, { name: string; bg: string; bg2: string; ink: string; muted: string; accent: string; accent2: string; dark: boolean }> = {
  midnight: { name: "Midnight", bg: "#0b1020", bg2: "#18224a", ink: "#f4f6ff", muted: "#9aa6d6", accent: "#6ee7ff", accent2: "#a78bfa", dark: true },
  sunset: { name: "Sunset", bg: "#1d0f1f", bg2: "#3a1838", ink: "#fff4ec", muted: "#d9a7b0", accent: "#ff8a4c", accent2: "#ffd166", dark: true },
  mint: { name: "Mint", bg: "#05261f", bg2: "#0d4237", ink: "#eafff8", muted: "#8cc9b6", accent: "#39f0b6", accent2: "#f4ff7a", dark: true },
  electric: { name: "Electric", bg: "#0a0a0a", bg2: "#1d1d1d", ink: "#ffffff", muted: "#a3a3a3", accent: "#c6ff3d", accent2: "#ff3d9a", dark: true },
  paper: { name: "Paper", bg: "#f4efe6", bg2: "#e6dccb", ink: "#1d1a16", muted: "#6f665a", accent: "#e4572e", accent2: "#2b59c3", dark: false },
  ocean: { name: "Ocean", bg: "#eaf4ff", bg2: "#cfe3ff", ink: "#0b1f3a", muted: "#4d6a91", accent: "#1f6feb", accent2: "#00b3a4", dark: false },
};
export const FONTS: Record<Exclude<FontId, "brand">, { name: string; family: string; weight: number; track: number }> = {
  grotesk: { name: "Grotesk", family: '"Bricolage Grotesque", "Montserrat", sans-serif', weight: 800, track: -0.03 },
  serif: { name: "Serif", family: '"Fraunces", Georgia, serif', weight: 600, track: -0.02 },
  heavy: { name: "Heavy", family: '"Montserrat", sans-serif', weight: 900, track: -0.02 },
  mono: { name: "Mono", family: '"JetBrains Mono", monospace', weight: 700, track: -0.01 },
  book: { name: "Book", family: '"Literata", Georgia, serif', weight: 600, track: -0.02 },
};
type Pal = (typeof PALETTES)["midnight"];
/** A palette or the user's brand colours (dark ground, their two colours). */
export function paletteOf(id: PaletteId): Pal {
  if (id !== "brand") return PALETTES[id] ?? PALETTES.midnight;
  const b = activeBrand().brand;
  return { name: "Brand", bg: "#0f0f12", bg2: "#1e1e26", ink: "#ffffff", muted: "#a8a8b3", accent: b.accent, accent2: b.accent2, dark: true };
}
export function fontOf(id: FontId) {
  if (id !== "brand") return FONTS[id] ?? FONTS.grotesk;
  return { name: "Brand", family: `"${activeBrand().brand.font}", "Montserrat", sans-serif`, weight: 800, track: -0.02 };
}

export const KIND_NAME: Record<SceneKind, string> = { title: "Title", statement: "Statement", number: "Big number", list: "List", quote: "Quote",
  compare: "Before and after", bars: "Bar chart", image: "Picture", screen: "App screen", cta: "Call to action" };

/** Pictures for picture scenes, by media key (the player loads them). */
const IMAGES = new Map<string, HTMLImageElement>();
const AUTO_FOCUS = new Map<string, Point>();
export const setStudioImage = (key: string, img: HTMLImageElement) => { IMAGES.set(key, img); AUTO_FOCUS.delete(key); };
export const studioImage = (key?: string) => (key ? IMAGES.get(key) : undefined);

/** The busiest region of a picture (lib/screenScene.ts busyRegion on a ~160 px copy): where an app screen punches in
 *  when nobody has picked a spot. Browser only; the middle elsewhere. */
export function busyFocus(img: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement): Point {
  const iw = "naturalWidth" in img ? img.naturalWidth : "videoWidth" in img ? img.videoWidth : img.width;
  const ih = "naturalHeight" in img ? img.naturalHeight : "videoHeight" in img ? img.videoHeight : img.height;
  if (typeof document === "undefined" || !iw || !ih) return { x: 0.5, y: 0.5 };
  const w = Math.max(16, Math.min(160, iw)), h = Math.max(8, Math.round((w * ih) / iw));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return { x: 0.5, y: 0.5 };
  g.imageSmoothingQuality = "high"; g.drawImage(img, 0, 0, w, h);
  const r = busyRegion(g.getImageData(0, 0, w, h).data, w, h);
  return { x: +r.x.toFixed(3), y: +r.y.toFixed(3) };
}
/** The scene's focus: the user's pick, else the picture's busiest region (worked out once per picture). */
export function focusOf(s: Pick<Scene, "focus" | "image">): Point {
  if (s.focus) return s.focus;
  const img = studioImage(s.image);
  if (!img?.naturalWidth || !s.image) return { x: 0.5, y: 0.5 };
  let f = AUTO_FOCUS.get(s.image);
  if (!f) { f = busyFocus(img); AUTO_FOCUS.set(s.image, f); }
  return f;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const STOP = new Set("the a an and or but of to in on at for with from by is are was were be been it this that these those your you our we my i me they them their his her its as so if then than just very really more most into over about what when how why who".split(" "));

/** Seconds a scene stays up: long enough to read twice. */
export function readTime(s: Pick<Scene, "kind" | "text" | "sub" | "items">): number {
  const words = [s.text, s.sub ?? "", ...(s.items ?? [])].join(" ").split(/\s+/).filter(Boolean).length;
  const base = s.kind === "number" ? 2.6 : s.kind === "statement" || s.kind === "quote" ? 1.6 : 2.2;
  // an app screen needs time to land, punch in and be looked at
  if (s.kind === "screen") return +Math.min(7, Math.max(4, 2.8 + 0.24 * words)).toFixed(1);
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
      // "Reels: 12" lines are numbers: a bar chart says them better than a list
      if (items.length >= 2 && items.every((x) => /:\s*[$£€]?\d[\d,.]*\s*%?$/.test(x))) push({ kind: "bars", text: head || "By the numbers", items });
      else push({ kind: "list", text: head || "In short", items });
      continue;
    }
    const words = u.split(/\s+/).length;
    const q = u.match(/^["“](.+)["”]\s*(?:[-—–]\s*(.+))?$/);
    const fromTo = u.match(/^(.*?)\b(?:went|grew|jumped|rose|climbed|fell|dropped|went up|went down)?\s*from\s+(.+?)\s+to\s+(.+?)[.!]?$/i);
    if (fromTo && NUM.test(fromTo[2]) && NUM.test(fromTo[3]) && words <= 16) {
      const head = fromTo[1].replace(/\b(went|grew|jumped|rose|climbed|fell|dropped)\s*$/i, "").trim();
      push({ kind: "compare", text: head, items: [fromTo[2], fromTo[3]], say: u }); i++; continue;
    }
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
    const ordinal = n && /\b(step|number|no\.?|part|tip|rule|day|chapter|lesson|level|round|version)\s*$/i.test(u.slice(0, n.index ?? 0));
    if (n && !ordinal && words <= 18 && +n[2].replace(/,/g, "") > 0) {
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
      say: s.say ? String(s.say).slice(0, 400) : undefined, picture: s.picture ? String(s.picture).slice(0, 400) : undefined };
    if (kind === "screen") {
      const raw = s as Omit<Partial<Scene>, "focus"> & { focus?: unknown };
      if (Number.isFinite(Number(raw.shot))) sc.shot = Math.round(Number(raw.shot));
      if (raw.callout) sc.callout = String(raw.callout).slice(0, 40);
      // the AI's focus is a few words ("top right", "the chart"); a point is kept as it is
      const f = raw.focus as Partial<Point> | string | undefined;
      if (typeof f === "string") sc.hint = f.slice(0, 60);
      else if (f && Number.isFinite(Number(f.x)) && Number.isFinite(Number(f.y))) sc.focus = { x: clamp01(Number(f.x)), y: clamp01(Number(f.y)) };
      if (raw.hint) sc.hint = String(raw.hint).slice(0, 60);
    }
    sc.duration = Number.isFinite(Number(s.duration)) ? Math.min(8, Math.max(kind === "screen" ? 3.2 : 1.8, Number(s.duration))) : readTime(sc);
    return sc;
  }).filter((s) => s.text || s.items?.length || s.kind === "screen");
}

// ------------------------------------------------------------------ product demo: screenshots woven into the plan

/** A screenshot for a product demo: its media key and file name (the name's words find the sentence that mentions it). */
export type Shot = { key: string; name?: string; focus?: Point };

const SHOT_NOISE = new Set("screenshot screen shot image img copy png jpg jpeg webp gif final untitled capture snap clean new edit frame".split(" "));
const stem = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").replace(/ies$/, "y").replace(/(?<=[^s])s$/, "");
/** The words of a file name that mean something ("acme-dashboard_v2.png" -> acme, dashboard). Words in `skip` (the
 *  product's name, from the title) are left out when anything else is left. */
export function shotWords(name?: string, skip?: Set<string>): string[] {
  const ws = (name ?? "").replace(/\.[a-z0-9]{2,5}$/i, "").split(/[^\p{L}]+/u).map((w) => w.toLowerCase())
    .filter((w) => w.length >= 3 && !SHOT_NOISE.has(w) && !STOP.has(w));
  const topic = skip ? ws.filter((w) => !skip.has(stem(w))) : ws;
  return topic.length ? topic : ws;
}
/** "acme-dashboard.png" -> "Acme dashboard" ("" when the name says nothing); "Dashboard" when Acme is the product. */
export function shotLabel(name?: string, skip?: Set<string>): string {
  const w = shotWords(name, skip).slice(0, 3).join(" ");
  return w ? w[0].toUpperCase() + w.slice(1) : "";
}
const sceneWords = (s: Scene) => new Set([s.text, s.sub ?? "", s.say ?? "", ...(s.items ?? [])].join(" ").split(/\s+/).map(stem).filter(Boolean));

/** A screen scene for a screenshot, its caption the sentence that talks about it. */
export function screenScene(shot: Shot, caption: string, from: Partial<Scene> = {}): Scene {
  const label = shotLabel(shot.name);
  const sc: Scene = { id: uid(), kind: "screen", text: caption, image: shot.key, duration: 4, emphasis: from.emphasis,
    say: from.say ?? (caption || undefined), callout: from.callout ?? (label && label.toLowerCase() !== caption.toLowerCase() ? label : undefined) };
  if (shot.focus) { sc.focus = shot.focus; sc.focusAuto = true; }
  sc.duration = readTime(sc);
  return sc;
}

/** Weave screenshots into a plan: each screenshot goes to the sentence that mentions it (by the words of its file name),
 *  the rest spread evenly through the middle, never two screens in a row when it can be helped. A plain statement
 *  becomes the screen (its sentence the caption); any other scene (the title, a number, a list) keeps its animation and
 *  the screen follows it. The title stays first and the call to action last:
 *  title -> screen -> statement -> screen -> number -> screen -> call to action. */
export function weaveShots(plan: Scene[], shots: Shot[]): Scene[] {
  if (!shots.length) return plan;
  const n = plan.length;
  const end = n && plan[n - 1].kind === "cta" ? n - 1 : n;                 // anchors come before the call to action
  const free = (i: number) => plan[i].kind !== "screen";
  const replaces = (i: number) => i > 0 && plan[i].kind === "statement";  // the screen takes this scene's place
  const anchor = new Map<number, number>();                               // scene index -> shot index
  const byName = new Set<number>();
  const words = plan.map(sceneWords);
  const product = n && plan[0].kind === "title" ? words[0] : undefined;   // the title's words (usually the product's name)
  const label = (k: number) => shotLabel(shots[k].name, product);
  // 1. by name: the sentence that mentions the screenshot
  shots.forEach((sh, k) => {
    const want = shotWords(sh.name, product).map(stem);
    if (!want.length) return;
    let best = -1, score = 0;
    for (let i = 0; i < end; i++) {
      if (!free(i) || anchor.has(i)) continue;
      const sc = want.filter((w) => words[i].has(w)).length + (replaces(i) ? 0.1 : 0);
      if (sc >= 1 && sc > score) { best = i; score = sc; }
    }
    if (best >= 0) { anchor.set(best, k); byName.add(k); }
  });
  // two screens end up side by side when the later anchor is the very next scene and the screen takes its place
  const touches = (i: number) => [...anchor.keys()].some((j) => (j === i - 1 && replaces(i)) || (j === i + 1 && replaces(j)));
  // 2. the rest: spread evenly over the middle, statements first, not next to another screen
  const rest = shots.map((_, k) => k).filter((k) => !byName.has(k));
  const middle = Array.from({ length: end }, (_, i) => i).filter(free);
  const extra: number[] = [];
  rest.forEach((k, j) => {
    const ideal = middle.length ? middle[Math.min(middle.length - 1, Math.floor(((j + 0.5) * middle.length) / rest.length))] : 0;
    let best = -1, cost = Infinity;
    for (const i of middle) {
      if (anchor.has(i)) continue;
      const c = Math.abs(i - ideal) + (touches(i) ? 3 : 0) + (replaces(i) ? 0 : 0.5);
      if (c < cost) { best = i; cost = c; }
    }
    if (best >= 0) anchor.set(best, k); else extra.push(k);
  });
  const out: Scene[] = [];
  plan.forEach((s, i) => {
    const k = anchor.get(i);
    if (k === undefined) { out.push(s); return; }
    if (replaces(i)) {
      const l = label(k);
      out.push(screenScene(shots[k], s.text, { emphasis: s.emphasis, say: s.say, callout: l && !s.text.toLowerCase().startsWith(l.toLowerCase()) ? l : "" }));
      return;
    }
    out.push(s);
    // a title, number or list keeps its words; the screen after it says what the picture is (its name), or nothing
    out.push(screenScene(shots[k], label(k), { say: "", callout: "" }));
  });
  const tail = extra.map((k) => screenScene(shots[k], label(k), { say: "", callout: "" }));
  if (tail.length) out.splice(out.length && out[out.length - 1].kind === "cta" ? out.length - 1 : out.length, 0, ...tail);
  return out.map((s) => (s.callout === "" ? { ...s, callout: undefined } : s));
}

/** The product demo with no AI: the text's own plan, the screenshots woven in. */
export const demoScenes = (text: string, shots: Shot[]) => weaveShots(planScenes(text), shots);

/** An AI plan's screen scenes, resolved: "shot" (1-based) becomes the screenshot's media key, the focus hint a point (or
 *  the busy-region default), screens with no usable screenshot get the next unused one or become statements, and any
 *  screenshot the AI left out is woven in the way demoScenes does. */
export function placeShots(scenes: Scene[], shots: Shot[]): Scene[] {
  const used = new Set<number>();
  const out = scenes.map((s): Scene => {
    if (s.kind !== "screen") return s;
    const { shot, hint, ...rest } = s;
    let k = shot && shot >= 1 && shot <= shots.length && !used.has(shot - 1) ? shot - 1 : -1;
    if (k < 0 && rest.image && !shot) return rest;                        // already has a picture of its own
    if (k < 0) k = shots.findIndex((_, i) => !used.has(i));
    if (k < 0) { const st: Scene = { ...rest, kind: "statement", callout: undefined }; st.duration = readTime(st); return st; }
    used.add(k);
    const hinted = hintFocus(hint);
    const focus = rest.focus ?? hinted ?? shots[k].focus;
    return { ...rest, image: shots[k].key, ...(focus ? { focus, focusAuto: !rest.focus && !hinted } : {}) };
  });
  const left = shots.filter((_, i) => !used.has(i));
  return left.length ? weaveShots(out, left) : out;
}


export const timeline = (a: Anim) => { let t = 0; return a.scenes.map((s) => { const r = { s, start: t, end: t + s.duration }; t += s.duration; return r; }); };
export const total = (a: Anim) => a.scenes.reduce((n, s) => n + s.duration, 0);

// ------------------------------------------------------------------ drawing

type Ctx = CanvasRenderingContext2D;
type P = Pal;

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
                 local: number, opts: { align?: "left" | "center"; lh?: number; stagger?: number; colour?: string; onAccent?: string } = {}) {
  const F = fontOf(a.font);
  const font = (s: number) => `${F.weight} ${s}px ${F.family}`;
  const lh = opts.lh ?? 1.04;
  const { size, lines } = fit(g, font, text, box.w, box.h, max, lh);
  g.font = font(size);
  (g as Ctx & { letterSpacing?: string }).letterSpacing = `${(F.track * size).toFixed(1)}px`;
  const em = new Set(emphasis.flatMap((e) => e.split(/\s+/)).map(bare));
  const blockH = lines.length * size * lh;
  let y0 = box.y + (box.h - blockH) / 2;
  let idx = 0;
  const stagger = (opts.stagger ?? 0.07) * (a.pace === "calm" ? 1.7 : 1);
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
      g.fillStyle = em.has(bare(w)) && clamp01((local - 0.45 - idx * stagger) / 0.4) > 0.5 ? (opts.onAccent ?? (p.dark ? p.bg : "#fff")) : (opts.colour ?? p.ink);
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
  const p = paletteOf(a.palette);
  const F = fontOf(a.font);
  const U = Math.min(W, H);
  const tall = H > W * 1.2;
  const m = 0.08 * W;
  const body = (sz: number, w = 500) => `${w} ${sz}px ${F.family.includes("Mono") ? F.family : '"Plus Jakarta Sans", "Inter", sans-serif'}`;
  const sub = 0.054 * U;
  const inA = clamp01((local - 0.5) / 0.5);
  const box = { x: m, y: tall ? 0.27 * H : 0.17 * H, w: W - 2 * m, h: tall ? 0.36 * H : 0.48 * H };
  g.textAlign = "left";
  if (a.pace === "hype" && (s.kind === "title" || s.kind === "statement" || s.kind === "cta" || s.kind === "quote")) {
    hype(g, a, p, s, local, W, H);
    dots(g, p, W, H, U, index, count);
    return;
  }
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
    case "image": {
      const img = studioImage(s.image);
      const kb = 1.04 + 0.08 * clamp01(local / Math.max(1, s.duration));
      if (img?.naturalWidth) {
        const sc = Math.max(W / img.naturalWidth, H / img.naturalHeight) * kb;
        const dw = img.naturalWidth * sc, dh = img.naturalHeight * sc;
        g.save(); g.globalAlpha = ease.out(clamp01(local / 0.5));
        g.drawImage(img, (W - dw) / 2 + 0.02 * W * Math.sin(local * 0.3), (H - dh) / 2, dw, dh); g.restore();
        const sh = g.createLinearGradient(0, H * 0.45, 0, H);
        sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.78)");
        g.fillStyle = sh; g.fillRect(0, 0, W, H);
      } else {
        g.fillStyle = hexA(p.ink, 0.06); g.beginPath(); g.roundRect(m, 0.18 * H, W - 2 * m, 0.42 * H, 0.03 * U); g.fill();
        g.fillStyle = p.muted; g.font = body(0.04 * U, 600); g.textAlign = "center"; g.fillText("Add a picture for this scene", W / 2, 0.4 * H);
      }
      if (s.text) kinetic(g, a, { ...p, ink: "#ffffff" }, s.text, s.emphasis ?? [], { x: m, y: tall ? 0.64 * H : 0.6 * H, w: W - 2 * m, h: tall ? 0.2 * H : 0.28 * H },
        0.1 * U, local, { align: "left", colour: "#ffffff" });
      break;
    }
    case "screen":
      drawScreen(g, a, p, s, local, W, H);
      return;                                               // the screen has the frame to itself (no scene dots)
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
      const { brand, logo } = activeBrand();
      if (a.palette === "brand" || a.font === "brand") {
        const k = clamp01((local - 0.8) / 0.5);
        g.save(); g.globalAlpha = k;
        if (logo?.naturalWidth) { const h = 0.11 * U, w = Math.min(0.5 * W, logo.naturalWidth * h / logo.naturalHeight); g.drawImage(logo, W / 2 - w / 2, box.y - 0.04 * H - h, w, h * (w / (logo.naturalWidth * h / logo.naturalHeight))); }
        if (brand.handle.trim()) { g.font = body(0.045 * U, 700); g.fillStyle = p.muted; g.textAlign = "center";
          g.fillText(brand.handle.startsWith("@") ? brand.handle : `@${brand.handle}`, W / 2, r.bottom + 0.2 * H); }
        g.restore();
      }
      break;
    }
  }
  dots(g, p, W, H, U, index, count);
}

// ------------------------------------------------------------------ app screens

/** Relative luminance of a #rrggbb colour (0 black .. 1 white). */
function lum(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const c = [16, 8, 0].map((sh) => { const v = ((n >> sh) & 255) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const mixHex = (a: string, b: string, k: number) => {
  const x = parseInt(a.slice(1), 16), y = parseInt(b.slice(1), 16);
  return `#${[16, 8, 0].map((sh) => Math.round((1 - k) * ((x >> sh) & 255) + k * ((y >> sh) & 255)).toString(16).padStart(2, "0")).join("")}`;
};

/** The colours of an app screen scene: the soft look (a light backdrop tinted with the palette's or brand's accent, the
 *  hackathon-demo look) or the palette's own ground. The accent is deepened when it would be too pale to read on a
 *  light ground or a white app screen. */
export function screenColours(a: Pick<Anim, "palette" | "screenLook">) {
  const p = paletteOf(a.palette);
  const soft = (a.screenLook ?? "soft") === "soft";
  const dark = soft ? false : p.dark;
  const accent = !dark && lum(p.accent) > 0.35 ? mixHex(p.accent, "#1d1b17", 0.4) : p.accent;
  return { soft, dark, accent, onAccent: lum(accent) > 0.42 ? "#14120f" : "#ffffff",
    ground: soft ? backdropFor(p.accent) : p.bg, glow: soft ? "#ffffff" : p.bg2, ink: soft ? "#1d1b17" : p.ink, muted: soft ? "#6f665a" : p.muted,
    shadow: dark ? 0.5 : 0.18 };
}

/** An app screen: the screenshot framed on a soft backdrop (rounded corners, soft shadow), rising in, pushing in slowly,
 *  punching in on the focus, a callout pill pointing at it, the caption above or below (lib/screenScene.ts). The picture
 *  is drawn once, straight from its source rectangle, so it stays as sharp as the screenshot. */
function drawScreen(g: Ctx, a: Anim, p: P, s: Scene, local: number, W: number, H: number) {
  const c = screenColours(a);
  const U = Math.min(W, H);
  g.fillStyle = c.ground; g.fillRect(0, 0, W, H);
  const gl = g.createRadialGradient(W / 2, -0.15 * H, 0, W / 2, -0.15 * H, 1.1 * Math.max(W, H));
  gl.addColorStop(0, hexA(c.glow, c.soft ? 0.6 : 0.85)); gl.addColorStop(1, hexA(c.glow, 0));
  g.fillStyle = gl; g.fillRect(0, 0, W, H);
  const img = studioImage(s.image);
  const has = !!img?.naturalWidth;
  const aw = has ? img!.naturalWidth : 1600, ah = has ? img!.naturalHeight : 1000;
  const focus = focusOf(s);
  const L = screenLayout({ W, H, aw, ah, caption: !!s.text.trim(), focusY: focus.y, focusX: focus.x });
  const S = L.screen;
  if (L.caption) kinetic(g, a, { ...p, ink: c.ink, accent: c.accent }, s.text, s.emphasis ?? [], L.caption, L.capSize, local,
    { stagger: 0.04, lh: 1.1, onAccent: c.onAccent });
  const punch = has ? punchOf(s) : undefined;
  const e = screenEnter(local);
  g.save();
  g.globalAlpha = clamp01(local / 0.3);
  const cx = S.x + S.w / 2, cy = S.y + S.h / 2, k = 0.965 + 0.035 * e;
  g.translate(cx, cy + (1 - e) * 0.035 * U); g.scale(k, k); g.translate(-cx, -cy);
  g.shadowColor = `rgba(0,0,0,${c.shadow})`; g.shadowBlur = L.shadow.blur; g.shadowOffsetY = L.shadow.dy;
  g.fillStyle = has ? "#ffffff" : mixHex(c.ground, c.ink, 0.05);
  g.beginPath(); g.roundRect(S.x, S.y, S.w, S.h, L.radius); g.fill();
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
  if (has) {
    const v = screenView(aw, ah, S, local, s.duration, focus, punch);
    g.save(); g.beginPath(); g.roundRect(S.x, S.y, S.w, S.h, L.radius); g.clip();
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = "high";
    g.drawImage(img!, v.x, v.y, v.w, v.h, S.x, S.y, S.w, S.h);
    g.restore();
  } else {
    g.fillStyle = c.muted; g.font = `600 ${0.036 * U}px "Plus Jakarta Sans", "Inter", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("Add a screenshot of your app", cx, cy); g.textBaseline = "alphabetic"; g.textAlign = "left";
  }
  // a hairline edge, so a white app screen still reads against a light backdrop
  g.strokeStyle = c.dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.09)"; g.lineWidth = Math.max(1, U / 1080);
  g.beginPath(); g.roundRect(S.x, S.y, S.w, S.h, L.radius); g.stroke();
  g.restore();
  const text = s.callout?.trim();
  if (has && text) {
    const ck = calloutK(local, punch);
    if (ck > 0) {
      const pt = pointOnScreen(focus, aw, ah, screenView(aw, ah, S, local, s.duration, focus, punch), S);
      drawCallout(g, c, text, pt, S, W, H, ck, local);
    }
  }
}

/** The callout: a ring on the focus point, a thin line drawn out to a pill with a few words. */
function drawCallout(g: Ctx, c: ReturnType<typeof screenColours>, text: string, pt: Point, S: { x: number; y: number; w: number; h: number },
                     W: number, H: number, k: number, local: number) {
  const U = Math.min(W, H);
  const fs = (H > 1.2 * W ? 0.036 : 0.03) * U;
  g.font = `700 ${fs}px "Plus Jakarta Sans", "Inter", sans-serif`;
  const pillH = 2.1 * fs;
  const P = calloutPlace({ pt, S, W, H, pillW: Math.min(g.measureText(text).width, 0.8 * S.w) + 1.7 * fs, pillH });
  // words that don't fit the pill it got are cut with an ellipsis
  let label = text;
  while (g.measureText(label).width > P.box.w - 1.7 * fs && label.length > 2) label = `${label.replace(/…$/, "").slice(0, -1).trimEnd()}…`;
  g.save();
  // the ring: an open circle around the spot (what it points at stays readable), white under the accent so it shows on
  // dark and light screens, with a soft pulse
  const R = 0.026 * U * (0.6 + 0.4 * ease.back(k)), pulse = 0.5 + 0.5 * Math.sin(local * 4);
  g.globalAlpha = 0.1 * k; g.fillStyle = c.accent;
  g.beginPath(); g.arc(pt.x, pt.y, R * (1.25 + 0.2 * pulse), 0, Math.PI * 2); g.fill();
  g.globalAlpha = k;
  g.strokeStyle = "rgba(255,255,255,0.9)"; g.lineWidth = 0.009 * U; g.beginPath(); g.arc(pt.x, pt.y, R, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = c.accent; g.lineWidth = 0.0045 * U; g.beginPath(); g.arc(pt.x, pt.y, R, 0, Math.PI * 2); g.stroke();
  // the line, drawn out from the pill to the ring
  const dx = pt.x - P.anchor.x, dy = pt.y - P.anchor.y, len = Math.hypot(dx, dy);
  if (len > R + 0.01 * U) {
    const reach = (len - R - 0.003 * U) * k;
    g.lineWidth = Math.max(2, 0.003 * U); g.lineCap = "round";
    g.beginPath(); g.moveTo(P.anchor.x, P.anchor.y); g.lineTo(P.anchor.x + (dx / len) * reach, P.anchor.y + (dy / len) * reach); g.stroke();
  }
  // the pill pops in from where the line starts
  const sc = 0.85 + 0.15 * ease.back(k);
  g.translate(P.anchor.x, P.anchor.y); g.scale(sc, sc); g.translate(-P.anchor.x, -P.anchor.y);
  g.shadowColor = "rgba(0,0,0,0.2)"; g.shadowBlur = 0.025 * U; g.shadowOffsetY = 0.006 * U;
  g.fillStyle = c.accent; g.beginPath(); g.roundRect(P.box.x, P.box.y, P.box.w, P.box.h, pillH / 2); g.fill();
  g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
  g.fillStyle = c.onAccent; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(label, P.box.x + P.box.w / 2, P.box.y + P.box.h / 2 + fs * 0.04);
  g.restore();
  g.textAlign = "left"; g.textBaseline = "alphabetic";
}

/** Hype pace: one word at a time, huge, the ground flipping to the accent on the key words, each word punching in. */
function hype(g: Ctx, a: Anim, p: P, s: Scene, local: number, W: number, H: number) {
  const words = s.text.split(/\s+/).filter(Boolean);
  if (!words.length) return;
  const per = Math.max(0.18, (s.duration - 0.3) / words.length);
  const i = Math.min(words.length - 1, Math.floor(local / per));
  const k = clamp01((local - i * per) / Math.min(0.16, per * 0.6));
  const em = new Set((s.emphasis ?? []).flatMap((e) => e.split(/\s+/)).map(bare));
  const hot = em.has(bare(words[i])) || /\d/.test(words[i]) || i === words.length - 1;
  const U = Math.min(W, H);
  if (hot) { g.fillStyle = p.accent; g.fillRect(0, 0, W, H); }
  const F = fontOf(a.font);
  const w = words[i].replace(/[.,!?;:]+$/, "");
  let size = 0.36 * U;
  g.font = `${F.weight} ${size}px ${F.family}`;
  while (g.measureText(w).width > W * 0.8 && size > 0.08 * U) { size *= 0.93; g.font = `${F.weight} ${size}px ${F.family}`; }
  g.save(); g.translate(W / 2, H / 2);
  const sc = 1.25 - 0.25 * ease.back(k); g.scale(sc, sc); g.rotate(((i % 2 ? 1 : -1) * (1 - k) * 4 * Math.PI) / 180);
  g.globalAlpha = Math.min(1, k * 2);
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = hot ? (p.dark ? p.bg : "#fff") : p.ink;
  g.fillText(s.kind === "title" || s.kind === "cta" ? w.toUpperCase() : w, 0, 0);
  g.restore();
  if (s.kind === "cta" && s.sub && i === words.length - 1) {
    g.font = `800 ${0.05 * U}px "Plus Jakarta Sans", sans-serif`; g.textAlign = "center"; g.fillStyle = hot ? (p.dark ? p.bg : "#fff") : p.accent;
    g.globalAlpha = clamp01((local - i * per - 0.2) / 0.3); g.fillText(s.sub, W / 2, H / 2 + 0.22 * U); g.globalAlpha = 1;
  }
}

function dots(g: Ctx, p: P, W: number, H: number, U: number, index: number, count: number) {
  // scene dots along the bottom
  const dotW = 0.04 * U, gapD = 0.014 * U, totalW = count * dotW + (count - 1) * gapD;
  for (let i = 0; i < count; i++) {
    g.fillStyle = i === index ? p.accent : hexA(p.ink, 0.2);
    g.beginPath(); g.roundRect(W / 2 - totalW / 2 + i * (dotW + gapD), H - 0.06 * H, dotW, Math.max(6, 0.008 * U), 4); g.fill();
  }
}

/** The animated ground of a palette (used by cards inside reels too). */
export const drawBackground = (g: Ctx, a: Pick<Anim, "palette">, W: number, H: number, t: number) => background(g, paletteOf(a.palette), W, H, t);

/** One frame of the whole animation at time t: background, the scene (with its exit), and a wipe between scenes. */
export function drawAnim(g: Ctx, a: Anim, t: number) {
  const { W, H } = frameSize(a.format);
  const p = paletteOf(a.palette);
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
