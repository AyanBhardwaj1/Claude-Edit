// The AI editor. Calls go straight from the browser to Anthropic or OpenAI with the user's own key:
// this app's server never sees the key, the transcript or the video.

import { motionOf } from "./edit";
import type { AiEdit } from "./edit";
import { DEFAULT_MAX_TOKENS, type AiChoice } from "./effort";
import { momentsText } from "./moments";
import { APPLY_NOTE, EDIT_SCHEMA, FIRST_EDIT, REVIEW_EDIT, SCRIPT_SCHEMA, SYSTEM, WRITE_SCRIPT } from "./prompts";
import { reelCheck } from "./score";
import { playedLength, WAIT_SPEED, waitSavings } from "./screenrec";
import { buildTimeline } from "./timeline";
import type { Asset, Edit, Project, Settings, StyleRule } from "./types";

export class AiError extends Error {
  constructor(message: string, public userMessage: string) { super(message); }
}

type Json = Record<string, unknown>;
import { askByRelay } from "./relay";
export type KeyProvider = "anthropic" | "openai";

const PREFERRED = {
  anthropic: [/^claude-sonnet-5/, /^claude-opus-5/, /^claude-sonnet-4/, /^claude-opus-4/, /sonnet/, /claude/],
  openai: [/^gpt-6(?!.*(mini|nano|audio|realtime|image|search|transcribe|tts))/, /^gpt-5(?!.*(nano|audio|realtime|image|search|transcribe|tts))/,
    /^gpt-4\.1/, /^gpt-4o(?!.*(audio|realtime|search|transcribe|tts))/, /^gpt-/],
};

export async function listModels(provider: KeyProvider, key: string): Promise<{ models: string[]; suggested: string | null }> {
  const r = provider === "anthropic"
    ? await fetch("https://api.anthropic.com/v1/models?limit=100", { headers: anthropicHeaders(key) })
    : await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new AiError(`models ${r.status}`, r.status === 401 ? "That key was not accepted. Check it and try again." :
    `The ${provider === "anthropic" ? "Anthropic" : "OpenAI"} API answered ${r.status}.`);
  const data = (await r.json()) as { data: { id: string; created?: number; created_at?: string }[] };
  const models = data.data.map((m) => m.id).filter((id) => provider === "anthropic" || /^(gpt|o\d)/.test(id)).sort().reverse();
  const suggested = PREFERRED[provider].map((re) => models.find((m) => re.test(m))).find(Boolean) ?? models[0] ?? null;
  return { models, suggested };
}

function anthropicHeaders(key: string): Record<string, string> {
  return { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true",
    "content-type": "application/json" };
}

/** One JSON answer from the AI. `choice` (lib/effort.ts) sets the model and answer budget; without it, the user's model and
 *  16000 tokens. A preferred model the key can't use falls back to the user's own model once; an answer budget the model
 *  refuses or runs out of falls back to the usual 16000 once. */
/** An AI editor is connected: an API key for the chosen provider, or the copy-and-paste plan (always there). */
export function aiReady(s: Settings | undefined | null): boolean {
  if (!s) return false;
  return s.provider === "chat" || !!(s.provider === "anthropic" ? s.anthropicKey : s.openaiKey);
}

export async function callJson(s: Settings, system: string, user: string, schema: Json, name: string, choice?: AiChoice): Promise<Json> {
  if (s.provider === "chat") return askByRelay({ name, system, user, schema });   // your plan, by copy and paste
  const anthropic = s.provider === "anthropic";
  const key = anthropic ? s.anthropicKey : s.openaiKey;
  if (!key) throw new AiError("no key", `Add your ${anthropic ? "Anthropic" : "OpenAI"} API key in Settings first.`);
  let model = choice?.model || (anthropic ? s.anthropicModel : s.openaiModel);
  let fallback = choice?.fallback ?? null;
  let maxTokens = choice?.maxTokens ?? DEFAULT_MAX_TOKENS;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = anthropic
      ? await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: anthropicHeaders(key),
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }],
          tools: [{ name, description: "Return the result.", input_schema: schema }], tool_choice: { type: "tool", name } }),
      })
      : await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: user }],
          response_format: { type: "json_schema", json_schema: { name, schema: loosen(schema), strict: false } } }),
      });
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 2000 * (attempt + 1) ** 2)); continue; }
    if (!r.ok) {
      const body = await r.text();
      if (r.status === 404 && fallback && fallback !== model) {           // the effort's model isn't open to this key
        console.warn(`model ${model} unavailable, using ${fallback}`);
        model = fallback; fallback = null; attempt--; continue;
      }
      if (r.status === 400 && anthropic && maxTokens > DEFAULT_MAX_TOKENS && /max_tokens/.test(body)) {
        maxTokens = DEFAULT_MAX_TOKENS; attempt--; continue;            // an older model with a smaller answer limit
      }
      throw new AiError(`${r.status} ${body.slice(0, 300)}`, r.status === 401 ? "Your API key was not accepted. Check it in Settings." :
        r.status === 404 ? `The model "${model}" isn't available to your key. Pick another in Settings.` :
          `The AI couldn't finish (${r.status}). ${body.slice(0, 160)}`);
    }
    const data = await r.json();
    if (anthropic) {
      if (data.stop_reason === "max_tokens" && maxTokens < DEFAULT_MAX_TOKENS) { maxTokens = DEFAULT_MAX_TOKENS; continue; }   // Fast ran out of room
      const block = (data.content as { type: string; input?: Json }[]).find((c) => c.type === "tool_use");
      if (block?.input) return block.input;
    } else {
      const text = data.choices?.[0]?.message?.content as string | undefined;
      if (text) { try { return JSON.parse(text); } catch { /* retry below */ } }
    }
  }
  throw new AiError("no usable answer", "The AI is busy or didn't give a usable answer. Try again in a minute.");
}

/** OpenAI's json_schema doesn't take type arrays like ["string","null"] in every model: widen them. */
function loosen(schema: Json): Json {
  return JSON.parse(JSON.stringify(schema, (k, v) => (k === "type" && Array.isArray(v) ? v[0] : v)));
}

/** The transcript as the editor reads it: one line per phrase, every word with its id. */
export function transcriptText(p: Project): string {
  const a = p.analysis;
  const lines: string[] = [];
  for (const ph of a?.phrases ?? []) {
    const i0 = p.words.findIndex((w) => w.id === ph.from), i1 = p.words.findIndex((w) => w.id === ph.to);
    const ws = p.words.slice(i0, i1 + 1).filter((w) => w.w.trim()).map((w) => `${w.id}:${w.w.replace(/[<>]/g, "")}`).join(" ");
    lines.push(`[take ${ph.src + 1} ${ph.s.toFixed(1)}s] ${ws}`);
  }
  const parts = [`<transcript>\n${lines.join("\n")}\n</transcript>`];
  if (a?.retakes.length) parts.push("RETAKE GROUPS (same line said more than once; * = last complete take):\n" +
    a.retakes.map((g) => g.phrases.map((r, k) => `${k === g.chosen ? "*" : " "} ${r.from}-${r.to} "${g.texts[k]}"`).join("\n")).join("\n---\n"));
  if (a?.dropped.length) parts.push("SUGGESTED DROPS:\n" + a.dropped.slice(0, 80).map((d) => `${d.from}-${d.to} ${d.reason}: "${d.text}"`).join("\n"));
  if (a?.pauses.length) parts.push("LONG PAUSES (>0.8 s): " + a.pauses.filter((x) => x.seconds > 0.8).map((x) => `after ${x.after} ${x.seconds}s`).join(", "));
  if (a?.names.length) parts.push("NAMES HEARD: " + a.names.join(", "));
  if (a?.unsure.length) parts.push("UNSURE WORDS (the recogniser was less sure): " + a.unsure.join(", "));
  const lib = p.library.filter((x) => !x.web);
  parts.push("LIBRARY:\n" + (lib.length ? lib.map((x) => `- key "${x.key}": ${libKind(x)} "${x.name}"` +
    (x.width && x.height && x.kind !== "music" ? ` ${x.width}x${x.height}` : "") +
    (x.kind === "music" ? ` sounds ${x.feel ?? "?"} (energy ${x.energy ?? "?"})${x.origin === "composed" ? ", composed for this video, ends on its last chord" : ""}` : x.duration ? ` ${clipLength(x)}` : "")).join("\n")
    : "(empty: use webPictures, labels and zooms)"));
  return parts.join("\n\n");
}

/** A clip's length as it plays in the video: trimmed and with its waits sped through ("Speed through waits"), saying so
 *  when the waits make it shorter, so the editor gives the shot room for the clip as it plays, not as recorded. */
export function clipLength(x: Asset): string {
  const plays = playedLength(x) ?? x.duration ?? 0;
  const w = waitSavings(x);
  return w.count && x.speedWaits !== false && w.saves >= 0.05
    ? `${plays.toFixed(1)}s (waits played ${WAIT_SPEED}x faster; ${(plays + w.saves).toFixed(1)}s at normal speed)`
    : `${plays.toFixed(1)}s`;
}

/** How a library item reads to the editor: screenshots and screen recordings are named as such (lib/framed.ts). */
export const libKind = (x: Asset) => (x.screen ? (x.kind === "video" ? "screen recording" : "screenshot") : x.kind);

const rulesText = (rules: StyleRule[]) => (rules.length ? rules.map((r) => `- ${r.text}`).join("\n") : "(none yet)");

export async function firstEdit(s: Settings, p: Project, rules: StyleRule[], choice?: AiChoice, hint = ""): Promise<AiEdit> {
  const user = `${FIRST_EDIT}${hint ? ` ${hint}` : ""}\n\nVideo title: ${p.title}\n\n${transcriptText(p)}`;
  return (await callJson(s, SYSTEM.replace("{{rules}}", rulesText(rules)), user, EDIT_SCHEMA as unknown as Json, "submit_edit", choice)) as AiEdit;
}

export async function applyNote(s: Settings, p: Project, current: Edit, note: string, rules: StyleRule[], choice?: AiChoice): Promise<AiEdit> {
  const cur = toAiShape(current);
  const where = momentsText(buildTimeline(p.words, current, p.sources.map((x) => x.duration)), current, note);
  const user = `${APPLY_NOTE(note)}${where ? `\n\nWHERE THE NOTE POINTS (times are in the edited video as the user watched it):\n${where}` : ""}` +
    `\n\nCURRENT EDIT:\n${JSON.stringify(cur)}\n\n${transcriptText(p)}`;
  return (await callJson(s, SYSTEM.replace("{{rules}}", rulesText(rules)), user, EDIT_SCHEMA as unknown as Json, "submit_edit", choice)) as AiEdit;
}

/** Best quality: a second look at the first edit by a strict senior editor; returns the whole (improved) edit. */
/** What the reel check measured on an edit, as lines a reviewer can act on (failing and borderline checks only). */
export function measuredProblems(p: Project, e: Edit): string {
  const tl = buildTimeline(p.words, e, p.sources.map((x) => x.duration));
  const bad = reelCheck(p, e, tl).checks.filter((c) => !c.ok);
  return bad.length ? bad.map((c) => `- ${c.title}${c.warn ? " (borderline)" : ""}: ${c.detail}${c.fix ? ` Fix: ${c.fix}` : ""}`).join("\n")
    : "(the automatic check found nothing: look for what it can't measure)";
}

export async function reviewEdit(s: Settings, p: Project, current: Edit, rules: StyleRule[], choice?: AiChoice): Promise<AiEdit> {
  const user = `${REVIEW_EDIT}\n\nMEASURED BY THE REEL CHECK (fix these first, in the edit, not by explaining):\n${measuredProblems(p, current)}` +
    `\n\nVideo title: ${p.title}\n\nCURRENT EDIT:\n${JSON.stringify(toAiShape(current))}\n\n${transcriptText(p)}`;
  return (await callJson(s, SYSTEM.replace("{{rules}}", rulesText(rules)), user, EDIT_SCHEMA as unknown as Json, "submit_edit", choice)) as AiEdit;
}

export async function writeScript(s: Settings, idea: string, rules: StyleRule[]) {
  return (await callJson(s, `You write short-form video scripts.\nStyle rules:\n${rulesText(rules)}`, WRITE_SCRIPT(idea),
    SCRIPT_SCHEMA as unknown as Json, "submit_script")) as { hook: string; script: string; onScreenText: string[] };
}

/** The current Edit in the same shape the AI answers with, so a note can copy what it doesn't change. */
export function toAiShape(e: Edit): AiEdit {
  const hook = e.broll.find((b) => b.treatment === "text-pop" && b.style === "label" && b.tilt === 0);
  return {
    keep: e.keep, gapCap: e.gapCap, speed: e.speed ?? 1, captions: e.captions, corrections: e.corrections,   // the AI copies what it can see
    hook: hook ? { text: hook.text ?? "", ...hook.anchor } : null,
    labels: e.broll.filter((b) => b.treatment === "text-pop" && b !== hook).map((b) => ({ text: b.text ?? "", ...b.anchor, style: b.style })),
    broll: e.broll.filter((b) => b.treatment !== "text-pop" && b.treatment !== "motion" && b.asset).map((b) => ({ asset: b.asset!, ...b.anchor,
      treatment: b.treatment, side: b.side,
      ...(b.treatment === "framed" ? { focus: b.focus, punch: b.punch, full: b.full, backdrop: b.backdrop } : {}) })),
    motionCards: e.broll.filter((b) => b.treatment === "motion" && b.card).map((b) => ({ ...b.card!, ...b.anchor })),
    zooms: e.zooms.map((z) => ({ ...z.anchor, scale: z.scale })),
    music: { asset: e.music.asset, level: e.music.level, automation: e.music.automation.map((a) => ({ ...a.anchor, db: a.db })) },
    motion: motionOf(e),
    cover: e.cover, post: e.post,
  };
}
