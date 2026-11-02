// Fetches a licensed picture from the known sources only (so the browser can draw it into the video: a canvas
// that holds a cross-site picture without CORS can't be recorded). Fixed host list, no redirects to other hosts,
// images only, 8 MB cap.

export const runtime = "nodejs";

const HOSTS = new Set(["api.openverse.org", "upload.wikimedia.org", "cdn.simpleicons.org"]);
const MAX = 8 * 1024 * 1024;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let url: URL;
  try { url = new URL(raw); } catch { return new Response("bad url", { status: 400 }); }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password) {
    return new Response("host not allowed", { status: 403 });
  }
  let r = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Claude-Edit-Web/0.1" }, signal: AbortSignal.timeout(15000) });
  for (let hop = 0; hop < 3 && r.status >= 300 && r.status < 400; hop++) {      // openverse thumbs redirect within the list
    const next = new URL(r.headers.get("location") ?? "", url);
    if (next.protocol !== "https:" || !HOSTS.has(next.hostname)) return new Response("redirect not allowed", { status: 403 });
    r = await fetch(next, { redirect: "manual", signal: AbortSignal.timeout(15000) });
  }
  const type = r.headers.get("content-type") ?? "";
  if (!r.ok || !/^image\/(png|jpeg|webp|gif|svg\+xml)/.test(type)) return new Response("not an image", { status: 502 });
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > MAX) return new Response("too big", { status: 413 });
  const body = await r.arrayBuffer();
  if (body.byteLength > MAX) return new Response("too big", { status: 413 });
  return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "X-Content-Type-Options": "nosniff" } });
}
