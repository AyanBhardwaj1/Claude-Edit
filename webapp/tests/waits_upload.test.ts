// "Speed through waits" for screen recordings the user uploads: the detector shared with the recorder, the per-clip
// speedWaits switch in the time map, and the played length the AI editor reads.
import assert from "node:assert/strict";
import test from "node:test";
import { clipPieces, clipPlan, detectWaits, frameChange, piecesLength, playedLength, recordingMeta, samplesFrom, spedWaits,
  WAIT_SPEED, waitSavings, type Sample } from "../lib/screenrec";
import type { Asset, Project } from "../lib/types";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

/** A synthetic 10 s screen recording as 64x36 greyscale frames: 3 s of a moving picture, 4 s frozen on the frame shown at
 *  3.0 s, 3 s moving again (like the ffmpeg test clip used in the browser check). */
function frameAt(t: number): Uint8Array {
  const at = t >= 3 && t < 7 ? 3 : t;
  const f = new Uint8Array(64 * 36);
  const shift = Math.floor(at * 30) * 3;                        // a bar sweeping across at 90 px a second
  for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) f[y * 64 + x] = (x + shift) % 64 < 16 ? 230 : 40 + (y % 4);
  return f;
}

/** What the upload scan does with the frames it sees: each compared with the one before (frameChange), at the times given. */
function scan(times: number[]): Sample[] {
  let prev: Uint8Array | null = null;
  return times.map((t) => { const g = frameAt(t); const change = prev ? frameChange(prev, g) : 1; prev = g; return { t, change }; });
}

test("waits: the recorder's detector, unchanged: same thresholds, padding and edges", () => {
  // the recorder's own fixture (tests/screenrec.test.ts): moving 1 s, frozen 1-3 s, a too-short freeze
  const changes = [1, 0.3, 0.2, 0.25, 0.4, 0, 0, 0.004, 0, 0, 0, 0.009, 0, 0.3, 0.2, 0, 0, 0.5, 0.2];
  assert.deepEqual(detectWaits(samplesFrom(changes), { pad: 0 }), [[1, 3]]);
  assert.deepEqual(detectWaits(samplesFrom(changes)), [[1.15, 2.85]]);
  assert.deepEqual(detectWaits(samplesFrom([1, 1, 0, 0, 0, 1]), { pad: 0 }), []);
  assert.deepEqual(detectWaits([]), []);
});

test("waits: an uploaded 10 s clip (3 s moving, 4 s frozen, 3 s moving), seeked every 250 ms", () => {
  const times = Array.from({ length: 40 }, (_, i) => i * 0.25);
  const w = detectWaits(scan(times));
  assert.equal(w.length, 1);
  const [s, e] = w[0];
  assert.ok(s > 3 && s < 3.5, `starts just after 3 s: ${s}`);
  assert.ok(e > 6.4 && e < 7, `ends just before 7 s: ${e}`);
  assert.deepEqual(w, [[3.15, 6.6]]);
});

test("waits: fast playback sampling (16x, frames about 0.27 s apart, uneven) finds the same wait", () => {
  const times: number[] = [];
  for (let t = 0.02, i = 0; t < 10; t += 16 / 60 + (i++ % 3 === 0 ? 0.03 : -0.01)) times.push(Math.round(t * 1000) / 1000);
  const w = detectWaits(scan(times));
  assert.equal(w.length, 1);
  assert.ok(w[0][0] > 3 && w[0][0] < 3.6 && w[0][1] > 6.3 && w[0][1] < 7, JSON.stringify(w));
  // a stalled scan that finished by seeking (a gap of a second in the middle of the wait) still finds it
  const mixed = [...times.filter((t) => t < 4.2), ...[5.2, 5.45, 5.7, 5.95, 6.2, 6.45, 6.7, 6.95, 7.2, 7.45]];
  const m = detectWaits(scan(mixed));
  assert.equal(m.length, 1);
  assert.ok(m[0][0] > 3 && m[0][1] > 6.3 && m[0][1] < 7, JSON.stringify(m));
});

test("waits: speedWaits switches the speed-up per clip; default on", () => {
  const a = { kind: "video" as const, duration: 10, waits: [[3.15, 6.6]] as [number, number][] };
  const on = clipPlan(a)!;
  assert.deepEqual(on.map((x) => [x.from, x.to, x.rate]), [[0, 3.15, 1], [3.15, 6.6, WAIT_SPEED], [6.6, 10, 1]]);
  assert.deepEqual(clipPlan({ ...a, speedWaits: true }), on);
  // off: no trim and nothing sped: plays straight through, as an untouched clip does
  assert.equal(clipPlan({ ...a, speedWaits: false }), null);
  assert.equal(playedLength({ ...a, speedWaits: false }), 10);
  // off with a trim: the trim still applies, the waits play at 1x
  const trimmed = clipPlan({ ...a, trim: { start: 1, end: 9 }, speedWaits: false })!;
  assert.deepEqual(trimmed.map((x) => [x.from, x.to, x.rate]), [[1, 9, 1]]);
  assert.deepEqual(spedWaits({ ...a, speedWaits: false }), []);
  assert.deepEqual(spedWaits(a), a.waits);
  // looked for and none found ([]) plays straight
  assert.equal(clipPlan({ kind: "video", duration: 10, waits: [] }), null);
});

test("waits: played length is the sped-up length (about 10 - 4 x 5/6 for a 4 s freeze), and what it saves", () => {
  const a = { kind: "video" as const, duration: 10, waits: [[3.15, 6.6]] as [number, number][] };
  const wait = 6.6 - 3.15;
  assert.ok(near(playedLength(a)!, 10 - wait * (1 - 1 / WAIT_SPEED), 0.002));
  assert.ok(playedLength(a)! < 7.2 && playedLength(a)! > 6.6);
  const s = waitSavings(a);
  assert.equal(s.count, 1);
  assert.ok(near(s.seconds, wait, 0.001));
  assert.ok(near(s.saves, wait * (1 - 1 / WAIT_SPEED), 0.002));
  // the saving counts only the waits inside the trim, and is the same whether the switch is on or off (it's what "on" saves)
  const t = waitSavings({ ...a, trim: { start: 5, end: 10 }, speedWaits: false });
  assert.equal(t.count, 1);
  assert.ok(near(t.seconds, 1.6, 0.001));
  assert.deepEqual(waitSavings({ kind: "video", duration: 10 }), { count: 0, seconds: 0, saves: 0 });
  assert.deepEqual(waitSavings({ kind: "image", duration: 10, waits: [[1, 3]] }), { count: 0, seconds: 0, saves: 0 });
  // the clip pieces add up to the played length
  assert.ok(near(piecesLength(clipPieces({ duration: 10, waits: a.waits })), playedLength(a)!, 0.002));
});

test("waits: a recording made in Cutmind keeps its waits even when not sped through (the switch is then off)", () => {
  assert.deepEqual(recordingMeta(10, { start: 0, end: 10 }, [[3, 6]], false), { screen: true, duration: 10, waits: [[3, 6]], speedWaits: false });
  assert.deepEqual(recordingMeta(10, { start: 0, end: 10 }, [[3, 6]]), { screen: true, duration: 10, waits: [[3, 6]] });
  // looked for and none found: an empty list, so an uploaded-clip scan never runs on it again
  assert.deepEqual(recordingMeta(10, { start: 0, end: 10 }, []), { screen: true, duration: 10, waits: [] });
});

test("waits: the AI editor reads the clip's sped-up length", async () => {
  const { transcriptText } = await import("../lib/ai");
  const lib: Asset[] = [
    { key: "a", name: "upload.mp4", kind: "video", duration: 10, width: 1280, height: 720, screen: true, waits: [[3.15, 6.6]] },
    { key: "b", name: "off.mp4", kind: "video", duration: 10, width: 1280, height: 720, screen: true, waits: [[3.15, 6.6]], speedWaits: false },
    { key: "c", name: "busy.mp4", kind: "video", duration: 10, width: 1280, height: 720, screen: true, waits: [] },
  ];
  const p = { id: "p", title: "t", createdAt: "", updatedAt: "", sources: [], words: [{ id: "w0", src: 0, s: 0, e: 0.3, w: "hi" }], versions: [],
    current: 0, status: "transcribed", library: lib } as Project;
  const text = transcriptText(p);
  assert.match(text, /key "a": screen recording "upload.mp4" 1280x720 7\.1s \(waits played 6x faster; 10\.0s at normal speed\)/);
  assert.match(text, /key "b": screen recording "off.mp4" 1280x720 10\.0s$/m);
  assert.match(text, /key "c": screen recording "busy.mp4" 1280x720 10\.0s$/m);
});
