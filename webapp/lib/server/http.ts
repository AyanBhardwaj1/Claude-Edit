// Small helpers for the account routes: the session cookie, same-origin checks and a per-instance rate limit.
import "server-only";
import { NextResponse, type NextRequest } from "next/server";

export const COOKIE = "cm_session";

export function setSession(res: NextResponse, token: string, remember: boolean) {
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
    ...(remember ? { maxAge: 60 * 60 * 24 * 30 } : {}) });
}
export function clearSession(res: NextResponse) { res.cookies.set(COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 }); }

/** Writes must come from this site (the cookie is SameSite=Lax; this also blocks cross-site form posts). */
export function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host")); } catch { return false; }
}

const hits = new Map<string, { n: number; reset: number }>();
/** At most `max` tries a minute per address and action (per server instance: a speed bump, not a wall). */
export function limited(req: NextRequest, action: string, max = 10): boolean {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const k = `${action}:${ip}`, now = Date.now();
  const h = hits.get(k);
  if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + 60_000 }); return false; }
  h.n++;
  if (hits.size > 5000) for (const [key, v] of hits) if (v.reset < now) hits.delete(key);
  return h.n > max;
}

export const bad = (message: string, status = 400, field?: string) => NextResponse.json({ error: message, field }, { status });
