import assert from "node:assert/strict";
import test from "node:test";
import { analyze } from "../lib/analyze";
import { defaultEdit, fromAi } from "../lib/edit";
import { alignScript, applyScript, opcodes, restoreHeard, scriptTokens } from "../lib/retext";
import { captionWords } from "../lib/text";
import { buildTimeline, spanOf } from "../lib/timeline";
import type { Project, Word } from "../lib/types";

const words = (text: string, t0 = 0, step = 0.4): Word[] =>
  text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: +(t0 + i * step).toFixed(3), e: +(t0 + i * step + 0.3).toFixed(3), w, p: 0.7 }));
const text = (ws: Word[]) => ws.map((w) => w.w).join(" ");
const timing = (ws: Word[]) => ws.map((w) => [w.id, w.src, w.s, w.e]);

function project(ws: Word[]): Project {
  return { id: "p", title: "t", createdAt: "", updatedAt: "", sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 60, width: 1080, height: 1920 }],
    words: ws, library: [{ key: "pic", name: "pic.png", kind: "image", width: 800, height: 600 }], versions: [], current: 0, status: "transcribed",
    analysis: analyze(ws) };
}

test("misheard names are fixed and every word keeps its id and timing", () => {
  const heard = words("so i tried met his muse and whisper ex last week");
  const r = alignScript(heard, "So I tried Meta's Muse and WhisperX last week.");
  assert.deepEqual(timing(r.words), timing(heard));                       // nothing added, removed or re-timed
  assert.equal(text(r.words), "So I tried Meta's  Muse and WhisperX  last week.");
  assert.equal(r.words[4].w, "", "the extra heard word merges into the word before");
  const caps = captionWords(buildTimeline(r.words, { keep: [{ from: "w0", to: "w10" }], gapCap: 0.15 }, [60]).words, []);
  assert.deepEqual(caps.map((c) => c.text), ["So", "I", "tried", "Meta's", "Muse", "and", "WhisperX", "last", "week."]);
  const metas = caps.find((c) => c.text === "Meta's")!;
  assert.ok(metas.oe > heard[4].s - 0.01, "Meta's stays up over the merged word's time");
  assert.equal(r.stats.kept, 0);
  assert.ok(r.stats.changed >= 6, `changed ${r.stats.changed}`);
});

test("punctuation and casing come from the script", () => {
  const heard = words("the one habit that doubled my posting is batching");
  const r = alignScript(heard, "The one habit that doubled my posting? Batching!");
  assert.equal(text(r.words), "The one habit that doubled my posting? is Batching!");    // "is" wasn't in the script: kept as said
  assert.equal(r.stats.matched, 8);
  assert.equal(r.stats.kept, 1);
  assert.equal(r.words[0].p, 1, "the script confirms the word");
});

test("an ad-lib that isn't in the script is kept as it was said", () => {
  const heard = words("i film four videos honestly every sunday morning");
  const r = alignScript(heard, "I film 4 videos every Sunday morning.");
  assert.equal(text(r.words), "I film 4 videos honestly every Sunday morning.");
  assert.equal(r.stats.kept, 1);
  assert.equal(r.stats.replaced, 1);
  // a filler right before a misheard word stays too, when the rest clearly sounds like the script
  const r2 = alignScript(words("and um met his muse is great"), "and Meta's Muse is great");
  assert.equal(text(r2.words), "and um Meta's  Muse is great");
});

test("script words the recogniser missed squeeze into the neighbouring word", () => {
  const heard = words("it takes three hours for one minute video");
  const r = alignScript(heard, "It takes three hours for a one minute video. Every single time I post.");
  assert.deepEqual(timing(r.words), timing(heard));
  assert.equal(r.words[4].w, "for a", "one short missing word goes with the word before");
  assert.equal(r.stats.inserted, 1);
  assert.equal(r.stats.skipped, 5, "a whole line that wasn't said is left out");
  const caps = captionWords(buildTimeline(r.words, { keep: [{ from: "w0", to: "w7" }], gapCap: 0.15 }, [60]).words, []);
  const f = caps.find((c) => c.text === "for")!, a = caps.find((c) => c.text === "a")!;
  assert.equal(f.id, "w4");
  assert.equal(a.id, "w4.1");
  assert.ok(f.os < a.os && Math.abs(a.oe - (f.os + 0.3)) < 1e-9, "the two words share the heard word's time");
  // a missing word at a sentence start goes before the next word instead
  const r2 = alignScript(words("this is great. we love it"), "This is great. So we love it.");
  assert.equal(r2.words[3].w, "So we");
});

test("a retake of a script line gets the script's words too, whichever take the edit keeps", () => {
  const heard = words("so met his muse is the best way to edit wait let me try that again met his muse is the best way to edit a reel");
  const r = alignScript(heard, "Meta's Muse is the best way to edit a reel.");
  assert.equal(text(r.words), "so Meta's  Muse is the best way to edit wait let me try that again Meta's  Muse is the best way to edit a reel.");
  assert.equal(r.stats.kept, 7, "the restart and meta-talk stay as said");
  assert.equal(r.stats.skipped, 0);
});

test("ids stay stable for 1:1 runs and numbers spoken as words are replaced in place", () => {
  const heard = words("i spent twenty three hundred dollars on gear");
  const r = alignScript(heard, "I spent $2,300 on gear.");
  assert.deepEqual(r.words.map((w) => w.id), heard.map((w) => w.id));
  assert.equal(r.words[2].w, "$2,300");
  assert.equal(text(r.words.slice(3, 6)), "  ");                          // merged into the word before
  assert.equal(r.words[7].w, "gear.");
});

test("scripts are read like they'd be said", () => {
  assert.deepEqual(scriptTokens("Hook: I quit editing.\n\nScript:\nI spent [how much] on it — really.\n\nOn screen:\nQuit editing"),
    ["I", "quit", "editing.", "I", "spent", "on", "it", "really."]);
  assert.deepEqual(opcodes(["a", "b", "c"], ["a", "x", "c"]), [["equal", 0, 1, 0, 1], ["replace", 1, 2, 1, 2], ["equal", 2, 3, 2, 3]]);
});

test("anchors in an edit still resolve after the script is used, and the cut plays the same", () => {
  const heard = words("so i tried met his muse and whisper ex last week and it changed how i edit forever");
  const p = project(heard.map((w) => ({ ...w })));
  const { edit } = fromAi(p, defaultEdit(p), {
    keep: [{ from: "w1", to: "w17" }],
    broll: [{ asset: "pic", from: "w3", to: "w5" }], labels: [{ text: "WhisperX", from: "w7", to: "w8" }],
    zooms: [{ from: "w13", to: "w16" }], music: { automation: [{ from: "w9", to: "w11", db: 3 }] }, cover: { word: "w4" },
  });
  const before = buildTimeline(p.words, edit, [60]);
  const r = applyScript(p, "So I tried Meta's Muse and WhisperX last week, and it changed how I edit forever.");
  assert.ok(r.ok, r.message);
  assert.match(r.message, /^Fixed \d+ words/);
  const after = buildTimeline(p.words, edit, [60]);
  assert.equal(after.duration, before.duration);
  assert.deepEqual(after.segments, before.segments);
  for (const range of [...edit.broll.map((b) => b.anchor), ...edit.zooms.map((z) => z.anchor), ...edit.music.automation.map((m) => m.anchor)])
    assert.deepEqual(spanOf(after, range), spanOf(before, range));
  assert.ok(after.byId.has(edit.cover.word!));
  assert.equal(p.wordsHeard?.length, heard.length);
  assert.ok(captionWords(after.words, edit.corrections).some((c) => c.text === "Meta's"));
  restoreHeard(p);
  assert.equal(text(p.words), text(heard));
  assert.equal(p.wordsHeard, undefined);
  assert.equal(p.script?.startsWith("So I tried"), true);
  // a script for some other video is refused
  const wrong = applyScript(p, "Here is a recipe for banana bread with walnuts and a little cinnamon on top.");
  assert.equal(wrong.ok, false);
  assert.equal(text(p.words), text(heard));
});

test("5,000 words align in well under 200 ms", () => {
  const vocab = "the a and to of i you it that is in for on with my this so we just what video edit reel hook music take one two three".split(" ");
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const heardText: string[] = [], scriptText: string[] = [];
  for (let i = 0; i < 5000; i++) {
    const w = vocab[Math.floor(rnd() * vocab.length)];
    heardText.push(w);
    const x = rnd();
    if (x < 0.03) scriptText.push("Brand" + i);                // misheard
    else if (x < 0.04) continue;                                // an ad-lib, not in the script
    else { scriptText.push(w + (x > 0.95 ? "." : "")); if (x > 0.99) scriptText.push("really"); }
  }
  const heard = words(heardText.join(" "), 0, 0.3);
  alignScript(heard.slice(0, 200), scriptText.slice(0, 200).join(" "));       // warm up
  const t0 = performance.now();
  const r = alignScript(heard, scriptText.join(" "));
  const ms = performance.now() - t0;
  assert.equal(r.words.length, 5000);
  assert.deepEqual(r.words.map((w) => w.id), heard.map((w) => w.id));
  assert.ok(r.stats.matched > 4500, `matched ${r.stats.matched}`);
  assert.ok(ms < 200, `${ms.toFixed(0)} ms`);
});
