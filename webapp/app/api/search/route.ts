// Licensed pictures for the things a video names. Only licences that allow reuse come back:
// CC0, public domain, CC BY, CC BY-SA. Logos come from Simple Icons (CC0). No keys, no user data stored.

import { NextResponse } from "next/server";

export const runtime = "nodejs";

type Result = { url: string; title: string; creator: string; license: string; page: string; source: string; kind: "logo" | "photo";
  width?: number; height?: number };

const UA = "Cutmind/0.1 (video editor; image search)";
const OK = new Set(["cc0", "pdm", "by", "by-sa"]);

function lic(s: string): string {
  const t = (s || "").toLowerCase().replace(/^cc[ -]/, "").replace(/\s+\d+(\.\d+)?$/, "").trim();
  return t === "public domain" || t === "pd" ? "pdm" : t;
}

function slug(name: string) {
  return name.toLowerCase().replace(/\+/g, "plus").replace(/\./g, "dot").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

async function openverse(q: string): Promise<Result[]> {
  const u = `https://api.openverse.org/v1/images/?${new URLSearchParams({ q, license: "cc0,pdm,by,by-sa", mature: "false", page_size: "6" })}`;
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const d = await r.json() as { results: { id: string; title?: string; creator?: string; license: string; foreign_landing_url?: string;
    width?: number; height?: number; source?: string }[] };
  return d.results.map((x) => ({ url: `https://api.openverse.org/v1/images/${x.id}/thumb/`, title: x.title || q, creator: x.creator || "",
    license: lic(x.license), page: x.foreign_landing_url || "", source: `openverse/${x.source ?? ""}`, kind: "photo" as const,
    width: x.width, height: x.height }));
}

async function wikimedia(q: string): Promise<Result[]> {
  const u = `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ action: "query", format: "json", generator: "search",
    gsrsearch: q, gsrnamespace: "6", gsrlimit: "6", prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1200", origin: "*" })}`;
  const r = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) return [];
  const d = await r.json() as { query?: { pages: Record<string, { index: number; title: string; imageinfo?: { thumburl?: string; url: string;
    mime: string; width: number; height: number; descriptionurl: string; extmetadata?: Record<string, { value: string }> }[] }> } };
  return Object.values(d.query?.pages ?? {}).sort((a, b) => a.index - b.index).flatMap((p) => {
    const ii = p.imageinfo?.[0];
    if (!ii || !/^image\/(jpeg|png|webp)/.test(ii.mime)) return [];
    const m = ii.extmetadata ?? {};
    return [{ url: ii.thumburl || ii.url, title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""),
      creator: (m.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim(), license: lic(m.LicenseShortName?.value ?? ""),
      page: ii.descriptionurl, source: "wikimedia", kind: "photo" as const, width: ii.width, height: ii.height }];
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().slice(0, 120);
  const kind = searchParams.get("kind") === "logo" ? "logo" : "photo";
  if (!q) return NextResponse.json({ results: [] });
  let results: Result[] = [];
  if (kind === "logo") {
    const name = q.replace(/\s+logo$/i, "");
    results.push({ url: `https://cdn.simpleicons.org/${slug(name)}`, title: `${name} logo`, creator: "Simple Icons", license: "cc0",
      page: "https://simpleicons.org", source: "simple-icons", kind: "logo" });
  } else {
    const [a, b] = await Promise.all([openverse(q).catch(() => []), wikimedia(q).catch(() => [])]);
    results = [...a, ...b].filter((r) => OK.has(r.license));
  }
  return NextResponse.json({ results: results.slice(0, 8) }, { headers: { "Cache-Control": "public, max-age=86400" } });
}
