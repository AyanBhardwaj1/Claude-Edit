import assert from "node:assert/strict";
import test from "node:test";
import { defaultEdit } from "../lib/edit";
import { insights } from "../lib/insights";
import type { Edit, Project, Word } from "../lib/types";

const words: Word[] = "so here is the one habit that doubled my posting and it took ten minutes a day to start".split(" ")
  .map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.33, w }));
function video(id: string, day: number, tweak: (e: Edit) => void = () => {}): Project {
  const p = { id, title: `Video ${id}`, createdAt: `2026-11-0${day}T10:00:00Z`, updatedAt: "", words, library: [], current: 1,
    status: "edited", sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 20, width: 1080, height: 1920 }] } as unknown as Project;
  const e: Edit = { ...defaultEdit(p), keep: [{ from: "w0", to: `w${words.length - 1}` }] };
  tweak(e);
  p.versions = [{ n: 1, edit: e, note: "", summary: "", at: "" }];
  return p;
}

test("your reels over time: the average, the change, and what most often holds them back", () => {
  assert.equal(insights([video("a", 1)]), null);                         // one video is not a trend
  const vs = [video("a", 1, (e) => { e.captions.enabled = false; }), video("b", 2, (e) => { e.captions.enabled = false; }),
    video("c", 3), video("d", 4)];
  const r = insights(vs)!;
  assert.equal(r.videos, 4);
  assert.equal(r.scroll.of, 4);
  assert.equal(r.scroll.passed, 0);                // every one opens with "so" and has no hook or movement
  assert.ok(r.change !== null && r.change > 0, `later reels score higher: ${r.change}`);
  assert.ok(r.top, "a repeated problem is named");
  assert.ok(r.averageLength > 0 && r.averageLength < 20);
  assert.equal(insights([...vs, { ...video("s", 5), sample: true } as Project])!.videos, 4);   // the sample doesn't count
});
