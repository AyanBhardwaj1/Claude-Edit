import assert from "node:assert/strict";
import test from "node:test";
import { defaultEdit } from "../lib/edit";
import { declineLearned, learnFromExport, signals } from "../lib/learn";
import type { Edit, Project } from "../lib/types";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } }
const g = globalThis as unknown as { localStorage: Mem; sessionStorage: Mem };
g.localStorage = new Mem(); g.sessionStorage = new Mem();

function project(id: string, change: (e: Edit) => void): Project {
  const p = { id, title: id, createdAt: "", updatedAt: "", sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 10, width: 1080, height: 1920 }],
    words: [{ id: "w0", src: 0, s: 0, e: 0.4, w: "hi" }], library: [], versions: [], current: 2, status: "edited" } as unknown as Project;
  const first = { ...defaultEdit(p), zooms: [{ anchor: { from: "w0", to: "w0" }, scale: 1.2 }, { anchor: { from: "w0", to: "w0" }, scale: 1.3 }] };
  const mine: Edit = JSON.parse(JSON.stringify(first));
  change(mine);
  p.versions = [{ n: 1, edit: first, note: "", summary: "", at: "" }, { n: 2, edit: mine, note: "", summary: "", at: "" }];
  return p;
}

test("what a change from the AI's draft to the export says about taste", () => {
  const a = project("x", () => {}).versions[0].edit;
  const b: Edit = JSON.parse(JSON.stringify(a));
  assert.deepEqual(signals(a, b), []);
  b.captions.size = a.captions.size + 20; b.zooms = []; b.sfx = false; b.captions.textCase = "as-is";
  assert.deepEqual(signals(a, b), ["Make the subtitles bigger", "Subtitles as I say them, not in capitals", "Fewer zooms", "No sound effects"]
    .filter((s) => a.sfx || s !== "No sound effects"));
});

test("a change made in two different videos is offered once, never from one video, never twice after a no", () => {
  g.localStorage.clear();
  const bigger = (e: Edit) => { e.captions.size += 20; };
  assert.equal(learnFromExport(project("v1", bigger), []), null);
  assert.equal(learnFromExport(project("v1", bigger), []), null);                // the same video exported again
  assert.equal(learnFromExport(project("v2", bigger), []), "Make the subtitles bigger");
  assert.equal(learnFromExport(project("v3", bigger), [{ id: "r", text: "make the subtitles bigger", at: "" }]), null);
  declineLearned("Make the subtitles bigger");
  assert.equal(learnFromExport(project("v4", bigger), []), null);
  assert.equal(learnFromExport(project("v5", (e) => { e.zooms = []; }), []), null);
  assert.equal(learnFromExport(project("v6", (e) => { e.zooms = []; }), []), "Fewer zooms");
});
