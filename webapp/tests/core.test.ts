import assert from "node:assert/strict";
import test from "node:test";
import { analyze, sameLine } from "../lib/analyze";
import { defaultEdit, fromAi, postText } from "../lib/edit";
import { captionWords, chunk, digits } from "../lib/text";
import { buildTimeline, spanOf } from "../lib/timeline";
import type { Project, Word } from "../lib/types";

const words = (text: string, t0 = 0, step = 0.4, src = 0, start = 0): Word[] =>
  text.split(" ").map((w, i) => ({ id: `w${start + i}`, src, s: +(t0 + i * step).toFixed(3), e: +(t0 + i * step + 0.3).toFixed(3), w }));

function project(ws: Word[]): Project {
  return { id: "p", title: "t", createdAt: "", updatedAt: "", sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 60, width: 1920, height: 1080 }],
    words: ws, library: [{ key: "song", name: "song.mp3", kind: "music", feel: "upbeat" }, { key: "pic", name: "pic.png", kind: "image", width: 800, height: 600 }],
    versions: [], current: 0, status: "transcribed", analysis: analyze(ws) };
}

test("timeline cuts long pauses down to the gap cap and maps words to output time", () => {
  const ws = [...words("one two three"), ...words("four five", 5)].map((w, i) => ({ ...w, id: `w${i}` }));
  const tl = buildTimeline(ws, { keep: [{ from: "w0", to: "w4" }], gapCap: 0.15 }, [60]);
  assert.equal(tl.segments.length, 2);                       // the 4.2 s pause became a cut
  const gap = tl.byId.get("w3")!.os - tl.byId.get("w2")!.oe;
  assert.ok(gap > 0.1 && gap < 0.3, `gap ${gap}`);
  assert.deepEqual(spanOf(tl, { from: "w1", to: "w2" })?.map((x) => +x.toFixed(2)), [0.4, 1.1]);        // the take starts at 0: no lead-in to shift by
  assert.equal(spanOf(tl, { from: "w9", to: "w9" }), null);
});

test("analysis keeps the last complete take and drops meta-talk and fillers", () => {
  const ws = [...words("so the best way to edit is this", 0), ...words("let me try that again", 4, 0.4, 0, 7),
    ...words("the best way to edit a reel is this one", 8, 0.4, 0, 12), ...words("um", 13, 0.4, 0, 22)];
  ws.forEach((w, i) => (w.id = `w${i}`));
  ws[6].w = "this.";
  const a = analyze(ws);
  assert.ok(sameLine("so the best way to edit is this", "the best way to edit a reel is this one"));
  assert.equal(a.retakes.length, 1);
  const kept = new Set<string>();
  const idx = new Map(ws.map((w, i) => [w.id, i]));
  for (const r of a.defaultKeep) for (let i = idx.get(r.from)!; i <= idx.get(r.to)!; i++) kept.add(ws[i].w);
  assert.ok(kept.has("reel") && !kept.has("try") && !kept.has("um"));
  assert.ok(a.dropped.some((d) => d.reason === "meta-talk"));
});

test("captions: digits, corrections and 3-word cues", () => {
  const ws = words("it costs twenty five dollars on pay pal for step one");
  const tl = buildTimeline(ws, { keep: [{ from: "w0", to: `w${ws.length - 1}` }], gapCap: 0.15 }, [60]);
  const cw = captionWords(tl.words, [{ from: "pay pal", to: "PayPal" }]);
  assert.equal(cw.map((w) => w.text).join(" "), "it costs $25 on PayPal for step 1");
  const cues = chunk(cw, 3);
  assert.ok(cues.every((c) => c.words.length <= 3));
  assert.equal(digits(words("the one thing").map((w) => ({ id: w.id, text: w.w, os: w.s, oe: w.e, seg: 0 })))[1].text, "one");
});

test("an AI edit is validated before it reaches the project", () => {
  const ws = words("here are three tools that will change how you edit videos");
  const p = project(ws);
  const base = defaultEdit(p);
  assert.equal(base.music.asset, "song");
  const { edit, problems } = fromAi(p, base, {
    keep: [{ from: "w0", to: "w10" }, { from: "w99", to: "w100" }], gapCap: 9,
    hook: { text: "3 tools that change editing", from: "w0", to: "w5" },
    labels: [{ text: "$20", from: "w2", to: "w3", style: "pop" }],
    broll: [{ asset: "pic", from: "w6", to: "w8", treatment: "side-card" }, { asset: "nope", from: "w1", to: "w2" }],
    zooms: [{ from: "w8", to: "w10", scale: 3 }],
    post: { caption: "Three tools — one week", hashtags: ["a", "#b", "c", "d", "e", "f"], keywords: ["tools"] },
  });
  assert.deepEqual(edit.keep, [{ from: "w0", to: "w10" }]);
  assert.equal(edit.gapCap, 2);
  assert.equal(edit.broll.length, 3);
  assert.equal(edit.broll[0].style, "label");
  assert.equal(edit.zooms[0].scale, 1.4);
  assert.deepEqual(edit.post.hashtags, ["#a", "#b", "#c", "#d", "#e"]);
  assert.equal(edit.post.caption, "Three tools, one week");
  assert.ok(problems.some((x) => x.includes("nope")) && problems.some((x) => x.includes("cut")));
  assert.equal(postText(p, edit), "Three tools, one week\n\n#a #b #c #d #e");
});

test("live cut (landing page): retakes, meta-talk and stutters go, the last complete take stays", async () => {
  const { liveCut, SAMPLE_TAKE } = await import("../lib/livecut");
  const r = liveCut(SAMPLE_TAKE);
  const marks = r.lines.map((l) => l.mark);
  assert.deepEqual(marks, ["false start", "retake", "meta-talk", "retake", "kept", "stutter", "kept"]);
  assert.ok(r.lines[4].captions.includes("IT TAKES 3"), "numbers become digits in captions");
  assert.ok(r.keptWords < r.totalWords && r.keptSeconds < r.rawSeconds);
  assert.deepEqual(liveCut("   ").lines, []);
});

test("password rules for local accounts", async () => {
  const { passwordProblem, validEmail } = await import("../lib/auth");
  assert.ok(passwordProblem("short1"));
  assert.ok(passwordProblem("onlyletters"));
  assert.equal(passwordProblem("reels4ever!"), null);
  assert.ok(validEmail("a@b.co") && !validEmail("a@b") && !validEmail("nope"));
});
