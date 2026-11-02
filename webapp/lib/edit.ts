// Defaults, the no-AI edit, and turning the AI's answer into a valid Edit (it never touches media).

import type { Asset, Broll, Captions, Edit, Project, Range, Treatment } from "./types";
import { indexOf } from "./timeline";

export const DEFAULT_CAPTIONS: Captions = {
  enabled: true, preset: "studio", size: 105, position: 0.75, textCase: "upper", maxWords: 3, font: "Montserrat",
};

export function defaultEdit(p: Project): Edit {
  const music = p.library.find((a) => a.kind === "music");
  return {
    keep: p.analysis?.defaultKeep?.length ? p.analysis.defaultKeep : p.words.length
      ? [{ from: p.words[0].id, to: p.words[p.words.length - 1].id }] : [],
    gapCap: 0.15, captions: { ...DEFAULT_CAPTIONS }, corrections: [], broll: [], zooms: [],
    music: { asset: music?.key ?? null, level: "under-voice", startAt: null, automation: [] },
    cover: { word: null, text: "" }, post: { caption: "", hashtags: [], keywords: [] }, sfx: true,
  };
}

const TREATMENTS: Treatment[] = ["card-above-head", "side-card", "phone-card", "full-frame", "split-top", "text-pop"];

/** What the AI sends back (see prompts.ts EDIT_SCHEMA). Every field is checked before it reaches the project. */
export type AiEdit = {
  summary?: string;
  keep?: Range[]; gapCap?: number;
  captions?: Partial<Captions>; corrections?: { from: string; to: string }[];
  hook?: { text: string; from: string; to: string } | null;
  labels?: { text: string; from: string; to: string; style?: "label" | "pop" }[];
  broll?: { asset: string; from: string; to: string; treatment?: string; side?: string }[];
  webPictures?: { query: string; kind: "logo" | "photo"; from: string; to: string; treatment?: string }[];
  zooms?: { from: string; to: string; scale?: number }[];
  music?: { asset?: string | null; level?: string; automation?: { from: string; to: string; db: number }[] };
  cover?: { word?: string | null; text?: string };
  post?: { caption?: string; hashtags?: string[]; keywords?: string[] };
  mirror?: boolean;
  styleRule?: string | null;
};

const clamp = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function fromAi(p: Project, base: Edit, ai: AiEdit, webAssets: Map<string, Asset> = new Map()): { edit: Edit; problems: string[] } {
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
    if (keep.length) e.keep = keep; else problems.push("cut: nothing usable, kept the previous cut");
  }
  if (ai.gapCap !== undefined) e.gapCap = clamp(ai.gapCap, 0.02, 2, e.gapCap);
  if (ai.captions) {
    const c = ai.captions;
    e.captions = {
      ...e.captions,
      enabled: c.enabled ?? e.captions.enabled,
      preset: (["studio", "bold", "white", "boxed", "minimal"] as const).includes(c.preset as never) ? c.preset! : e.captions.preset,
      size: clamp(c.size, 80, 160, e.captions.size), position: clamp(c.position, 0.5, 0.88, e.captions.position),
      textCase: (["upper", "as-is", "lower"] as const).includes(c.textCase as never) ? c.textCase! : e.captions.textCase,
      maxWords: Math.round(clamp(c.maxWords, 1, 4, e.captions.maxWords)),
      font: typeof c.font === "string" && c.font.length < 40 ? c.font : e.captions.font,
    };
  }
  if (ai.corrections) e.corrections = ai.corrections.filter((c) => c.from?.trim() && c.to?.trim()).slice(0, 60);
  if (ai.mirror !== undefined) p.sources.forEach((s) => (s.mirror = !!ai.mirror));
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
    TREATMENTS.includes(t as Treatment) && t !== "text-pop" ? (t as Treatment) : fallback;
  for (const b of ai.broll ?? []) {
    const r = okRange(b, `picture ${b.asset}`);
    if (!r) continue;
    const a = lib.get(b.asset);
    if (!a || a.kind === "music") { problems.push(`picture ${b.asset}: not in the library`); continue; }
    broll.push({ id: id(), anchor: r, asset: a.key, treatment: treat(b.treatment),
      side: (["left", "right", "auto"] as const).includes(b.side as never) ? (b.side as Broll["side"]) : "auto" });
  }
  for (const [key, a] of webAssets) {
    const w = (ai.webPictures ?? []).find((x) => `web:${x.query}` === key);
    if (!w) continue;
    const r = okRange(w, `web picture "${w.query}"`);
    if (r) broll.push({ id: id(), anchor: r, asset: a.key, treatment: treat(w.treatment) });
  }
  if (ai.hook !== undefined || ai.labels !== undefined || ai.broll !== undefined || ai.webPictures !== undefined) {
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
  if (JSON.stringify(a.captions) !== JSON.stringify(b.captions) || JSON.stringify(a.corrections) !== JSON.stringify(b.corrections)) out.push("subtitles");
  if (JSON.stringify(a.music) !== JSON.stringify(b.music)) out.push("music");
  if (JSON.stringify(a.broll) !== JSON.stringify(b.broll)) out.push("pictures");
  if (JSON.stringify(a.zooms) !== JSON.stringify(b.zooms)) out.push("zooms");
  if (JSON.stringify(a.cover) !== JSON.stringify(b.cover)) out.push("cover");
  if (JSON.stringify(a.post) !== JSON.stringify(b.post)) out.push("post caption");
  return out.length ? `Changed ${out.join(", ")}.` : "No changes.";
}
