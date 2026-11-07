import assert from "node:assert/strict";
import test from "node:test";
import { saidIn } from "../lib/search";
import type { Project } from "../lib/types";

const p = { id: "p", title: "Tuesday", words: "So I moved all my notes from Notion to Obsidian last week and Notion felt slow".split(" ")
  .map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.5, e: i * 0.5 + 0.4, w })) } as unknown as Project;

test("a video is found by what was said, with the words around the first place and a count", () => {
  const r = saidIn(p, "notion")!;
  assert.equal(r.match, "Notion");
  assert.equal(r.before, "all my notes from");
  assert.equal(r.after, "to Obsidian last week");
  assert.equal(r.count, 2);
  assert.equal(r.at, 3.5);
  assert.equal(saidIn(p, "moved all")!.match, "moved all");
  assert.equal(saidIn(p, "figma"), null);
  assert.equal(saidIn(p, "  "), null);
});

test("curly and straight apostrophes match each other", () => {
  const q = { id: "q", title: "t", words: "I don't think so".split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i, e: i + 0.5, w })) } as unknown as Project;
  assert.equal(saidIn(q, "don’t")!.match, "don't");
});

test("searching 50 long videos stays quick after the first keystroke", () => {
  const big = Array.from({ length: 50 }, (_, k) => ({ id: `p${k}`, title: "t", words: Array.from({ length: 20000 }, (_, i) =>
    ({ id: `w${i}`, src: 0, s: i, e: i + 0.5, w: ["the", "best", "way", "to", "edit"][i % 5] })) })) as unknown as Project[];
  for (const p of big) saidIn(p, "x");                                   // the first keystroke bares each transcript once
  const t0 = performance.now();
  for (const q of ["e", "ed", "edi", "edit"]) for (const p of big) saidIn(p, q);
  assert.ok(performance.now() - t0 < 2500, `${performance.now() - t0} ms`);
});
