import assert from "node:assert/strict";
import test from "node:test";
import { attention, spotsNote, zoomsFor } from "../lib/attention";
import { noteTimes } from "../lib/moments";
import { defaultEdit } from "../lib/edit";
import { DEFAULT_MOTION } from "../lib/edit";
import { buildTimeline } from "../lib/timeline";
import type { Word } from "../lib/types";

// 24 words at a brisk 0.4 s each (150 wpm), then a 2 s pause, then 6 more words
const words: Word[] = [
  ...Array.from({ length: 24 }, (_, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.33, w: `word${i}` })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `w${24 + i}`, src: 0, s: 11.6 + i * 0.4, e: 11.6 + i * 0.4 + 0.33, w: `late${i}` })),
];
const still = { ...DEFAULT_MOTION, transition: "none" as const };
const tl = buildTimeline(words, { keep: [{ from: "w0", to: "w29" }], gapCap: 5 }, [20]);   // keep the pause

test("a long stretch with nothing new on screen is the weakest spot, and a zoom there fixes it", () => {
  const a = attention(tl, { broll: [], zooms: [], motion: still });
  assert.equal(a.risk.length, Math.ceil(tl.duration / 0.5));
  assert.equal(a.risk[0], 0);                                         // the opening is fresh
  assert.equal(a.spots[0].cause, "still");
  assert.match(a.spots[0].text, /s of the same picture/);
  const zoomed = attention(tl, { broll: [], zooms: [{ anchor: { from: "w8", to: "w9" }, scale: 1.2 }, { anchor: { from: "w16", to: "w17" }, scale: 1.2 },
    { anchor: { from: "w24", to: "w25" }, scale: 1.2 }], motion: still });
  assert.ok(Math.max(...zoomed.risk.slice(0, 18)) < 0.55, "fresh pictures every ~3 s keep the first part calm");
});

test("dead air is named as such", () => {
  const busy = attention(tl, { broll: [], zooms: Array.from({ length: 10 }, (_, i) => ({ anchor: { from: `w${i * 3}`, to: `w${i * 3}` }, scale: 1.1 })), motion: still });
  const quiet = busy.spots.find((s) => s.cause === "quiet");
  assert.ok(quiet, JSON.stringify(busy.spots));
  assert.ok(quiet!.from >= 9 && quiet!.to <= 12.2, `${quiet!.from}-${quiet!.to}`);
  assert.match(quiet!.text, /with nothing said/);
});

test("an empty timeline has no risk and no spots", () => {
  const empty = buildTimeline([], { keep: [], gapCap: 0.3 }, []);
  assert.deepEqual(attention(empty, { broll: [], zooms: [], motion: still }), { step: 0.5, risk: [], spots: [] });
});

test("Add zooms there turns a same-picture spot calm, on the words said there", () => {
  const e = { ...defaultEdit({ words, sources: [{ duration: 20 }], library: [] } as never), keep: [{ from: "w0", to: "w29" }], gapCap: 5, broll: [], zooms: [], motion: still };
  const before = attention(tl, e);
  const spot = before.spots.find((s) => s.cause === "still")!;
  const fixed = zoomsFor(tl, e, spot)!;
  assert.ok(fixed.zooms.length >= 2, String(fixed.zooms.length));
  for (const z of fixed.zooms) assert.ok(tl.byId.get(z.anchor.from)!.os >= spot.from - 0.01);
  const after = attention(tl, fixed);
  assert.ok(!after.spots.some((s) => s.cause === "still" && s.from <= spot.from + 1), JSON.stringify(after.spots));
  assert.equal(zoomsFor(tl, e, { ...spot, cause: "quiet" }), null);
});

test("the weak spots become a timed note the editor can pin to the words", () => {
  const note = spotsNote([{ from: 5, to: 23.4, cause: "still", risk: 1, text: "23 s of the same picture", fix: "" },
    { from: 61, to: 63, cause: "quiet", risk: 0.7, text: "2.0 s with nothing said", fix: "" }]);
  assert.match(note, /^Viewers may drift at 0:05 to 0:23 \(the same picture for 18 seconds\); and at 1:01 to 1:03 \(nothing said for 2 seconds\)\./);
  assert.deepEqual(noteTimes(note), [5, 23, 61, 63]);
});
