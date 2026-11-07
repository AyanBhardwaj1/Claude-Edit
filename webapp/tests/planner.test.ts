import assert from "node:assert/strict";
import test from "node:test";
import { chunkLong, planScenes, sentencesOf } from "../lib/studio";
import { voicedDuration } from "../lib/studioAi";

test("sentences break after a full stop and a space, not inside addresses, numbers or abbreviations", () => {
  assert.deepEqual(sentencesOf("Title. Visit example.com today."), ["Title.", "Visit example.com today."]);
  assert.deepEqual(sentencesOf("The e.g. thing is 3.5% better. Done!"), ["The e.g. thing is 3.5% better.", "Done!"]);
  assert.deepEqual(sentencesOf('He said "stop." Then left'), ['He said "stop."', "Then left"]);
  assert.ok(planScenes("Title. Visit example.com today.").every((sc) => !/^com\b/.test(sc.text)));
});

test("a very long sentence becomes readable cards", () => {
  const long = Array.from({ length: 60 }, (_, i) => `word${i}${i % 12 === 11 ? "," : ""}`).join(" ") + ".";
  const parts = chunkLong(long);
  assert.ok(parts.length >= 4 && parts.every((x) => x.split(" ").length <= 16), JSON.stringify(parts.map((x) => x.split(" ").length)));
  assert.equal(parts.join(" "), long);
  assert.deepEqual(chunkLong("Short and sweet."), ["Short and sweet."]);
});

test("a scene lasts as long as its voice", () => {
  const sc = { id: "s", kind: "statement", text: "Hi", duration: 3 } as never;
  assert.equal(voicedDuration(sc, 20), 20.6);
});
