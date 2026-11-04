// The signed-in user's synced preferences: settings without API keys, style rules and the look. Never videos or keys.
import { NextResponse, type NextRequest } from "next/server";
import { getData, putData, serverAccounts, sessionUser } from "@/lib/server/db";
import { bad, COOKIE, sameOrigin } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEYS = /key|token|secret/i;
function clean(v: unknown): Record<string, unknown> {
  const d = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const settings = { ...((d.settings as Record<string, unknown>) ?? {}) };
  for (const k of Object.keys(settings)) if (KEYS.test(k)) delete settings[k];          // keys stay in the browser
  const style = Array.isArray(d.style) ? d.style.slice(0, 200).filter((r) => r && typeof r.text === "string")
    .map((r) => ({ id: String(r.id).slice(0, 40), text: String(r.text).slice(0, 300), at: String(r.at).slice(0, 40) })) : [];
  return { settings, style, theme: typeof d.theme === "string" ? d.theme.slice(0, 20) : undefined };
}

export async function GET(req: NextRequest) {
  if (!serverAccounts()) return bad("Not set up.", 404);
  const me = await sessionUser(req.cookies.get(COOKIE)?.value).catch(() => null);
  if (!me) return bad("Signed out.", 401);
  return NextResponse.json(await getData(me.id), { headers: { "cache-control": "no-store" } });
}

export async function PUT(req: NextRequest) {
  if (!serverAccounts()) return bad("Not set up.", 404);
  if (!sameOrigin(req)) return bad("That request didn't come from this site.", 403);
  const me = await sessionUser(req.cookies.get(COOKIE)?.value).catch(() => null);
  if (!me) return bad("Signed out.", 401);
  const text = await req.text();
  if (text.length > 100_000) return bad("Too big.", 413);
  await putData(me.id, clean(JSON.parse(text || "{}")));
  return NextResponse.json({ ok: true });
}
