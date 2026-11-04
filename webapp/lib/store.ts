// Everything stays in this browser: projects and media in IndexedDB, settings and style rules in localStorage.
// API keys are kept only if the user ticks "remember" (else for this tab only), and are never sent to this app's server.
// Each local account (lib/auth.ts) sees its own videos, settings and style; data made before accounts existed is
// shared by everyone in this browser.

import { createStore, del, get, keys, set } from "idb-keyval";
import type { Anim } from "./studio";
import type { Project, Settings, StyleRule } from "./types";

const media = () => createStore("cutmind-media", "files");
const projects = () => createStore("cutmind-projects", "projects");
const anims = () => createStore("cutmind-anims", "anims");

let owner: string | null = null;
/** The signed-in account; everything below reads and writes that account's data. */
export function setOwner(id: string | null) { owner = id; }
const k = (base: string) => (owner ? `${base}.${owner}` : base);
function read(base: string): string | null {
  return localStorage.getItem(k(base)) ?? (owner ? localStorage.getItem(base) : null);
}

export async function putMedia(key: string, blob: Blob) { await set(key, blob, media()); }
export async function getMedia(key: string): Promise<Blob | undefined> { return get(key, media()); }

export async function saveProject(p: Project) {
  p.updatedAt = new Date().toISOString();
  if (!p.owner && owner) p.owner = owner;
  await set(p.id, JSON.parse(JSON.stringify(p)), projects());
}
export async function loadProject(id: string): Promise<Project | undefined> { return get(id, projects()); }
export async function listProjects(): Promise<Project[]> {
  const ks = await keys(projects());
  const ps = await Promise.all(ks.map((k) => get(k, projects()) as Promise<Project>));
  return ps.filter((p) => p && (!p.owner || !owner || p.owner === owner)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteProject(p: Project) {
  await del(p.id, projects());
  // clips share their long video's files: only delete what no other project (of any account) still uses
  const ks = await keys(projects());
  const others = (await Promise.all(ks.map((k) => get(k, projects()) as Promise<Project>))).filter(Boolean);
  const used = new Set(others.flatMap((q) => [...q.sources.map((s) => s.mediaKey), ...q.library.map((a) => a.key)]));
  await Promise.all([...p.sources.map((s) => s.mediaKey), ...p.library.map((a) => a.key)].filter((k) => !used.has(k)).map((k) => del(k, media())));
}

export async function saveAnim(a: Anim) {
  a.updatedAt = new Date().toISOString();
  if (!a.owner && owner) a.owner = owner;
  await set(a.id, JSON.parse(JSON.stringify(a)), anims());
}
export async function listAnims(): Promise<Anim[]> {
  const ks = await keys(anims());
  const all = await Promise.all(ks.map((k) => get(k, anims()) as Promise<Anim>));
  return all.filter((a) => a && (!a.owner || !owner || a.owner === owner)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteAnim(a: Anim) {
  await del(a.id, anims());
  await Promise.all([a.music, ...Object.values(a.voice?.keys ?? {})].filter(Boolean).map((k) => del(k!, media())));
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic", anthropicKey: "", openaiKey: "", anthropicModel: "claude-sonnet-5-5", openaiModel: "",
  transcriber: "openai", rememberKeys: false,
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const s = { ...DEFAULT_SETTINGS, ...JSON.parse(read("ce.settings") || "{}") } as Settings;
    const session = JSON.parse(sessionStorage.getItem(k("ce.keys")) || "{}");
    return { ...s, anthropicKey: s.anthropicKey || session.anthropicKey || "", openaiKey: s.openaiKey || session.openaiKey || "" };
  } catch { return DEFAULT_SETTINGS; }
}

export function saveSettings(s: Settings) {
  const { anthropicKey, openaiKey, ...rest } = s;
  localStorage.setItem(k("ce.settings"), JSON.stringify(s.rememberKeys ? s : rest));
  sessionStorage.setItem(k("ce.keys"), JSON.stringify({ anthropicKey, openaiKey }));
  changed();
}

export function loadRules(): StyleRule[] {
  try { return JSON.parse(read("ce.style") || "[]"); } catch { return []; }
}
export function saveRules(r: StyleRule[]) { localStorage.setItem(k("ce.style"), JSON.stringify(r)); changed(); }

/** Tells lib/sync.ts that a preference changed (it pushes them when server accounts are on). */
function changed() { if (typeof window !== "undefined") window.dispatchEvent(new Event("cutmind:prefs")); }
