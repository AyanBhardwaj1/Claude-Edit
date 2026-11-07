import assert from "node:assert/strict";
import test from "node:test";
import { noteTimes, pinToPlayhead } from "../lib/moments";

test("a note pointing at what's on screen gets the playhead's time; others stay as typed", () => {
  assert.equal(pinToPlayhead("cut this", 12.34, 30), "cut this (at 0:12.3)");
  assert.equal(pinToPlayhead("put the logo here", 65.08, 90), "put the logo here (at 1:05.0)");
  assert.deepEqual(noteTimes(pinToPlayhead("music too loud now", 7.5, 30)), [7.5]);
  assert.equal(pinToPlayhead("make the captions bigger", 12, 30), "make the captions bigger");      // nothing to point at
  assert.equal(pinToPlayhead("cut this at 0:05", 12, 30), "cut this at 0:05");                      // a time already given
  assert.equal(pinToPlayhead("cut this", 0, 30), "cut this");                                       // at the start
  assert.equal(pinToPlayhead("Is this better?", 30, 30), "Is this better?");                        // at the end
});

test("notes about the whole video aren't pinned to a moment", () => {
  for (const n of ["this video is great", "make this whole thing faster", "now make the music quieter overall", "I love how this turned out", "here's my idea for the hook"])
    assert.equal(pinToPlayhead(n, 30, 90), n, n);
  for (const n of ["cut this", "logo here", "this part drags", "zoom in on this", "too loud right now", "bleep that"])
    assert.notEqual(pinToPlayhead(n, 30, 90), n, n);
});
