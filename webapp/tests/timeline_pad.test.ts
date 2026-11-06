import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline } from "../lib/timeline";
import type { Word } from "../lib/types";

const ws: Word[] = "this is really the best tip".split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.35, e: i * 0.35 + 0.3, w }));

test("a word that was cut is never heard in the air around its neighbours", () => {
  const all = buildTimeline(ws, { keep: [{ from: "w0", to: "w5" }], gapCap: 0.3 }, [10]);
  const cut = buildTimeline(ws, { keep: [{ from: "w0", to: "w1" }, { from: "w3", to: "w5" }], gapCap: 0.3 }, [10]);   // "really" out
  const really = ws[2];
  for (const sg of cut.segments) assert.ok(sg.end <= really.s + 1e-9 || sg.start >= really.e - 1e-9, `${sg.start}-${sg.end} plays "really"`);
  assert.ok(cut.duration < all.duration, `cutting a word makes the reel shorter (${cut.duration} vs ${all.duration})`);
  for (let i = 1; i < cut.segments.length; i++) assert.ok(cut.segments[i].start >= cut.segments[i - 1].end - 1e-9, "no audio played twice");
});

test("a take whose length the browser couldn't read still plays forwards", () => {
  const tl = buildTimeline(ws, { keep: [{ from: "w0", to: "w5" }], gapCap: 0.3 }, [0]);
  assert.ok(tl.duration > 0 && tl.segments.every((s) => s.end > s.start));
});
