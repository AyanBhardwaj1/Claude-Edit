import assert from "node:assert/strict";
import test from "node:test";
import { framedLayout } from "../lib/framed";
import { ease } from "../lib/motion";
import { busyRegion, calloutK, calloutPlace, focusBox, hintFocus, overlaps, pointOnScreen, punchOf, SCREEN, screenEnter, screenLayout, screenPunchK,
  screenView } from "../lib/screenScene";

type Box = { x: number; y: number; w: number; h: number };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const inside = (b: Box, W: number, H: number) => b.x >= -1e-6 && b.y >= -1e-6 && b.x + b.w <= W + 1e-6 && b.y + b.h <= H + 1e-6;
const within = (b: Box, o: Box) => b.x >= o.x - 1e-6 && b.y >= o.y - 1e-6 && b.x + b.w <= o.x + o.w + 1e-6 && b.y + b.h <= o.y + o.h + 1e-6;

const FRAMES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] } as const;
const PICTURES = { laptop: [2880, 1800], wide: [1920, 1080], phone: [1170, 2532], square: [1200, 1200] } as const;
const FOCI = [{ x: 0.1, y: 0.08 }, { x: 0.5, y: 0.5 }, { x: 0.92, y: 0.15 }, { x: 0.2, y: 0.9 }, { x: 0.85, y: 0.85 }, { x: 0.5, y: 0.49 }, { x: 0.5, y: 0.51 }];

test("app screen: the screen sits inside the frame in every shape, the caption beside it, never over it", () => {
  for (const [fname, [W, H]] of Object.entries(FRAMES)) {
    for (const [pname, [aw, ah]] of Object.entries(PICTURES)) {
      for (const f of FOCI) {
        const L = screenLayout({ W, H, aw, ah, caption: true, focusY: f.y, focusX: f.x });
        const at = `${fname} ${pname} focus ${f.x},${f.y}`;
        assert.ok(inside(L.screen, W, H), `screen inside the frame: ${at} ${JSON.stringify(L.screen)}`);
        assert.ok(L.caption && inside(L.caption, W, H), `caption inside the frame: ${at}`);
        assert.ok(!overlaps(L.caption!, L.screen), `caption clear of the screen: ${at}`);
        assert.ok(near(L.screen.w / L.screen.h, aw / ah, 1e-6), `the screenshot keeps its shape: ${at}`);
        assert.ok(L.screen.w <= 0.92 * W + 1e-6 && L.screen.h <= 0.92 * H + 1e-6 && (L.screen.w >= 0.5 * W || L.screen.h >= 0.6 * H),
          `a sensible size: ${at} ${L.screen.w}x${L.screen.h}`);
        assert.ok(L.caption!.w >= 0.3 * W, `room for the words: ${at}`);
        // the caption goes on the side away from the focus (beside a phone screen in a wide frame)
        if (W > H && aw < ah) {
          assert.equal(L.side, f.x >= 0.5 ? "left" : "right", at);
          if (L.side === "left") assert.ok(L.caption!.x + L.caption!.w <= L.screen.x + 1e-6);
          else assert.ok(L.caption!.x >= L.screen.x + L.screen.w - 1e-6);
          continue;
        }
        assert.equal(L.side, f.y >= 0.5 ? "top" : "bottom", at);
        if (L.side === "top") assert.ok(L.caption!.y + L.caption!.h <= L.screen.y + 1e-6);
        else assert.ok(L.caption!.y >= L.screen.y + L.screen.h - 1e-6);
        // centred, with the rounded corners and shadow of the framed look
        assert.ok(near(L.screen.x + L.screen.w / 2, W / 2, 1e-6));
        assert.ok(near(L.radius, 18 * Math.min(W, H) / 1080));
      }
    }
  }
  // tall frames: clear of the platform's top and bottom bars
  const T = screenLayout({ W: 1080, H: 1920, aw: 2880, ah: 1800, caption: true, focusY: 0.8 });
  assert.ok(T.caption!.y >= 0.07 * 1920 - 1e-6 && T.screen.y + T.screen.h <= 0.91 * 1920);
  assert.ok(near(T.screen.w, 0.92 * 1080), "tall frames keep the screen at 92% of the width");
});

test("app screen: with no caption it is exactly the framed look (92% on a soft backdrop)", () => {
  const L = screenLayout({ W: 1920, H: 1080, aw: 1920, ah: 1080, caption: false });
  assert.deepEqual(L.screen, framedLayout({ W: 1920, H: 1080, aw: 1920, ah: 1080, face: null }).screen);
  assert.ok(near(L.screen.w, 0.92 * 1920) && near(L.screen.h, 0.92 * 1080));
  assert.equal(L.caption, null);
  assert.deepEqual(L.shadow, { blur: 60, dy: 24, alpha: 0.18 });
});

test("app screen: the caption never covers the focus, before, during or after the punch-in", () => {
  for (const [fname, [W, H]] of Object.entries(FRAMES)) {
    const U = Math.min(W, H);
    for (const [pname, [aw, ah]] of Object.entries(PICTURES)) {
      for (const f of FOCI) {
        const L = screenLayout({ W, H, aw, ah, caption: true, focusY: f.y });
        const dur = 4.4, punch = punchOf({ duration: dur })!;
        for (let t = 0; t <= dur; t += 0.1) {
          const v = screenView(aw, ah, L.screen, t, dur, f, punch);
          assert.ok(v.x >= -1e-6 && v.y >= -1e-6 && v.x + v.w <= aw + 1e-6 && v.y + v.h <= ah + 1e-6, `never past the screenshot's edge: ${fname} ${pname} t=${t}`);
          const pt = pointOnScreen(f, aw, ah, v, L.screen);
          const fb = focusBox(pt, L.screen, U);
          assert.ok(within(fb, L.screen), `the focus stays on the screen: ${fname} ${pname} ${f.x},${f.y} t=${t}`);
          assert.ok(!overlaps(L.caption!, fb), `caption clear of the focus: ${fname} ${pname} ${f.x},${f.y} t=${t}`);
        }
      }
    }
  }
});

test("app screen: the punch-in lands on the focus (it moves toward the middle and is magnified)", () => {
  const W = 1920, H = 1080, aw = 2880, ah = 1800, f = { x: 0.7, y: 0.3 };
  const L = screenLayout({ W, H, aw, ah, caption: true, focusY: f.y });
  const punch = punchOf({ duration: 5 })!;
  const before = screenView(aw, ah, L.screen, 0, 5, f, punch), after = screenView(aw, ah, L.screen, punch.at + SCREEN.punchTime, 5, f, punch);
  assert.ok(near(before.w, aw, 1e-6), "the whole screenshot at the start");
  assert.ok(near(aw / after.w, 1.6 * (1 + 0.07 * (punch.at + SCREEN.punchTime) / 5), 1e-6), `zoomed ${aw / after.w}`);
  // the focus point is inside the view once punched in
  assert.ok(f.x * aw >= after.x && f.x * aw <= after.x + after.w && f.y * ah >= after.y && f.y * ah <= after.y + after.h);
});

test("app screen: the callout pill stays inside the frame and off the focus", () => {
  for (const [fname, [W, H]] of Object.entries(FRAMES)) {
    const U = Math.min(W, H);
    for (const [pname, [aw, ah]] of Object.entries(PICTURES)) {
      for (const f of [...FOCI, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.02, y: 0.98 }]) {
        for (const caption of [true, false]) {
          const L = screenLayout({ W, H, aw, ah, caption, focusY: f.y });
          const punch = punchOf({ duration: 4.4 })!;
          for (const t of [punch.at + SCREEN.punchTime, 4.4]) {
            const pt = pointOnScreen(f, aw, ah, screenView(aw, ah, L.screen, t, 4.4, f, punch), L.screen);
            for (const pillW of [0.2 * U, 0.45 * U, 0.75 * U]) {
              const P = calloutPlace({ pt, S: L.screen, W, H, pillW, pillH: 0.065 * U });
              const at = `${fname} ${pname} ${f.x},${f.y} caption=${caption} w=${pillW}`;
              assert.ok(inside(P.box, W, H), `pill inside the frame: ${at} ${JSON.stringify(P.box)}`);
              assert.ok(!overlaps(P.box, focusBox(pt, L.screen, U)), `pill off the focus: ${at}`);
              if (L.caption) assert.ok(!overlaps(P.box, L.caption), `pill off the caption: ${at}`);
              // the line starts on the pill's edge facing the point
              assert.ok(near(P.anchor.y, P.above ? P.box.y + P.box.h : P.box.y));
              assert.ok(P.anchor.x >= P.box.x && P.anchor.x <= P.box.x + P.box.w);
            }
          }
        }
      }
    }
  }
});

test("app screen: easing at key times, frame-rate independent and smooth", () => {
  assert.equal(screenEnter(0), 0);
  assert.equal(screenEnter(SCREEN.enter), 1);
  assert.equal(screenEnter(10), 1);
  assert.ok(near(screenEnter(SCREEN.enter / 2), ease.out(0.5)) && near(ease.out(0.5), 0.875));
  const punch = punchOf({ duration: 4.4 })!;
  assert.ok(near(punch.at, 0.38 * 4.4) && punch.zoom === 1.6);
  assert.equal(screenPunchK(punch.at - 0.1, punch), 0);
  assert.equal(screenPunchK(punch.at, punch), 0);
  assert.ok(near(screenPunchK(punch.at + SCREEN.punchTime / 2, punch), 0.5));
  assert.equal(screenPunchK(punch.at + SCREEN.punchTime, punch), 1);
  assert.equal(calloutK(punch.at, punch), 0);
  assert.equal(calloutK(punch.at + 0.7 * SCREEN.punchTime + SCREEN.calloutIn, punch), 1);
  assert.equal(calloutK(0.8), 0); assert.equal(calloutK(0.8 + SCREEN.calloutIn), 1);
  // the punch time: short scenes still punch after 0.9 s and leave 1.6 s to look; zoom 1 means no punch; a set time is kept
  assert.equal(punchOf({ duration: 2 })!.at, 0.9);
  assert.equal(punchOf({ duration: 10 })!.at, 3.8);
  assert.equal(punchOf({ duration: 4, zoom: 1 }), undefined);
  assert.equal(punchOf({ duration: 4, punch: 2.5 })!.at, 2.5);
  assert.equal(punchOf({ duration: 4, punch: 9 })!.at, 3.6);
  // the same time gives the same frame at 24, 30 or 60 fps; zoom never goes backwards; no jumps between 60 fps frames
  const S = { x: 0, y: 0, w: 1600, h: 1000 }, f = { x: 0.8, y: 0.2 };
  const at = (t: number) => screenView(2880, 1800, S, t, 4.4, f, punch);
  assert.deepEqual(at(2), at((2 * 30) / 30)); assert.deepEqual(at(1.5), at(90 / 60)); assert.deepEqual(at(1.25), at(30 / 24));
  let prev = at(0);
  for (let i = 1; i <= 4.4 * 60; i++) {
    const v = at(i / 60);
    assert.ok(v.w <= prev.w + 1e-9, "the zoom only goes in");
    assert.ok(Math.abs(v.x - prev.x) < 0.02 * 2880 && Math.abs(v.w - prev.w) < 0.02 * 2880, `smooth at frame ${i}`);
    prev = v;
  }
});

// ------------------------------------------------------------------ the busy-region focus

function canvas(w: number, h: number, fill = 255) {
  const d = new Uint8ClampedArray(w * h * 4).fill(fill);
  const px = (x: number, y: number, v: number) => { const i = 4 * (y * w + x); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; };
  return { d, px };
}

test("busy region: finds the detailed part of a flat screen", () => {
  const w = 160, h = 100;
  const { d, px } = canvas(w, h);
  // "text" (a checker of dark and light) in the top right: x 100..140, y 15..45
  for (let y = 15; y < 45; y++) for (let x = 100; x < 140; x++) if ((x + y) % 2) px(x, y, 30);
  const r = busyRegion(d, w, h);
  assert.ok(Math.abs(r.x - 0.75) < 0.08 && Math.abs(r.y - 0.3) < 0.1, JSON.stringify(r));
  assert.ok(r.box.w > 0.25 && r.box.w < 0.35);
});

test("busy region: a flat picture gives the middle; a soft gradient doesn't count as detail", () => {
  const flat = canvas(120, 80);
  assert.deepEqual({ x: busyRegion(flat.d, 120, 80).x, y: busyRegion(flat.d, 120, 80).y }, { x: 0.5, y: 0.5 });
  const w = 160, h = 100;
  const { d, px } = canvas(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, Math.round((255 * x) / w));     // a smooth ramp across
  for (let y = 70; y < 90; y++) for (let x = 20; x < 50; x++) if ((x >> 1) % 2) px(x, y, (x * 7) % 2 ? 0 : 255);   // detail bottom left
  const r = busyRegion(d, w, h);
  assert.ok(r.x < 0.35 && r.y > 0.65, JSON.stringify(r));
});

test("busy region: the denser of two areas wins, and a busy edge strip loses to busy content", () => {
  const w = 160, h = 100;
  const { d, px } = canvas(w, h);
  for (let y = 20; y < 40; y++) for (let x = 15; x < 45; x++) if ((x + y) % 6 === 0) px(x, y, 40);   // sparse
  for (let y = 55; y < 80; y++) for (let x = 95; x < 135; x++) if ((x + y) % 2) px(x, y, 40);       // dense
  const r = busyRegion(d, w, h);
  assert.ok(r.x > 0.55 && r.y > 0.5, JSON.stringify(r));
  // a menu bar along the very top edge (as dense as the content) vs a block of content in the middle
  const b = canvas(w, h);
  for (let y = 0; y < 6; y++) for (let x = 0; x < w; x++) if ((x + y) % 2) b.px(x, y, 40);
  for (let y = 40; y < 70; y++) for (let x = 60; x < 110; x++) if ((x + y) % 2) b.px(x, y, 40);
  const r2 = busyRegion(b.d, w, h);
  assert.ok(r2.y > 0.4 && r2.y < 0.7 && r2.x > 0.35 && r2.x < 0.7, JSON.stringify(r2));
});

test("focus hints: words become a place, or nothing", () => {
  assert.deepEqual(hintFocus("top right"), { x: 0.8, y: 0.18 });
  assert.deepEqual(hintFocus("the left sidebar"), { x: 0.2, y: 0.5 });
  assert.deepEqual(hintFocus("bottom"), { x: 0.5, y: 0.82 });
  assert.deepEqual(hintFocus("the middle"), { x: 0.5, y: 0.5 });
  assert.equal(hintFocus("the revenue chart"), null);
  assert.equal(hintFocus(""), null);
});

// ------------------------------------------------------------------ the product demo

const DEMO = "Fluxboard keeps your team in flow.\nIt turns scattered notes, chats and tasks into one clear plan.\nThe dashboard shows every project and deadline at a glance.\nTeams save 6 hours a week on status meetings.\nIn settings, connect Slack, GitHub and your calendar in one click.\nTry Fluxboard free today.";

test("product demo: screenshots interleave with the text scenes (title, screen, statement, screen, number, screen, cta)", async () => {
  const { demoScenes, planScenes } = await import("../lib/studio");
  assert.deepEqual(planScenes(DEMO).map((s) => s.kind), ["title", "statement", "statement", "number", "statement", "cta"]);
  const shots = [1, 2, 3].map((i) => ({ key: `k${i}`, name: `Screenshot 2026-11-06 at 10.1${i}.png` }));
  const sc = demoScenes(DEMO, shots);
  assert.deepEqual(sc.map((s) => s.kind), ["title", "screen", "statement", "screen", "number", "screen", "cta"]);
  assert.deepEqual(sc.filter((s) => s.kind === "screen").map((s) => s.image), ["k1", "k2", "k3"], "screens keep the order they were added in");
  // a screen that takes a statement's place uses that sentence as its caption
  assert.equal(sc[3].text, "The dashboard shows every project and deadline at a glance.");
  assert.equal(sc[5].text, "In settings, connect Slack, GitHub and your calendar in one click.");
  assert.ok(sc.every((s) => s.duration >= 2.4 && s.duration <= 7));
  assert.ok(sc.filter((s) => s.kind === "screen").every((s) => s.duration >= 4), "screens stay up long enough to punch in");
});

test("product demo: each screenshot lands on the sentence that mentions it (by its file name)", async () => {
  const { demoScenes } = await import("../lib/studio");
  const sc = demoScenes(DEMO, [{ key: "set", name: "fluxboard-settings.png" }, { key: "dash", name: "Fluxboard Dashboard (2).png" }]);
  assert.deepEqual(sc.map((s) => s.kind), ["title", "statement", "screen", "number", "screen", "cta"]);
  const dash = sc.find((s) => s.image === "dash")!, set = sc.find((s) => s.image === "set")!;
  assert.match(dash.text, /dashboard shows every project/);
  assert.match(set.text, /In settings, connect Slack/);
  assert.equal(dash.callout, "Dashboard", "the name's words make the callout ('Fluxboard' is in the text already, so it's not the topic)");
  // no two screens in a row when there are more screenshots than sentences to pair them with... except at the end
  const many = demoScenes("Meet Orbit.\nIt plans your week for you.\nTry Orbit today.", ["a", "b", "c"].map((k) => ({ key: k })));
  assert.equal(many[0].kind, "title"); assert.equal(many[many.length - 1].kind, "cta");
  assert.equal(many.filter((s) => s.kind === "screen").length, 3);
});

test("product demo: the AI's screens are resolved, and screenshots it left out are woven in", async () => {
  const { cleanScenes, placeShots } = await import("../lib/studio");
  const { STUDIO_SCHEMA, studioPrompt } = await import("../lib/studioAi");
  const kinds = (STUDIO_SCHEMA.properties.scenes.items.properties.kind as { enum: string[] }).enum;
  assert.ok(kinds.includes("screen"));
  assert.ok("shot" in STUDIO_SCHEMA.properties.scenes.items.properties && "callout" in STUDIO_SCHEMA.properties.scenes.items.properties);
  const shots = [{ key: "a", name: "orbit-calendar.png" }, { key: "b", name: "orbit-inbox.png" }, { key: "c", name: "orbit-stats.png" }];
  assert.match(studioPrompt("text", "promo", "16:9", shots), /1\. Orbit calendar[\s\S]*3\. Orbit stats/);
  assert.doesNotMatch(studioPrompt("text", "promo", "16:9"), /screenshot/);
  const raw = [
    { kind: "title", text: "Meet Orbit" },
    { kind: "screen", shot: 2, text: "Every email sorted for you", focus: "left sidebar", callout: "Smart inbox" },
    { kind: "statement", text: "It plans your week" },
    { kind: "screen", shot: 9, text: "A screen that doesn't exist" },
    { kind: "screen", shot: 2, text: "The same screen twice" },
    { kind: "cta", text: "Try Orbit", sub: "Start free" },
  ];
  const sc = placeShots(cleanScenes(raw), shots);
  const screens = sc.filter((s) => s.kind === "screen");
  assert.deepEqual(screens.map((s) => s.image).sort(), ["a", "b", "c"], "every screenshot is used once");
  const inbox = sc.find((s) => s.image === "b")!;
  assert.deepEqual(inbox.focus, { x: 0.2, y: 0.5 }); assert.equal(inbox.callout, "Smart inbox"); assert.equal(inbox.focusAuto, false);
  assert.ok(sc.every((s) => s.shot === undefined && s.hint === undefined), "no plan-only fields are kept");
  assert.equal(sc[0].kind, "title"); assert.equal(sc[sc.length - 1].kind, "cta");
  // with no screenshots, screens become statements (an AI that misreads the brief can't leave an empty scene)
  const none = placeShots(cleanScenes([{ kind: "screen", shot: 1, text: "Look at this" }]), []);
  assert.equal(none[0].kind, "statement");
});
