// Server-side accounts (only when a database is connected: DATABASE_URL or POSTGRES_URL, e.g. Neon from the Vercel
// Marketplace). Stored: email, name, a scrypt password hash, sessions (as SHA-256 of the token) and the user's
// synced preferences (settings without API keys, style rules, look). Videos and API keys never come here.

import "server-only";
import { createHash, randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

export const DB_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const serverAccounts = () => !!DB_URL;

type Sql = ReturnType<typeof postgres>;
const g = globalThis as unknown as { __cutmindSql?: Sql; __cutmindReady?: Promise<void> };

function sql(): Sql {
  if (!g.__cutmindSql) {
    const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(DB_URL) || DB_URL.includes("host=/");
    g.__cutmindSql = postgres(DB_URL, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, ssl: local ? false : "require" });
  }
  return g.__cutmindSql;
}

async function ready(): Promise<Sql> {
  const db = sql();
  g.__cutmindReady ??= (async () => {
    await db`create table if not exists cm_users (id text primary key, email text unique not null, name text not null,
      pass text not null, created_at timestamptz not null default now())`;
    await db`create table if not exists cm_sessions (token text primary key, user_id text not null references cm_users(id) on delete cascade,
      created_at timestamptz not null default now(), expires_at timestamptz not null)`;
    await db`create table if not exists cm_data (user_id text primary key references cm_users(id) on delete cascade,
      data jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now())`;
    await db`delete from cm_sessions where expires_at < now()`;
  })().catch((e) => { g.__cutmindReady = undefined; throw e; });
  await g.__cutmindReady;
  return db;
}

export type DbUser = { id: string; email: string; name: string; createdAt: string };
const pub = (r: { id: string; email: string; name: string; created_at: Date }): DbUser =>
  ({ id: r.id, email: r.email, name: r.name, createdAt: new Date(r.created_at).toISOString() });

const N = 2 ** 15, R = 8, P = 1, LEN = 32, MAXMEM = 64 * 1024 * 1024;
async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${h.toString("base64")}`;
}
async function checkPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split("$");
  if (kind !== "scrypt") return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length, { N: +n, r: +r, p: +p, maxmem: MAXMEM });
  return got.length === want.length && timingSafeEqual(got, want);
}
const DUMMY = "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createUser(name: string, email: string, password: string): Promise<DbUser | null> {
  const db = await ready();
  const id = randomBytes(9).toString("base64url");
  const rows = await db`insert into cm_users (id, email, name, pass) values (${id}, ${email}, ${name}, ${await hashPassword(password)})
    on conflict (email) do nothing returning id, email, name, created_at`;
  return rows.length ? pub(rows[0] as never) : null;
}

export async function verifyUser(email: string, password: string): Promise<DbUser | null> {
  const db = await ready();
  const rows = await db`select id, email, name, pass, created_at from cm_users where email = ${email}`;
  const ok = await checkPassword(password, rows.length ? (rows[0].pass as string) : DUMMY);   // same work either way
  return rows.length && ok ? pub(rows[0] as never) : null;
}

export async function newSession(userId: string, days: number): Promise<string> {
  const db = await ready();
  const token = randomBytes(32).toString("base64url");
  await db`insert into cm_sessions (token, user_id, expires_at) values (${tokenHash(token)}, ${userId}, now() + ${`${days} days`}::interval)`;
  return token;
}

export async function sessionUser(token: string | undefined): Promise<DbUser | null> {
  if (!token) return null;
  const db = await ready();
  const rows = await db`select u.id, u.email, u.name, u.created_at from cm_sessions s join cm_users u on u.id = s.user_id
    where s.token = ${tokenHash(token)} and s.expires_at > now()`;
  return rows.length ? pub(rows[0] as never) : null;
}

export async function endSession(token: string | undefined) {
  if (!token) return;
  const db = await ready();
  await db`delete from cm_sessions where token = ${tokenHash(token)}`;
}

export async function renameUser(id: string, name: string): Promise<DbUser> {
  const db = await ready();
  const rows = await db`update cm_users set name = ${name} where id = ${id} returning id, email, name, created_at`;
  return pub(rows[0] as never);
}

/** Changes the password and signs out every other device. */
export async function changePassword(id: string, current: string, next: string, keepToken: string): Promise<boolean> {
  const db = await ready();
  const rows = await db`select pass from cm_users where id = ${id}`;
  if (!rows.length || !(await checkPassword(current, rows[0].pass as string))) return false;
  await db`update cm_users set pass = ${await hashPassword(next)} where id = ${id}`;
  await db`delete from cm_sessions where user_id = ${id} and token <> ${tokenHash(keepToken)}`;
  return true;
}

/** Deletes the account for good (its sessions and synced preferences go with it: on delete cascade). The password is
 *  asked again, so a session left open on a shared computer can't do it. */
export async function deleteUser(id: string, password: string): Promise<boolean> {
  const db = await ready();
  const rows = await db`select pass from cm_users where id = ${id}`;
  if (!rows.length || !(await checkPassword(password, rows[0].pass as string))) return false;
  await db`delete from cm_users where id = ${id}`;
  return true;
}

export async function getData(id: string): Promise<Record<string, unknown>> {
  const db = await ready();
  const rows = await db`select data from cm_data where user_id = ${id}`;
  return rows.length ? (rows[0].data as Record<string, unknown>) : {};
}

export async function putData(id: string, data: Record<string, unknown>) {
  const db = await ready();
  await db`insert into cm_data (user_id, data, updated_at) values (${id}, ${db.json(data as never)}, now())
    on conflict (user_id) do update set data = excluded.data, updated_at = now()`;
}
