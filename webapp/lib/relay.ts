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
  const bodies = [...fences.map((m) => m[2].trim()), text.trim()];
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
