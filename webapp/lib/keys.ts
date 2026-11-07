// The AI providers a key can connect, and where each one's key and model live in Settings. Every place that stores,
// syncs or strips keys goes through KEY_FIELDS, so a new provider's key can't be synced to the server by mistake.
import type { Settings } from "./types";

export type KeyProvider = "anthropic" | "openai" | "openrouter" | "gemini";
export const KEY_PROVIDERS: KeyProvider[] = ["anthropic", "openai", "openrouter", "gemini"];
export const KEY_FIELDS = ["anthropicKey", "openaiKey", "openrouterKey", "geminiKey"] as const;
export type KeyField = (typeof KEY_FIELDS)[number];

export const PROVIDER_NAME: Record<KeyProvider, string> = { anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter", gemini: "Google Gemini" };
export const KEY_HINT: Record<KeyProvider, string> = { anthropic: "sk-ant-…", openai: "sk-…", openrouter: "sk-or-…", gemini: "AIza…" };
export const KEY_PAGE: Record<KeyProvider, string> = {
  anthropic: "https://console.anthropic.com/settings/keys", openai: "https://platform.openai.com/api-keys",
  openrouter: "https://openrouter.ai/keys", gemini: "https://aistudio.google.com/apikey",
};

export const keyField = (p: KeyProvider): KeyField => `${p}Key` as KeyField;
export const modelField = (p: KeyProvider) => `${p}Model` as "anthropicModel" | "openaiModel" | "openrouterModel" | "geminiModel";
export const isKeyProvider = (p: Settings["provider"]): p is KeyProvider => (KEY_PROVIDERS as string[]).includes(p);

/** The chosen provider's key ("" for the copy-and-paste plan, or none yet). */
export function keyOf(s: Settings, p: Settings["provider"] = s.provider): string {
  return isKeyProvider(p) ? (s[keyField(p)] ?? "") : "";
}
export function modelOf(s: Settings, p: KeyProvider): string { return s[modelField(p)] ?? ""; }

/** Settings without any key: what may leave this browser. */
export function withoutKeys<T extends Partial<Settings>>(s: T): Omit<T, KeyField> {
  const out = { ...s } as Record<string, unknown>;
  for (const f of KEY_FIELDS) delete out[f];
  return out as Omit<T, KeyField>;
}
export function onlyKeys(s: Partial<Settings>): Partial<Pick<Settings, KeyField>> {
  const out: Partial<Pick<Settings, KeyField>> = {};
  for (const f of KEY_FIELDS) if (s[f]) out[f] = s[f];
  return out;
}
