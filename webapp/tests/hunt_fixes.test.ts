import assert from "node:assert/strict";
import test from "node:test";
import { planScenes } from "../lib/studio";
import { parseTags } from "../lib/text";
import { translatedCues } from "../lib/translate";
import { buildTimeline } from "../lib/timeline";
import type { Word } from "../lib/types";

test("hashtags typed with spaces, commas or back to back come out as separate tags", () => {
  assert.deepEqual(parseTags("#reels #editing"), ["#reels", "#editing"]);
  assert.deepEqual(parseTags("#reels#editing, tips"), ["#reels", "#editing", "#tips"]);
  assert.deepEqual(parseTags("  "), []);
});

test("a translated line follows its kept words: cut its first word, bring it back, cut it all", () => {
  const words: Word[] = "So today I want to show you".split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i, e: i + 0.5, w }));
  const tr = { lang: "es", lines: [{ from: "w0", to: "w3", text: "Hoy quiero" }, { from: "w4", to: "w6", text: "mostrarte" }] };
  const cues = (keep: { from: string; to: string }[]) => translatedCues(words, tr as never, buildTimeline(words, { keep, gapCap: 0.4 }, [10]));
  assert.deepEqual(cues([{ from: "w0", to: "w6" }]).map((c) => c.from), ["w0", "w4"]);
  assert.deepEqual(cues([{ from: "w1", to: "w6" }]).map((c) => [c.from, c.text]), [["w1", "Hoy quiero"], ["w4", "mostrarte"]]);
  assert.deepEqual(cues([{ from: "w0", to: "w3" }]).map((c) => c.text), ["Hoy quiero"]);              // its words all cut: no line
  assert.deepEqual(cues([{ from: "w0", to: "w6" }]).length, 2);                                       // and back again
});

test("a long script keeps its closing call to action", () => {
  const text = Array.from({ length: 20 }, (_, i) => `Point number ${i + 1} is something worth saying.`).join(" ") + " Try it today.";
  const scenes = planScenes(text);
  assert.ok(scenes.length <= 14);
  assert.equal(scenes[scenes.length - 1].kind, "cta");
  assert.match(scenes[scenes.length - 1].text, /Try it today/);
});

test("the scene planner keeps decimals inside a sentence", async () => {
  const { planScenes } = await import("../lib/studio");
  const scenes = planScenes("My engagement rate hit 2.25% this month. Version 2.0 ships Friday.");
  assert.ok(scenes.some((s) => /2\.25%/.test(s.text) || s.value === 2.25), JSON.stringify(scenes.map((s) => [s.kind, s.text, s.value])));
  assert.ok(!scenes.some((s) => /^25%/.test(s.text)));
});
