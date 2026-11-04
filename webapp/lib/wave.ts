// A waveform of the cut, for the timeline: loudness in 240 slices of the output, read from the takes' sound.

import { decodeMono } from "./media";
import { getMedia } from "./store";
import { sourceAt, type Timeline } from "./timeline";
import type { Project } from "./types";

const RATE = 8000;
const cache = new Map<string, Float32Array>();

async function audioOf(key: string): Promise<Float32Array | null> {
  if (cache.has(key)) return cache.get(key)!;
  const blob = await getMedia(key);
  if (!blob) return null;
  try { const x = await decodeMono(blob, RATE); cache.set(key, x); return x; } catch { return null; }
}

export async function waveform(p: Project, tl: Timeline, bins = 240): Promise<number[] | null> {
  if (!tl.duration) return null;
  const audio = await Promise.all(p.sources.map((s) => audioOf(s.mediaKey)));
  const out: number[] = [];
  const step = tl.duration / bins, win = Math.max(1, Math.floor(step * RATE));
  for (let i = 0; i < bins; i++) {
    const at = sourceAt(tl, (i + 0.5) * step);
    const x = at ? audio[at.src] : null;
    if (!x) { out.push(0); continue; }
    const c = Math.floor(at!.time * RATE) - (win >> 1);
    let sum = 0, n = 0;
    for (let k = Math.max(0, c); k < Math.min(x.length, c + win); k += 4) { sum += x[k] * x[k]; n++; }
    out.push(n ? Math.sqrt(sum / n) : 0);
  }
  const peak = Math.max(1e-4, ...out);
  return out.map((v) => Math.min(1, (v / peak) ** 0.7));
}
