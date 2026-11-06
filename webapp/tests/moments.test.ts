import assert from "node:assert/strict";
import test from "node:test";
import { anchorSpoken, momentsText, noteTimes } from "../lib/moments";
import { buildTimeline } from "../lib/timeline";
import type { Word } from "../lib/types";

const words = (text: string, step = 0.5): Word[] =>
  text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: +(i * step).toFixed(3), e: +(i * step + 0.4).toFixed(3), w }));

test("times in a note: clock, decimals and seconds, no duplicates, no false hits", () => {
  assert.deepEqual(noteTimes("at 0:12 the music is too loud"), [12]);
  assert.deepEqual(noteTimes("cut 1:05.5 and also at 30s, then 30 seconds again"), [65.5, 30]);
  assert.deepEqual(noteTimes("show the 20 bucks label, 3 steps"), []);
  assert.deepEqual(noteTimes("the zoom at 4 sec"), [4]);
  assert.deepEqual(noteTimes("at 1m23s the logo covers me"), [83]);
});

test("what the edited video has at a note's time: the words with ids, pictures and zooms on screen", () => {
  const ws = words("this app saves you twenty bucks every single month if you cook at home");
  const keep = [{ from: "w0", to: "w13" }];
  const tl = buildTimeline(ws, { keep, gapCap: 0.3 }, [60]);
  const t = tl.byId.get("w5")!.os + 0.1;                 // "bucks"
  const note = `at 0:0${Math.floor(t)} put the price on screen`;
  const e = { broll: [{ id: "b1", anchor: { from: "w4", to: "w6" }, treatment: "text-pop" as never, text: "$20" }],
    zooms: [{ anchor: { from: "w9", to: "w11" }, scale: 1.2 }] };
  const out = momentsText(tl, e, note);
  assert.match(out, /AT 0:0\d/);
  assert.match(out, /w4:twenty/);
  assert.match(out, /picture b1 \(text-pop, "\$20"\) on w4-w6/);
  assert.doesNotMatch(out, /zoom/);
  assert.equal(momentsText(tl, e, "make it punchier"), "");
  assert.equal(momentsText(tl, e, "at 9:00 cut it"), "");   // past the end: nothing to point at
});

test("a spoken note about 'here' gets the player's time; one with its own time or no 'here' is left alone", () => {
  assert.equal(anchorSpoken("Cut this part", 12.4), "At 0:12, cut this part");
  assert.equal(anchorSpoken("The music is too loud here", 75), "At 1:15, the music is too loud here");
  assert.equal(anchorSpoken("At 0:30 cut this part", 12), "At 0:30 cut this part");
  assert.equal(anchorSpoken("Make the captions bigger", 12), "Make the captions bigger");
  assert.equal(anchorSpoken("Where is the logo", 12), "Where is the logo");                 // "where" isn't "here"
});
