// Reads the text of a public web page so Motion Studio can animate it ("paste a link"). Public http(s) pages only:
// private and local addresses are refused (before every redirect too), 2 MB and 8 seconds at most, text only.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { privateIp } from "@/lib/server/net";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 2 * 1024 * 1024;

async function safe(u: URL): Promise<boolean> {
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return false;
  if (u.port && !["80", "443", ""].includes(u.port)) return false;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) return false;
  const ips = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
  return ips.length > 0 && ips.every((ip) => !privateIp(ip));
}

function textOf(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const body = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, " ");
  const blocks = [...body.matchAll(/<(h1|h2|h3|p|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map((m) => ({ tag: m[1].toLowerCase(), t: m[2].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, "\"")
      .replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim() }))
    .filter((x) => x.t.length > 2);
  const lines = blocks.map((x) => (x.tag === "li" ? `- ${x.t}` : x.t));
  let text = "";
  for (const l of lines) { if ((text + l).length > 6000) break; text += l + "\n"; }
  return { title, text: text.trim() };
}

export async function GET(req: NextRequest) {
  let u: URL;
  try { u = new URL(req.nextUrl.searchParams.get("url") ?? ""); } catch { return NextResponse.json({ error: "That isn't a link." }, { status: 400 }); }
  try {
    for (let hop = 0; hop < 4; hop++) {
      if (!(await safe(u))) return NextResponse.json({ error: "That link can't be read (only public web pages)." }, { status: 400 });
      const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(8000),
        headers: { "user-agent": "Cutmind/0.1 (reads a page the user asked to animate)", accept: "text/html,text/plain" } });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { u = new URL(r.headers.get("location")!, u); continue; }
      if (!r.ok) return NextResponse.json({ error: `The page answered ${r.status}.` }, { status: 502 });
      const type = r.headers.get("content-type") ?? "";
      if (!/text\/(html|plain)|application\/xhtml/.test(type)) return NextResponse.json({ error: "That link isn't a web page." }, { status: 415 });
      const reader = r.body!.getReader();
      const chunks: Uint8Array[] = []; let n = 0;
      for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > MAX) { void reader.cancel(); break; } chunks.push(value); }
      const raw = new TextDecoder().decode(Buffer.concat(chunks));
      const out = /text\/plain/.test(type) ? { title: "", text: raw.slice(0, 6000) } : textOf(raw);
      if (!out.text) return NextResponse.json({ error: "No readable text on that page." }, { status: 422 });
      return NextResponse.json(out, { headers: { "cache-control": "no-store" } });
    }
    return NextResponse.json({ error: "Too many redirects." }, { status: 508 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).name === "TimeoutError" ? "The page took too long." : "The page couldn't be read." }, { status: 502 });
  }
}
