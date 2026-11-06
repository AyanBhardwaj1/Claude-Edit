import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MOTION } from "../lib/edit";
import { scrollTest } from "../lib/scrolltest";
import { buildTimeline } from "../lib/timeline";
import type { Edit, Word } from "../lib/types";

const say = (text: string, start = 0): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: start + i * 0.4, e: start + i * 0.4 + 0.33, w }));
const edit = (over: Partial<Edit> = {}) => ({
  keep: [{ from: "w0", to: "w9" }], gapCap: 0.4, zooms: [], broll: [], motion: { ...DEFAULT_MOTION, transition: "none" },
  captions: { enabled: true, preset: "studio", size: 105, position: 0.75, textCase: "upper", maxWords: 3, font: "Montserrat" }, ...over,
}) as unknown as Edit;
const hook = { id: "h", treatment: "text-pop", style: "label", tilt: 0, text: "Stop paying for this", anchor: { from: "w0", to: "w3" } };

test("a reel with no hook, a still shot and a warm-up opener fails the scroll test, with fixes", () => {
  const ws = say("so today I want to talk about saving money on rent");
  const e = edit({ captions: { ...edit().captions, enabled: false } });
  const r = scrollTest(buildTimeline(ws, e, [10]), e);
  assert.equal(r.passed, 0);
  assert.ok(r.lines.every((l) => l.fix));
  assert.match(r.lines.find((l) => l.id === "open")!.text, /“so”/);
});

test("hook title from the first word, subtitles, a zoom and a strong opener pass", () => {
  const ws = say("rent is the biggest bill you pay and here is how");
  const e = edit({ broll: [hook] as never, zooms: [{ anchor: { from: "w4", to: "w5" }, scale: 1.2 }] });
  const r = scrollTest(buildTimeline(ws, e, [10]), e);
  assert.equal(r.passed, 4, JSON.stringify(r.lines));
  assert.match(r.lines[0].text, /Stop paying for this/);
});

test("the first word is timed on the edited reel, not the raw clip", () => {
  const ws = say("rent is the biggest bill you pay and here is how", 5);   // 5 s of silence in the raw clip, cut away
  const e = edit({ broll: [hook] as never });
  const r = scrollTest(buildTimeline(ws, e, [15]), e);
  assert.ok(r.lines.find((l) => l.id === "read")!.ok);
});
