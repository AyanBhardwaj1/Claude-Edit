// Your Claude or ChatGPT plan as the AI editor, by copy and paste. Claude Pro/Max and ChatGPT Plus/Pro plans have no
// sign-in a web app like this may use, so Cutmind never touches the account: it writes the exact request, you paste it
// into claude.ai or chatgpt.com (your plan, your chat), and paste the answer back. Every AI step goes through here
// when Settings → AI editor is "Your Claude or ChatGPT plan"; nothing is sent anywhere by Cutmind itself.
type Json = Record<string, unknown>;

export type RelayAsk = { name: string; system: string; user: string; schema: Json };
type Relay = (ask: RelayAsk) => Promise<Json>;

let relay: Relay | null = null;
/** The dialog that shows the request and takes the answer registers itself here (components/Relay.tsx). */
export function setRelay(fn: Relay | null) { relay = fn; }
export function relayReady() { return !!relay; }
export async function askByRelay(ask: RelayAsk): Promise<Json> {
  if (!relay) throw new Error("The copy-and-paste window isn't open: reload the page.");
  return relay(ask);
}

/** The whole request as one message to paste into a chat: the editor's instructions, the material, and the exact
 *  JSON shape to answer in. */
export function relayPrompt(ask: RelayAsk): string {
  return [
    "You are helping me edit a video in Cutmind. Follow these instructions exactly.",
    "", "## Instructions", ask.system.trim(),
    "", "## Material", ask.user.trim(),
    "", "## How to answer",
    `Reply with ONE JSON object and nothing else (no explanation before or after). It must match this JSON Schema ("${ask.name}"):`,
    "```json", JSON.stringify(ask.schema), "```",
  ].join("\n");
}

/** The JSON object in a pasted answer: inside a ```json fence or not, with text around it or not. Null when there's
 *  none to read. */
export function parseRelayAnswer(text: string): Json | null {
  // every code box (```json ones first), then the whole reply: a chat may show other code before the answer
  const fences = [...text.matchAll(/```([a-z]*)\s*([\s\S]*?)```/gi)].sort((x, y) => Number(y[1].toLowerCase() === "json") - Number(x[1].toLowerCase() === "json"));
  // also the widest ```json box: a caption with ``` inside it cuts the lazy match short
  const greedy = text.match(/```json\s*([\s\S]*)```/i);
  const bodies = [...fences.map((m) => m[2].trim()), ...(greedy ? [greedy[1].trim()] : []), text.trim()];
  const tries: string[] = [];
  for (const body of bodies) {
    tries.push(body);
    const a = body.indexOf("{"), b = body.lastIndexOf("}");
    if (a >= 0 && b > a) tries.push(body.slice(a, b + 1));
  }
  // as pasted first (curly quotes inside a caption stay as they are); then without trailing commas; then with the
  // chat's "smart" quotes straightened too: the ways chat apps most often bend JSON
  const commas = (t: string) => t.replace(/,\s*([}\]])/g, "$1");
  const quotes = (t: string) => commas(t).replace(/[“”]/g, '"');
  for (const t of [...tries, ...tries.map(commas), ...tries.map(quotes)]) {
    try {
      const v = JSON.parse(t);
      if (v && typeof v === "object" && !Array.isArray(v)) return v as Json;
    } catch { /* the next try */ }
  }
  return null;
}

/** The parts the request asked for (its schema's top-level "required") that an answer lacks. */
export function missingParts(schema: Json, v: Json): string[] {
  const req = Array.isArray(schema.required) ? (schema.required as unknown[]).filter((k): k is string => typeof k === "string") : [];
  return req.filter((k) => v[k] === undefined || v[k] === null);
}

/** How many of the asked-for fields (the schema's top-level properties) an answer has. */
export function knownParts(schema: Json, v: Json): number {
  const props = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  return props.filter((k) => v[k] !== undefined && v[k] !== null).length;
}

/** An answer in some other shape altogether: none of the fields asked for (a chat that ignored the format). A reply
 *  with some fields and not others is fine: each step keeps what the answer leaves out, as with an API answer. */
export function offShape(schema: Json, v: Json): boolean {
  const props = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  return props.length > 0 && knownParts(schema, v) === 0;
}

/** Chats often wrap the answer: {"submit_edit": {…}} or {"answer": {…}}. When the answer itself lacks what was asked
 *  and exactly one object inside it has it (all the required parts, or else any asked-for field), that's the answer. */
export function fitAnswer(schema: Json, v: Json): Json {
  if (!missingParts(schema, v).length) return v;
  const inner = Object.values(v).filter((x): x is Json => !!x && typeof x === "object" && !Array.isArray(x));
  const whole = inner.filter((x) => !missingParts(schema, x).length);
  if (whole.length === 1) return whole[0];
  if (offShape(schema, v)) {
    const some = inner.filter((x) => !offShape(schema, x));
    if (some.length === 1) return some[0];
  }
  return v;
}

/** A short message for the chat when its answer lacked parts: what's missing, and the shape again. */
export function relayReminder(ask: RelayAsk, missing: string[]): string {
  return [`Your answer is missing ${missing.map((k) => `"${k}"`).join(", ")}. Reply again with ONE JSON object and nothing`,
    `else, matching this JSON Schema ("${ask.name}") exactly, with every required field filled in:`,
    "```json", JSON.stringify(ask.schema), "```"].join("\n");
}
