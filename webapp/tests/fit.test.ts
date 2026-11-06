import assert from "node:assert/strict";
import test from "node:test";
import { defaultEdit } from "../lib/edit";
import { applyFit, planFit } from "../lib/fit";
import { buildTimeline } from "../lib/timeline";
import type { Project, Word } from "../lib/types";

// eight sentences, 0.5 s a word with 0.35 s pauses between sentences
const TEXT = ["I lost 4000 dollars on one bad habit.", "It was a normal week at the office and nothing much happened at all.",
  "The weather was fine and the coffee was fine too.", "Here is the secret you need to know.",
  "We had meetings and more meetings that went on and on all day long.", "Then lunch came around like it usually does.",
  "Batch your posts on Sunday and you will never miss a day.", "Follow for part two."];
function project(): Project {
  const ws: Word[] = [];
  let t = 0;
  for (const s of TEXT) { for (const w of s.split(" ")) { ws.push({ id: `w${ws.length}`, src: 0, s: +t.toFixed(3), e: +(t + 0.4).toFixed(3), w }); t += 0.5; } t += 0.35; }
  return { id: "p", words: ws, library: [], versions: [], sources: [{ id: 0, name: "a", mediaKey: "k", duration: t + 1, width: 1080, height: 1920 }] } as unknown as Project;
}
const said = (p: Project, e: { keep: { from: string; to: string }[] }) => {
  const idx = new Map(p.words.map((w, i) => [w.id, i])); const out: string[] = [];
  for (const r of e.keep) for (let i = idx.get(r.from)!; i <= idx.get(r.to)!; i++) out.push(p.words[i].w);
  return out.join(" ");
};

test("fit to a length drops the lines that grip least, keeps the hook and the ending", () => {
  const p = project();
  const e = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${p.words.length - 1}` }], gapCap: 0.4 };
  const plan = planFit(p, e, 30);
  assert.ok(plan.now > 30 && plan.reached, JSON.stringify(plan));
  const out = applyFit(p, e, plan);
  const dur = buildTimeline(p.words, out, [99]).duration;
  assert.ok(dur <= 30.05, `${dur}`);
  const text = said(p, out);
  assert.ok(text.startsWith("I lost 4000 dollars") && text.endsWith("Follow for part two."), text);
  assert.ok(text.includes("Here is the secret you need to know.") && text.includes("never miss a day"), text);   // the gripping lines stay
  assert.ok(plan.drop.every((d) => !/secret|never|4000|Follow/.test(d.text)));
  assert.deepEqual(plan.drop.map((d) => d.at), [...plan.drop.map((d) => d.at)].sort((a, b) => a - b));        // listed in order
});

test("tighter pauses alone when they are enough; nothing when it already fits; never fewer than three lines", () => {
  const p = project();
  const e = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${p.words.length - 1}` }], gapCap: 0.4 };
  const full = planFit(p, e, 90);
  assert.equal(full.drop.length, 0); assert.equal(full.after, full.now);
  const nowLoose = buildTimeline(p.words, e, [99]).duration, tight = buildTimeline(p.words, { ...e, gapCap: 0.12 }, [99]).duration;
  const justPauses = planFit(p, e, Math.floor(nowLoose) - 0.5 > tight ? Math.floor(nowLoose) - 0.5 : nowLoose - 0.01);
  assert.equal(justPauses.drop.length, 0); assert.equal(justPauses.gapCap, 0.12);
  const tiny = planFit(p, e, 5);
  assert.equal(tiny.reached, false);
  assert.equal(8 - tiny.drop.length, 3);
});

test("a line that names something is kept over a plain one", () => {
  const p = project();
  p.words.filter((w) => w.w === "office").forEach((w) => (w.w = "Notion"));     // "…a normal week at the Notion and…"
  const e = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${p.words.length - 1}` }], gapCap: 0.4 };
  const plan = planFit(p, e, 30);
  assert.ok(plan.drop.every((d) => !d.text.includes("Notion")), JSON.stringify(plan.drop.map((d) => d.text)));
});

test("a line said again later in the cut is the first to go", () => {
  const p = project();
  // sentence 6 becomes a repeat of sentence 4 ("Here is the secret you need to know.")
  const s6 = p.words.filter((w) => w.s >= 0).slice(0);
  const start = TEXT.slice(0, 5).join(" ").split(" ").length;
  "Here is the secret you need to know.".split(" ").forEach((w, i) => { s6[start + i].w = w; });
  for (let i = start + 8; i < start + TEXT[5].split(" ").length; i++) s6[i].w = "";
  const e = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${p.words.length - 1}` }], gapCap: 0.4 };
  const nowTight = buildTimeline(p.words, { ...e, gapCap: 0.12 }, [99]).duration;
  const plan = planFit(p, e, nowTight - 1);
  assert.equal(plan.drop.length, 1);
  assert.match(plan.drop[0].text, /^Here is the secret/);
  assert.ok(plan.drop[0].at > 15);                 // the later one, not the first time it's said
});

test("a list item is never cut: the others lean on it", () => {
  const p = project();
  p.words.filter((w) => w.w === "It" && w.s < 5).forEach((w) => (w.w = "Step"));          // "Step was a normal week…"
  const e = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${p.words.length - 1}` }], gapCap: 0.4 };
  assert.ok(planFit(p, e, 30).drop.every((d) => !d.text.startsWith("Step")));
});

test("lines the cut plays twice are listed, the later one to cut", async () => {
  const { repeats } = await import("../lib/fit");
  const p = project();
  const start = TEXT.slice(0, 5).join(" ").split(" ").length;           // sentence 6 becomes sentence 4 again
  "Here is the secret you need to know.".split(" ").forEach((w, i) => { p.words[start + i].w = w; });
  const e = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${p.words.length - 1}` }], gapCap: 0.4 };
  const r = repeats(p, e);
  assert.equal(r.length, 1);
  assert.ok(r[0].again.at > r[0].first.at);
  assert.match(r[0].again.text, /^Here is the secret/);
  assert.equal(repeats(p, { ...e, keep: [{ from: "w0", to: `w${start - 1}` }] }).length, 0);   // the repeat cut: nothing
});

test("said twice means the same sentence, not the same opening", async () => {
  const { sameSentence } = await import("../lib/fit");
  assert.equal(sameSentence("So I use Notion.", "And I use Figma."), false);
  assert.equal(sameSentence("It's so good.", "It's so bad."), false);
  assert.equal(sameSentence("I love this.", "I love you."), false);
  assert.equal(sameSentence("I'm going to show you three tools.", "I'm going to show you how it works."), false);
  assert.equal(sameSentence("Here is the secret you need to know.", "Here is the secret you need to know."), true);
  assert.equal(sameSentence("Um, follow for part two.", "Follow for part two!"), true);
  assert.equal(sameSentence("Here is the one secret you really need to know.", "Here is the secret you really need to know."), true);
});
