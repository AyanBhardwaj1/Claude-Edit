// Find and fetch licensed pictures for the AI's "webPictures" (through this app's /api routes), store them
// in the project's library with their credit. SVG logos are drawn to PNG so the renderer can use them.

import { putMedia } from "./store";
import type { Asset, Credit } from "./types";

type Result = { url: string; title: string; creator: string; license: string; page: string; source: string; kind: "logo" | "photo" };

export async function findPicture(query: string, kind: "logo" | "photo"): Promise<{ asset: Asset; blob: Blob } | null> {
  const r = await fetch(`/api/search?${new URLSearchParams({ q: query, kind })}`);
  if (!r.ok) return null;
  const { results } = (await r.json()) as { results: Result[] };
  for (const hit of results.slice(0, 3)) {
    const img = await fetch(`/api/image?${new URLSearchParams({ url: hit.url })}`);
    if (!img.ok) continue;
    let blob = await img.blob();
    if (blob.type === "image/svg+xml") blob = await svgToPng(blob);
    const bmp = await createImageBitmap(blob).catch(() => null);
    if (!bmp) continue;
    const credit: Credit = { title: hit.title, creator: hit.creator, license: hit.license, page: hit.page, source: hit.source };
    const asset: Asset = { key: `web:${query}`, name: hit.title, kind: "image", width: bmp.width, height: bmp.height, credit, web: true };
    bmp.close();
    await putMedia(asset.key, blob);
    return { asset, blob };
  }
  return null;
}

async function svgToPng(svg: Blob, size = 800): Promise<Blob> {
  const url = URL.createObjectURL(svg);
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  const g = c.getContext("2d")!;
  const s = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size)) * 0.8;
  const w = (img.naturalWidth || size) * s, h = (img.naturalHeight || size) * s;
  g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
  URL.revokeObjectURL(url);
  return new Promise((ok) => c.toBlob((b) => ok(b!), "image/png"));
}
