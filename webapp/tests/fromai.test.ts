import assert from "node:assert/strict";
import test from "node:test";
import { defaultEdit, fromAi } from "../lib/edit";
import type { AiEdit } from "../lib/edit";
import type { Project, Word } from "../lib/types";

const words: Word[] = Array.from({ length: 12 }, (_, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.3, w: `x${i}` }));
const p = { id: "p", title: "t", words, library: [], versions: [], sources: [{ id: 0, name: "a", mediaKey: "k", duration: 10, width: 1080, height: 1920 }] } as unknown as Project;
const base = { ...defaultEdit(p), keep: [{ from: "w0", to: "w11" }] };

test("overlapping keep ranges play each word once, in the order given (a cold open stays first)", () => {
  const { edit } = fromAi(p, base, { keep: [{ from: "w8", to: "w9" }, { from: "w0", to: "w5" }, { from: "w3", to: "w9" }] } as AiEdit);
  assert.deepEqual(edit.keep, [{ from: "w8", to: "w9" }, { from: "w0", to: "w5" }, { from: "w6", to: "w7" }]);
});

test("a wrongly shaped answer is tidied, not a crash; null means not given", () => {
  const weird = { keep: { from: "w0", to: "w3" }, labels: [null, { from: "w1", to: "w2", text: 42 }], gapCap: null,
    captions: { size: null, position: null }, post: { caption: 7, hashtags: "#one #two three, four five" },
    cover: { text: 99 }, corrections: [{ from: 1, to: "one" }], music: { automation: [null] } } as unknown as AiEdit;
  const { edit } = fromAi(p, base, weird);
  assert.equal(edit.gapCap, base.gapCap);
  assert.equal(edit.captions.size, base.captions.size);
  assert.equal(edit.captions.position, base.captions.position);
  assert.deepEqual(edit.post.hashtags, ["#one", "#two", "#three", "#four", "#five"]);
  assert.equal(edit.post.caption, "7");
  assert.ok(edit.broll.some((b) => b.text === "42"));
  assert.deepEqual(edit.keep, base.keep);                                  // keep wasn't a list: kept the previous cut
});
