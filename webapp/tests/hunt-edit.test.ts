import assert from "node:assert/strict";
import test from "node:test";
import { crutches, cutWords, keepAnchors, restoreWords } from "../lib/crutch";
import { repeats } from "../lib/fit";
import { namedNotShown } from "../lib/names";
import { buildTimeline, spanOf } from "../lib/timeline";
import { translatedCues } from "../lib/translate";
import type { Edit, Project, Range, Word } from "../lib/types";

const say = (text: string): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: +(i * 0.4).toFixed(3), e: +(i * 0.4 + 0.3).toFixed(3), w }));
const project = (text: string): Project => ({ id: "p", words: say(text), sources: [{ id: 0, duration: 60 }] }) as unknown as Project;
const all = (p: Project): Range[] => [{ from: "w0", to: `w${p.words.length - 1}` }];
const order = (p: Project, keep: Range[]) => buildTimeline(p.words, { keep, gapCap: 0.4, speed: 1 } as Edit, [60]).words.map((w) => w.w).join(" ");

test("a word clicked off or on keeps a cold open where it is", () => {
  const p = project("Hi everyone. I lost 4000 dollars. Here is why.");
  const cold: Range[] = [{ from: "w2", to: "w5" }, { from: "w0", to: "w1" }, { from: "w6", to: "w8" }];
  const cut = cutWords(p, cold, ["w1"]);
  assert.equal(order(p, cut), "I lost 4000 dollars. Hi Here is why.");
  assert.equal(order(p, restoreWords(p, cut, ["w1"])), "I lost 4000 dollars. Hi everyone. Here is why.");
});

test("cutting words keeps what's anchored on them: pulled in to the words that still play", () => {
  const p = project("Basically, I quit my job today. It was literally the best call.");
  const e = { keep: all(p), gapCap: 0.4, speed: 1, broll: [{ id: "hook", anchor: { from: "w0", to: "w3" } }],
    zooms: [{ anchor: { from: "w6", to: "w8" }, scale: 1.1 }, { anchor: { from: "w8", to: "w8" }, scale: 1.2 }],
    chapters: [{ from: "w0", title: "Start" }] } as unknown as Edit;
  const ids = crutches(p, e.keep).flatMap((c) => c.hits.flat());
  const next = keepAnchors(p, { ...e, keep: cutWords(p, e.keep, ids) });
  const tl = buildTimeline(p.words, next, [60]);
  assert.deepEqual(next.broll[0].anchor, { from: "w1", to: "w3" });
  assert.ok(spanOf(tl, next.broll[0].anchor));                        // the hook title still shows
  assert.deepEqual(next.zooms[0].anchor, { from: "w6", to: "w7" });      // ended on "literally"
  assert.deepEqual(next.zooms[1].anchor, { from: "w8", to: "w8" });    // all its words went: it goes with them
  assert.equal(next.chapters![0].from, "w1");
  assert.deepEqual(e.broll[0].anchor, { from: "w0", to: "w3" });       // the old version is untouched
});

test("'you know' that ends what's said isn't a habit; one set off is", () => {
  const names = (t: string) => { const p = project(t); return crutches(p, all(p)).map((c) => c.name); };
  assert.deepEqual(names("And now you know."), []);
  assert.deepEqual(names("I bet you know. Trust me."), []);
  assert.deepEqual(names("If you know, you know."), []);
  assert.deepEqual(names("It's tough, you know. Anyway."), ["you know"]);
  assert.deepEqual(names("You know, it works."), ["you know"]);
});

test("a possessive is the same name", () => {
  const p = project("I switched to Notion last week. Notion's editor is fast.");
  const tl = buildTimeline(p.words, { keep: all(p), gapCap: 0.4, speed: 1 } as Edit, [60]);
  const found = namedNotShown(tl, { broll: [] });
  const notion = found.filter((n) => /notion/i.test(JSON.stringify(n)));
  assert.equal(notion.length, 1, JSON.stringify(found));
});

test("words brought back after translating still get subtitles (their own words)", () => {
  const ws = say("First point here. This one I cut. Last point here.");
  const tr = { lang: "Spanish", lines: [{ from: "w0", to: "w2", text: "Primer punto." }, { from: "w7", to: "w9", text: "Último punto." }] };
  const full = buildTimeline(ws, { keep: [{ from: "w0", to: "w9" }], gapCap: 0.4, speed: 1 } as Edit, [30]);
  const cues = translatedCues(ws, tr as never, full);
  assert.deepEqual(cues.map((c) => c.text), ["Primer punto.", "This one I cut.", "Último punto."]);
});

test("repeats answers the same cut again without redoing it", () => {
  const p = project("Here is the secret you need. It works every day. Here is the secret you need. Yes.");
  const e = { keep: all(p), gapCap: 0.4, speed: 1 } as Edit;
  const a = repeats(p, e);
  assert.equal(a.length, 1);
  assert.equal(repeats(p, { ...e }), a);                               // cached: the same answer object
  assert.notEqual(repeats(p, { ...e, keep: [{ from: "w0", to: "w9" }] }), a);
});
