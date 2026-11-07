import assert from "node:assert/strict";
import test from "node:test";

class Mem {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as { localStorage: Mem; sessionStorage: Mem; window: unknown; dispatchEvent: () => boolean };
g.localStorage ??= new Mem(); g.sessionStorage ??= new Mem(); g.window ??= globalThis; g.dispatchEvent ??= () => true;

test("keys kept from before accounts reach no account, and signing out clears them too", async () => {
  const { setOwner, loadSettings, forgetKeys } = await import("../lib/store");
  g.localStorage.clear(); g.sessionStorage.clear();
  g.localStorage.setItem("ce.settings", JSON.stringify({ provider: "openrouter", openrouterKey: "sk-or-SECRET", rememberKeys: true }));
  setOwner(null);
  assert.equal(loadSettings().openrouterKey, "sk-or-SECRET");          // no accounts: as before
  setOwner("acctA");
  const a = loadSettings();
  assert.equal(a.openrouterKey, "");                                   // an account never gets the shared copy's keys
  assert.equal(a.provider, "openrouter");                              // the rest of the shared settings still apply
  forgetKeys();
  assert.ok(!g.localStorage.getItem("ce.settings")!.includes("SECRET"));  // and signing out clears the shared copy's keys
  setOwner(null);
  g.localStorage.clear();
});

test("a pasted request is never taken as the answer", async () => {
  const { fitAnswer, isTheRequest, offShape, parseRelayAnswer, relayPrompt } = await import("../lib/relay");
  const schema = { type: "object", properties: { hook: { type: "string" }, script: { type: "string" }, onScreenText: { type: "array" } },
    required: ["hook", "script", "onScreenText"] };
  const req = relayPrompt({ name: "submit_script", system: "Write a script.", user: "About rent", schema });
  assert.ok(isTheRequest(req, req) && isTheRequest(`  ${req}\n`, req) && !isTheRequest('{"hook": "x"}', req));
  const v = parseRelayAnswer(req)!;                                    // the schema inside the request
  const fit = fitAnswer(schema, v);
  assert.notDeepEqual(fit, schema.properties);                         // not its "properties" as if they were the answer
  assert.ok(offShape(schema, fit));
});

test("lengths in a note aren't read as moments; 'the 12 second mark' still is", async () => {
  const { noteTimes, pinToPlayhead } = await import("../lib/moments");
  assert.deepEqual(noteTimes("the 2s pause here is too long"), []);
  assert.deepEqual(noteTimes("cut this 3 second pause"), []);
  assert.deepEqual(noteTimes("make the 5 second gap here shorter"), []);
  assert.deepEqual(noteTimes("at the 12 second mark the logo covers me"), [12]);
  assert.deepEqual(noteTimes("cut what I say at 41s"), [41]);
  assert.equal(pinToPlayhead("cut this 3 second pause", 42.37, 60), "cut this 3 second pause (at 0:42.3)");
});

test("OpenRouter suggests the newest model of the family", async () => {
  const { listModels } = await import("../lib/ai");
  const real = globalThis.fetch;
  const data = [["anthropic/claude-sonnet-4", 1], ["anthropic/claude-sonnet-4.5", 2], ["anthropic/claude-sonnet-5.5", 4], ["anthropic/claude-sonnet-5", 3]]
    .map(([id, created]) => ({ id, created }));
  globalThis.fetch = (async (url: string) => new Response(JSON.stringify(String(url).endsWith("/key") ? { data: {} } : { data }),
    { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const r = await listModels("openrouter", "sk-or-x");
    assert.equal(r.suggested, "anthropic/claude-sonnet-5.5");
    assert.equal(r.models[0], "anthropic/claude-sonnet-5.5");
  } finally { globalThis.fetch = real; }
});
