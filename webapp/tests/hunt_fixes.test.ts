import assert from "node:assert/strict";
import test from "node:test";
import { planScenes } from "../lib/studio";
import { parseTags } from "../lib/text";
import { keptTranslation } from "../lib/translate";
import type { Word } from "../lib/types";

test("hashtags typed with spaces, commas or back to back come out as separate tags", () => {
  assert.deepEqual(parseTags("#reels #editing"), ["#reels", "#editing"]);
  assert.deepEqual(parseTags("#reels#editing, tips"), ["#reels", "#editing", "#tips"]);
  assert.deepEqual(parseTags("  "), []);
});

test("cutting the first word of a translated phrase keeps the line, on the next kept word", () => {
  const words: Word[] = "So today I want to show you".split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i, e: i + 0.5, w }));
  const tr = { lang: "es", lines: [{ from: "w0", to: "w3", text: "Hoy quiero" }, { from: "w4", to: "w6", text: "mostrarte" }] };
  const kept = new Set(["w1", "w2", "w3", "w4", "w5", "w6"]);
  assert.deepEqual(keptTranslation(words, tr as never, kept).lines.map((l) => [l.from, l.to]), [["w1", "w3"], ["w4", "w6"]]);
  const gone = new Set(["w4", "w5", "w6"]);
  assert.deepEqual(keptTranslation(words, tr as never, gone).lines.map((l) => l.text), ["mostrarte"]);
});

test("a long script keeps its closing call to action", () => {
  const text = Array.from({ length: 20 }, (_, i) => `Point number ${i + 1} is something worth saying.`).join(" ") + " Try it today.";
  const scenes = planScenes(text);
  assert.ok(scenes.length <= 14);
  assert.equal(scenes[scenes.length - 1].kind, "cta");
  assert.match(scenes[scenes.length - 1].text, /Try it today/);
});
