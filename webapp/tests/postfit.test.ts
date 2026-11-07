import assert from "node:assert/strict";
import test from "node:test";
import { postFit } from "../lib/postfit";

test("a normal post fits every app, and shows what people see before 'more'", () => {
  const r = postFit("One habit doubled my posting.\nHere's how I batch a week of reels in an hour.", ["#reels", "#creator"]);
  assert.ok(r.fits.every((f) => f.ok));
  assert.equal(r.fits[2].text, "first line, 29 of 100");
  assert.equal(r.cut, false);
});

test("too long, too many hashtags, a long first line: each says which app and why", () => {
  const long = "x".repeat(2300);
  const r = postFit(long, Array.from({ length: 31 }, (_, i) => `#t${i}`));
  assert.deepEqual(r.fits.map((f) => f.ok), [false, true, false]);
  assert.match(r.fits[0].text, /31 hashtags/);
  assert.equal(r.shown.length, 125);
  assert.equal(r.cut, true);
  assert.equal(postFit("🎬".repeat(10), []).fits[0].text, "10 of 2,200 characters");   // an emoji counts as one
});

test("the count is of the text that's shared, credits included", () => {
  const r = postFit("x".repeat(2150), ["#a"], "x".repeat(2150) + "\n\nPhoto credits: " + "y".repeat(80) + "\n\n#a");
  assert.equal(r.fits[0].ok, false);
});
