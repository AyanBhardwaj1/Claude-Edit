import assert from "node:assert/strict";
import test from "node:test";
import { autoSections, bedName, curve, duckCurve, fitToVideo, gridOffset, harmony, KEYS, MOOD_IDS, MOODS, parseKey, planBed, progression,
  scoreBed, suggestMood, toMode } from "../lib/compose";
import { integratedLufs, kWeighting, limitPeaks, normalise, samplePeakDb } from "../lib/loudness";
import { wav } from "../lib/media";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const onGrid = (t: number, off: number, unit: number) => { const k = (t - off) / unit; return near(k, Math.round(k), 1e-3); };

test("section plan: sections sit on the bar grid and the final chord lands exactly where asked", () => {
  for (const mood of MOOD_IDS) for (const [length, end] of [[60, 57.3], [20, 18.2], [33.7, 31.1], [8, 6.5], [4, 2.5], [180, 175]]) {
    const P = planBed({ length, mood, endChordAt: end });
    assert.equal(P.endChordAt, end, `${mood} ${length}`);
    assert.ok(near(P.ring, length - end));
    assert.equal(P.bpm, MOODS[mood].bpm);
    assert.ok(onGrid(end, P.gridOffset, P.bar), "the final chord is a downbeat");
    assert.equal(P.sections[0].at, 0);
    assert.ok(near(P.sections[P.sections.length - 1].end, end, 1e-4), "the last section ends on the final chord");
    P.sections.forEach((s, i) => {
      if (i) assert.ok(onGrid(s.at, P.gridOffset, P.bar), `${mood} ${length}: ${s.name} at ${s.at} is on a downbeat`);
      if (i) assert.equal(s.at, P.sections[i - 1].end);
      assert.ok(s.end > s.at, `${s.name} has length`);
    });
  }
});

test("section plan: the shape grows with the length and keeps its order", () => {
  const names = (len: number) => planBed({ length: len, mood: "warm", endChordAt: len - 2 }).sections.map((s) => s.name);
  assert.deepEqual(names(150), ["intro", "groove", "fill", "groove2", "lead", "build", "peak", "breakdown", "resolve"]);
  assert.deepEqual(names(60), ["intro", "groove", "fill", "build", "peak", "breakdown", "resolve"]);
  assert.deepEqual(names(30), ["intro", "groove", "build", "peak", "resolve"]);
  assert.equal(names(3.5).at(-1), "resolve");
  const P = planBed({ length: 60, mood: "warm", endChordAt: 58 });
  assert.equal(P.sections.find((s) => s.name === "fill")!.bars, 1);
  assert.ok(near(P.sections.reduce((a, s) => a + s.bars, 0), (58 - 0) / P.bar, 1.01));
  // the default ring, the grid offset and errors
  assert.ok(near(planBed({ length: 40 }).ring, 6));
  assert.equal(gridOffset(9.6, 2.4), 0);
  assert.ok(near(gridOffset(10, 2.4), 0.4));
  assert.deepEqual(autoSections(0.2, 2.4), [{ name: "intro", at: 0 }]);
  assert.throws(() => planBed({ length: 10, endChordAt: 9.9 }));
  assert.throws(() => planBed({ length: 10, mood: "polka" as never }));
});

test("fit to the video: as long as the edit, the final chord a little before the end", () => {
  for (const d of [12, 20, 28.4, 60, 95]) {
    const f = fitToVideo(d);
    assert.equal(f.length, d);
    assert.ok(f.endChordAt < d - 1.4 && f.endChordAt >= d - 3.5, `${d}: ${f.endChordAt}`);
    const S = scoreBed({ length: f.length, endChordAt: f.endChordAt });
    const finals = S.events.filter((e) => e.i === "pad" && near(e.t, f.endChordAt));
    assert.equal(finals.length, 1, "one final chord, exactly at the end chord time");
  }
  assert.equal(suggestMood(null), "warm");
  assert.equal(suggestMood(150), "warm");
  assert.equal(suggestMood(200), "uplifting");
  assert.equal(suggestMood(100), "lofi");
  assert.equal(bedName("warm", 100), "Original – warm 100 BPM");
});

test("keys and modes: every mood in every key makes a valid score", () => {
  assert.equal(KEYS.length, 24);
  for (const mood of MOOD_IDS) for (const key of KEYS) {
    const S = scoreBed({ length: 24, mood, key, endChordAt: 21.5 });
    assert.ok(S.events.length > 50, `${mood} ${key}: ${S.events.length} events`);
    for (const e of S.events) {
      assert.ok(Number.isFinite(e.t) && Number.isFinite(e.dur) && e.dur > 0 && e.vel > 0, `${mood} ${key} ${e.i}`);
      assert.ok(e.t <= S.plan.endChordAt + 0.1, `${e.i} at ${e.t} after the final chord`);
      for (const m of e.notes) assert.ok(Number.isInteger(m) && m >= 20 && m <= 100, `${mood} ${key} note ${m}`);
    }
    // nothing but the final chord's ring sounds after the end chord, and nothing louder after the fade
    assert.ok(S.kicks.every((k) => k < S.plan.endChordAt));
    assert.equal(S.mode, key.endsWith("m") ? "minor" : MOODS[mood].mode);
  }
});

test("progressions: transposed by key, mapped degree by degree into minor modes", () => {
  const pcs = (ns: number[]) => ns.map((n) => ((n % 12) + 12) % 12);
  assert.deepEqual(parseKey("F#"), { pc: 6, mode: "" });
  assert.deepEqual(parseKey("Bbm"), { pc: 10, mode: "minor" });
  assert.deepEqual(parseKey("D minor"), { pc: 2, mode: "minor" });
  assert.throws(() => parseKey("H"));
  // D major as written: Dmaj7 Bm7 Gmaj7 A/E
  assert.deepEqual(progression("warm", "D").chords, [[50, 54, 57, 61], [47, 54, 57, 62], [55, 59, 62, 66], [52, 57, 61, 64]]);
  // D minor: Dmaj7 -> Dm7 (F natural, C natural)
  const dm = progression("warm", "Dm");
  assert.equal(dm.mode, "minor");
  assert.deepEqual(dm.chords[0], [50, 53, 57, 60]);
  // A minor: tonic chord A C E G, the V chord's third stays minor in natural minor
  const am = progression("warm", "Am");
  assert.deepEqual(pcs(am.chords[0]), [9, 0, 4, 7]);
  assert.deepEqual(pcs([am.roots[0]]), [9]);
  // tense is harmonic minor: the leading tone is raised (C# in D)
  const tense = progression("tense", "D");
  assert.equal(tense.mode, "harmonic");
  assert.ok(pcs(tense.chords[3]).includes(1), "A/E in D harmonic minor keeps C#");
  assert.ok(pcs(tense.chords[0]).includes(5), "the tonic chord is minor (F)");
  // uplifting starts on the vi
  assert.deepEqual(progression("uplifting", "C").chords[0], harmony("C", "major")([47, 54, 57, 62]));
  assert.equal(toMode(66, 38, "minor"), 65, "F# -> F in D minor");
  assert.equal(toMode(64, 38, "minor"), 64, "E stays");
  assert.equal(toMode(63, 38, "minor"), 63, "notes outside the major scale stay");
});

test("control curves: interpolation and kick pumping", () => {
  const c = curve([[0, 0], [1, 1], [2, 1]], 2, 10);
  assert.equal(c.length, 21);
  assert.ok(near(c[5], 0.5, 1e-6) && near(c[20], 1));
  const d = duckCurve([1], 2, 1000, 0.55, 0.16);
  assert.equal(d[0], 1);
  assert.ok(near(d[1000], 0.45, 1e-6), `dip ${d[1000]}`);
  assert.ok(d[1160] > 0.75 && d[1160] < 0.85, "recovers with tau");
  assert.ok(d[1999] > 0.99);
});

const sine = (freq: number, amp: number, seconds: number, rate = 48000) => {
  const x = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return x;
};

test("loudness: K-weighting coefficients match BS.1770 at 48 kHz", () => {
  const [s, h] = kWeighting(48000);
  assert.ok(near(s.b0, 1.53512485958697, 1e-9) && near(s.b1, -2.69169618940638, 1e-9) && near(s.b2, 1.19839281085285, 1e-9));
  assert.ok(near(s.a1, -1.69065929318241, 1e-9) && near(s.a2, 0.73248077421585, 1e-9));
  assert.ok(near(h.a1, -1.99004745483398, 1e-9) && near(h.a2, 0.99007225036621, 1e-9));
});

test("loudness: a 1 kHz sine reads its known LUFS, silence is gated out", () => {
  // full scale in one channel reads -3.01 LUFS (BS.1770); the same in both channels 0 LUFS; -20 dB lower reads 20 lower
  const one = sine(1000, 1, 5);
  assert.ok(Math.abs(integratedLufs([one], 48000) - -3.01) < 0.5, `mono ${integratedLufs([one], 48000)}`);
  const a = sine(1000, 0.1, 5);
  const L = integratedLufs([a, a], 48000);
  assert.ok(Math.abs(L - -20) < 0.5, `stereo -20 dB sine read ${L}`);
  // half silence: the absolute gate keeps the reading at the sine's level
  const gap = new Float32Array(a.length * 2); gap.set(a, 0);
  assert.ok(Math.abs(integratedLufs([gap, gap], 48000) - L) < 0.3);
  assert.equal(integratedLufs([new Float32Array(48000 * 2)], 48000), -70);
  assert.ok(Math.abs(integratedLufs([sine(1000, 0.1, 5, 44100)], 44100) - -23.01) < 0.5, "other rates too");
});

test("loudness: normalise reaches the target and keeps peaks under the ceiling", () => {
  // a sine with sharp spikes: the target needs gain the peaks can't take, so the limiter works
  const x = sine(220, 0.05, 6), y = sine(330, 0.05, 6);
  for (let i = 0; i < x.length; i += 4800) { x[i] = 0.6; y[i + 1] = -0.6; }
  const m = normalise([x, y], 48000, -16, -1.5);
  assert.ok(Math.abs(m.lufs - -16) < 0.5, `lufs ${m.lufs}`);
  assert.ok(m.peakDb <= -1.5 + 1e-6, `peak ${m.peakDb}`);
  assert.ok(samplePeakDb([x, y]) <= -1.5 + 1e-6);
  const z = sine(100, 0.99, 1);
  limitPeaks([z], 48000, -6);
  assert.ok(samplePeakDb([z]) <= -6 + 1e-6);
});

test("WAV: a 16-bit PCM stereo header, interleaved samples", async () => {
  const L = new Float32Array([0, 0.5, -1, 2]), R = new Float32Array([1, -0.5, 0.25, -2]);
  const b = wav([L, R], 48000);
  assert.equal(b.type, "audio/wav");
  const v = new DataView(await b.arrayBuffer());
  const str = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => v.getUint8(o + i)));
  assert.equal(str(0), "RIFF"); assert.equal(str(8), "WAVE"); assert.equal(str(12), "fmt "); assert.equal(str(36), "data");
  assert.equal(v.byteLength, 44 + 4 * 2 * 2);
  assert.equal(v.getUint32(4, true), 36 + 16);
  assert.equal(v.getUint32(16, true), 16);
  assert.equal(v.getUint16(20, true), 1, "PCM");
  assert.equal(v.getUint16(22, true), 2, "stereo");
  assert.equal(v.getUint32(24, true), 48000);
  assert.equal(v.getUint32(28, true), 48000 * 4, "byte rate");
  assert.equal(v.getUint16(32, true), 4, "block align");
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 16);
  const s = (i: number) => v.getInt16(44 + i * 2, true);
  assert.deepEqual([s(0), s(1), s(2), s(3), s(4), s(5), s(6), s(7)], [0, 32767, 16384, -16383, -32767, 8192, 32767, -32767]);
  // mono still works as before (transcription uploads)
  const m = new DataView(await wav(new Float32Array(10), 16000).arrayBuffer());
  assert.equal(m.getUint16(22, true), 1); assert.equal(m.getUint32(28, true), 32000); assert.equal(m.byteLength, 64);
});
