// The sample project (public/demo, made by scripts/make_demo.py): a drawn presenter and a computer voice reading a take
// with a restart, meta-talk and a stutter. It loads with its first edit already made (no key needed), so anyone can
// play it, open "Edit it myself", switch shapes and export before filming anything.

import { analyze } from "./analyze";
import { defaultEdit, fromAi, type AiEdit } from "./edit";
import { uid } from "./media";
import type { FaceSample, Project } from "./types";
import { addToLibrary, type Progress } from "./workflow";
import { putMedia, saveProject } from "./store";

type DemoFile = {
  title: string; about: string;
  source: { name: string; width: number; height: number; duration: number };
  words: { w: string; s: number; e: number }[];
  faces: FaceSample[];
  library: { key: string; file: string; name: string; kind: "image" | "music" }[];
  edit: AiEdit;
};

const BASE = "/demo/";

async function get(path: string): Promise<Blob> {
  const r = await fetch(BASE + path);
  if (!r.ok) throw Object.assign(new Error(`demo ${path}: ${r.status}`), { userMessage: "The sample video couldn't load. Check your connection and try again." });
  return r.blob();
}

export async function createSample(onProgress: Progress = () => undefined): Promise<{ project: Project; summary: string }> {
  onProgress("Getting the sample video", 10);
  const d = (await (await fetch(BASE + "demo.json")).json()) as DemoFile;
  const p: Project = { id: uid(), title: d.title, createdAt: new Date().toISOString(), updatedAt: "", sources: [], words: [], library: [],
    versions: [], current: 0, status: "new", sample: true };
  const key = `${p.id}:take0`;
  await putMedia(key, await get("take.mp4"));
  p.sources.push({ id: 0, name: d.source.name, mediaKey: key, duration: d.source.duration, width: d.source.width, height: d.source.height });
  p.words = d.words.map((w, i) => ({ id: `w${i}`, src: 0, s: w.s, e: w.e, w: w.w, p: 0.99 }));
  p.faces = d.faces;
  p.analysis = analyze(p.words);
  onProgress("Adding its picture and music", 45);
  const files = await Promise.all(d.library.map(async (a) => new File([await get(a.file)], a.name, { type: a.kind === "image" ? "image/png" : "audio/mp4" })));
  await addToLibrary(p, files, onProgress);
  const keyOf = new Map(d.library.map((a, i) => [a.key, p.library[i]?.key]));
  const ai: AiEdit = structuredClone(d.edit);
  ai.broll = (ai.broll ?? []).map((b) => ({ ...b, asset: keyOf.get(b.asset) ?? b.asset }));
  if (ai.music?.asset) ai.music.asset = keyOf.get(ai.music.asset) ?? null;
  const { edit, problems } = fromAi(p, defaultEdit(p), ai);
  if (problems.length) console.warn("sample edit", problems);
  const summary = ai.summary ?? "Here's the sample's first edit.";
  p.versions = [{ n: 1, edit, note: "First draft", summary, at: new Date().toISOString() }];
  p.current = 1;
  p.status = "edited";
  await saveProject(p);
  onProgress("Ready", 100);
  return { project: p, summary };
}

export const SAMPLE_ABOUT = "A sample made for trying Cutmind: a drawn presenter and a computer voice, not a real person.";
