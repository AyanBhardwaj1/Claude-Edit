// Speed vs quality: one table says what each effort changes, and everything (workflow, AI calls, the UI) reads it.
// Balanced is exactly the editor as it always was; Fast does less; Best adds one senior-editor review pass.

import type { Settings } from "./types";

export type Effort = Settings["effort"];
export const EFFORTS: Effort[] = ["fast", "balanced", "best"];

export type EffortPlan = {
  label: string;                  // the button
  line: string;                   // one plain sentence under it
  faces: boolean;                 // find the face so the reframe follows it (off: the reframe stays centred)
  pictures: number;               // most web pictures fetched for one edit
  maxTokens: number;              // the AI's answer budget (Anthropic)
  review: boolean;                // a second AI call reviews the first edit like a senior editor
  anthropicModel: string | null;  // a model to prefer, only if the user's key lists it
  hint: string;                   // an extra line for the first-edit prompt
};

export const EFFORT: Record<Effort, EffortPlan> = {
  fast: {
    label: "Fast", line: "A quicker, simpler cut: no face framing and at most 4 pictures.",
    faces: false, pictures: 4, maxTokens: 6000, review: false, anthropicModel: "claude-haiku-5-5",
    hint: "Work quickly and keep the edit simple: at most 4 webPictures.",
  },
  balanced: {
    label: "Balanced", line: "The full edit: face framing, best takes and up to 16 pictures.",
    faces: true, pictures: 16, maxTokens: 16000, review: false, anthropicModel: null, hint: "",
  },
  best: {
    label: "Best quality", line: "Everything in Balanced, then a second pass that reviews the edit like a senior editor. Uses more AI credit.",
    faces: true, pictures: 16, maxTokens: 32000, review: true, anthropicModel: "claude-opus-5-5", hint: "",
  },
};

export const DEFAULT_EFFORT: Effort = "balanced";
export const DEFAULT_MAX_TOKENS = EFFORT.balanced.maxTokens;

/** Old saved settings (and anything unexpected) read as balanced. */
export function effortOf(s: Pick<Settings, "effort"> | { effort?: unknown }): Effort {
  return EFFORTS.includes(s.effort as Effort) ? (s.effort as Effort) : DEFAULT_EFFORT;
}
export const planOf = (s: Pick<Settings, "effort"> | { effort?: unknown }) => EFFORT[effortOf(s)];

/** What one AI call uses: the model and answer budget, plus the user's own model to fall back to if the other is refused. */
export type AiChoice = { model: string; maxTokens: number; fallback: string | null };

/** The user's model unless the effort prefers another AND the key's model list (when known) has it. Never guesses:
 *  with no list, the user's chosen model stays. OpenAI always keeps the user's model. */
export function pickModel(effort: Effort, provider: Settings["provider"], userModel: string, available: string[] | null): string {
  const want = provider === "anthropic" ? EFFORT[effort].anthropicModel : null;
  if (!want || !available?.length) return userModel;
  return available.find((m) => m === want) ?? available.find((m) => m.startsWith(`${want}-`)) ?? userModel;
}

export function aiChoice(s: Settings, effort: Effort, available: string[] | null): AiChoice {
  const user = s.provider === "anthropic" ? s.anthropicModel : s.openaiModel;
  const model = pickModel(effort, s.provider, user, available);
  return { model, maxTokens: EFFORT[effort].maxTokens, fallback: model !== user ? user : null };
}
