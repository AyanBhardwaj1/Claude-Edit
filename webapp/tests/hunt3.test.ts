import assert from "node:assert/strict";
import test from "node:test";
import { analyze } from "../lib/analyze";
import { defaultEdit, fromAi, type AiEdit } from "../lib/edit";
import { webKey } from "../lib/images";
import { learnFromExport } from "../lib/learn";
import { blankProject, makeReel } from "../lib/workflow";
import type { Edit, Project, Settings, Word } from "../lib/types";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } }
const g = globalThis as unknown as { localStorage: Mem; sessionStorage: Mem };
g.localStorage ??= new Mem(); g.sessionStorage ??= new Mem();

const words = (text: string, t0 = 0, step = 0.4, start = 0): Word[] =>
  text.split(" ").map((w, i) => ({ id: `w${start + i}`, src: 0, s: +(t0 + i * step).toFixed(3), e: +(t0 + i * step + 0.3).toFixed(3), w }));

function keptText(ws: Word[], keep: { from: string; to: string }[]): string {
  const idx = new Map(ws.map((w, i) => [w.id, i]));
  const out: string[] = [];
  for (const r of keep) for (let i = idx.get(r.from)!; i <= idx.get(r.to)!; i++) out.push(ws[i].w);
  return out.join(" ");
}

test("a stutter drops its whole first copy: 'I was, I was going' keeps 'I was going'", () => {
  const ws = words("I was I was going home after work.");
  const kept = keptText(ws, analyze(ws).defaultKeep);
  assert.equal(kept, "I was going home after work.");
});

test("a retake of only the opening still opens the cut", () => {
  const ws = [...words("so the best way to edit a reel is this.", 0, 0.4, 0),
    ...words("you add the captions after the cut.", 5, 0.4, 10),
    ...words("the best way to edit a reel is this one.", 9, 0.4, 17)];
  const a = analyze(ws);
  const kept = keptText(ws, a.defaultKeep);
  assert.ok(kept.startsWith("the best way to edit a reel is this one."), kept);
  assert.ok(kept.endsWith("after the cut."), kept);
});

test("the same web picture asked for at two mentions goes on both", () => {
  const ws = words("Notion is great and Notion is free and that is all");
  const p = { id: "p", title: "t", words: ws, library: [], versions: [],
    sources: [{ id: 0, name: "a", mediaKey: "k", duration: 10, width: 1080, height: 1920 }] } as unknown as Project;
  const base = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${ws.length - 1}` }] };
  const asset = { key: webKey("p", "Notion logo"), name: "Notion", kind: "image" as const, width: 100, height: 100, web: true };
  const ai = { keep: base.keep, webPictures: [
    { query: "Notion logo", kind: "logo", from: "w0", to: "w2" }, { query: "Notion logo", kind: "logo", from: "w4", to: "w6" }] } as unknown as AiEdit;
  const { edit } = fromAi(p, base, ai, new Map([["Notion logo", asset]]));
  const placed = edit.broll.filter((b) => b.asset === asset.key);
  assert.equal(placed.length, 2);
  assert.deepEqual(placed.map((b) => b.anchor.from), ["w0", "w4"]);
});

test("web pictures are kept per video, so two videos searching the same words don't share a file", () => {
  assert.notEqual(webKey("a", "cat"), webKey("b", "cat"));
  assert.equal(webKey("a", "cat"), "web:a:cat");
});

test("a copy of a video is the same video when learning taste", () => {
  g.localStorage.clear();
  const project = (id: string): Project => {
    const p = { id, title: id, createdAt: "", updatedAt: "", sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 10, width: 1080, height: 1920 }],
      words: [{ id: "w0", src: 0, s: 0, e: 0.4, w: "hi" }], library: [], versions: [], current: 2, status: "edited" } as unknown as Project;
    const first = defaultEdit(p);
    const mine: Edit = JSON.parse(JSON.stringify(first));
    mine.captions.size += 20;
    p.versions = [{ n: 1, edit: first, note: "", summary: "", at: "" }, { n: 2, edit: mine, note: "", summary: "", at: "" }] as never;
    return p;
  };
  assert.equal(learnFromExport(project("v1"), []), null);
  assert.equal(learnFromExport(project("v1-copy-ab12c"), []), null);      // its copy: still one video
  assert.equal(learnFromExport(project("v2"), []), "Make the subtitles bigger");
});

test("try again carries on with the video already made instead of copying the takes in twice", async () => {
  let creates = 0, listens = 0;
  const takes = [new File([new Blob(["a"])], "Take 1.webm", { type: "video/webm" })];
  const settings = { provider: "anthropic", transcriber: "openai" } as Settings;
  const steps = {
    createProject: async (t: File[]) => { creates++; const q = blankProject(t, ""); q.sources = []; return q; },
    listen: async () => { listens++; if (listens === 1) throw new Error("network"); return null; },
    makeFirstEdit: async () => "Here's your first edit.",
  };
  let made: Project | null = null;
  const again = () => ({ made, onMade: (p: Project) => { made = p; } });
  await assert.rejects(makeReel(takes, [], "", settings, [], () => undefined, steps as never, again()));
  assert.equal(creates, 1);
  const res = await makeReel(takes, [], "", settings, [], () => undefined, steps as never, again());
  assert.equal(creates, 1);                                   // the second try reused it
  assert.equal(res.project, made);
});
