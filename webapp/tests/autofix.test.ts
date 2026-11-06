import assert from "node:assert/strict";
import test from "node:test";
import { fixWhatICan } from "../lib/autofix";
import { DEFAULT_MOTION } from "../lib/edit";
import { scrollTest } from "../lib/scrolltest";
import { subtitlesCovered } from "../lib/safezones";
import { buildTimeline } from "../lib/timeline";
import type { Edit, Project, Word } from "../lib/types";

const ws: Word[] = "so today I want to show you how I film a week of videos in one hour every Sunday and it saves me hours".split(" ")
  .map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.45, e: i * 0.45 + 0.35, w }));
const p = { words: ws, sources: [{ id: 0, duration: 20 }] } as unknown as Project;
const e = { keep: [{ from: "w0", to: `w${ws.length - 1}` }], gapCap: 0.4, corrections: [], broll: [], zooms: [],
  motion: { ...DEFAULT_MOTION, transition: "none" }, music: { asset: null, level: "under-voice", startAt: null, automation: [] },
  captions: { enabled: false, preset: "studio", size: 105, position: 0.86, textCase: "upper", maxWords: 3, font: "Montserrat" } } as unknown as Edit;

test("fix what I can: subtitles on, warm-up cut, movement, raised subtitles, all in one edit", () => {
  const r = fixWhatICan(p, e, true)!;
  assert.ok(r.done.includes("subtitles on"));
  assert.ok(r.done.some((d) => /cut the warm-up “so today”/.test(d)), r.done.join(" | "));
  assert.ok(r.done.includes("a zoom in the first seconds"));
  assert.ok(r.done.includes("subtitles raised clear of the app buttons"));
  const tl = buildTimeline(ws, r.edit, [20]);
  const st = scrollTest(tl, r.edit);
  for (const id of ["read", "moves", "open"]) assert.ok(st.lines.find((l) => l.id === id)!.ok, id);
  assert.deepEqual(subtitlesCovered(r.edit), []);
  assert.equal(fixWhatICan(p, r.edit, true), null, "nothing left to fix the second time");
  assert.equal(e.captions.enabled, false, "the given edit is untouched");
});
