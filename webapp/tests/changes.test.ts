import assert from "node:assert/strict";
import test from "node:test";
import { changeItems, changeList } from "../lib/changes";
import { defaultEdit } from "../lib/edit";
import type { Edit, Project, Word } from "../lib/types";

const ws: Word[] = "so here is my tip about my cat and then the real tip".split(" ")
  .map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.5, e: i * 0.5 + 0.4, w }));
const project = (): Project => ({ id: "p", title: "t", createdAt: "", updatedAt: "", sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 10, width: 1080, height: 1920 }],
  words: ws, library: [{ key: "song1", name: "Sunny Day", kind: "music" }, { key: "song2", name: "Night Drive", kind: "music" }],
  versions: [], current: 0, status: "edited" } as Project);

test("a version's real changes in plain lines: the cut, subtitles, music, pictures", () => {
  const p = project();
  const a: Edit = { ...defaultEdit(p), keep: [{ from: "w0", to: "w12" }] };
  const b: Edit = JSON.parse(JSON.stringify(a));
  assert.deepEqual(changeList(p, a, b), []);
  b.keep = [{ from: "w0", to: "w4" }, { from: "w8", to: "w12" }];
  b.captions = { ...a.captions, size: a.captions.size + 10 };
  b.music = { ...a.music, asset: "song2" };
  b.music.automation = [{ anchor: { from: "w0", to: "w2" }, db: -6 }];
  b.broll = [{ id: "x1", anchor: { from: "w10", to: "w11" }, treatment: "text-pop", text: "THE REAL TIP" }];
  const out = changeList(p, a, b);
  assert.match(out[0], /^Length 0:07 → 0:06 \(−1\.\d s\)$/);
  assert.ok(out.includes("Cut “about my cat”"), out.join(" | "));
  assert.ok(out.includes("Subtitles: bigger"));
  assert.ok(out.some((x) => /^Music: .* → Night Drive$/.test(x)));
  assert.ok(out.includes("Added “THE REAL TIP”"));
  assert.ok(out.includes("Music turned down in 1 place"));
});

test("a change you can see somewhere in the video points at a word there", () => {
  const p = project();
  const a: Edit = { ...defaultEdit(p), keep: [{ from: "w0", to: "w12" }], broll: [] };
  const b: Edit = JSON.parse(JSON.stringify(a));
  b.broll = [{ id: "x1", anchor: { from: "w10", to: "w11" }, treatment: "text-pop", text: "TIP" }];
  b.music.automation = [{ anchor: { from: "w2", to: "w3" }, db: -6 }];
  b.captions = { ...a.captions, size: a.captions.size + 10 };
  const items = changeItems(p, a, b);
  assert.deepEqual(items.find((c) => c.text.startsWith("Added"))?.at, "w10");
  assert.deepEqual(items.find((c) => c.text.startsWith("Music turned down"))?.at, "w2");
  assert.equal(items.find((c) => c.text.startsWith("Subtitles"))?.at, undefined);   // everywhere: nowhere to jump
});
