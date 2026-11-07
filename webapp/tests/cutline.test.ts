import assert from "node:assert/strict";
import test from "node:test";
import { clipsOf, deleteClip, moveClip, nudgeLayer, splitAt, trimClip, trimToTime } from "../lib/cutline";
import { buildTimeline } from "../lib/timeline";
import type { Edit, Project, Word } from "../lib/types";

const say = (text: string): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: +(i * 0.5).toFixed(3), e: +(i * 0.5 + 0.4).toFixed(3), w }));
const P = { id: "p", words: say("one two three four five six seven eight nine ten"), sources: [{ id: 0, duration: 10 }] } as unknown as Project;
const base = (keep = [{ from: "w0", to: "w9" }]) => ({ keep, gapCap: 0.4, speed: 1, broll: [{ id: "b", anchor: { from: "w2", to: "w3" }, treatment: "text-pop", text: "Hi" }],
  zooms: [{ anchor: { from: "w6", to: "w6" }, scale: 1.2 }] }) as unknown as Edit;
const tlOf = (e: Edit) => buildTimeline(P.words, e, [10]);
const said = (e: Edit) => tlOf(e).words.map((w) => w.w).join(" ");

test("split at the playhead makes two clips that play the same", () => {
  const e = base();
  const s = splitAt(P, e, tlOf(e), tlOf(e).byId.get("w4")!.os + 0.05)!;
  assert.deepEqual(s.keep, [{ from: "w0", to: "w3" }, { from: "w4", to: "w9" }]);
  assert.equal(said(s), said(e));
  assert.equal(splitAt(P, s, tlOf(s), tlOf(s).byId.get("w4")!.os - 0.01), null);   // already split there
  assert.equal(clipsOf(P, s, tlOf(s)).length, 2);
});

test("delete and move clips; the last clip stays", () => {
  const e = { ...base(), keep: [{ from: "w0", to: "w3" }, { from: "w4", to: "w6" }, { from: "w7", to: "w9" }] };
  assert.equal(said(deleteClip(P, e, 1)!), "one two three four eight nine ten");
  assert.equal(said(moveClip(e, 2, 0)!), "eight nine ten one two three four five six seven");
  assert.equal(deleteClip(P, base(), 0), null);
  assert.equal(moveClip(e, 0, 0), null);
});

test("deleting a clip keeps what's anchored on its edge words", () => {
  const e = { ...base(), keep: [{ from: "w0", to: "w2" }, { from: "w3", to: "w9" }] };
  const d = deleteClip(P, e, 0)!;
  assert.deepEqual(d.broll[0].anchor, { from: "w3", to: "w3" });               // the text card stays, on its word still played
});

test("trim by words: within the take, never onto another clip's words", () => {
  const e = { ...base(), keep: [{ from: "w0", to: "w3" }, { from: "w6", to: "w9" }] };
  assert.deepEqual(trimClip(P, e, 0, "to", 1)!.keep[0], { from: "w0", to: "w4" });
  assert.deepEqual(trimClip(P, e, 0, "to", 5)!.keep[0], { from: "w0", to: "w5" });      // stops before w6 (clip 2 plays it)
  assert.deepEqual(trimClip(P, e, 1, "from", 2)!.keep[1], { from: "w8", to: "w9" });
  assert.equal(trimClip(P, e, 0, "from", -1), null);                                   // nothing before w0
  assert.deepEqual(trimToTime(P, e, 0, "to", P.words[5].e)!.keep[0], { from: "w0", to: "w5" });
});

test("nudge a picture by whole played words", () => {
  const e = base();
  assert.deepEqual(nudgeLayer(P, e, "broll", 0, 2)!.broll[0].anchor, { from: "w4", to: "w5" });
  assert.deepEqual(nudgeLayer(P, e, "zoom", 0, 10)!.zooms[0].anchor, { from: "w9", to: "w9" });   // clamped at the end
  assert.equal(nudgeLayer(P, e, "broll", 0, 0), null);
});

test("add text at the playhead, change its words; duplicate a clip", async () => {
  const { addText, setText, duplicateClip } = await import("../lib/cutline");
  const e = base();
  const tl = tlOf(e);
  const a = addText(P, e, tl, tl.byId.get("w3")!.os + 0.1, "  Big news ")!;
  const card = a.broll[a.broll.length - 1];
  assert.equal(card.treatment, "text-pop");
  assert.equal(card.text, "Big news");
  assert.deepEqual(card.anchor, { from: "w3", to: "w6" });
  assert.equal(addText(P, e, tl, 1, "   "), null);
  assert.equal(setText(a, a.broll.length - 1, "Bigger news")!.broll[a.broll.length - 1].text, "Bigger news");
  assert.equal(setText(a, 0, "Hi"), null);                                     // unchanged
  const d = duplicateClip({ ...e, keep: [{ from: "w0", to: "w1" }, { from: "w2", to: "w9" }] }, 0)!;
  assert.equal(said(d).split(" ").slice(0, 4).join(" "), "one two one two");
});

test("a line played twice (cold open, duplicate): each clip is its own occurrence", async () => {
  const e = { ...base(), keep: [{ from: "w7", to: "w9" }, { from: "w0", to: "w9" }] };
  const tl = tlOf(e);
  const cs = clipsOf(P, e, tl);
  assert.equal(cs.length, 2);
  assert.ok(cs[0].end <= cs[1].start + 1e-9, JSON.stringify(cs));          // one after the other, not on top of each other
  // the playhead on the second "nine" splits the second clip, not the cold open
  const nine2 = tl.words.filter((w) => w.w === "nine")[1];
  assert.deepEqual(splitAt(P, e, tl, nine2.os + 0.01)!.keep, [{ from: "w7", to: "w9" }, { from: "w0", to: "w7" }, { from: "w8", to: "w9" }]);
  // a card on the last "ten" (drawn at its last occurrence) nudged later stays at the end, not back at the start
  const c = { ...e, broll: [{ id: "x", anchor: { from: "w9", to: "w9" }, treatment: "text-pop", text: "x" }] } as unknown as Edit;
  assert.equal(nudgeLayer(P, c, "broll", 0, 1), null);                          // already the last word: it stays (was: jumped to "one")
  assert.deepEqual(nudgeLayer(P, c, "broll", 0, -1)!.broll[0].anchor, { from: "w8", to: "w8" });
});

test("a zoom at the playhead, on the word said there", async () => {
  const { addZoom } = await import("../lib/cutline");
  const e = base();
  const tl = tlOf(e);
  const z = addZoom(P, e, tl, tl.byId.get("w2")!.os + 0.05)!;
  assert.deepEqual(z.zooms[z.zooms.length - 1], { anchor: { from: "w2", to: "w4" }, scale: 1.15 });
  assert.equal(addZoom(P, e, tl, tl.duration + 1), null);
});

test("a picture from the library at the playhead, for about 2 seconds", async () => {
  const { addPicture } = await import("../lib/cutline");
  const Q = { ...P, library: [{ key: "pic1", name: "a.png", kind: "image" }, { key: "song", name: "s.m4a", kind: "music" }] } as unknown as Project;
  const e = base();
  const tl = tlOf(e);
  const n = addPicture(Q, e, tl, tl.byId.get("w1")!.os + 0.05, "pic1")!;
  const b = n.broll[n.broll.length - 1];
  assert.equal(b.asset, "pic1"); assert.equal(b.treatment, "card-above-head");
  assert.equal(b.anchor.from, "w1");
  assert.ok(tl.byId.get(b.anchor.to)!.oe - tl.byId.get("w1")!.os >= 2.0);
  assert.equal(addPicture(Q, e, tl, 0, "song"), null);                          // music isn't a picture
});
