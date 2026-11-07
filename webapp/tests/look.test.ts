import assert from "node:assert/strict";
import test from "node:test";
import { defaultEdit } from "../lib/edit";
import { lookOf, lookSummary, wears, withLook } from "../lib/look";
import type { Project } from "../lib/types";

const p = { id: "p", words: [{ id: "w0", src: 0, s: 0, e: 0.4, w: "hi" }], library: [{ key: "song", name: "s", kind: "music" }], versions: [],
  sources: [{ id: 0, name: "a", mediaKey: "k", duration: 5, width: 1080, height: 1920 }] } as unknown as Project;

test("a look carries subtitles, motion and pace, never the cut, pictures or post", () => {
  const mine = defaultEdit(p);
  mine.captions = { ...mine.captions, preset: "bold", maxWords: 1, textCase: "lower" };
  mine.gapCap = 0.1; mine.speed = 1.2; mine.music.level = "quiet";
  const look = lookOf(mine);
  const other = { ...defaultEdit(p), keep: [{ from: "w0", to: "w0" }], post: { caption: "mine", hashtags: ["#x"], keywords: [] } };
  const worn = withLook(other, look);
  assert.equal(worn.captions.preset, "bold"); assert.equal(worn.captions.maxWords, 1); assert.equal(worn.gapCap, 0.1);
  assert.equal(worn.speed, 1.2); assert.equal(worn.music.level, "quiet"); assert.equal(worn.music.asset, "song");
  assert.equal(worn.post.caption, "mine"); assert.deepEqual(worn.keep, other.keep);
  assert.ok(wears(worn, look)); assert.ok(!wears(other, look));
  assert.match(lookSummary(look), /bold subtitles, lower case, 1 word at a time/);
  worn.captions.size = 1; assert.equal(look.captions.size, mine.captions.size);         // the saved look isn't shared by reference
});

test("a look still matches after the server reorders its keys", () => {
  const e = defaultEdit(p);
  const look = lookOf(e);
  const reorder = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort((a, b) => a.length - b.length || a.localeCompare(b)).map((k) => [k, o[k]]));
  const back = { ...look, captions: reorder(look.captions) as never, motion: reorder(look.motion) as never };
  assert.ok(wears(e, back));
  assert.match(lookSummary({ ...look, captions: { ...look.captions, preset: "boxed" } }), /a phrase at a time/);
});
