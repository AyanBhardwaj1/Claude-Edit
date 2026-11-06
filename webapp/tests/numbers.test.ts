import assert from "node:assert/strict";
import test from "node:test";
import { digits } from "../lib/text";

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
