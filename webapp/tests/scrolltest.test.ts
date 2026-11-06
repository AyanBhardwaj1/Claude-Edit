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

test("the loop: a sign-off or dead air at the end fails, a clean last word passes", async () => {
  const { loopCheck } = await import("../lib/scrolltest");
  const e = edit();
  const clean = buildTimeline(say("rent is the biggest bill you pay and here is how"), e, [10]);
  assert.ok(loopCheck(clean).ok);
  const bye = buildTimeline(say("here is how to save money thanks for watching bye now"), e, [10]);
  assert.match(loopCheck(bye).text, /sign-off/);
  const ws = [...say("rent is the biggest bill you pay and here is how"), { id: "w10", src: 0, s: 4, e: 6.5, w: " " }];   // a kept silent stretch
  const quiet = buildTimeline(ws, { ...e, keep: [{ from: "w0", to: "w10" }] }, [10]);
  assert.match(loopCheck(quiet).text, /s of nothing after the last word/);
});

test("cutting the warm-up drops the leading so/um/today and moves the hook title onto the new first word", async () => {
  const { cutWarmUp } = await import("../lib/scrolltest");
  const ws = say("so um today rent is the biggest bill you pay");
  const e = edit({ broll: [{ ...hook, anchor: { from: "w0", to: "w4" } }] as never, zooms: [{ anchor: { from: "w1", to: "w1" }, scale: 1.2 }],
    music: { asset: null, level: "under-voice", startAt: null, automation: [] } } as never);
  const r = cutWarmUp(ws, e)!;
  assert.equal(r.cut, "so um today");
  assert.deepEqual(r.edit.keep, [{ from: "w3", to: "w9" }]);
  assert.deepEqual(r.edit.broll[0].anchor, { from: "w3", to: "w4" });
  assert.deepEqual(r.edit.zooms[0].anchor, { from: "w3", to: "w3" });
  const tl = buildTimeline(ws, r.edit, [10]);
  const after = scrollTest(tl, r.edit);
  assert.ok(after.lines.find((l) => l.id === "open")!.ok);
  assert.ok(after.lines.find((l) => l.id === "hook")!.ok);
  assert.equal(e.keep[0].from, "w0", "the given edit is untouched");
  assert.equal(cutWarmUp(say("rent is the biggest bill you pay and here is how"), edit()), null);
  assert.equal(cutWarmUp(say("so um ok fine"), edit({ keep: [{ from: "w0", to: "w3" }] })), null);   // too little left
});

test("a warm-up that is a whole take keeps the next take; a hook title alone isn't the picture moving", async () => {
  const { cutWarmUp } = await import("../lib/scrolltest");
  const ws: Word[] = [{ id: "a0", src: 0, s: 0, e: 0.3, w: "Okay" }, { id: "a1", src: 0, s: 0.4, e: 0.6, w: "so" },
    ...["rent", "is", "the", "biggest", "bill"].map((w, i) => ({ id: `b${i}`, src: 1, s: i * 0.4, e: i * 0.4 + 0.3, w }))];
  const r = cutWarmUp(ws, edit({ keep: [{ from: "a0", to: "b4" }] }))!;
  assert.deepEqual(r.edit.keep, [{ from: "b0", to: "b4" }]);
  const e = edit({ broll: [{ ...hook, anchor: { from: "w1", to: "w3" } }] as never });
  const moves = scrollTest(buildTimeline(say("rent is the biggest bill you pay and here is how"), e, [10]), e).lines.find((l) => l.id === "moves")!;
  assert.equal(moves.ok, false);
});

test("a hook title cut short by the next card is too quick to read", () => {
  const ws = say("rent is the biggest bill you pay and here is how");
  const long = { ...hook, text: "The one bill you can cut by half this year" };
  const card = { id: "c", treatment: "text-pop", style: "pop", tilt: 3, text: "50%", anchor: { from: "w2", to: "w3" } };
  const e = edit({ broll: [long, card] as never, zooms: [{ anchor: { from: "w4", to: "w5" }, scale: 1.2 }] });
  const r = scrollTest(buildTimeline(ws, e, [10]), e);
  const h = r.lines.find((l) => l.id === "hook")!;
  assert.equal(h.ok, false); assert.match(h.text, /is up for 0\.\d s/); assert.match(h.fix!, /cuts it short/);
  const alone = edit({ broll: [long] as never });
  assert.ok(scrollTest(buildTimeline(ws, alone, [10]), alone).lines.find((l) => l.id === "hook")!.ok === false);   // 10 words: 2.9 s needed, up 2.0 s
  const short = edit({ broll: [hook] as never });
  assert.ok(scrollTest(buildTimeline(ws, short, [10]), short).lines.find((l) => l.id === "hook")!.ok);
});

test("cutting the warm-up moves translated subtitles onto the new first word; a card at the same start doesn't cut the hook", async () => {
  const { cutWarmUp } = await import("../lib/scrolltest");
  const ws = say("so today rent is the biggest bill you pay and");
  const e = edit({ translation: { lang: "es", lines: [{ from: "w0", to: "w4", text: "hoy el alquiler es" }, { from: "w5", to: "w9", text: "la factura" }] } } as never);
  const r = cutWarmUp(ws, e)!;
  assert.equal(r.edit.translation!.lines[0].from, "w2");
  const card = (id: string, from: string) => ({ id, treatment: "text-pop", style: "pop", tilt: 3, text: "x", anchor: { from, to: from } });
  const h = edit({ broll: [hook, card("c1", "w0"), card("c2", "w3")] as never });
  const line = scrollTest(buildTimeline(say("rent is the biggest bill you pay and here is how"), h, [10]), h).lines.find((l) => l.id === "hook")!;
  assert.ok(line.ok, line.text);
});
