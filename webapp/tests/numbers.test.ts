import assert from "node:assert/strict";
import test from "node:test";
import { applyCorrections, digits } from "../lib/text";

const say = (s: string) => digits(s.split(" ").map((t, i) => ({ id: `w${i}`, text: t, os: i, oe: i + 0.5, seg: 0 }))).map((w) => w.text).join(" ");

test("spoken numbers become digits only the way numbers are said", () => {
  assert.equal(say("twenty four hours"), "24 hours");
  assert.equal(say("two hundred fifty dollars"), "$250");
  assert.equal(say("three thousand five hundred"), "3,500");
  assert.equal(say("ninety nine percent"), "99%");
  assert.equal(say("in twenty twenty four"), "in 2024");                  // a year, no comma
  assert.equal(say("nineteen ninety five"), "1995");
  assert.equal(say("seven eleven"), "7 11");                              // never added together
  assert.equal(say("fifty fifty"), "50 50");
  assert.equal(say("ten fifteen"), "10 15");
  assert.equal(say("two, three ideas"), "2, 3 ideas");                    // a comma ends a number
  assert.equal(say("one point five million"), "one point five million"); // left as said
  assert.equal(say("one of them"), "one of them");
});

test("a correction to an accented name doesn't double its last letter", () => {
  const out = applyCorrections([{ id: "w0", text: "josé,", os: 0, oe: 0.4, seg: 0 }], [{ from: "josé", to: "José" }]);
  assert.equal(out[0].text, "José,");
});

test("short caption cues on fast speech never run into the next one", async () => {
  const { chunk } = await import("../lib/text");
  // sentence ends every word, 0.12 s apart: each cue would be held 0.3 s and overlap the next
  const cw = ["Go.", "Now.", "Fast.", "Done."].map((t, k) => ({ id: `w${k}`, text: t, os: k * 0.12, oe: k * 0.12 + 0.1, seg: 0 }));
  const cues = chunk(cw, 3);
  assert.equal(cues.length, 4);
  for (let k = 0; k + 1 < cues.length; k++) assert.ok(cues[k].end <= cues[k + 1].start, `cue ${k} ends ${cues[k].end} after ${cues[k + 1].start}`);
  assert.ok(cues[3].end >= cues[3].start + 0.3);
});
