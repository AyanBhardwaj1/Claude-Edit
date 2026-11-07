import assert from "node:assert/strict";
import test from "node:test";
import { buildTimeline } from "../lib/timeline";
import { unsureWords } from "../lib/unsure";
import type { Word } from "../lib/types";

const words: Word[] = "I edit with Clawed Code every um day and Clawed is great".split(" ")
  .map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.3, w, p: w === "Clawed" ? 0.31 : w === "um" ? 0.2 : w === "great" ? 0.55 : 0.95 }));
const tl = (keep = [{ from: "w0", to: "w11" }]) => buildTimeline(words, { keep, gapCap: 0.4 }, [10]);

test("unsure words are listed once, with the words around them, fillers left out", () => {
  const u = unsureWords(tl(), []);
  assert.deepEqual(u.map((x) => x.word), ["Clawed", "great"]);
  assert.equal(u[0].before, "I edit with");
  assert.equal(u[0].after, "Code every um");
});

test("a word already corrected, or cut, isn't listed", () => {
  assert.deepEqual(unsureWords(tl(), [{ from: "Clawed", to: "Claude" }]).map((x) => x.word), ["great"]);
  assert.deepEqual(unsureWords(tl([{ from: "w0", to: "w2" }, { from: "w11", to: "w11" }]), []).map((x) => x.word), ["great"]);
});
