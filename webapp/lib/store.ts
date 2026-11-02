// Everything stays in this browser: projects and media in IndexedDB, settings and style rules in localStorage.
// API keys are kept only if the user ticks "remember" (else for this tab only), and are never sent to this app's server.

import { createStore, del, get, keys, set } from "idb-keyval";
import type { Project, Settings, StyleRule } from "./types";

const media = () => createStore("claude-edit-media", "files");
const projects = () => createStore("claude-edit-projects", "projects");

export async function putMedia(key: string, blob: Blob) { await set(key, blob, media()); }
export async function getMedia(key: string): Promise<Blob | undefined> { return get(key, media()); }

export async function saveProject(p: Project) {
  p.updatedAt = new Date().toISOString();
  await set(p.id, JSON.parse(JSON.stringify(p)), projects());
}
export async function loadProject(id: string): Promise<Project | undefined> { return get(id, projects()); }
export async function listProjects(): Promise<Project[]> {
  const ks = await keys(projects());
  const ps = await Promise.all(ks.map((k) => get(k, projects()) as Promise<Project>));
  return ps.filter(Boolean).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteProject(p: Project) {
  await del(p.id, projects());
  await Promise.all([...p.sources.map((s) => s.mediaKey), ...p.library.map((a) => a.key)].map((k) => del(k, media())));
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic", anthropicKey: "", openaiKey: "", anthropicModel: "claude-sonnet-5-5", openaiModel: "",
  transcriber: "openai", rememberKeys: false,
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("ce.settings") || "{}") } as Settings;
    const session = JSON.parse(sessionStorage.getItem("ce.keys") || "{}");
    return { ...s, anthropicKey: s.anthropicKey || session.anthropicKey || "", openaiKey: s.openaiKey || session.openaiKey || "" };
  } catch { return DEFAULT_SETTINGS; }
}

export function saveSettings(s: Settings) {
  const { anthropicKey, openaiKey, ...rest } = s;
  localStorage.setItem("ce.settings", JSON.stringify(s.rememberKeys ? s : rest));
  sessionStorage.setItem("ce.keys", JSON.stringify({ anthropicKey, openaiKey }));
}

export function loadRules(): StyleRule[] {
  try { return JSON.parse(localStorage.getItem("ce.style") || "[]"); } catch { return []; }
}
export function saveRules(r: StyleRule[]) { localStorage.setItem("ce.style", JSON.stringify(r)); }
