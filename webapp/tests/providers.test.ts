import assert from "node:assert/strict";
import test from "node:test";
import { aiReady, callJson, listModels } from "../lib/ai";
import { KEY_FIELDS, onlyKeys, withoutKeys } from "../lib/keys";
import type { Settings } from "../lib/types";

const base = { provider: "openrouter", anthropicKey: "", openaiKey: "", anthropicModel: "", openaiModel: "", transcriber: "browser",
  rememberKeys: false, effort: "balanced" } as unknown as Settings;
type Call = { url: string; init?: RequestInit };
function mockFetch(reply: (c: Call) => Response) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => { const c = { url: String(url), init }; calls.push(c); return reply(c); }) as typeof fetch;
  return { calls, done: () => { globalThis.fetch = real; } };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json" } });

test("every provider's key stays out of what syncs, and comes back from this tab's copy", () => {
  const s = { ...base, anthropicKey: "a", openaiKey: "o", openrouterKey: "r", geminiKey: "g" } as Settings;
  const out = withoutKeys(s) as Record<string, unknown>;
  for (const f of KEY_FIELDS) assert.equal(f in out, false, f);
  assert.equal(out.provider, "openrouter");
  assert.deepEqual(onlyKeys(s), { anthropicKey: "a", openaiKey: "o", openrouterKey: "r", geminiKey: "g" });
  assert.equal(aiReady({ ...base, openrouterKey: "r" } as Settings), true);
  assert.equal(aiReady({ ...base, provider: "gemini" } as Settings), false);
});

test("OpenRouter: the chosen model, the key as a bearer token, the reply read from text", async () => {
  const m = mockFetch(() => json({ choices: [{ message: { content: 'Here:\n```json\n{"hooks": ["One habit"]}\n```' } }] }));
  try {
    const r = await callJson({ ...base, openrouterKey: "sk-or-x", openrouterModel: "anthropic/claude-sonnet-4.5" } as Settings, "sys", "user", { type: "object" }, "submit_hooks");
    assert.deepEqual(r, { hooks: ["One habit"] });
    assert.equal(m.calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(m.calls[0].init!.body));
    assert.equal(body.model, "anthropic/claude-sonnet-4.5");
    assert.match(body.messages[1].content, /## How to answer/);
    assert.equal((m.calls[0].init!.headers as Record<string, string>).Authorization, "Bearer sk-or-x");
  } finally { m.done(); }
});

test("Gemini: the key in a header (never the address), JSON answers, a model picked when none is set", async () => {
  const m = mockFetch((c) => c.url.includes("/models?")
    ? json({ models: [{ name: "models/gemini-9-flash", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-9-pro", supportedGenerationMethods: ["generateContent"] }, { name: "models/embed-1", supportedGenerationMethods: ["embedContent"] }] })
    : json({ candidates: [{ content: { parts: [{ text: '{"titles": ["Intro"]}' }] } }] }));
  try {
    const s = { ...base, provider: "gemini", geminiKey: "AIzaX" } as Settings;
    const r = await callJson(s, "sys", "user", { type: "object" }, "submit_titles");
    assert.deepEqual(r, { titles: ["Intro"] });
    const gen = m.calls.find((c) => c.url.includes(":generateContent"))!;
    assert.equal(gen.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-9-pro:generateContent");
    assert.ok(m.calls.every((c) => !c.url.includes("AIzaX")));
    assert.equal((gen.init!.headers as Record<string, string>)["x-goog-api-key"], "AIzaX");
    assert.equal(JSON.parse(String(gen.init!.body)).generationConfig.responseMimeType, "application/json");
    assert.deepEqual((await listModels("gemini", "AIzaX")).models, ["gemini-9-pro", "gemini-9-flash"]);
  } finally { m.done(); }
});

test("clear messages for a bad key and an empty OpenRouter account", async () => {
  for (const [status, msg] of [[401, /not accepted/], [402, /out of credits/]] as const) {
    const m = mockFetch(() => json({ error: "x" }, status));
    try {
      await assert.rejects(callJson({ ...base, openrouterKey: "k", openrouterModel: "m" } as Settings, "s", "u", {}, "n"),
        (e: { userMessage?: string }) => msg.test(e.userMessage ?? ""));
    } finally { m.done(); }
  }
});
