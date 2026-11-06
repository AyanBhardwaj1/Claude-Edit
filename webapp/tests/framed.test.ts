import assert from "node:assert/strict";
import test from "node:test";
import { toAiShape } from "../lib/ai";
import { analyze } from "../lib/analyze";
import { defaultEdit, fromAi } from "../lib/edit";
import { backdropFor, framedLayout, framedView, framedZoom, inBand, IVORY, looksLikeScreen, smooth, type FaceZone, type FramedLayout } from "../lib/framed";
import { EDIT_SCHEMA } from "../lib/prompts";
import { boxedChars, boxedCues, boxedLines, type CapWord } from "../lib/text";
import type { Project, Word } from "../lib/types";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const inside = (b: { x: number; y: number; w: number; h: number }, W: number, H: number) =>
  b.x >= -1e-6 && b.y >= -1e-6 && b.x + b.w <= W + 1e-6 && b.y + b.h <= H + 1e-6;

// a speaker in a 9:16 reel: eyes-to-chin zone around 0.36H .. 0.55H
const FACE_916: FaceZone = { x0: 380, x1: 700, y0: 690, y1: 1060 };
const FACE_11: FaceZone = { x0: 380, x1: 700, y0: 320, y1: 670 };

test("framed: 16:9 is full frame at 92% with 18 px corners and the soft shadow", () => {
  const L = framedLayout({ W: 1920, H: 1080, aw: 2880, ah: 1620, face: FACE_11 });
  assert.equal(L.mode, "full");
  assert.ok(near(L.screen.w, 0.92 * 1920) && near(L.screen.h, 0.92 * 1080), JSON.stringify(L.screen));
  assert.ok(near(L.screen.x, 0.04 * 1920) && near(L.screen.y, 0.04 * 1080));
  assert.ok(inside(L.screen, 1920, 1080));
  assert.deepEqual(L.region, { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(L.radius, 18);
  assert.deepEqual(L.shadow, { blur: 60, dy: 24, alpha: 0.18 });
  // a 16:10 screen keeps its shape inside the 92% box
  const M = framedLayout({ W: 1920, H: 1080, aw: 1440, ah: 900, face: null });
  assert.ok(near(M.screen.w / M.screen.h, 1.6) && M.screen.h <= 0.92 * 1080 + 1e-6 && inside(M.screen, 1920, 1080));
});

test("framed: 9:16 with a face puts a full-width screen on top and never covers the eyes-to-chin zone", () => {
  const W = 1080, H = 1920;
  const L = framedLayout({ W, H, aw: 1920, ah: 1080, face: FACE_916 });
  assert.equal(L.mode, "split");
  assert.ok(inside(L.screen, W, H) && inside(L.region, W, H));
  assert.ok(near(L.screen.w, W * 0.92), `full width minus margins: ${L.screen.w}`);
  assert.ok(L.screen.y + L.screen.h <= L.region.h, "screen inside the backdrop band");
  assert.ok(L.screen.y + L.screen.h + L.shadow.dy + L.shadow.blur <= L.region.h + 0.2 * L.shadow.blur, "room for the shadow under the screen");
  assert.ok(L.region.h < 0.5 * H, `upper area: ${L.region.h}`);
  // where the face lands once the speaker moves into the band below
  const top = inBand(L, FACE_916.y0, H), chin = inBand(L, FACE_916.y1, H);
  assert.ok(top >= L.region.h, `face top ${top} below the backdrop ${L.region.h}`);
  assert.ok(chin <= H * 0.8, `chin ${chin} stays above the subtitles`);
  assert.ok(L.screen.y + L.screen.h <= top);
  // no face on screen (tracked, not seen) or the brief says full-frame: the backdrop may cover everything
  const F = framedLayout({ W, H, aw: 1920, ah: 1080, face: null });
  assert.equal(F.mode, "full");
  assert.ok(inside(F.screen, W, H) && near(F.screen.w, 0.92 * W));
  assert.ok(F.screen.y + F.screen.h / 2 <= 0.5 * H, "upper/middle area");
  assert.equal(framedLayout({ W, H, aw: 1920, ah: 1080, face: FACE_916, full: true }).mode, "full");
  // a phone recording on a reel fits the band at its own shape
  const P = framedLayout({ W, H, aw: 1170, ah: 2532, face: FACE_916 });
  assert.ok(inside(P.screen, W, H) && P.screen.y + P.screen.h <= P.region.h && inBand(P, FACE_916.y0, H) >= P.region.h);
});

test("framed: 1:1 and 4:5 with a face keep the face whole below the screen", () => {
  for (const [W, H, face] of [[1080, 1080, FACE_11], [1080, 1350, { x0: 380, x1: 700, y0: 420, y1: 860 }]] as [number, number, FaceZone][]) {
    const L: FramedLayout = framedLayout({ W, H, aw: 1920, ah: 1080, face });
    assert.equal(L.mode, "split");
    assert.ok(inside(L.screen, W, H), JSON.stringify(L));
    assert.ok(L.screen.y + L.screen.h <= L.region.h);
    const top = inBand(L, face.y0, H), chin = inBand(L, face.y1, H);
    assert.ok(top >= L.region.h && chin <= H, `${W}x${H}: face ${top}-${chin}, band from ${L.region.h}`);
    assert.ok(near(L.screen.w / L.screen.h, 16 / 9, 1e-3));
    assert.equal(L.radius, 18);
  }
});

test("framed: Ken Burns and punch-in easing are pure functions of time", () => {
  assert.equal(framedZoom(0, 4), 1);
  assert.ok(near(framedZoom(2, 4), 1.035));
  assert.ok(near(framedZoom(4, 4), 1.07));
  assert.ok(near(framedZoom(9, 4), 1.07), "holds after the shot");
  const punch = { at: 1, zoom: 1.6 };
  assert.ok(near(framedZoom(1, 4, punch), 1.0175), "punch starts at `at`");
  assert.ok(near(framedZoom(1.175, 4, punch), (1 + 0.07 * 1.175 / 4) * 1.3), "halfway through 350 ms: half the punch");
  assert.ok(near(framedZoom(1.35, 4, punch), (1 + 0.07 * 1.35 / 4) * 1.6), "arrives at 350 ms");
  assert.equal(smooth(0), 0); assert.equal(smooth(0.5), 0.5); assert.equal(smooth(1), 1);
  assert.ok(smooth(0.1) < 0.1 && smooth(0.9) > 0.9, "ease-in-out");
  // frame-rate independent: 24 and 60 fps sample the same curve
  for (const [frame24, frame60] of [[30, 75], [12, 30], [96, 240]]) assert.equal(framedZoom(frame24 / 24, 4, punch), framedZoom(frame60 / 60, 4, punch));
  // the view never leaves the picture and lands on the focus
  const focus = { x: 0.8, y: 0.2 };
  for (const t of [0, 0.5, 1.1, 1.4, 3.9]) {
    const v = framedView(2880, 1620, { w: 1766, h: 994 }, t, 4, focus, punch);
    assert.ok(v.x >= -1e-6 && v.y >= -1e-6 && v.x + v.w <= 2880 + 1e-6 && v.y + v.h <= 1620 + 1e-6, `t=${t} ${JSON.stringify(v)}`);
  }
  const end = framedView(2880, 1620, { w: 1766, h: 994 }, 3.9, 4, focus, punch);
  assert.ok(end.x <= 0.8 * 2880 && end.x + end.w >= 0.8 * 2880 && end.y <= 0.2 * 1620 && end.y + end.h >= 0.2 * 1620, "focus in view");
  assert.ok(near(end.h, 1620 / framedZoom(3.9, 4, punch)), "zoom from the native picture");
  const still = framedView(1920, 1080, { w: 1766, h: 994 }, 0, 4);
  assert.ok(still.x < 1 && still.w > 1918 && near(still.y, 0) && near(still.h, 1080), "the whole picture at the start");
  // a tall page in a wide box keeps its top
  const page = framedView(1440, 6000, { w: 1766, h: 994 }, 0, 4);
  assert.equal(page.y, 0);
});

test("framed: backdrop is ivory, or a light tint of the brand accent", () => {
  assert.equal(backdropFor(null), IVORY);
  assert.equal(backdropFor("nope"), IVORY);
  const t = backdropFor("#FF7A3D");
  assert.match(t, /^#[0-9a-f]{6}$/);
  const lum = (h: string) => [1, 3, 5].reduce((a, i) => a + parseInt(h.slice(i, i + 2), 16), 0) / 3;
  assert.ok(lum(t) > 200, `still soft: ${t}`);
  assert.notEqual(t, IVORY);
});

/** Synthetic RGBA samples, like getImageData on a 160 px drawing. */
function sample(w: number, h: number, px: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = px(x, y); d.set([r, g, b, 255], 4 * (y * w + x)); }
  return d;
}
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

test("screen detection: flat UI colours yes, photos and gradients no", () => {
  const W = 160, H = 90;
  const ui = sample(W, H, (x, y) => {
    if (y < 10) return [24, 28, 40];                                      // top bar
    if (x < 30) return [242, 244, 247];                                   // sidebar
    if (y > 20 && y < 50 && x > 40 && x < 150) return [255, 255, 255];   // a card
    if (y % 6 === 0 && x > 45 && x < 120 && y > 22 && y < 48) return [60, 64, 72];   // text lines
    if (y > 60 && y < 70 && x > 40 && x < 70) return [99, 102, 241];     // a button
    return [248, 249, 251];
  });
  assert.ok(looksLikeScreen(ui, W, H, 1920, 1080), "a dashboard screenshot");
  assert.ok(looksLikeScreen(ui, W, H), "flat enough without the screen shape too");
  const photo = sample(W, H, (x, y) => {
    const base = 120 + 60 * Math.sin(x / 9) * Math.cos(y / 7);
    return [base + rand() * 30, base * 0.8 + rand() * 30, base * 0.6 + rand() * 30].map((v) => Math.max(0, Math.min(255, Math.round(v)))) as [number, number, number];
  });
  assert.ok(!looksLikeScreen(photo, W, H, 1920, 1080), "a noisy photo");
  const sky = sample(W, H, (x, y) => [Math.round(90 + x * 0.9), Math.round(140 + y * 0.8), 230]);
  assert.ok(!looksLikeScreen(sky, W, H, 4032, 3024), "a smooth gradient is not a screen");
});

// ------------------------------------------------------------------ the AI's framed screens round-trip

const words = (text: string): Word[] => text.split(" ").map((w, i) => ({ id: `w${i}`, src: 0, s: i * 0.4, e: i * 0.4 + 0.3, w }));

test("schema: framed + focus/punch survive fromAi -> toAiShape -> fromAi; boxed is a caption style", () => {
  const ws = words("open the dashboard and click the export button to get your video");
  const p: Project = { id: "p", title: "t", createdAt: "", updatedAt: "", sources: [{ id: 0, name: "a.mp4", mediaKey: "k", duration: 60, width: 1080, height: 1920 }],
    words: ws, library: [{ key: "shot", name: "dashboard.png", kind: "image", width: 2880, height: 1800, screen: true }],
    versions: [], current: 0, status: "transcribed", analysis: analyze(ws) };
  const items = (EDIT_SCHEMA.properties.broll.items.properties.treatment as { enum: readonly string[] }).enum;
  assert.ok(items.includes("framed"));
  assert.ok(EDIT_SCHEMA.properties.captions.properties.preset.enum.includes("boxed"));
  const base = defaultEdit(p);
  const { edit, problems } = fromAi(p, base, {
    broll: [{ asset: "shot", from: "w1", to: "w9", treatment: "framed", focus: { x: 0.82, y: 0.12 }, punch: { at: 1.2, zoom: 1.6 } }],
    captions: { preset: "boxed" },
  });
  assert.deepEqual(problems, []);
  const b = edit.broll[0];
  assert.equal(b.treatment, "framed");
  assert.deepEqual(b.focus, { x: 0.82, y: 0.12 });
  assert.deepEqual(b.punch, { at: 1.2, zoom: 1.6 });
  assert.equal(edit.captions.preset, "boxed");
  assert.equal(edit.captions.textCase, "as-is", "boxed reads in sentence case");
  assert.equal(edit.captions.font, "Figtree");
  const shape = toAiShape(edit);
  assert.deepEqual(shape.broll?.[0], { asset: "shot", from: "w1", to: "w9", treatment: "framed", side: "auto", focus: { x: 0.82, y: 0.12 },
    punch: { at: 1.2, zoom: 1.6 }, full: undefined, backdrop: undefined });
  const again = fromAi(p, edit, JSON.parse(JSON.stringify(shape))).edit;
  assert.deepEqual(again.broll, edit.broll);
  assert.deepEqual(again.captions, edit.captions);
  // junk is clamped or dropped
  const junk = fromAi(p, base, { broll: [{ asset: "shot", from: "w1", to: "w3", treatment: "framed", focus: { x: 4, y: -1 },
    punch: { at: -2, zoom: 9 }, backdrop: "red" }] }).edit.broll[0];
  assert.deepEqual(junk.focus, { x: 1, y: 0 });
  assert.deepEqual(junk.punch, { at: 0, zoom: 2.5 });
  assert.equal(junk.backdrop, undefined);
  // other treatments don't pick up framed fields
  const card = fromAi(p, base, { broll: [{ asset: "shot", from: "w1", to: "w3", treatment: "side-card", focus: { x: 0.5, y: 0.5 } }] }).edit.broll[0];
  assert.equal(card.focus, undefined);
});

test("LIBRARY lines call screens screenshots and screen recordings", async () => {
  const { transcriptText } = await import("../lib/ai");
  const ws = words("look at this");
  const p = { id: "p", title: "t", createdAt: "", updatedAt: "", sources: [], words: ws, versions: [], current: 0, status: "transcribed",
    library: [{ key: "a", name: "app.png", kind: "image", width: 1440, height: 900, screen: true },
      { key: "b", name: "demo.mp4", kind: "video", duration: 8, width: 1920, height: 1080, screen: true },
      { key: "c", name: "beach.jpg", kind: "image", width: 4032, height: 3024 }] } as Project;
  const text = transcriptText(p);
  assert.match(text, /key "a": screenshot "app.png" 1440x900/);
  assert.match(text, /key "b": screen recording "demo.mp4" 1920x1080 8.0s/);
  assert.match(text, /key "c": image "beach.jpg"/);
});

// ------------------------------------------------------------------ boxed subtitles

const cap = (text: string, gap = 0.35): CapWord[] => text.split(" ").map((w, i) => ({ id: `w${i}`, text: w, os: i * gap, oe: i * gap + 0.3, seg: 0 }));

test("boxed captions: a phrase at a time, at most 2 lines of 42 characters", () => {
  const long = "So this is the part where most people give up on editing their videos, because the timeline gets messy and slow, " +
    "and honestly I did too until I found a better way to do it every single week";
  const lines = boxedLines("open the dashboard and click export", 42, 2)!;
  assert.deepEqual(lines, ["open the dashboard and click export"]);
  const two = boxedLines("this sentence is long enough that it needs two lines here", 42, 2)!;
  assert.equal(two.length, 2);
  assert.ok(two.every((l) => l.length <= 42));
  assert.ok(Math.abs(two[0].length - two[1].length) <= 10, `balanced: ${two}`);
  assert.equal(boxedLines(long, 42, 2), null, "too long for one box");
  const cues = boxedCues(cap(long), 42, 2);
  assert.ok(cues.length >= 3, `${cues.length} cues`);
  for (const c of cues) {
    const ls = boxedLines(c.words.map((w) => w.text).join(" "), 42, 2)!;
    assert.ok(ls && ls.length <= 2 && ls.every((l) => l.length <= 42), JSON.stringify(ls));
    assert.ok(c.end > c.start);
  }
  // every word once, in order
  assert.equal(cues.flatMap((c) => c.words.map((w) => w.text)).join(" "), long);
  // a sentence end starts a new phrase
  const s = boxedCues(cap("Short one. Then another line"), 42, 2);
  assert.deepEqual(s.map((c) => c.words.map((w) => w.text).join(" ")), ["Short one.", "Then another line"]);
  // narrow reels hold fewer characters a line, wide videos 42
  assert.equal(boxedChars(1920, 59), 42);
  assert.ok(boxedChars(1080, 59) < 42 && boxedChars(1080, 59) >= 24);
});
