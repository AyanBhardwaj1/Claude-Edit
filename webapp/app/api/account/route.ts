// Accounts on the server, when a database is connected. Without one, GET says so and the app keeps accounts in the browser.
import { NextResponse, type NextRequest } from "next/server";
import { normEmail, passwordProblem, validEmail } from "@/lib/auth";
import { changePassword, createUser, deleteUser, endSession, newSession, renameUser, serverAccounts, sessionUser, verifyUser } from "@/lib/server/db";
import { bad, clearSession, COOKIE, limited, sameOrigin, setSession } from "@/lib/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!serverAccounts()) return NextResponse.json({ mode: "local" });
  try {
    const user = await sessionUser(req.cookies.get(COOKIE)?.value);
    return NextResponse.json({ mode: "server", user }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("account GET", e);
    return NextResponse.json({ mode: "server", user: null, error: "The account service isn't reachable right now." }, { status: 503 });
  }
}

type Body = { action?: string; name?: string; email?: string; password?: string; current?: string; next?: string; remember?: boolean };

export async function POST(req: NextRequest) {
  if (!serverAccounts()) return bad("Accounts on the server aren't set up on this site.", 404);
  if (!sameOrigin(req)) return bad("That request didn't come from this site.", 403);
  const b = (await req.json().catch(() => ({}))) as Body;
  const token = req.cookies.get(COOKIE)?.value;
  try {
    if (b.action === "signup" || b.action === "signin") {
      if (limited(req, b.action)) return bad("Too many tries. Wait a minute and try again.", 429);
      const email = normEmail(String(b.email ?? "")), password = String(b.password ?? "");
      if (!validEmail(email)) return bad("Enter an email like you@example.com.", 400, "email");
      let user;
      if (b.action === "signup") {
        const name = String(b.name ?? "").trim().slice(0, 60);
        if (!name) return bad("Tell us what to call you.", 400, "name");
        const problem = passwordProblem(password);
        if (problem) return bad(problem, 400, "password");
        if (password.length > 200) return bad("Use 200 characters or fewer.", 400, "password");
        user = await createUser(name, email, password);
        if (!user) return bad("There's already an account with this email. Sign in instead.", 409, "email");
      } else {
        user = password && password.length <= 200 ? await verifyUser(email, password) : null;
        if (!user) return bad("That email and password don't match an account.", 401, "password");
      }
      const remember = b.remember !== false;
      const res = NextResponse.json({ user });
      setSession(res, await newSession(user.id, remember ? 30 : 1), remember);
      return res;
    }
    if (b.action === "signout") {
      await endSession(token);
      const res = NextResponse.json({ ok: true });
      clearSession(res);
      return res;
    }
    const me = await sessionUser(token);
    if (!me) return bad("You're signed out. Sign in again.", 401);
    if (b.action === "rename") {
      const name = String(b.name ?? "").trim().slice(0, 60);
      if (!name) return bad("Your name can't be empty.", 400, "name");
      return NextResponse.json({ user: await renameUser(me.id, name) });
    }
    if (b.action === "password") {
      if (limited(req, "password", 5)) return bad("Too many tries. Wait a minute and try again.", 429);
      const problem = passwordProblem(String(b.next ?? ""));
      if (problem) return bad(problem, 400, "password");
      const ok = await changePassword(me.id, String(b.current ?? ""), String(b.next), token!);
      return ok ? NextResponse.json({ ok: true }) : bad("Your current password isn't right.", 400, "password");
    }
    if (b.action === "delete") {
      if (limited(req, "password", 5)) return bad("Too many tries. Wait a minute and try again.", 429);
      if (!(await deleteUser(me.id, String(b.password ?? "")))) return bad("That password isn't right.", 400, "password");
      const res = NextResponse.json({ ok: true });
      clearSession(res);
      return res;
    }
    return bad("Unknown action.");
  } catch (e) {
    console.error("account POST", e);
    return bad("The account service isn't reachable right now. Try again in a moment.", 503);
  }
}
