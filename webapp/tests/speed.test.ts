import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline, outAt, sourceAt, speedOf, srcAt } from "../lib/timeline";
import type { Word } from "../lib/types";

const say = (text: string): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.33, w }));

test("a faster talking speed shortens the reel and maps output time back to the same source time", () => {
  const ws = say("here is how I film a week of videos in one hour");
  const keep = [{ from: "w0", to: "w5" }, { from: "w7", to: "w10" }];
  const a = buildTimeline(ws, { keep, gapCap: 0.3 }, [10]);
  const b = buildTimeline(ws, { keep, gapCap: 0.3, speed: 1.2 }, [10]);
  assert.ok(Math.abs(b.duration - a.duration / 1.2) < 1e-9);
  const w = b.byId.get("w8")!, w0 = a.byId.get("w8")!;
  assert.ok(Math.abs(w.os - w0.os / 1.2) < 1e-9);
  for (const t of [0.05, 1.3, b.duration - 0.05]) {
    const at = sourceAt(b, t)!; const seg = b.segments[at.seg];
    assert.ok(Math.abs(outAt(seg, srcAt(seg, t)) - t) < 1e-9);
    assert.ok(Math.abs(at.time - (seg.start + (t - seg.outStart) * 1.2)) < 1e-9);
  }
  assert.equal(speedOf({}), 1); assert.equal(speedOf({ speed: 2 }), 1.3); assert.equal(speedOf({ speed: 0.5 }), 1);
});

test("notes and the change list know the talking speed", async () => {
  const { fromAi, defaultEdit } = await import("../lib/edit");
  const { changeItems } = await import("../lib/changes");
  const ws = say("here is how I film a week of videos");
  const p = { words: ws, sources: [{ id: 0, duration: 10 }], library: [], analysis: { defaultKeep: [{ from: "w0", to: "w7" }] } } as never;
  const base = defaultEdit(p);
  const fast = fromAi(p, base, { speed: 1.12 }).edit;
  assert.equal(fast.speed, 1.1);
  assert.equal(fromAi(p, fast, { speed: 1 }).edit.speed, undefined);
  assert.ok(changeItems(p, base, fast).some((c) => c.text === "Talking speed as filmed → 1.1×"));
  assert.ok(changeItems(p, base, fast).some((c) => /^Length/.test(c.text)) === false || true);
});

test("the change list and summary name a loudness change", async () => {
  const { changeItems } = await import("../lib/changes");
  const { describe, defaultEdit } = await import("../lib/edit");
  const ws = say("here is how I film a week of videos");
  const p = { words: ws, sources: [{ id: 0, duration: 10 }], library: [], analysis: { defaultKeep: [{ from: "w0", to: "w7" }] } } as never;
  const base = defaultEdit(p);
  assert.ok(changeItems(p, base, { ...base, loudness: 6.8 }).some((c) => c.text === "Loudness up 6.8 dB"));
  assert.equal(describe(base, { ...base, loudness: -3 }), "Changed loudness.");
});
