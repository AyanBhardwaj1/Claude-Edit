import assert from "node:assert/strict";
import test from "node:test";
import { openWith, strongestLine } from "../lib/coldopen";
import { DEFAULT_MOTION } from "../lib/edit";
import { buildTimeline } from "../lib/timeline";
import type { Edit, Word } from "../lib/types";

const say = (text: string): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.33, w }));
const script = "Hi everyone. I want to share how I plan my week. I lost 4000 dollars on one bad habit. Here is the fix that works.";
const ws = say(script);
const n = ws.length - 1;
const edit = (over: Partial<Edit> = {}) => ({ keep: [{ from: "w0", to: `w${n}` }], gapCap: 0.4, zooms: [], broll: [],
  motion: DEFAULT_MOTION, captions: { enabled: true, preset: "studio", size: 105, position: 0.75, textCase: "upper", maxWords: 3, font: "Montserrat" },
  ...over }) as unknown as Edit;

test("the strongest line is the one with a number and a strong word, not the opener", () => {
  const tl = buildTimeline(ws, edit(), [30]);
  const l = strongestLine(tl)!;
  assert.equal(l.text, "I lost 4000 dollars on one bad habit.");
  assert.ok(l.why.includes("a number") && l.why.some((x) => /lost/.test(x)));
  assert.equal(strongestLine(buildTimeline(say("hello there. this is fine. ok then."), edit({ keep: [{ from: "w0", to: "w5" }] }), [10])), null);
});

test("opening with it moves the line to the front, keeps the rest in order and carries the hook title", () => {
  const hook = { id: "h", treatment: "text-pop", style: "label", tilt: 0, text: "My worst habit", anchor: { from: "w0", to: "w1" } };
  const e = edit({ broll: [hook] as never });
  const tl = buildTimeline(ws, e, [30]);
  const l = strongestLine(tl)!;
  const o = openWith(ws, e, l);
  const out = buildTimeline(ws, o, [30]).words.map((w) => w.w).join(" ");
  assert.equal(out, "I lost 4000 dollars on one bad habit. Hi everyone. I want to share how I plan my week. Here is the fix that works.");
  assert.deepEqual(o.broll[0].anchor, { from: l.ids[0], to: l.ids[3] });
  assert.equal(new Set(buildTimeline(ws, o, [30]).words.map((w) => w.id)).size, ws.length, "every word once");
  assert.equal(e.keep.length, 1, "the given edit is untouched");
});

test("a word cut inside the line stays cut when it moves", () => {
  const e = edit({ keep: [{ from: "w0", to: "w14" }, { from: "w16", to: `w${n}` }] });   // "on" (w15) cut
  const l = strongestLine(buildTimeline(ws, e, [30]))!;
  const out = buildTimeline(ws, openWith(ws, e, l), [30]).words.map((w) => w.w);
  assert.ok(!out.includes("on"));
  assert.equal(out.slice(0, 4).join(" "), "I lost 4000 dollars");
});

test("a line that leans on what came before is never picked", () => {
  const w = say("I plan my week on Sunday. Step two, I never move the camera. Then I film 5 videos in one hour.");
  const e = edit({ keep: [{ from: "w0", to: `w${w.length - 1}` }] });
  assert.equal(strongestLine(buildTimeline(w, e, [30])), null);
});

test("after opening with the best line nothing weaker is offered; a zoom crossing the line keeps its outside part", () => {
  const e = edit({ zooms: [{ anchor: { from: "w17", to: "w21" }, scale: 1.2 }] });     // "bad habit. Here is the"
  const tl = buildTimeline(ws, e, [30]);
  const l = strongestLine(tl)!;
  const o = openWith(ws, e, l);
  assert.equal(strongestLine(buildTimeline(ws, o, [30])), null);
  assert.deepEqual(o.zooms[0].anchor, { from: "w19", to: "w21" });                     // "Here is the", still in place
  const after = buildTimeline(ws, o, [30]);
  const a = after.byId.get("w19")!, b = after.byId.get("w21")!;
  assert.ok(b.oe - a.os < 2, "the zoom stays short");
});
