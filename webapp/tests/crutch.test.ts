import assert from "node:assert/strict";
import test from "node:test";
import { crutches, cutWords } from "../lib/crutch";
import type { Project, Range, Word } from "../lib/types";

function project(text: string): Project {
  const ws: Word[] = text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: +(i * 0.4).toFixed(3), e: +(i * 0.4 + 0.3).toFixed(3), w }));
  return { id: "p", words: ws, sources: [{ id: 0 }] } as unknown as Project;
}
const all = (p: Project): Range[] => [{ from: "w0", to: `w${p.words.length - 1}` }];
const said = (p: Project, keep: Range[]) => {
  const idx = new Map(p.words.map((w, i) => [w.id, i])); const out: string[] = [];
  for (const r of keep) for (let i = idx.get(r.from)!; i <= idx.get(r.to)!; i++) out.push(p.words[i].w);
  return out.join(" ");
};

test("habit words are found only in the forms safe to drop", () => {
  const p = project("So basically, you know, it's literally the best. Do you know why? It actually works, and, like, I mean, try it. I like it.");
  const found = Object.fromEntries(crutches(p, all(p)).map((c) => [c.name, c.hits.length]));
  assert.deepEqual(found, { basically: 1, "you know": 1, literally: 1, like: 1, "I mean": 1 });   // not "do you know", "actually works", "I like it"
});

test("cutting them all keeps the rest in order, a re-ordered cut included", () => {
  const p = project("Basically, this is literally it. Then the end.");
  const keep: Range[] = [{ from: "w5", to: "w7" }, { from: "w0", to: "w4" }];
  const ids = crutches(p, keep).flatMap((c) => c.hits.flat());
  assert.equal(said(p, cutWords(p, keep, ids)), "Then the end. this is it.");
});

test("only words the cut plays are counted", () => {
  const p = project("Basically, this is it. Honestly, the end.");
  const found = crutches(p, [{ from: "w4", to: "w6" }]).map((c) => c.name);
  assert.deepEqual(found, ["honestly"]);
});

test("find a word or phrase, then cut or bring back every place it's said", async () => {
  const { findWords, restoreWords } = await import("../lib/crutch");
  const p = project("Subscribe now. Then the end. Please subscribe now, okay?");
  assert.deepEqual(findWords(p, "subscribe now").map((h) => h.join(",")), ["w0,w1", "w6,w7"]);
  assert.deepEqual(findWords(p, "SUB").length, 2);                    // the start of a word, any case
  assert.deepEqual(findWords(p, "  "), []);
  const keep: Range[] = [{ from: "w2", to: "w4" }, { from: "w0", to: "w1" }, { from: "w5", to: "w8" }];   // re-ordered
  const ids = findWords(p, "subscribe now").flat();
  const cut = cutWords(p, keep, ids);
  assert.equal(said(p, cut), "Then the end. Please okay?");
  assert.equal(said(p, restoreWords(p, cut, ids)), "Subscribe now. Then the end. Please subscribe now, okay?");   // w0-w1 had no neighbour left: back in filmed order
  assert.equal(said(p, restoreWords(p, cut, ["w6", "w7"])), "Then the end. Please subscribe now, okay?");
});
