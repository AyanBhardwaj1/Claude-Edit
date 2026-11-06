import assert from "node:assert/strict";
import test from "node:test";
import { chapterMarks, chapterText } from "../lib/chapters";
import { buildTimeline } from "../lib/timeline";
import type { Word } from "../lib/types";

// 4 minutes of talk: a sentence of 10 words every 5 s
const words: Word[] = [];
for (let s = 0; s < 48; s++) "so this is the next part of what I learned.".split(" ").forEach((w, i) =>
  words.push({ id: `w${words.length}`, src: 0, s: s * 5 + i * 0.4, e: s * 5 + i * 0.4 + 0.33, w: i === 6 ? `${w}${s}` : w }));

test("about one chapter a minute, at sentence starts, YouTube's rules kept", () => {
  const tl = buildTimeline(words, { keep: [{ from: "w0", to: `w${words.length - 1}` }], gapCap: 1.5 }, [300]);
  const chs = chapterMarks(tl);
  assert.equal(chs.length, Math.round(tl.duration / 60));
  assert.equal(chs[0].at, 0); assert.equal(chs[0].title, "Intro");
  assert.ok(chs.slice(1).every((c) => /^This is the next part of/.test(c.title)), JSON.stringify(chs));
  const text = chapterText(chs, tl.duration);
  assert.match(text, /^0:00 Intro\n\d:\d\d This is/);
  assert.equal(chapterMarks(buildTimeline(words.slice(0, 50), { keep: [{ from: "w0", to: "w49" }], gapCap: 1.5 }, [30])).length, 0);   // under a minute
  assert.equal(chapterText(chs.slice(0, 2), tl.duration), "");
});
