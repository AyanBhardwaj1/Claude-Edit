import assert from "node:assert/strict";
import test from "node:test";
import { analyze } from "../lib/analyze";
import { pickTake, takeLines, withTake } from "../lib/takes";
import { defaultEdit } from "../lib/edit";
import { buildTimeline, spanOf } from "../lib/timeline";
import type { Project, Range, Word } from "../lib/types";

const words = (text: string, t0: number, start: number): Word[] =>
  text.split(" ").map((w, i) => ({ id: `w${start + i}`, src: 0, s: +(t0 + i * 0.4).toFixed(3), e: +(t0 + i * 0.4 + 0.3).toFixed(3), w }));

function project(): Project {
  const ws = [...words("um so the best way to edit a reel is this.", 0, 0),
    ...words("the best way to edit a reel is this one.", 6, 11),
    ...words("you add the captions after the cut.", 11, 21)];
  return { id: "p", title: "t", words: ws, library: [], versions: [], sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 20, width: 1080, height: 1920 }],
    analysis: analyze(ws) } as unknown as Project;
}
const text = (p: Project, keep: Range[]) => {
  const idx = new Map(p.words.map((w, i) => [w.id, i])); const out: string[] = [];
  for (const r of keep) for (let i = idx.get(r.from)!; i <= idx.get(r.to)!; i++) out.push(p.words[i].w);
  return out.join(" ");
};

test("each line said twice lists its takes and which one plays", () => {
  const p = project();
  const keep = p.analysis!.defaultKeep;
  const lines = takeLines(p, keep);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].takes.length, 2);
  assert.equal(lines[0].playing, 1);                                 // the last complete take
  assert.equal(text(p, keep), "the best way to edit a reel is this one. you add the captions after the cut.");
});

test("picking the other take plays it in the same place, without its 'um', and back again", () => {
  const p = project();
  const L = takeLines(p, p.analysis!.defaultKeep)[0];
  const k1 = withTake(p, p.analysis!.defaultKeep, L, 0);
  assert.equal(text(p, k1), "so the best way to edit a reel is this. you add the captions after the cut.");
  assert.equal(takeLines(p, k1)[0].playing, 0);
  const k2 = withTake(p, k1, takeLines(p, k1)[0], 1);
  assert.equal(text(p, k2), text(p, p.analysis!.defaultKeep));
});

test("a take keeps its place in a re-ordered cut (a cold open stays first)", () => {
  const p = project();
  const cold: Range[] = [{ from: "w21", to: "w27" }, { from: "w11", to: "w20" }];       // the last line opens
  const L = takeLines(p, cold)[0];
  assert.equal(text(p, withTake(p, cold, L, 0)), "you add the captions after the cut. so the best way to edit a reel is this.");
});

test("when no take plays, the picked one goes back where it was filmed", () => {
  const p = project();
  const none: Range[] = [{ from: "w21", to: "w27" }];
  const L = takeLines(p, none)[0];
  assert.equal(L.playing, -1);
  assert.equal(text(p, withTake(p, none, L, 1)), "the best way to edit a reel is this one. you add the captions after the cut.");
});

test("what's placed on the line moves to the picked take: the hook title still shows", () => {
  const p = project();
  const e = { ...defaultEdit(p), keep: p.analysis!.defaultKeep };
  e.broll = [{ id: "h", anchor: { from: "w11", to: "w14" }, treatment: "text-pop", style: "label", tilt: 0, text: "Hook" } as never];
  e.zooms = [{ anchor: { from: "w18", to: "w20" }, scale: 1.2 }];
  e.cover = { word: "w12", text: "" };
  const L = takeLines(p, e.keep)[0];
  const next = pickTake(p, e, L, 0);
  // take 1 is "um so the best way …" (w0-w10): its trimmed words start at w1 ("so")
  assert.deepEqual(next.broll[0].anchor, { from: "w1", to: "w4" });
  assert.deepEqual(next.zooms[0].anchor, { from: "w8", to: "w10" });
  assert.equal(next.cover.word, "w2");
  const tl = buildTimeline(p.words, next, [20]);
  assert.ok(spanOf(tl, next.broll[0].anchor), "the hook title has a place in the new cut");
  assert.notEqual(e.broll[0].anchor.from, next.broll[0].anchor.from);   // the old edit is untouched
});

test("a bleep on the old take bleeps the swear in the picked one", () => {
  const ws = [..."so this shit is the best way to edit.".split(" "), ..."this shit is the best way to edit a reel.".split(" ")]
    .map((w, i) => ({ id: `w${i}`, src: 0, s: i < 9 ? i * 0.4 : 5 + (i - 9) * 0.4, e: (i < 9 ? i * 0.4 : 5 + (i - 9) * 0.4) + 0.3, w }));
  const p = { id: "p", words: ws, library: [], versions: [], sources: [{ id: 0, name: "a", mediaKey: "k", duration: 12, width: 1080, height: 1920 }],
    analysis: analyze(ws) } as unknown as Project;
  const e = { ...defaultEdit(p), keep: p.analysis!.defaultKeep, bleeps: ["w10"] };
  const L = takeLines(p, e.keep)[0];
  const next = pickTake(p, e, L, 0);
  assert.ok(next.bleeps!.includes("w2"), JSON.stringify(next.bleeps));
});
