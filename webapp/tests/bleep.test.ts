import assert from "node:assert/strict";
import test from "node:test";
import { bleepSpans, isSwear, swears } from "../lib/bleep";
import { DEFAULT_MOTION } from "../lib/edit";
import { captionWords, maskWord } from "../lib/text";
import { buildTimeline } from "../lib/timeline";
import { srt } from "../lib/translate";
import type { Edit, Project, Word } from "../lib/types";

const say = (text: string): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.33, w }));

test("strong words are found, mild ones and lookalikes are left alone", () => {
  for (const w of ["fuck", "Fucking,", "motherfucker", "shit.", "bullshit", "bitches", "asshole", "WTF"]) assert.ok(isSwear(w), w);
  for (const w of ["damn", "hell", "crap", "shitake", "Dick", "class", "assess", "pass", "Scunthorpe"]) assert.ok(!isSwear(w), w);
});

test("bleeped words are masked in the subtitles and the .srt, and get spans a little wider than the word", () => {
  const ws = say("this is fucking great and shit happens");
  const e = { keep: [{ from: "w0", to: "w6" }], gapCap: 0.4, corrections: [], motion: DEFAULT_MOTION, bleeps: ["w2", "w5"],
    captions: { enabled: true, preset: "studio", size: 105, position: 0.75, textCase: "upper", maxWords: 3, font: "Montserrat" } } as unknown as Edit;
  const tl = buildTimeline(ws, e, [10]);
  assert.deepEqual(swears(tl).map((w) => w.id), ["w2", "w5"]);
  assert.equal(captionWords(tl.words, [], e.bleeps).map((w) => w.text).join(" "), "this is f****** great and s*** happens");
  assert.match(srt({} as Project, e, tl), /f\*{6} great/);
  const sp = bleepSpans(tl, e.bleeps);
  assert.equal(sp.length, 2);
  const w2 = tl.byId.get("w2")!;
  assert.ok(sp[0][0] < w2.os && sp[0][1] > w2.oe);
  assert.deepEqual(bleepSpans(tl, ["gone"]), []);
  assert.equal(maskWord("“Fuck!”"), "“F***!”");
});

test("the change list names bleeps", async () => {
  const { changeItems } = await import("../lib/changes");
  const ws = say("this is fucking great");
  const p = { words: ws, sources: [{ duration: 10 }] } as unknown as Project;
  const base = { keep: [{ from: "w0", to: "w3" }], gapCap: 0.4, corrections: [], broll: [], zooms: [], motion: DEFAULT_MOTION,
    music: { asset: null, level: "under-voice", startAt: null, automation: [] }, cover: { word: null, text: "" }, post: { caption: "", hashtags: [], keywords: [] },
    captions: { enabled: true, preset: "studio", size: 105, position: 0.75, textCase: "upper", maxWords: 3, font: "Montserrat" } } as unknown as Edit;
  const items = changeItems(p, base, { ...base, bleeps: ["w2"] });
  assert.ok(items.some((c) => c.text === "Bleeped 1 word"), JSON.stringify(items));
});

test("a note asking to bleep the swearing turns into bleeps (and back)", async () => {
  const { fromAi, defaultEdit } = await import("../lib/edit");
  const ws = say("this is fucking great and shit happens");
  const p = { words: ws, sources: [{ id: 0, duration: 10 }], library: [], analysis: { defaultKeep: [{ from: "w0", to: "w6" }] } } as unknown as Project;
  const base = defaultEdit(p);
  const on = fromAi(p, base, { bleep: true }).edit;
  assert.deepEqual(on.bleeps, ["w2", "w5"]);
  assert.deepEqual(fromAi(p, on, { bleep: false }).edit.bleeps, []);
  assert.equal(fromAi(p, base, {}).edit.bleeps, undefined, "never on its own");
});

test("a bleep covers the empty words a pasted script word holds, and a version summary names bleeps", async () => {
  const { describe } = await import("../lib/edit");
  const ws: Word[] = [{ id: "w0", src: 0, s: 0, e: 0.3, w: "this" }, { id: "w1", src: 0, s: 1.2, e: 1.55, w: "motherfucker" },
    { id: "w2", src: 0, s: 1.6, e: 1.95, w: "" }, { id: "w3", src: 0, s: 2.0, e: 2.3, w: "again" }];
  const tl = buildTimeline(ws, { keep: [{ from: "w0", to: "w3" }], gapCap: 1 }, [5]);
  const [sp] = bleepSpans(tl, ["w1"]);
  assert.ok(sp[1] >= tl.byId.get("w2")!.oe, `${sp} should reach ${tl.byId.get("w2")!.oe}`);
  assert.equal(describe({ keep: [], gapCap: 0.3 } as never, { keep: [], gapCap: 0.3, bleeps: ["w1"] } as never), "Changed bleeps.");
});
