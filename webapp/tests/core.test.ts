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

test("the sample project's first edit is valid against its own transcript", async () => {
  const { readFileSync } = await import("node:fs");
  const d = JSON.parse(readFileSync(new URL("../public/demo/demo.json", import.meta.url), "utf8"));
  const ws: Word[] = d.words.map((w: { w: string; s: number; e: number }, i: number) => ({ id: `w${i}`, src: 0, s: w.s, e: w.e, w: w.w }));
  const p = project(ws);
  p.library = [{ key: "card", name: "hook list.png", kind: "image", width: 1200, height: 900 }, { key: "song", name: "pad.m4a", kind: "music", feel: "gentle" }];
  const { edit, problems } = fromAi(p, defaultEdit(p), d.edit);
  assert.deepEqual(problems, []);
  const text = buildTimeline(ws, edit, [d.source.duration]).words.map((w) => w.w).join(" ");
  assert.ok(!/let me try that again/i.test(text) && !/^Okay so/.test(text), text);
  assert.ok(/I never move it/.test(text) && !/I I never/.test(text), "stutter cut");
  assert.equal(edit.broll.filter((b) => b.treatment === "text-pop").length, 4);   // hook title + 3 labels
  assert.equal(edit.broll.filter((b) => b.treatment === "motion" && b.card?.value === 4).length, 1);   // the animated counter
});

test("motion: defaults for old edits, validation of AI answers, templates", async () => {
  const { motionOf, cleanMotion, DEFAULT_MOTION } = await import("../lib/edit");
  const { TEMPLATES, applyTemplate, templateOf } = await import("../lib/templates");
  const { cutFx } = await import("../lib/motion");
  const ws = words("one two three four five six");
  const p = project(ws);
  const old = defaultEdit(p); delete old.motion;
  assert.deepEqual(motionOf(old), DEFAULT_MOTION);
  const m = cleanMotion({ captionAnim: "wobble" as never, accent: "red", transition: "whip", look: "film" });
  assert.equal(m.captionAnim, "pop"); assert.equal(m.accent, DEFAULT_MOTION.accent); assert.equal(m.transition, "whip"); assert.equal(m.look, "film");
  const { edit } = fromAi(p, defaultEdit(p), { motion: { captionAnim: "karaoke", accent: "#ff3d9a" } });
  assert.equal(motionOf(edit).captionAnim, "karaoke");
  for (const t of TEMPLATES) assert.equal(templateOf(applyTemplate(defaultEdit(p), t)), t.id);
  assert.equal(cutFx("flash", [5], 5.05)?.kind, "flash");
  assert.equal(cutFx("flash", [5], 5.5), null);
  assert.equal(cutFx("punch", [5], 5), null);
});

test("motion studio: the offline planner reads the shape of the text", async () => {
  const { planScenes, cleanScenes, narration } = await import("../lib/studio");
  const sc = planScenes("Cutmind turns raw takes into finished reels.\nIt keeps your best take of every line.\nEditing used to take 3 hours. Now it takes 20 minutes.\n- Subtitles on every word\n- Pictures that miss your face\n- Music under your voice\nTry it on your next video.");
  const kinds = sc.map((s) => s.kind);
  assert.equal(kinds[0], "title");
  assert.ok(kinds.includes("list") && kinds.includes("compare"), kinds.join(","));
  assert.equal(kinds[kinds.length - 1], "cta");
  assert.deepEqual(sc.find((s) => s.kind === "compare")!.items, ["3 hours", "20 minutes"]);
  const two = planScenes("Why your videos stop getting views.\nA slow intro loses 65% of them.\nOpen with the payoff.");
  const num = two.find((s) => s.kind === "number")!;
  assert.equal(num.value, 65); assert.equal(num.suffix, "%");
  assert.equal(planScenes("A title here.\nStep 1, I write every hook.").find((s) => s.kind === "number"), undefined, "step numbers are not stats");
  const wk = planScenes("My week in numbers.\nViews went from 2,000 to 18,500.\n- Reels: 12\n- Hours editing: 3\n- New followers: 940");
  assert.deepEqual(wk.find((s) => s.kind === "compare")?.items, ["2,000", "18,500"]);
  assert.equal(wk.find((s) => s.kind === "compare")?.text, "Views");
  assert.equal(wk.find((s) => s.kind === "bars")?.items?.length, 3);
  assert.deepEqual(sc.find((s) => s.kind === "list")!.items, ["Subtitles on every word", "Pictures that miss your face", "Music under your voice"]);
  assert.ok(sc.every((s) => s.duration >= 2.4 && s.duration <= 7));
  const cleaned = cleanScenes([{ kind: "wobble", text: "Hi" }, { kind: "number", text: "users", value: "12", duration: 99 }, { kind: "list" }]);
  assert.equal(cleaned[0].kind, "statement"); assert.equal(cleaned[1].value, 12); assert.equal(cleaned[1].duration, 8); assert.equal(cleaned.length, 2);
  assert.match(narration({ id: "x", kind: "number", text: "hours saved", value: 3, duration: 3 }), /3 hours saved/);
});

test("clips: the AI's picks are checked (ids, length, overlaps) and ranked", async () => {
  const { findClips } = await import("../lib/clips");
  const ws = words(Array.from({ length: 200 }, (_, i) => `w${i}x`).join(" "), 0, 0.4);
  const p = project(ws);
  const answer = { clips: [
    { title: "Good one", hook: "A hook", from: "w10", to: "w80", why: "it lands", score: 7 },     // 28 s
    { title: "Overlaps", from: "w50", to: "w120", score: 9 },                                       // overlaps the first once ranked? kept: higher score first
    { title: "Too short", from: "w150", to: "w155", score: 10 },
    { title: "Unknown ids", from: "w999", to: "w1000", score: 10 },
    { title: "Fine", from: "w130", to: "w190", score: 6 },
  ] };
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_clips", input: answer }] }),
    { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const s = { provider: "anthropic", anthropicKey: "k", openaiKey: "", anthropicModel: "m", openaiModel: "", transcriber: "browser", rememberKeys: false } as const;
    const clips = await findClips(s, p);
    assert.deepEqual(clips.map((c) => c.title), ["Good one", "Fine"]);
    assert.equal(clips[0].seconds > 20, true);
  } finally { globalThis.fetch = real; }
});

test("subtitles: phrases for translation and an .srt file", async () => {
  const { phrasesOf, srt } = await import("../lib/translate");
  const ws = [...words("Hello there friends.", 0, 0.4), ...words("This is the second line", 3, 0.4, 0, 3)];
  const p = project(ws);
  const e = defaultEdit(p);
  const tl = buildTimeline(ws, e, [60]);
  const ph = phrasesOf(tl);
  assert.equal(ph.length, 2);
  assert.equal(ph[0].text, "Hello there friends.");
  const file = srt(p, e, tl);
  assert.match(file, /^1\n00:00:00,000 --> 00:00:0\d,\d{3}\nHello there friends\.\n/);
  const tr = srt(p, { ...e, translation: { lang: "Spanish", lines: [{ from: ph[0].from, to: ph[0].to, text: "Hola amigos." }] } }, tl);
  assert.match(tr, /Hola amigos\./);
});

test("page reader refuses private and local addresses", async () => {
  const { privateIp } = await import("../lib/server/net");
  for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "::ffff:10.0.0.1"])
    assert.equal(privateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "151.101.1.69", "2606:4700::6810:84e5"]) assert.equal(privateIp(ip), false, ip);
});

test("reel check: scores the sample's first edit and flags real problems", async () => {
  const { readFileSync } = await import("node:fs");
  const { reelCheck } = await import("../lib/score");
  const d = JSON.parse(readFileSync(new URL("../public/demo/demo.json", import.meta.url), "utf8"));
  const ws: Word[] = d.words.map((w: { w: string; s: number; e: number }, i: number) => ({ id: `w${i}`, src: 0, s: w.s, e: w.e, w: w.w }));
  const p = project(ws);
  p.library = [{ key: "card", name: "hook list.png", kind: "image", width: 1200, height: 900 }, { key: "song", name: "pad.m4a", kind: "music", feel: "gentle" }];
  const { edit } = fromAi(p, defaultEdit(p), d.edit);
  const r = reelCheck(p, edit, buildTimeline(ws, edit, [d.source.duration]));
  assert.ok(r.score >= 80, `sample scores ${r.score}: ${r.checks.filter((c) => !c.ok).map((c) => c.id)}`);
  const bare = defaultEdit(p); bare.captions.enabled = false;
  const r2 = reelCheck(p, bare, buildTimeline(ws, bare, [d.source.duration]));
  assert.ok(r2.score < r.score - 20);
  assert.equal(r2.checks.find((c) => c.id === "hook")!.ok, false);
  assert.equal(r2.checks.find((c) => c.id === "subs")!.ok, false);
});
