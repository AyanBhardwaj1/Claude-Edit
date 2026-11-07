import assert from "node:assert/strict";
import test from "node:test";
import { aiReady, callJson } from "../lib/ai";
import { fitAnswer, missingParts, offShape, parseRelayAnswer, relayPrompt, relayReminder, setRelay } from "../lib/relay";
import type { Settings } from "../lib/types";

test("the request has the instructions, the material and the exact answer shape", () => {
  const t = relayPrompt({ name: "submit_hooks", system: "You write hooks.", user: "Transcript: hi", schema: { type: "object", properties: { hooks: { type: "array" } } } });
  assert.match(t, /## Instructions\nYou write hooks\./);
  assert.match(t, /## Material\nTranscript: hi/);
  assert.match(t, /ONE JSON object/);
  assert.match(t, /"hooks"/);
});

test("a pasted reply is read with or without a code fence and text around it", () => {
  assert.deepEqual(parseRelayAnswer('{"hooks":["a"]}'), { hooks: ["a"] });
  assert.deepEqual(parseRelayAnswer('Here you go:\n```json\n{"hooks": ["a", "b"]}\n```\nHope that helps!'), { hooks: ["a", "b"] });
  assert.deepEqual(parseRelayAnswer('Sure! {"keep": [{"from": "w0", "to": "w9"}]} Let me know.'), { keep: [{ from: "w0", to: "w9" }] });
  assert.equal(parseRelayAnswer("I can't help with that."), null);
  assert.equal(parseRelayAnswer('["not", "an", "object"]'), null);
});

test("with your plan, an AI step goes to the copy-and-paste window, never to an API", async () => {
  const s = { provider: "chat", anthropicKey: "", openaiKey: "" } as unknown as Settings;
  assert.equal(aiReady(s), true);
  assert.equal(aiReady({ ...s, provider: "anthropic" }), false);
  const seen: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => { throw new Error("no network in plan mode"); }) as typeof fetch;
  setRelay(async (ask) => { seen.push(ask.name); return { hooks: ["One habit doubled my posting"] }; });
  try {
    const r = await callJson(s, "sys", "user", { type: "object" }, "submit_hooks");
    assert.deepEqual(r, { hooks: ["One habit doubled my posting"] });
    assert.deepEqual(seen, ["submit_hooks"]);
  } finally { globalThis.fetch = realFetch; setRelay(null); }
});

test("curly quotes inside a caption survive; bent JSON from a chat app is still read", () => {
  assert.deepEqual(parseRelayAnswer('{"caption": "He said “hi” to me"}'), { caption: "He said “hi” to me" });
  assert.deepEqual(parseRelayAnswer('{“hooks”: [“a”, “b”],}'), { hooks: ["a", "b"] });
});

test("a trailing comma with curly quotes in a string, and a JSON box after another code box, are read", () => {
  assert.deepEqual(parseRelayAnswer('{"summary": "I cut the “um” parts", "keep": ["w1"],}'), { summary: "I cut the “um” parts", keep: ["w1"] });
  assert.deepEqual(parseRelayAnswer('Here:\n```\nnot json\n```\n```json\n{"a":1}\n```'), { a: 1 });
});

test("a caption with ``` inside it, and braces in the prose around the box, still parse", () => {
  assert.deepEqual(parseRelayAnswer('Sure {ok}\n```json\n{"c":"a ``` b"}\n```\nbye {x}'), { c: "a ``` b" });
});

test("an answer wrapped by the chat is unwrapped; missing parts are named", () => {
  const schema = { type: "object", properties: { summary: { type: "string" }, keep: { type: "array" } }, required: ["summary", "keep"] };
  const inner = { summary: "tight", keep: [{ from: "w1", to: "w9" }] };
  assert.deepEqual(fitAnswer(schema, { submit_edit: inner }), inner);
  assert.deepEqual(fitAnswer(schema, inner), inner);
  assert.deepEqual(missingParts(schema, { summary: "tight" }), ["keep"]);
  assert.deepEqual(missingParts(schema, fitAnswer(schema, { a: { summary: "x" }, b: { keep: [] } })), ["summary", "keep"]);
  assert.deepEqual(missingParts({ type: "object" }, {}), []);
  // a note's answer with only some fields is fine as it is (the cut stays as it was); one with none is off shape
  assert.equal(offShape(schema, { summary: "bigger subtitles" }), false);
  assert.equal(offShape(schema, { response: "I made the subtitles bigger" }), true);
  assert.deepEqual(fitAnswer(schema, { answer: { summary: "bigger" } }), { summary: "bigger" });
  const msg = relayReminder({ name: "submit_edit", system: "", user: "", schema }, ["keep"]);
  assert.match(msg, /missing "keep"/);
  assert.ok(msg.includes(JSON.stringify(schema)));
});
