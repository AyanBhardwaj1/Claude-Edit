// The whole workflow: takes in -> transcript and analysis -> first edit (AI or deterministic) -> notes -> versions.

import { applyNote, firstEdit, listModels, reviewEdit } from "./ai";
import { analyze } from "./analyze";
import { defaultEdit, describe, fromAi, type AiEdit } from "./edit";
import { aiChoice, effortOf, EFFORT, type AiChoice } from "./effort";
import { trackFaces } from "./face";
import { findPicture } from "./images";
import { activeRms, decodeMono, looksLikeScreenAt, musicFeel, probeImage, probeVideo, uid } from "./media";
import { getMedia, putMedia, saveProject } from "./store";
import { applyScript, type ScriptResult } from "./retext";
import { record } from "./timings";
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

/** A filmed take's name says nothing ("Take 1.webm"): then the video is called after the script's first line. */
const GENERIC = /^take \d+\.\w+$/i;

/** The title for a new video: the first take's file name, or for takes filmed in Cutmind the script's first line. */
export function titleFor(takes: { name: string }[], script = ""): string {
  const first = script.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (first && GENERIC.test(takes[0]?.name ?? "")) {
    if (first.length <= 60) return first;
    const cut = first.slice(0, 60);
    return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60).replace(/[\s,;:.!?-]+$/, "")}…`;
  }
  return (takes[0]?.name ?? "New video").replace(/\.\w+$/, "").replace(/[_-]+/g, " ");
}

/** An empty project for these takes. A script (pasted, or the teleprompter's from "Film it here") rides along so the
 *  listen step applies it, and "Paste your script" in Subtitles starts from it. */
export function blankProject(takes: { name: string }[], script = ""): Project {
  const p: Project = { id: uid(), title: titleFor(takes, script), createdAt: new Date().toISOString(),
    updatedAt: "", sources: [], words: [], library: [], versions: [], current: 0, status: "new" };
  if (script.trim()) p.script = script.trim();
  return p;
}

export async function createProject(takes: File[], extras: File[], onProgress: Progress, script = ""): Promise<Project> {
  const p = blankProject(takes, script);
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

/** What a file already knows about itself, added to its library entry after probing: a screen recording made in Cutmind
 *  (components/ScreenRecorder.tsx) is a screen, with its length, trim and waits (a recorded WebM has no length in it). */
export const fileMeta = new WeakMap<File, Partial<Asset>>();

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
      if (kind === "image" || kind === "video") {
        Object.assign(a, kind === "image" ? await probeImage(url) : await probeVideo(url));
        if (fileMeta.get(f)?.screen || await looksLikeScreenAt(url, kind)) a.screen = true;   // the AI then reads "screenshot" / "screen recording"
      } else {
        onProgress(`Listening to ${f.name}`);
        const x = await decodeMono(f, 16000);
        const feel = musicFeel(x);
        Object.assign(a, { duration: x.length / 16000, feel: feel.feel, energy: feel.energy, entry: feel.entry, rms: feel.rms });
      }
    } finally { URL.revokeObjectURL(url); }
    Object.assign(a, fileMeta.get(f));
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

const footage = (p: Project) => p.sources.reduce((a, x) => a + (x.duration || 0), 0);
const since = (t0: number) => (performance.now() - t0) / 1000;

/** The model and answer budget for this effort. The effort's preferred model is used only when the key's model list has it
 *  (asked once per key; if the list can't be read, the user's own model stays). */
const known = new Map<string, Promise<string[] | null>>();
async function choiceFor(s: Settings): Promise<AiChoice> {
  const effort = effortOf(s);
  const key = s.provider === "anthropic" ? s.anthropicKey : s.openaiKey;
  if (s.provider !== "anthropic" || !EFFORT[effort].anthropicModel || !key) return aiChoice(s, effort, null);
  if (!known.has(key)) known.set(key, Promise.race([
    listModels("anthropic", key).then((r) => r.models).catch(() => null),
    new Promise<null>((ok) => setTimeout(() => ok(null), 6000)),
  ]));
  return aiChoice(s, effort, await known.get(key)!);
}

/** Transcript, retakes and (unless the effort is Fast) the face. `s.effort` is this video's effort. A pasted script puts
 *  its words on the heard timing before anything reads them (lib/retext.ts), so the first edit already uses it. */
export async function listen(p: Project, s: Settings, onProgress: Progress, script = ""): Promise<ScriptResult | null> {
  const effort = effortOf(s);
  const t0 = performance.now();
  let fixed: ScriptResult | null = null;
  p.words = [];
  delete p.wordsHeard;
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
  if (script.trim()) {
    onProgress("Matching your script", 42);
    fixed = applyScript(p, script);
  }
  record("listen", effort, since(t0), footage(p), s.transcriber);
  if (EFFORT[effort].faces) {
    onProgress("Finding your face", 45);
    const t1 = performance.now();
    try {
      const urls = await mediaUrls(p);
      p.faces = await trackFaces(p.sources, p.sources.map((x) => urls.get(x.mediaKey)!), (pct) => onProgress("Finding your face", 45 + pct * 0.1));
      urls.forEach((u) => URL.revokeObjectURL(u));
      record("faces", effort, since(t1), footage(p));
    } catch { p.faces = []; }                       // the reframe falls back to the centre
  } else p.faces = [];                              // Fast: no face finding, the reframe stays centred
  p.status = "transcribed";
  await saveProject(p);
  return fixed;
}

async function webPictures(p: Project, ai: AiEdit, onProgress: Progress, limit = 16): Promise<Map<string, Asset>> {
  const out = new Map<string, Asset>();
  const want = (ai.webPictures ?? []).slice(0, limit);
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
    const plan = EFFORT[effortOf(s)];
    const t0 = performance.now();
    onProgress("Picking your best takes and planning the edit", 55);
    const choice = await choiceFor(s);
    const ai = await firstEdit(s, p, rules, choice, plan.hint);
    const web = await webPictures(p, ai, onProgress, plan.pictures);
    const res = fromAi(p, base, ai, web);
    edit = res.edit;
    const wanted = Math.min(plan.pictures, (ai.webPictures ?? []).length), found = web.size;
    summary = (ai.summary ?? "Here's your first edit.") + (wanted > found ? ` I couldn't find ${wanted - found} of the pictures online.` : "");
    if (res.problems.length) console.warn("edit problems", res.problems);
    if (plan.review) {
      onProgress(REVIEWING, 80);
      try {
        const again = await reviewEdit(s, p, edit, rules, choice);
        const more = await webPictures(p, again, onProgress, plan.pictures);
        const rev = fromAi(p, edit, again, more);
        if (rev.problems.length) console.warn("review problems", rev.problems);
        edit = rev.edit;
        if (again.summary) summary = again.summary;
      } catch (e) { console.warn("review pass failed, keeping the first edit", e); }
    }
    if (!p.parent) record("edit", effortOf(s), since(t0), footage(p));
  }
  p.versions = [{ n: 1, edit, note: "First draft", summary, at: new Date().toISOString() }];
  p.current = 1;
  p.status = "edited";
  await saveProject(p);
  return summary;
}

/** New video, start to finish: copy the takes in, listen (applying the script to the subtitles), make the first edit.
 *  Dropped takes and takes filmed with "Film it here" both come through here. `steps` is for the tests. */
export async function makeReel(takes: File[], extras: File[], script: string, s: Settings, rules: StyleRule[], onProgress: Progress,
  steps = { createProject, listen, makeFirstEdit }): Promise<{ project: Project; summary: string }> {
  const p = await steps.createProject(takes, extras, onProgress, script);
  const fixed = await steps.listen(p, s, onProgress, script);
  const summary = await steps.makeFirstEdit(p, s, rules, onProgress);
  onProgress("Ready", 100);
  return { project: p, summary: !fixed ? summary
    : `${summary} ${fixed.ok ? `Subtitles use your script: ${fixed.message}` : `I kept the words as I heard them: ${fixed.message}`}` };
}

/** The progress line while Best quality runs its review pass. */
export const REVIEWING = "Reviewing the edit like a senior editor";

/** Notes are one pass at every effort, with the effort's model and answer budget (the saved default effort). */
export async function applyUserNote(p: Project, s: Settings, rules: StyleRule[], note: string, onProgress: Progress):
  Promise<{ summary: string; styleRule: string | null }> {
  const cur = p.versions.find((v) => v.n === p.current) ?? p.versions[p.versions.length - 1];
  onProgress("Working on your note", 30);
  const ai = await applyNote(s, p, cur.edit, note, rules, await choiceFor(s));
  const web = await webPictures(p, ai, onProgress, EFFORT[effortOf(s)].pictures);
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
