import assert from "node:assert/strict";
import test from "node:test";

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); } clear() { this.m.clear(); } }
const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = new Mem(); g.sessionStorage = new Mem();

test("progress steps read like a person talking", async () => {
  const { friendly } = await import("../lib/assistant");
  assert.match(friendly("Writing the parts", 10), /Composing new music/);
  assert.match(friendly("Listening to your video", 40), /Listening to every word.*\(40%\)/);
  assert.match(friendly("Finding your face", 50), /face/);
  assert.equal(friendly("Ready", 100), "All done!");
  assert.match(friendly("Something new", 20), /Something new…/);
});

test("what you make steers the AI editor's style and the shape a new video starts in", async () => {
  const { creatorRules, creatorFormat, saveCreator, loadCreator, describeCreator } = await import("../lib/assistant");
  assert.deepEqual(creatorRules(null), []);
  saveCreator({ kinds: ["youtube"], about: "money tips", goal: "10k subscribers" });
  const c = loadCreator()!;
  assert.deepEqual(c.kinds, ["youtube"]);
  assert.equal(creatorFormat(c), "16:9");
  assert.ok(creatorRules(c).some((r) => /YouTube/.test(r.text)) && creatorRules(c).some((r) => /money tips/.test(r.text)));
  assert.equal(creatorFormat({ kinds: ["reels", "youtube"], about: "", goal: "" }), null);
  assert.match(describeCreator(c), /longer YouTube videos; about: money tips; goal: 10k subscribers/);
});

test("the coach asks your AI with what it knows, and the editor's prompt carries your profile", async () => {
  const { askCoach, coachContext, saveCreator } = await import("../lib/assistant");
  const { setRelay } = await import("../lib/relay");
  const { DEFAULT_SETTINGS } = await import("../lib/store");
  saveCreator({ kinds: ["demo"], about: "a habit app", goal: "" });
  let asked = "";
  setRelay(async (ask) => { asked = ask.user; return { reply: "Open on the problem.", next: ["Write the hook"] }; });
  const ctx = coachContext({ kinds: ["demo"], about: "a habit app", goal: "" }, [], [], "Home");
  const r = await askCoach({ ...DEFAULT_SETTINGS, provider: "chat" }, "Plan my demo", ctx, []);
  assert.equal(r.text, "Open on the problem.");
  assert.deepEqual(r.next, ["Write the hook"]);
  assert.match(asked, /product demos; about: a habit app/);
  assert.match(asked, /Creator asks: Plan my demo/);
  setRelay(null);
});
