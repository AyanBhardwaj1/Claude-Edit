import assert from "node:assert/strict";
import test from "node:test";
import { clipPieces, clipPlan, clipTimeAt, detectWaits, errorMessage, extFor, formatTime, frameChange, MIME_TYPES, pickMimeType,
  piecesLength, playedLength, recordingMeta, recordingName, samplesFrom, sayTime, stepAt, toGrey, WAIT_SPEED } from "../lib/screenrec";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("screenrec: MP4 / H.264 first, then WebM VP9, then VP8; nothing supported -> empty", () => {
  assert.equal(pickMimeType(() => true), MIME_TYPES[0]);
  assert.match(MIME_TYPES[0], /^video\/mp4;codecs="avc1/);
  // Chrome without an H.264 encoder: VP9 WebM
  const chrome = new Set(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8,opus", "video/webm"]);
  assert.equal(pickMimeType((t) => chrome.has(t)), "video/webm;codecs=vp9,opus");
  // Firefox: VP8 only
  assert.equal(pickMimeType((t) => t.startsWith("video/webm;codecs=vp8") || t === "video/webm"), "video/webm;codecs=vp8,opus");
  // Safari: plain MP4
  assert.equal(pickMimeType((t) => t === "video/mp4"), "video/mp4");
  assert.equal(pickMimeType(() => false), "");
  // a browser that throws on the question is skipped, not fatal
  assert.equal(pickMimeType((t) => { if (t.includes("mp4")) throw new Error("no"); return true; }), "video/webm;codecs=vp9,opus");
  assert.equal(extFor("video/mp4;codecs=avc1"), "mp4");
  assert.equal(extFor("video/webm;codecs=vp9"), "webm");
  assert.equal(extFor(""), "webm");
});

test("screenrec: times and names read the way people say them", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(7.9), "0:07");
  assert.equal(formatTime(65), "1:05");
  assert.equal(formatTime(600), "10:00");
  assert.equal(formatTime(7.42, true), "0:07.4");
  assert.equal(formatTime(59.99, true), "0:59.9");
  assert.equal(formatTime(61.25, true), "1:01.2");
  assert.equal(formatTime(-3), "0:00");
  assert.equal(formatTime(NaN), "0:00");
  assert.equal(formatTime(Infinity), "0:00");
  assert.equal(sayTime(1), "1 second");
  assert.equal(sayTime(65), "1 minute 5 seconds");
  assert.equal(sayTime(120), "2 minutes");
  const at = new Date(2026, 10, 6, 9, 5);
  assert.equal(recordingName(at, "video/mp4"), "Screen recording 2026-11-06 at 09.05.mp4");
  assert.equal(recordingName(at, "video/webm;codecs=vp9"), "Screen recording 2026-11-06 at 09.05.webm");
  assert.doesNotMatch(recordingName(at, "video/mp4"), /[:/\\]/);
});

test("screenrec: frame change counts the share of pixels that really moved", () => {
  const a = new Uint8Array(100).fill(120);
  assert.equal(frameChange(a, a), 0);
  const noise = a.map((v, i) => v + (i % 2 ? 6 : -6));             // sensor-like wobble under the tolerance
  assert.equal(frameChange(a, noise), 0);
  const caret = Uint8Array.from(a); caret[5] = 255;                  // a blinking caret: 1 pixel in 100
  assert.equal(frameChange(a, caret), 0.01);
  const page = Uint8Array.from(a); page.fill(250, 0, 40);            // a new page scrolled in
  assert.equal(frameChange(a, page), 0.4);
  assert.equal(frameChange(new Uint8Array(0), a), 1);
  assert.deepEqual([...toGrey([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])], [255, 0, 76]);
});

test("screenrec: waits are stretches of >= 1 s with < 1% change, padded in, from the frame that stays up", () => {
  // 0.25 s samples: moving for 1 s, frozen from 1.0 s to 3.0 s, moving, a 0.5 s freeze (too short), moving
  const changes = [1, 0.3, 0.2, 0.25, 0.4, 0, 0, 0.004, 0, 0, 0, 0.009, 0, 0.3, 0.2, 0, 0, 0.5, 0.2];
  const w = detectWaits(samplesFrom(changes), { pad: 0 });
  assert.deepEqual(w, [[1, 3]]);                                     // samples 5..12 still; the frame at sample 4 (1.0 s) stays up
  // with the default padding the edges come in by 0.15 s
  assert.deepEqual(detectWaits(samplesFrom(changes)), [[1.15, 2.85]]);
  // exactly 1 s qualifies; 0.75 s does not
  assert.deepEqual(detectWaits(samplesFrom([1, 1, 0, 0, 0, 0, 1]), { pad: 0 }), [[0.25, 1.25]]);
  assert.deepEqual(detectWaits(samplesFrom([1, 1, 0, 0, 0, 1]), { pad: 0 }), []);
  // a freeze running to the end of the recording counts too
  assert.deepEqual(detectWaits(samplesFrom([1, 0.5, 0, 0, 0, 0, 0, 0]), { pad: 0 }), [[0.25, 1.75]]);
  // 1% change is a change
  assert.deepEqual(detectWaits(samplesFrom([1, 1, 0.01, 0.01, 0.01, 0.01, 0.01]), { pad: 0 }), []);
  // the very first sample (compared with nothing) never starts a wait
  assert.deepEqual(detectWaits(samplesFrom([0, 0, 0, 0, 0, 0]), { pad: 0 }), [[0, 1.25]]);
  // a background tab samples about once a second: real timestamps still find the wait
  const slow = [{ t: 0, change: 1 }, { t: 1.1, change: 0.4 }, { t: 2.1, change: 0 }, { t: 3.2, change: 0 }, { t: 4.2, change: 0.3 }];
  assert.deepEqual(detectWaits(slow, { pad: 0 }), [[1.1, 3.2]]);
  assert.deepEqual(detectWaits([]), []);
});

test("screenrec: trim + waits -> pieces: waits 6x faster, lengths add up, a cut speed drops them", () => {
  const p = clipPieces({ duration: 20, trim: { start: 2, end: 18 }, waits: [[5, 11], [0, 3], [16, 25]] });
  // waits clipped to the trim: [2,3], [5,11], [16,18]
  assert.deepEqual(p.map((x) => [x.from, x.to, x.rate]), [[2, 3, 6], [3, 5, 1], [5, 11, 6], [11, 16, 1], [16, 18, 6]]);
  assert.ok(near(piecesLength(p), 1 / 6 + 2 + 1 + 5 + 2 / 6, 0.002));
  assert.ok(p.every((x, i) => i === 0 ? x.out0 === 0 : near(x.out0, p[i - 1].out1)));
  // jump cuts instead of speed
  const cut = clipPieces({ duration: 20, trim: { start: 2, end: 18 }, waits: [[5, 11]], speed: Infinity });
  assert.deepEqual(cut.map((x) => [x.from, x.to]), [[2, 5], [11, 18]]);
  assert.equal(piecesLength(cut), 10);
  // overlapping waits merge; tiny ones go
  const m = clipPieces({ duration: 10, waits: [[2, 4], [3.5, 6], [8, 8.05]] });
  assert.deepEqual(m.map((x) => [x.from, x.to, x.rate]), [[0, 2, 1], [2, 6, WAIT_SPEED], [6, 10, 1]]);
  // nothing to do: one straight piece
  assert.deepEqual(clipPieces({ duration: 8 }).map((x) => [x.from, x.to, x.rate, x.out1]), [[0, 8, 1, 8]]);
  // a wait covering the whole trim still leaves a piece to play
  assert.equal(clipPieces({ duration: 6, trim: { start: 1, end: 3 }, waits: [[0, 6]], speed: Infinity }).length, 1);
});

test("screenrec: shot time maps onto the clip (and back round when the shot is longer)", () => {
  const p = clipPieces({ duration: 20, trim: { start: 2, end: 14 }, waits: [[5, 11]] });   // 2-5 @1, 5-11 @6, 11-14 @1 = 3 + 1 + 3 = 7 s
  assert.equal(piecesLength(p), 7);
  assert.deepEqual(clipTimeAt(p, 0), { t: 2, rate: 1 });
  assert.deepEqual(clipTimeAt(p, 2.5), { t: 4.5, rate: 1 });
  assert.deepEqual(clipTimeAt(p, 3.5), { t: 8, rate: 6 });           // half way through the sped-up wait
  assert.deepEqual(clipTimeAt(p, 4), { t: 11, rate: 1 });
  assert.deepEqual(clipTimeAt(p, 6.5), { t: 13.5, rate: 1 });
  assert.deepEqual(clipTimeAt(p, 7.5), { t: 2.5, rate: 1 });         // loops like the player's clips
  assert.ok(clipTimeAt(p, 50, false).t <= 14);
  assert.deepEqual(clipTimeAt(p, -1), { t: 2, rate: 1 });
  // the preview steps: play, speed up, jump past a cut, back to the in-point at the end
  assert.deepEqual(stepAt(p, 3), { rate: 1 });
  assert.deepEqual(stepAt(p, 6), { rate: 6 });
  assert.deepEqual(stepAt(p, 0.5), { rate: 1, jump: 2 });
  assert.deepEqual(stepAt(p, 14.2), { rate: 1, jump: 2 });
  const cut = clipPieces({ duration: 20, waits: [[5, 11]], speed: Infinity });
  assert.deepEqual(stepAt(cut, 7), { rate: 1, jump: 11 });
});

test("screenrec: a recording's library entry is a screen, with a trim only when trimmed and waits only when sped through", () => {
  assert.deepEqual(recordingMeta(6.04, { start: 0, end: 6.04 }, null), { screen: true, duration: 6.04 });
  assert.deepEqual(recordingMeta(6, { start: 0.8, end: 5.5 }, [[1, 3], [5.6, 6]]),
    { screen: true, duration: 6, trim: { start: 0.8, end: 5.5 }, waits: [[1, 3]] });
  const a = { kind: "video" as const, duration: 6, trim: { start: 0.8, end: 5.5 }, waits: [[1, 3]] as [number, number][] };
  assert.ok(near(playedLength(a)!, 0.2 + 2 / 6 + 2.5, 0.002));
  assert.equal(playedLength({ kind: "video", duration: 9 }), 9);
  assert.equal(clipPlan({ kind: "video", duration: 9 }), null);       // untouched clips play exactly as before
  assert.equal(clipPlan({ kind: "image", duration: 9, trim: { start: 1, end: 2 } }), null);
  assert.equal(clipPlan({ kind: "video", trim: { start: 1, end: 2 } }), null);   // no known length: play straight
  assert.ok(clipPlan(a));
});

test("screenrec: failures in plain words", () => {
  assert.match(errorMessage({ name: "NotAllowedError", message: "Permission denied" }), /wasn't allowed/);
  assert.match(errorMessage({ name: "NotAllowedError", message: "Permission denied by system" }), /System Settings/);
  assert.match(errorMessage({ name: "NotReadableError", message: "" }), /couldn't start/);
  assert.match(errorMessage({ name: "NotFoundError", message: "" }), /nothing to record/);
  assert.match(errorMessage(new Error("boom")), /boom/);
  for (const m of [errorMessage({ name: "NotAllowedError" }), errorMessage({ name: "NotReadableError" })])
    assert.doesNotMatch(m, /Error|DOMException|getDisplayMedia/);
});
