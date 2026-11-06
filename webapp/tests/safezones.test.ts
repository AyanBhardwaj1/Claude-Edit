import assert from "node:assert/strict";
import test from "node:test";
import { captionBand, subtitlesCovered } from "../lib/safezones";

const caps = (position: number, size = 105, enabled = true) => ({ captions: { enabled, preset: "studio", size, position, textCase: "upper", maxWords: 3, font: "Montserrat" } }) as never;

test("the default subtitles sit clear; low or huge ones go under the platforms' caption block", () => {
  assert.deepEqual(subtitlesCovered(caps(0.75)), []);
  assert.deepEqual(subtitlesCovered(caps(0.66)), []);
  assert.deepEqual(subtitlesCovered(caps(0.86)).sort(), ["reels", "shorts", "tiktok"]);
  assert.ok(subtitlesCovered(caps(0.79, 160)).includes("tiktok"));
  assert.deepEqual(subtitlesCovered(caps(0.9, 105, false)), []);
  const [a, b] = captionBand(caps(0.75));
  assert.ok(a < 0.75 && b > 0.75 && b - a < 0.1);
});

test("covered subtitles get the lowest position every platform leaves clear", async () => {
  const { clearPosition } = await import("../lib/safezones");
  assert.equal(clearPosition(caps(0.75)), null);                       // already clear
  const p = clearPosition(caps(0.86))!;
  assert.ok(p < 0.77 && p > 0.6, String(p));
  assert.deepEqual(subtitlesCovered(caps(p)), []);
  const big = clearPosition(caps(0.85, 200))!;
  assert.deepEqual(subtitlesCovered(caps(big, 200)), []);
  assert.ok(big < p);
});
