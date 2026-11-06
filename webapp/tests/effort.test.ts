import assert from "node:assert/strict";
import test from "node:test";
import { callJson } from "../lib/ai";
import { aiChoice, EFFORT, effortOf, EFFORTS, pickModel } from "../lib/effort";
import { DEFAULT_SETTINGS, loadSettings } from "../lib/store";
import { estimate, estimateText, formatEstimate, minutesOf, nextRate, PRIOR, record, stagesFor } from "../lib/timings";
import type { Settings } from "../lib/types";

// localStorage / sessionStorage for node
class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } }
const g = globalThis as unknown as { localStorage: Mem; sessionStorage: Mem };
g.localStorage = new Mem(); g.sessionStorage = new Mem();

const S: Settings = { ...DEFAULT_SETTINGS, anthropicKey: "k", anthropicModel: "claude-sonnet-5-5" };

test("the effort table: balanced is today's editor, fast does less, best adds one review pass", () => {
  assert.deepEqual(EFFORTS, ["fast", "balanced", "best"]);
  assert.deepEqual({ ...EFFORT.balanced, label: "", line: "" },
    { label: "", line: "", faces: true, pictures: 16, maxTokens: 16000, review: false, anthropicModel: null, hint: "" });
  assert.equal(EFFORT.fast.faces, false);
  assert.equal(EFFORT.fast.pictures, 4);
  assert.equal(EFFORT.fast.maxTokens, 6000);
  assert.equal(EFFORT.fast.review, false);
  assert.equal(EFFORT.best.review, true);
  assert.equal(EFFORT.best.maxTokens, 32000);
  assert.equal(EFFORT.best.faces && EFFORT.best.pictures >= EFFORT.balanced.pictures, true);
  for (const e of EFFORTS) assert.ok(EFFORT[e].label && EFFORT[e].line && !/—/.test(EFFORT[e].line));
});

test("old saved settings without an effort load as balanced", () => {
  assert.equal(DEFAULT_SETTINGS.effort, "balanced");
  assert.equal(effortOf({}), "balanced");
  assert.equal(effortOf({ effort: "turbo" }), "balanced");
  assert.equal(effortOf({ effort: "best" }), "best");
  g.localStorage.setItem("ce.settings", JSON.stringify({ provider: "openai", openaiModel: "gpt-x" }));
  assert.equal(loadSettings().effort, "balanced");
  g.localStorage.clear();
});

test("a faster or stronger model is used only when the key lists it, else the user's own model", () => {
  const listed = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];
  assert.equal(pickModel("fast", "anthropic", "claude-sonnet-5-5", listed), "claude-haiku-5-5");
  assert.equal(pickModel("best", "anthropic", "claude-sonnet-5-5", listed), "claude-opus-5-5");
  assert.equal(pickModel("balanced", "anthropic", "claude-sonnet-5-5", listed), "claude-sonnet-5-5");
  assert.equal(pickModel("fast", "anthropic", "claude-sonnet-5-5", null), "claude-sonnet-5-5");            // can't know: keep it
  assert.equal(pickModel("fast", "anthropic", "claude-sonnet-5-5", ["claude-sonnet-5-5"]), "claude-sonnet-5-5");
  assert.equal(pickModel("fast", "anthropic", "m", ["claude-haiku-5-5-20261001"]), "claude-haiku-5-5-20261001");
  assert.equal(pickModel("best", "openai", "gpt-6", listed), "gpt-6");                                      // OpenAI keeps the user's model
  assert.deepEqual(aiChoice(S, "fast", listed), { model: "claude-haiku-5-5", maxTokens: 6000, fallback: "claude-sonnet-5-5" });
  assert.deepEqual(aiChoice(S, "balanced", listed), { model: "claude-sonnet-5-5", maxTokens: 16000, fallback: null });
  assert.deepEqual(aiChoice(S, "best", null), { model: "claude-sonnet-5-5", maxTokens: 32000, fallback: null });
});

test("a 404 for the effort's model falls back to the user's model once; a refused answer budget falls back to 16000", async () => {
  const real = globalThis.fetch;
  const sent: { model: string; max_tokens: number }[] = [];
  const ok = (input: unknown) => new Response(JSON.stringify({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "x", input }] }), { status: 200 });
  try {
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)); sent.push(b);
      return b.model === "claude-opus-5-5" ? new Response("not found", { status: 404 }) : ok({ fine: true });
    }) as typeof fetch;
    assert.deepEqual(await callJson(S, "sys", "u", {}, "x", { model: "claude-opus-5-5", maxTokens: 32000, fallback: "claude-sonnet-5-5" }), { fine: true });
    assert.deepEqual(sent.map((b) => b.model), ["claude-opus-5-5", "claude-sonnet-5-5"]);

    sent.length = 0;                                     // the user's own model 404s: an error, no loop
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return new Response("nf", { status: 404 }); }) as typeof fetch;
    await assert.rejects(callJson(S, "sys", "u", {}, "x", { model: "claude-opus-5-5", maxTokens: 32000, fallback: "claude-sonnet-5-5" }),
      (e: Error & { userMessage?: string }) => /claude-sonnet-5-5/.test(e.userMessage ?? ""));
    assert.equal(sent.length, 2);

    sent.length = 0;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)); sent.push(b);
      return b.max_tokens > 16000 ? new Response("max_tokens: 32000 > 8192, the maximum", { status: 400 }) : ok({ ok: 1 });
    }) as typeof fetch;
    assert.deepEqual(await callJson(S, "sys", "u", {}, "x", { model: "old", maxTokens: 32000, fallback: null }), { ok: 1 });
    assert.deepEqual(sent.map((b) => b.max_tokens), [32000, 16000]);

    sent.length = 0;                                     // Fast ran out of room: once more with the usual budget
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body)); sent.push(b);
      return b.max_tokens < 16000 ? new Response(JSON.stringify({ stop_reason: "max_tokens", content: [{ type: "tool_use", input: { partial: 1 } }] }), { status: 200 })
        : ok({ whole: 1 });
    }) as typeof fetch;
    assert.deepEqual(await callJson(S, "sys", "u", {}, "x", { model: "m", maxTokens: 6000, fallback: null }), { whole: 1 });
    assert.deepEqual(sent.map((b) => b.max_tokens), [6000, 16000]);

    sent.length = 0;                                     // no choice: exactly the old request (user's model, 16000)
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return ok({}); }) as typeof fetch;
    await callJson(S, "sys", "u", {}, "x");
    assert.deepEqual(sent.map((b) => [b.model, b.max_tokens]), [["claude-sonnet-5-5", 16000]]);
  } finally { globalThis.fetch = real; }
});

test("timings: priors first, then the first measurement, then a moving average", () => {
  g.localStorage.clear();
  assert.deepEqual(stagesFor("fast"), ["listen", "edit"]);
  assert.deepEqual(stagesFor("best", false), ["listen", "faces"]);
  assert.equal(minutesOf(20), 1);                       // under a minute counts as a minute
  assert.equal(minutesOf(180), 3);

  const first = estimate("balanced", 120);
  assert.equal(first.learned, false);
  assert.equal(first.seconds, Math.round((PRIOR["listen:openai"] + PRIOR.faces + PRIOR["edit:balanced"]) * 2));
  assert.ok(estimate("fast", 120).seconds < first.seconds && first.seconds < estimate("best", 120).seconds);

  assert.deepEqual(nextRate(undefined, 30), { r: 30, n: 1 });
  assert.deepEqual(nextRate({ r: 30, n: 1 }, 40), { r: 0.6 * 30 + 0.4 * 40, n: 2 });
  assert.deepEqual(nextRate({ r: 10, n: 3 }, 1000), { r: 0.6 * 10 + 0.4 * 40, n: 4 });   // one huge outlier is capped at 4x

  record("listen", "balanced", 20, 120);                 // 10 s per minute
  record("faces", "balanced", 16, 120);                  // 8 s per minute
  record("edit", "balanced", 100, 120);                  // 50 s per minute
  assert.deepEqual(estimate("balanced", 120), { seconds: (10 + 8 + 50) * 2, learned: true });
  record("edit", "balanced", 140, 120);                  // 70 s per minute -> 0.6*50 + 0.4*70 = 58
  assert.deepEqual(estimate("balanced", 60), { seconds: 10 + 8 + 58, learned: true });

  // listening and faces are shared, the AI edit is per effort
  assert.deepEqual(estimate("fast", 60), { seconds: 10 + PRIOR["edit:fast"], learned: false });
  record("edit", "fast", 15, 30);
  assert.deepEqual(estimate("fast", 60), { seconds: 10 + 15, learned: true });
  // in-browser listening is learned apart from OpenAI's
  assert.equal(estimate("fast", 60, { transcriber: "browser" }).learned, false);
  // no key: no AI stage
  assert.deepEqual(estimate("fast", 60, { ai: false }), { seconds: 10 + 2, learned: true });

  record("edit", "fast", 0, 60); record("edit", "fast", NaN, 60); record("edit", "fast", 10, 0);   // ignored
  assert.equal(estimate("fast", 60).seconds, 25);
  g.localStorage.setItem("ce.timings", "not json");
  assert.equal(estimate("fast", 60).learned, false);     // a broken store falls back to the priors
  g.localStorage.clear();
});

test("estimates read in plain words", () => {
  assert.equal(formatEstimate(20), "under a minute");
  assert.equal(formatEstimate(70), "about 1 min");
  assert.equal(formatEstimate(250), "about 4 min");
  assert.equal(formatEstimate(3600), "about 1 h");
  assert.equal(formatEstimate(4300), "about 1 h 12 min");
  assert.equal(estimateText({ seconds: 250, learned: false }), "About 4 min (estimate)");
  assert.equal(estimateText({ seconds: 30, learned: true }, "for a 1-min video"), "Under a minute for a 1-min video on this device");
});
