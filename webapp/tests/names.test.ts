import assert from "node:assert/strict";
import test from "node:test";
import { namedNotShown } from "../lib/names";
import { buildTimeline } from "../lib/timeline";
import type { Word } from "../lib/types";

const say = (text: string): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.33, w }));

test("names said but not shown: apps and brands, runs of capitals, not sentence starts or common words", () => {
  const ws = say("I moved from Notion to Claude Code last Monday. Then I tried Obsidian, and Notion again.");
  const tl = buildTimeline(ws, { keep: [{ from: "w0", to: `w${ws.length - 1}` }], gapCap: 0.4 }, [30]);
  const n = namedNotShown(tl, { broll: [] });
  assert.deepEqual(n.map((x) => x.text), ["Notion", "Claude Code", "Obsidian"]);
  assert.deepEqual([n[1].from, n[1].to], ["w5", "w6"]);
  // a logo already on "Notion" covers it
  const shown = namedNotShown(tl, { broll: [{ id: "b", treatment: "card-above-head", asset: "x", anchor: { from: "w3", to: "w3" } }] });
  assert.deepEqual(shown.map((x) => x.text), ["Claude Code", "Obsidian"]);
  // a step label on screen doesn't show "Notion"; a card that spells it does
  const label = { id: "l", treatment: "text-pop", style: "label", text: "Step 1", anchor: { from: "w2", to: "w4" } };
  assert.equal(namedNotShown(tl, { broll: [label] as never })[0].text, "Notion");
  assert.notEqual(namedNotShown(tl, { broll: [{ ...label, text: "Why I left Notion" }] as never })[0].text, "Notion");
});

test("curly apostrophes don't make a name", () => {
  const ws = say("so honestly I’m moving to Notion today");
  const tl = buildTimeline(ws, { keep: [{ from: "w0", to: `w${ws.length - 1}` }], gapCap: 0.4 }, [30]);
  assert.deepEqual(namedNotShown(tl, { broll: [] }).map((x) => x.text), ["Notion"]);
});

test("a name that opens a sentence is kept whole, not cut to its second word", () => {
  const ws = say("Claude Code changed how I work. New York is where Notion started. So Figma helps. The end.");
  const tl = buildTimeline(ws, { keep: [{ from: "w0", to: `w${ws.length - 1}` }], gapCap: 0.4 }, [30]);
  assert.deepEqual(namedNotShown(tl, { broll: [] }).map((x) => x.text), ["Claude Code", "New York", "Notion", "Figma"]);
});
