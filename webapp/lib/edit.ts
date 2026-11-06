// Defaults, the no-AI edit, and turning the AI's answer into a valid Edit (it never touches media).

import type { Asset, Broll, BrollIn, CaptionAnim, Captions, Edit, Look, Motion, Project, Range, Transition, Treatment } from "./types";
import { swears } from "./bleep";
import { buildTimeline, indexOf } from "./timeline";

export const DEFAULT_CAPTIONS: Captions = {
  enabled: true, preset: "studio", size: 105, position: 0.75, textCase: "upper", maxWords: 3, font: "Montserrat",
};

export const DEFAULT_MOTION: Motion = {
  captionAnim: "pop", accent: "#FFE14D", emphasis: true, transition: "punch", look: "natural", progress: false, kenBurns: true, brollIn: "pop",
};
export const motionOf = (e: Edit): Motion => ({ ...DEFAULT_MOTION, ...(e.motion ?? {}) });

export const CAPTION_ANIMS: CaptionAnim[] = ["pop", "karaoke", "bounce", "words", "typewriter", "fade", "none"];
export const TRANSITIONS: Transition[] = ["none", "punch", "whip", "flash", "fade", "glitch"];
export const LOOKS: Look[] = ["natural", "warm", "cool", "cinematic", "mono", "vivid", "film"];
export const BROLL_INS: BrollIn[] = ["pop", "slide", "zoom", "spin"];

export function defaultEdit(p: Project): Edit {
  const music = p.library.find((a) => a.kind === "music");
  return {
    keep: p.analysis?.defaultKeep?.length ? p.analysis.defaultKeep : p.words.length
      ? [{ from: p.words[0].id, to: p.words[p.words.length - 1].id }] : [],
    gapCap: 0.15, captions: { ...DEFAULT_CAPTIONS }, corrections: [], broll: [], zooms: [],
    music: { asset: music?.key ?? null, level: "under-voice", startAt: null, automation: [] },
    cover: { word: null, text: "" }, post: { caption: "", hashtags: [], keywords: [] }, sfx: true, motion: { ...DEFAULT_MOTION },
  };
}

const TREATMENTS: Treatment[] = ["card-above-head", "side-card", "phone-card", "full-frame", "split-top", "framed", "text-pop", "motion"];
export const CAPTION_PRESETS = ["studio", "bold", "white", "block", "boxed", "minimal"] as const;
/** What picking the boxed subtitle style brings with it unless said otherwise: a clean sans in sentence case. */
export const BOXED_DEFAULTS = { font: "Figtree", textCase: "as-is" } as const;
const CARD_KINDS = ["number", "list", "compare", "bars", "statement", "title"] as const;

/** What the AI sends back (see prompts.ts EDIT_SCHEMA). Every field is checked before it reaches the project. */
export type AiEdit = {
  summary?: string;
  keep?: Range[]; gapCap?: number;
  captions?: Partial<Captions>; corrections?: { from: string; to: string }[];
  hook?: { text: string; from: string; to: string } | null;
  labels?: { text: string; from: string; to: string; style?: "label" | "pop" }[];
  broll?: { asset: string; from: string; to: string; treatment?: string; side?: string;
    focus?: { x: number; y: number }; punch?: { at: number; zoom?: number }; full?: boolean; backdrop?: string }[];
  webPictures?: { query: string; kind: "logo" | "photo"; from: string; to: string; treatment?: string }[];
  zooms?: { from: string; to: string; scale?: number }[];
  motionCards?: { kind: string; text?: string; sub?: string; items?: string[]; value?: number; prefix?: string; suffix?: string; from: string; to: string }[];
  music?: { asset?: string | null; level?: string; automation?: { from: string; to: string; db: number }[] };
  cover?: { word?: string | null; text?: string };
  post?: { caption?: string; hashtags?: string[]; keywords?: string[] };
  mirror?: boolean;
  bleep?: boolean;                 // bleep every strong swear word (lib/bleep.ts), false to remove the bleeps
  speed?: number;                  // talking speed 1-1.3 (1 = as filmed)
  motion?: Partial<Motion>;
  styleRule?: string | null;
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") return d;   // null is "not given", not 0
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

/** The AI's answer in the shape fromAi expects. Tool input isn't strictly validated (and an answer can be JSON from
 *  plain text), so a list given as an object, a hashtag string, null items or a number where text goes are tidied
 *  here instead of crashing the editor later. */
function sane(raw: AiEdit): AiEdit {
  const ai = { ...(raw && typeof raw === "object" ? raw : {}) } as Record<string, unknown>;
  const obj = (x: unknown) => !!x && typeof x === "object" && !Array.isArray(x);
  const list = (k: string) => { if (k in ai) ai[k] = Array.isArray(ai[k]) ? (ai[k] as unknown[]).filter(obj) : undefined; };
  ["keep", "labels", "broll", "webPictures", "motionCards", "zooms", "corrections"].forEach(list);
  for (const k of ["captions", "music", "cover", "post", "hook", "motion"]) if (k in ai && !obj(ai[k])) ai[k] = undefined;
  const text = (o: Record<string, unknown> | undefined, k: string) => {
    if (o && k in o && o[k] !== undefined && o[k] !== null && typeof o[k] !== "string") o[k] = typeof o[k] === "number" ? String(o[k]) : undefined;
  };
  for (const l of (ai.labels as Record<string, unknown>[] | undefined) ?? []) text(l, "text");
  for (const c of (ai.corrections as Record<string, unknown>[] | undefined) ?? []) { text(c, "from"); text(c, "to"); }
  if (ai.hook) { ai.hook = { ...(ai.hook as object) }; text(ai.hook as Record<string, unknown>, "text"); }
  if (ai.cover) { ai.cover = { ...(ai.cover as object) }; text(ai.cover as Record<string, unknown>, "text"); }
  if (ai.post) {
    const post = { ...(ai.post as Record<string, unknown>) };
    text(post, "caption");
    for (const k of ["hashtags", "keywords"]) {
      const v = post[k];
      post[k] = typeof v === "string" ? v.split(/[\s,]+/).filter(Boolean) : Array.isArray(v) ? v.filter((x) => x !== null && x !== undefined).map(String) : undefined;
    }
    ai.post = post;
  }
  if (ai.music && Array.isArray((ai.music as Record<string, unknown>).automation)) {
    ai.music = { ...(ai.music as object), automation: ((ai.music as Record<string, unknown>).automation as unknown[]).filter(obj) };
  } else if (ai.music) ai.music = { ...(ai.music as object), automation: undefined };
  return ai as AiEdit;
}

/** Keep ranges in their given (output) order, minus words an earlier range already plays, so nothing is heard twice
 *  (a range that overlaps an earlier one keeps only its new words; one that splits around them becomes two). */
function mergeKeep(keep: Range[], ids: Map<string, number>, words: Project["words"]): Range[] {
  const used = new Set<number>(), out: Range[] = [];
  for (const r of keep) {
    let a = -1;
    const lo = ids.get(r.from)!, hi = ids.get(r.to)!;
    for (let i = lo; i <= hi + 1; i++) {
      const free = i <= hi && !used.has(i);
      if (free && a < 0) a = i;
      if (!free && a >= 0) { out.push({ from: words[a].id, to: words[i - 1].id }); a = -1; }
      if (i <= hi) used.add(i);
    }
  }
  return out;
}

export function fromAi(p: Project, base: Edit, given: AiEdit, webAssets: Map<string, Asset> = new Map()): { edit: Edit; problems: string[] } {
  const ai = sane(given);
  const ids = indexOf(p.words);
  const lib = new Map([...p.library, ...webAssets.values()].map((a) => [a.key, a]));
  const problems: string[] = [];
  const okRange = (r: { from?: string; to?: string } | undefined, what: string): Range | null => {
    if (!r || !r.from || !r.to || !ids.has(r.from) || !ids.has(r.to)) { problems.push(`${what}: unknown word ids`); return null; }
    return ids.get(r.from)! <= ids.get(r.to)! ? { from: r.from, to: r.to } : { from: r.to, to: r.from };
  };
  const e: Edit = structuredClone(base);
  if (ai.keep) {
    const keep = ai.keep.map((r) => okRange(r, "cut")).filter(Boolean) as Range[];
    if (keep.length) e.keep = mergeKeep(keep, ids, p.words); else problems.push("cut: nothing usable, kept the previous cut");
  }
  if (ai.gapCap !== undefined) e.gapCap = clamp(ai.gapCap, 0.02, 2, e.gapCap);
  if (ai.captions) {
    const c = ai.captions;
    e.captions = {
      ...e.captions,
      enabled: c.enabled ?? e.captions.enabled,
      preset: CAPTION_PRESETS.includes(c.preset as never) ? c.preset! : e.captions.preset,
      size: clamp(c.size, 80, 160, e.captions.size), position: clamp(c.position, 0.5, 0.88, e.captions.position),
      textCase: (["upper", "as-is", "lower"] as const).includes(c.textCase as never) ? c.textCase! : e.captions.textCase,
      maxWords: Math.round(clamp(c.maxWords, 1, 4, e.captions.maxWords)),
      font: typeof c.font === "string" && c.font.length < 40 ? c.font : e.captions.font,
    };
    // newly boxed: a clean sans in sentence case, unless the answer chose a font or case itself
    if (e.captions.preset === "boxed" && base.captions.preset !== "boxed") {
      if (!c.font && e.captions.font === "Montserrat") e.captions.font = BOXED_DEFAULTS.font;
      if (!c.textCase) e.captions.textCase = BOXED_DEFAULTS.textCase;
    }
  }
  if (ai.motion) e.motion = cleanMotion({ ...motionOf(e), ...ai.motion });
  if (ai.corrections) e.corrections = ai.corrections.filter((c) => c.from?.trim() && c.to?.trim()).slice(0, 60);
  if (ai.mirror !== undefined) p.sources.forEach((s) => (s.mirror = !!ai.mirror));
  if (ai.speed !== undefined && ai.speed !== null) {   // rounded to the steps the control offers (1.1, 1.2, 1.3)
    const v = Math.round(clamp(ai.speed, 1, 1.3, 1) * 10) / 10;
    e.speed = v === 1 ? undefined : v;
  }
  if (ai.bleep === true) e.bleeps = swears(buildTimeline(p.words, e, p.sources.map((s) => s.duration))).map((w) => w.id);
  else if (ai.bleep === false) e.bleeps = [];
  const broll: Broll[] = [];
  let n = 0;
  const id = () => `b${++n}`;
  if (ai.hook && ai.hook.text) {
    const r = okRange(ai.hook, "hook");
    if (r) broll.push({ id: id(), anchor: r, treatment: "text-pop", style: "label", text: ai.hook.text.slice(0, 60), tilt: 0 });
  }
  for (const l of ai.labels ?? []) {
    const r = okRange(l, `label "${l.text}"`);
    if (r && l.text) broll.push({ id: id(), anchor: r, treatment: "text-pop", style: l.style === "pop" ? "pop" : "label", text: l.text.slice(0, 40) });
  }
  const treat = (t?: string, fallback: Treatment = "card-above-head"): Treatment =>
    TREATMENTS.includes(t as Treatment) && t !== "text-pop" && t !== "motion" ? (t as Treatment) : fallback;
  for (const b of ai.broll ?? []) {
    const r = okRange(b, `picture ${b.asset}`);
    if (!r) continue;
    const a = lib.get(b.asset);
    if (!a || a.kind === "music") { problems.push(`picture ${b.asset}: not in the library`); continue; }
    const item: Broll = { id: id(), anchor: r, asset: a.key, treatment: treat(b.treatment),
      side: (["left", "right", "auto"] as const).includes(b.side as never) ? (b.side as Broll["side"]) : "auto" };
    if (item.treatment === "framed") Object.assign(item, framedFields(b));
    broll.push(item);
  }
  for (const [key, a] of webAssets) {
    const w = (ai.webPictures ?? []).find((x) => `web:${x.query}` === key);
    if (!w) continue;
    const r = okRange(w, `web picture "${w.query}"`);
    if (r) broll.push({ id: id(), anchor: r, asset: a.key, treatment: treat(w.treatment) });
  }
  for (const c of (ai.motionCards ?? []).slice(0, 4)) {
    const r = okRange(c, `animated card "${c.text ?? c.kind}"`);
    if (!r || !CARD_KINDS.includes(c.kind as never)) continue;
    broll.push({ id: id(), anchor: r, treatment: "motion", card: { kind: c.kind as (typeof CARD_KINDS)[number], text: String(c.text ?? "").slice(0, 80),
      sub: c.sub ? String(c.sub).slice(0, 60) : undefined, items: Array.isArray(c.items) ? c.items.slice(0, 5).map((x) => String(x).slice(0, 50)) : undefined,
      value: Number.isFinite(Number(c.value)) ? Number(c.value) : undefined, prefix: c.prefix ? String(c.prefix).slice(0, 3) : undefined,
      suffix: c.suffix ? String(c.suffix).slice(0, 12) : undefined } });
  }
  if (ai.hook !== undefined || ai.labels !== undefined || ai.broll !== undefined || ai.webPictures !== undefined || ai.motionCards !== undefined) {
    // a note that only touches pictures keeps the rest; a first edit replaces them all
    e.broll = broll;
  }
  if (ai.zooms) e.zooms = ai.zooms.map((z) => {
    const r = okRange(z, "zoom");
    return r ? { anchor: r, scale: clamp(z.scale, 1.03, 1.4, 1.12) } : null;
  }).filter(Boolean) as Edit["zooms"];
  if (ai.music) {
    const m = ai.music;
    if (m.asset !== undefined) e.music.asset = m.asset && lib.get(m.asset)?.kind === "music" ? m.asset : null;
    if (m.level && ["under-voice", "quiet", "loud-intro"].includes(m.level)) e.music.level = m.level as Edit["music"]["level"];
    if (m.automation) e.music.automation = m.automation.map((a) => {
      const r = okRange(a, "music lift");
      return r ? { anchor: r, db: clamp(a.db, -12, 6, 0) } : null;
    }).filter(Boolean) as Edit["music"]["automation"];
  }
  if (ai.cover) e.cover = { word: ai.cover.word && ids.has(ai.cover.word) ? ai.cover.word : e.cover.word,
    text: (ai.cover.text ?? e.cover.text).split(/\s+/).slice(0, 3).join(" ") };
  if (ai.post) {
    const tags = (ai.post.hashtags ?? e.post.hashtags).map((t) => "#" + t.replace(/^#+/, "").replace(/\s+/g, "")).filter((t) => t.length > 1);
    const uniq = [...new Map(tags.map((t) => [t.toLowerCase(), t])).values()].slice(0, 5);
    if (uniq.length !== 5) problems.push(`post: ${uniq.length} hashtags (a post takes exactly 5)`);
    e.post = { caption: (ai.post.caption ?? e.post.caption).replace(/\s*—\s*/g, ", ").trim(),
      hashtags: uniq, keywords: (ai.post.keywords ?? e.post.keywords).slice(0, 8) };
  }
  return { edit: e, problems };
}

/** A framed screen's own fields, checked: focus inside the picture, a punch-in inside the shot, a hex backdrop. */
export function framedFields(b: { focus?: unknown; punch?: unknown; full?: unknown; backdrop?: unknown }): Partial<Broll> {
  const out: Partial<Broll> = {};
  const f = b.focus as { x?: unknown; y?: unknown } | undefined | null;
  if (f && Number.isFinite(Number(f.x)) && Number.isFinite(Number(f.y))) out.focus = { x: clamp(f.x, 0, 1, 0.5), y: clamp(f.y, 0, 1, 0.5) };
  const p = b.punch as { at?: unknown; zoom?: unknown } | undefined | null;
  if (p && p.at !== null && Number.isFinite(Number(p.at))) out.punch = { at: clamp(p.at, 0, 30, 0.8), zoom: clamp(p.zoom ?? 1.6, 1.05, 2.5, 1.6) };
  if (b.full === true) out.full = true;
  if (typeof b.backdrop === "string" && /^#[0-9a-f]{6}$/i.test(b.backdrop)) out.backdrop = b.backdrop;
  return out;
}

export function cleanMotion(m: Partial<Motion>): Motion {
  const d = DEFAULT_MOTION;
  const pick = <T,>(v: unknown, list: T[], def: T) => (list.includes(v as T) ? (v as T) : def);
  return {
    captionAnim: pick(m.captionAnim, CAPTION_ANIMS, d.captionAnim),
    accent: typeof m.accent === "string" && /^#[0-9a-f]{6}$/i.test(m.accent) ? m.accent : d.accent,
    emphasis: m.emphasis ?? d.emphasis, transition: pick(m.transition, TRANSITIONS, d.transition), look: pick(m.look, LOOKS, d.look),
    progress: m.progress ?? d.progress, kenBurns: m.kenBurns ?? d.kenBurns, brollIn: pick(m.brollIn, BROLL_INS, d.brollIn),
  };
}

/** The text under the post: caption, photo credits (CC BY / BY-SA pictures used), 5 hashtags. */
export function postText(p: Project, e: Edit): string {
  const used = new Set(e.broll.map((b) => b.asset).filter(Boolean));
  const credits = p.library.filter((a) => used.has(a.key) && a.credit && /^by/.test(a.credit.license))
    .map((a) => `${a.credit!.title} by ${a.credit!.creator || "unknown"} (${a.credit!.license.toUpperCase()})`);
  return [e.post.caption, credits.length ? `Photo credits: ${credits.join("; ")}` : "", e.post.hashtags.join(" ")]
    .filter(Boolean).join("\n\n");
}

/** One plain line on what changed between two versions (for the version list). */
export function describe(a: Edit, b: Edit): string {
  const out: string[] = [];
  if (JSON.stringify(a.keep) !== JSON.stringify(b.keep) || a.gapCap !== b.gapCap) out.push("the cut");
  if ((a.speed ?? 1) !== (b.speed ?? 1)) out.push("talking speed");
  if (JSON.stringify(a.bleeps ?? []) !== JSON.stringify(b.bleeps ?? [])) out.push("bleeps");
  if (JSON.stringify(a.captions) !== JSON.stringify(b.captions) || JSON.stringify(a.corrections) !== JSON.stringify(b.corrections)
    || JSON.stringify(a.translation) !== JSON.stringify(b.translation)) out.push(b.translation && !a.translation ? `subtitles in ${b.translation.lang}` : "subtitles");
  if (JSON.stringify(a.music) !== JSON.stringify(b.music)) out.push("music");
  if (JSON.stringify(a.broll) !== JSON.stringify(b.broll)) out.push("pictures");
  if (JSON.stringify(a.zooms) !== JSON.stringify(b.zooms)) out.push("zooms");
  if (JSON.stringify(a.cover) !== JSON.stringify(b.cover)) out.push("cover");
  if (JSON.stringify(a.post) !== JSON.stringify(b.post)) out.push("post caption");
  if (JSON.stringify(motionOf(a)) !== JSON.stringify(motionOf(b))) out.push("motion");
  return out.length ? `Changed ${out.join(", ")}.` : "No changes.";
}
