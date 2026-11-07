// Everything stays in this browser: projects and media in IndexedDB, settings and style rules in localStorage.
// API keys are kept only if the user ticks "remember" (else for this tab only), and are never sent to this app's server.
// Each local account (lib/auth.ts) sees its own videos, settings and style; data made before accounts existed is
// shared by everyone in this browser.

import { KEY_FIELDS, onlyKeys, withoutKeys } from "./keys";
import { createStore, del, get, keys, set } from "idb-keyval";
import { effortOf } from "./effort";
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
/** Every media key stored in this browser (backups pick the ones this account's videos use). */
export async function mediaKeys(): Promise<string[]> { return (await keys(media())).map(String); }
export async function delMedia(key: string) { await del(key, media()); }
/** Restore: put a project / animation back exactly as backed up (its time kept), for the signed-in account. */
/** The signed-in account's id (null before accounts, or signed out). */
export function currentOwner(): string | null { return owner; }
export async function putProjectRaw(p: Project) { p.owner = owner ?? undefined; await set(p.id, JSON.parse(JSON.stringify(p)), projects()); }
export async function putAnimRaw(a: Anim) { a.owner = owner ?? undefined; await set(a.id, JSON.parse(JSON.stringify(a)), anims()); }
export async function getAnim(id: string): Promise<Anim | undefined> { return get(id, anims()); }

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
/** A copy of a video to try something different: its own id, versions and title; the same footage and library files
 *  (shared like a long video's clips, so deleting either keeps what the other uses). */
export async function copyProject(p: Project): Promise<Project> {
  const now = new Date().toISOString();
  const copy: Project = { ...JSON.parse(JSON.stringify(p)), id: `${p.id.replace(/-copy-\w+$/, "")}-copy-${Math.random().toString(36).slice(2, 7)}`,
    title: `${p.title.replace(/ \(copy( \d+)?\)$/, "")} (copy)`, createdAt: now, updatedAt: now, sample: undefined };
  await saveProject(copy);
  return copy;
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
const animMedia = (a: Anim) => [a.music, ...Object.values(a.voice?.keys ?? {}), ...a.scenes.map((x) => x.image)].filter(Boolean) as string[];

export async function deleteAnim(a: Anim) {
  await del(a.id, anims());
  // a restored copy keeps the original's files: only delete what no other animation or project (of any account) uses
  const [ak, pk] = await Promise.all([keys(anims()), keys(projects())]);
  const others = (await Promise.all(ak.map((k) => get(k, anims()) as Promise<Anim>))).filter(Boolean);
  const ps = (await Promise.all(pk.map((k) => get(k, projects()) as Promise<Project>))).filter(Boolean);
  const used = new Set([...others.flatMap(animMedia), ...ps.flatMap((q) => [...q.sources.map((s) => s.mediaKey), ...q.library.map((x) => x.key)])]);
  await Promise.all(animMedia(a).filter((k) => !used.has(k)).map((k) => del(k, media())));
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic", anthropicKey: "", openaiKey: "", openrouterKey: "", geminiKey: "",
  anthropicModel: "claude-sonnet-5-5", openaiModel: "", openrouterModel: "", geminiModel: "",
  transcriber: "openai", rememberKeys: false, effort: "balanced",
};

export function loadSettings(): Settings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    // an account's own copy; else the copy kept from before accounts, shared by everyone here, minus any keys in it
    const own = owner ? localStorage.getItem(k("ce.settings")) : null;
    const stored = JSON.parse(own ?? read("ce.settings") ?? "{}") as Partial<Settings>;
    const s = { ...DEFAULT_SETTINGS, ...(owner && own === null ? withoutKeys(stored) : stored) } as Settings;
    s.effort = effortOf(s);
    const session = JSON.parse(sessionStorage.getItem(k("ce.keys")) || "{}") as Partial<Settings>;
    for (const f of KEY_FIELDS) s[f] = s[f] || session[f] || "";
    return s;
  } catch { return DEFAULT_SETTINGS; }
}

export function saveSettings(s: Settings) {
  // keys stay for this tab only, unless "Remember my keys" (KEY_FIELDS: every provider's key, lib/keys.ts)
  localStorage.setItem(k("ce.settings"), JSON.stringify(s.rememberKeys ? s : withoutKeys(s)));
  sessionStorage.setItem(k("ce.keys"), JSON.stringify(onlyKeys(s)));
  changed();
}

/** An account deleted: its videos and animations (files shared with someone else's stay), and everything this browser
 *  keeps for it (settings, keys, style, timings, flags: every storage entry named for it). */
export async function deleteAccountData(id: string) {
  const prev = owner;
  owner = id;
  try {
    for (const p of (await listProjects()).filter((x) => x.owner === id)) await deleteProject(p);
    for (const a of (await listAnims()).filter((x) => x.owner === id)) await deleteAnim(a);
  } finally { owner = prev; }
  for (const st of [localStorage, sessionStorage]) {
    for (const key of Object.keys(st)) if (key.endsWith(`.${id}`)) st.removeItem(key);
  }
}

/** Signing out on a shared computer: this account's API keys leave the browser (the tab's copy and a remembered one);
 *  the rest of its settings stay for next time. */
export function forgetKeys() {
  try {
    sessionStorage.removeItem(k("ce.keys"));
    for (const name of new Set([k("ce.settings"), "ce.settings"])) {   // the account's copy and the shared pre-accounts one
      const raw = localStorage.getItem(name);
      if (raw) localStorage.setItem(name, JSON.stringify(withoutKeys(JSON.parse(raw) as Settings)));
    }
  } catch { /* storage blocked: nothing kept */ }
}

export function loadRules(): StyleRule[] {
  try { return JSON.parse(read("ce.style") || "[]"); } catch { return []; }
}
export function saveRules(r: StyleRule[]) { localStorage.setItem(k("ce.style"), JSON.stringify(r)); changed(); }

/** Per-device values for this account that never sync (lib/timings.ts). Storage can be off (private mode): then nothing is kept. */
export function readLocal(base: string): string | null {
  try { return read(base); } catch { return null; }
}
export function writeLocal(base: string, value: string) {
  try { localStorage.setItem(k(base), value); } catch { /* storage full or off */ }
}

/** The last script written with "Write a script" (hook + what to say), offered with one click by "Paste your script". */
export function saveLastScript(text: string) { writeLocal("ce.lastScript", text); }
export function lastScript(): string { return readLocal("ce.lastScript") ?? ""; }

/** Tells lib/sync.ts that a preference changed (it pushes them when server accounts are on). */
function changed() { if (typeof window !== "undefined") window.dispatchEvent(new Event("cutmind:prefs")); }
