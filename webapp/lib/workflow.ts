// The whole workflow: takes in -> transcript and analysis -> first edit (AI or deterministic) -> notes -> versions.

import { applyNote, firstEdit } from "./ai";
import { analyze } from "./analyze";
import { defaultEdit, describe, fromAi, type AiEdit } from "./edit";
import { trackFaces } from "./face";
import { findPicture } from "./images";
import { activeRms, decodeMono, musicFeel, probeImage, probeVideo, uid } from "./media";
import { getMedia, putMedia, saveProject } from "./store";
import { transcribe } from "./transcribe";
import type { Asset, Edit, Project, Settings, StyleRule } from "./types";

export type Progress = (msg: string, pct?: number) => void;

const VIDEO = /\.(mp4|mov|m4v|webm|mkv)$/i, IMAGE = /\.(png|jpe?g|webp|gif)$/i, AUDIO = /\.(mp3|m4a|wav|aac|ogg|flac)$/i;

export function kindOf(f: File): Asset["kind"] | "take" | null {
  if (AUDIO.test(f.name) || f.type.startsWith("audio/")) return "music";
  if (IMAGE.test(f.name) || f.type.startsWith("image/")) return "image";
  if (VIDEO.test(f.name) || f.type.startsWith("video/")) return "video";
  return null;
}

export async function createProject(takes: File[], extras: File[], onProgress: Progress): Promise<Project> {
  const p: Project = { id: uid(), title: takes[0].name.replace(/\.\w+$/, "").replace(/[_-]+/g, " "), createdAt: new Date().toISOString(),
    updatedAt: "", sources: [], words: [], library: [], versions: [], current: 0, status: "new" };
  for (const [i, f] of takes.entries()) {
    onProgress("Copying your video", 2);
    const key = `${p.id}:take${i}`;
    await putMedia(key, f);
    const url = URL.createObjectURL(f);
    const m = await probeVideo(url);
    URL.revokeObjectURL(url);
    p.sources.push({ id: i, name: f.name, mediaKey: key, duration: m.duration, width: m.width, height: m.height });
  }
  await addToLibrary(p, extras, onProgress);
  await saveProject(p);
  return p;
}

export async function addToLibrary(p: Project, files: File[], onProgress: Progress = () => undefined): Promise<string[]> {
  const added: string[] = [];
  for (const f of files) {
    const kind = kindOf(f);
    if (!kind || kind === "take") continue;
    const key = `${p.id}:${uid()}`;
    await putMedia(key, f);
    const url = URL.createObjectURL(f);
    const a: Asset = { key, name: f.name, kind };
    try {
      if (kind === "image") Object.assign(a, await probeImage(url));
      else if (kind === "video") Object.assign(a, await probeVideo(url));
      else {
        onProgress(`Listening to ${f.name}`);
        const x = await decodeMono(f, 16000);
        const feel = musicFeel(x);
        Object.assign(a, { duration: x.length / 16000, feel: feel.feel, energy: feel.energy, entry: feel.entry, rms: feel.rms });
      }
    } finally { URL.revokeObjectURL(url); }
    p.library.push(a);
    added.push(f.name);
  }
  return added;
}

export async function mediaUrls(p: Project): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  for (const k of [...p.sources.map((s) => s.mediaKey), ...p.library.map((a) => a.key)]) {
    const b = await getMedia(k);
    if (b) m.set(k, URL.createObjectURL(b));
  }
  return m;
}

export async function listen(p: Project, s: Settings, onProgress: Progress) {
  p.words = [];
  for (const src of p.sources) {
    const blob = (await getMedia(src.mediaKey))!;
    const ws = await transcribe(blob, src.id, p.words.length, s.transcriber, s.openaiKey,
      (m, pct) => onProgress(p.sources.length > 1 ? `${m} (take ${src.id + 1})` : m, pct));
    p.words.push(...ws);
    src.rms = activeRms(await decodeMono(blob, 16000));
  }
  if (!p.words.length) throw new Error("I couldn't hear any speech in this video. Is the sound on?");
  onProgress("Finding your retakes", 40);
  p.analysis = analyze(p.words);
  onProgress("Finding your face", 45);
  try {
    const urls = await mediaUrls(p);
    p.faces = await trackFaces(p.sources, p.sources.map((x) => urls.get(x.mediaKey)!), (pct) => onProgress("Finding your face", 45 + pct * 0.1));
    urls.forEach((u) => URL.revokeObjectURL(u));
  } catch { p.faces = []; }                         // the reframe falls back to the centre
  p.status = "transcribed";
  await saveProject(p);
}

async function webPictures(p: Project, ai: AiEdit, onProgress: Progress): Promise<Map<string, Asset>> {
  const out = new Map<string, Asset>();
  const want = (ai.webPictures ?? []).slice(0, 16);
  if (want.length) onProgress(`Finding ${want.length} pictures online`, 70);
  await Promise.all(want.map(async (w) => {
    const existing = p.library.find((a) => a.key === `web:${w.query}`);
    if (existing) { out.set(existing.key, existing); return; }
    const hit = await findPicture(w.query, w.kind).catch(() => null);
    if (hit) { out.set(hit.asset.key, hit.asset); p.library.push(hit.asset); }
  }));
  return out;
}

export async function makeFirstEdit(p: Project, s: Settings, rules: StyleRule[], onProgress: Progress): Promise<string> {
  const base = defaultEdit(p);
  const key = s.provider === "anthropic" ? s.anthropicKey : s.openaiKey;
  let edit: Edit = base, summary: string;
  if (!key) {
    summary = "No AI editor connected, so I made a simple cut: I removed the pauses and repeated starts and added subtitles" +
      (base.music.asset ? " and your song." : ".") + " Add an API key in Settings and I can pick your best takes, add pictures and write your caption.";
  } else {
    onProgress("Picking your best takes and planning the edit", 55);
    const ai = await firstEdit(s, p, rules);
    const web = await webPictures(p, ai, onProgress);
    const res = fromAi(p, base, ai, web);
    edit = res.edit;
    const wanted = (ai.webPictures ?? []).length, found = web.size;
    summary = (ai.summary ?? "Here's your first edit.") + (wanted > found ? ` I couldn't find ${wanted - found} of the pictures online.` : "");
    if (res.problems.length) console.warn("edit problems", res.problems);
  }
  p.versions = [{ n: 1, edit, note: "First draft", summary, at: new Date().toISOString() }];
  p.current = 1;
  p.status = "edited";
  await saveProject(p);
  return summary;
}

export async function applyUserNote(p: Project, s: Settings, rules: StyleRule[], note: string, onProgress: Progress):
  Promise<{ summary: string; styleRule: string | null }> {
  const cur = p.versions.find((v) => v.n === p.current) ?? p.versions[p.versions.length - 1];
  onProgress("Working on your note", 30);
  const ai = await applyNote(s, p, cur.edit, note, rules);
  const web = await webPictures(p, ai, onProgress);
  const { edit } = fromAi(p, cur.edit, ai, web);
  const n = Math.max(...p.versions.map((v) => v.n)) + 1;
  const summary = ai.summary || describe(cur.edit, edit);
  p.versions.push({ n, edit, note, summary, at: new Date().toISOString() });
  p.current = n;
  await saveProject(p);
  return { summary, styleRule: ai.styleRule ?? null };
}

export async function saveManual(p: Project, edit: Edit, what: string) {
  const cur = p.versions.find((v) => v.n === p.current)!;
  const n = Math.max(...p.versions.map((v) => v.n)) + 1;
  p.versions.push({ n, edit, note: what, summary: describe(cur.edit, edit), at: new Date().toISOString() });
  p.current = n;
  await saveProject(p);
}
