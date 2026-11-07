// Email + password accounts, in one of two modes:
//   server  when the site has a database (app/api/account, lib/server/db.ts): sign in on any device; settings without
//           API keys, style rules and the look sync (lib/sync.ts). Videos and keys still never leave the browser.
//   local   without one: an account is a profile in this browser that separates the videos, settings and style of
//           everyone who uses it. Passwords are never stored: only a PBKDF2-SHA-256 hash with a random salt.

export type Account = { id: string; email: string; name: string; salt: string; hash: string; createdAt: string };
export type User = { id: string; email: string; name: string; createdAt: string };

const ACCOUNTS = "cutmind.accounts";
const SESSION = "cutmind.session";
const ITERATIONS = 210_000;

export class AuthError extends Error {
  constructor(message: string, public field?: "name" | "email" | "password") { super(message); }
}

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => new Uint8Array((s.match(/../g) ?? []).map((x) => parseInt(x, 16)));

async function derive(password: string, salt: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, key, 256);
  return hex(bits);
}

function accounts(): Account[] {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS) || "[]"); } catch { return []; }
}
function saveAccounts(a: Account[]) { localStorage.setItem(ACCOUNTS, JSON.stringify(a)); }

const publicUser = (a: Account): User => ({ id: a.id, email: a.email, name: a.name, createdAt: a.createdAt });
export const normEmail = (e: string) => e.trim().toLowerCase();
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

export function passwordProblem(p: string): string | null {
  if (p.length < 8) return "Use at least 8 characters.";
  if (!/[a-zA-Z]/.test(p) || !/[^a-zA-Z]/.test(p)) return "Mix letters with a number or a symbol.";
  return null;
}

async function localSignUp(name: string, email: string, password: string, remember: boolean): Promise<User> {
  if (!name.trim()) throw new AuthError("Tell us what to call you.", "name");
  if (!validEmail(email)) throw new AuthError("Enter an email like you@example.com.", "email");
  const bad = passwordProblem(password);
  if (bad) throw new AuthError(bad, "password");
  const all = accounts();
  if (all.some((a) => a.email === normEmail(email))) throw new AuthError("There's already an account with this email here. Sign in instead.", "email");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const a: Account = { id: hex(crypto.getRandomValues(new Uint8Array(8))), email: normEmail(email), name: name.trim().slice(0, 60),
    salt: hex(salt), hash: await derive(password, salt), createdAt: new Date().toISOString() };
  saveAccounts([...all, a]);
  startSession(a.id, remember);
  return publicUser(a);
}

async function localSignIn(email: string, password: string, remember: boolean): Promise<User> {
  if (!validEmail(email)) throw new AuthError("Enter an email like you@example.com.", "email");
  if (!password) throw new AuthError("Enter your password.", "password");
  const a = accounts().find((x) => x.email === normEmail(email));
  // same message either way, so the form doesn't reveal which emails have accounts
  if (!a || (await derive(password, unhex(a.salt))) !== a.hash) throw new AuthError("That email and password don't match an account in this browser.", "password");
  startSession(a.id, remember);
  return publicUser(a);
}

function startSession(id: string, remember: boolean) {
  const v = JSON.stringify({ id, at: new Date().toISOString() });
  localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION);
  (remember ? localStorage : sessionStorage).setItem(SESSION, v);
}

export function localUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION) || localStorage.getItem(SESSION) || "null") as { id: string } | null;
    const a = s && accounts().find((x) => x.id === s.id);
    return a ? publicUser(a) : null;
  } catch { return null; }
}

function localSignOut() { localStorage.removeItem(SESSION); sessionStorage.removeItem(SESSION); }

function localRename(id: string, name: string): User {
  if (!name.trim()) throw new AuthError("Your name can't be empty.", "name");
  const all = accounts();
  const a = all.find((x) => x.id === id);
  if (!a) throw new AuthError("This account no longer exists in this browser.");
  a.name = name.trim().slice(0, 60);
  saveAccounts(all);
  return publicUser(a);
}

async function localChangePassword(id: string, current: string, next: string) {
  const all = accounts();
  const a = all.find((x) => x.id === id);
  if (!a || (await derive(current, unhex(a.salt))) !== a.hash) throw new AuthError("Your current password isn't right.", "password");
  const bad = passwordProblem(next);
  if (bad) throw new AuthError(bad, "password");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  a.salt = hex(salt); a.hash = await derive(next, salt);
  saveAccounts(all);
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

// ------------------------------------------------------------------ the mode-independent API the app uses

export type Mode = "local" | "server";
let modeP: Promise<Mode> | null = null;
let serverUser: User | null | undefined;

async function call(body: Record<string, unknown>): Promise<{ user?: User }> {
  let r: Response;
  try {
    r = await fetch("/api/account", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      credentials: "same-origin" });
  } catch { throw new AuthError("Couldn't reach Cutmind. Check your connection and try again."); }
  const d = await r.json().catch(() => ({})) as { user?: User; error?: string; field?: AuthError["field"] };
  if (!r.ok) throw new AuthError(d.error ?? `Something went wrong (${r.status}). Try again.`, d.field);
  return d;
}

/** Server accounts when this site has a database, else accounts in this browser. Asked once per page. */
export function accountMode(): Promise<Mode> {
  modeP ??= fetch("/api/account", { credentials: "same-origin", cache: "no-store" })
    .then(async (r) => {
      if (r.status === 404) return "local" as Mode;
      const d = await r.json().catch(() => ({})) as { mode?: Mode; user?: User | null };
      if (d.mode === "server") serverUser = d.user ?? null;
      return d.mode === "server" ? "server" : "local";
    })
    .catch(() => "local" as Mode);
  return modeP;
}

export async function getUser(): Promise<User | null> {
  return (await accountMode()) === "server" ? serverUser ?? null : localUser();
}

export async function signUp(name: string, email: string, password: string, remember: boolean): Promise<User> {
  if ((await accountMode()) === "local") return localSignUp(name, email, password, remember);
  if (!name.trim()) throw new AuthError("Tell us what to call you.", "name");
  if (!validEmail(email)) throw new AuthError("Enter an email like you@example.com.", "email");
  const bad = passwordProblem(password);
  if (bad) throw new AuthError(bad, "password");
  return (serverUser = (await call({ action: "signup", name, email, password, remember })).user!);
}

export async function signIn(email: string, password: string, remember: boolean): Promise<User> {
  if ((await accountMode()) === "local") return localSignIn(email, password, remember);
  if (!validEmail(email)) throw new AuthError("Enter an email like you@example.com.", "email");
  if (!password) throw new AuthError("Enter your password.", "password");
  return (serverUser = (await call({ action: "signin", email, password, remember })).user!);
}

export async function signOut() {
  localSignOut();
  if ((await accountMode()) === "server") { await call({ action: "signout" }).catch(() => undefined); serverUser = null; }
}

/** Deletes the account for good, after asking for its password again. The caller then removes its videos, settings and
 *  keys from this browser (lib/store.ts deleteAccountData). */
export async function deleteAccount(id: string, password: string) {
  if ((await accountMode()) === "local") {
    const all = accounts();
    const a = all.find((x) => x.id === id);
    if (!a || (await derive(password, unhex(a.salt))) !== a.hash) throw new AuthError("That password isn't right.", "password");
    saveAccounts(all.filter((x) => x.id !== id));
    localSignOut();
    return;
  }
  await call({ action: "delete", password });
  localSignOut(); serverUser = null;
}

export async function rename(id: string, name: string): Promise<User> {
  if ((await accountMode()) === "local") return localRename(id, name);
  return (serverUser = (await call({ action: "rename", name })).user!);
}

export async function changePassword(id: string, current: string, next: string) {
  if ((await accountMode()) === "local") return localChangePassword(id, current, next);
  await call({ action: "password", current, next });
}
