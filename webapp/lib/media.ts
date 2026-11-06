// Media helpers that run in the browser: probe a video, decode audio, measure loudness and a song's feel.

import { looksLikeScreen } from "./framed";

export async function probeVideo(url: string): Promise<{ duration: number; width: number; height: number }> {
  const v = document.createElement("video");
  v.preload = "metadata";
  v.muted = true;
  v.src = url;
  await new Promise<void>((ok, bad) => {
    v.onloadedmetadata = () => ok();
    v.onerror = () => bad(new Error("This file can't be played in your browser. Try an MP4 (H.264) or MOV."));
  });
  return { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
}

export async function probeImage(url: string): Promise<{ width: number; height: number }> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}

/** Does this picture or clip look like an app / website screen? One small frame (160 px wide; a clip's frame at 1 s),
 *  judged by lib/framed.ts looksLikeScreen. Cheap, and never fails an upload: false when it can't tell. */
export async function looksLikeScreenAt(url: string, kind: "image" | "video"): Promise<boolean> {
  try {
    let el: HTMLImageElement | HTMLVideoElement, w: number, h: number;
    if (kind === "image") {
      const img = new Image(); img.src = url; await img.decode();
      el = img; w = img.naturalWidth; h = img.naturalHeight;
    } else {
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
      await new Promise<void>((ok, bad) => { v.onloadeddata = () => ok(); v.onerror = () => bad(new Error("no frame")); setTimeout(() => bad(new Error("slow")), 6000); });
      v.currentTime = Math.min(1, (v.duration || 0) / 2);
      await new Promise<void>((ok) => { v.onseeked = () => ok(); setTimeout(ok, 3000); });
      el = v; w = v.videoWidth; h = v.videoHeight;
    }
    if (!w || !h) return false;
    const sw = Math.min(160, w), sh = Math.max(1, Math.round((h * sw) / w));
    const c = document.createElement("canvas"); c.width = sw; c.height = sh;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    g.drawImage(el, 0, 0, sw, sh);
    const ok = looksLikeScreen(g.getImageData(0, 0, sw, sh).data, sw, sh, w, h);
    if (el instanceof HTMLVideoElement) el.removeAttribute("src");
    return ok;
  } catch { return false; }
}

/** Decode a file's audio to mono at the given rate (16 kHz for speech recognition). */
export async function decodeMono(file: Blob, rate = 16000): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, rate);
  const audio = await ctx.decodeAudioData(buf);
  const off = new OfflineAudioContext(1, Math.ceil(audio.duration * rate), rate);
  const src = off.createBufferSource();
  src.buffer = audio;
  src.connect(off.destination);
  src.start();
  return (await off.startRendering()).getChannelData(0);
}

export function rms(x: Float32Array): number {
  let s = 0, n = 0;
  const step = Math.max(1, Math.floor(x.length / 400000));
  for (let i = 0; i < x.length; i += step) { s += x[i] * x[i]; n++; }
  return Math.sqrt(s / Math.max(1, n));
}

/** RMS of the louder half of 50 ms blocks: speech level, not counting pauses. */
export function activeRms(x: Float32Array, rate = 16000): number {
  const block = Math.floor(rate * 0.05);
  const levels: number[] = [];
  for (let i = 0; i + block <= x.length; i += block) {
    let s = 0;
    for (let k = i; k < i + block; k++) s += x[k] * x[k];
    levels.push(Math.sqrt(s / block));
  }
  levels.sort((a, b) => a - b);
  const top = levels.slice(Math.floor(levels.length / 2));
  return top.length ? Math.sqrt(top.reduce((a, b) => a + b * b, 0) / top.length) : 0.05;
}

/** 16-bit PCM WAV of one channel, or of several (interleaved: stereo is [left, right]). */
export function wav(x: Float32Array | Float32Array[], rate = 16000): Blob {
  const ch = Array.isArray(x) ? x : [x];
  const n = ch[0]?.length ?? 0, k = ch.length, bytes = n * k * 2;
  const buf = new ArrayBuffer(44 + bytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + bytes, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, k, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * k * 2, true); v.setUint16(32, k * 2, true); v.setUint16(34, 16, true); str(36, "data");
  v.setUint32(40, bytes, true);
  const out = new Int16Array(buf, 44, n * k);
  for (let c = 0; c < k; c++) {
    const d = ch[c];
    for (let i = 0; i < n; i++) { const s = d[i] > 1 ? 1 : d[i] < -1 ? -1 : d[i]; out[i * k + c] = Math.round(s * 32767); }
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** What a song sounds like, measured: energy 0-1, a feel word, and where to enter it (a bar before the first big hit). */
export function musicFeel(x: Float32Array, rate = 16000): { energy: number; feel: string; entry: number; rms: number } {
  const n = Math.min(x.length, rate * 90);
  const hop = Math.floor(rate * 0.1);
  const env: number[] = [];
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(x[i]));
  for (let i = 0; i + hop <= n; i += hop) {
    let s = 0;
    for (let k = i; k < i + hop; k++) s += (x[k] / peak) ** 2;
    env.push(Math.sqrt(s / hop));
  }
  const mean = env.reduce((a, b) => a + b, 0) / Math.max(1, env.length);
  let rise = 0;
  for (let i = 1; i < env.length; i++) rise += Math.max(0, env[i] - env[i - 1]);
  const pulse = rise / Math.max(1, env.length - 1) / (mean + 1e-9);
  const sorted = [...env].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const full = env.filter((e) => e > 0.5 * p90).length / Math.max(1, env.length);
  const energy = Math.round(Math.min(1, 0.55 * Math.min(1, pulse / 0.35) + 0.45 * full) * 100) / 100;
  const feel = energy < 0.35 ? "gentle" : energy < 0.5 ? "steady" : energy < 0.65 ? "upbeat" : energy < 0.8 ? "driving" : "hype";
  const smooth = env.map((_, i) => env.slice(Math.max(0, i - 5), i + 5).reduce((a, b) => a + b, 0) / 10);
  const hit = smooth.findIndex((e) => e >= 0.8 * p90) * 0.1;
  const bar = 2.0;
  const entry = hit > 1.5 * bar ? Math.round((hit - bar) * 10) / 10 : 0;
  return { energy, feel, entry, rms: activeRms(x, rate) };
}

export const uid = () => Math.random().toString(36).slice(2, 10);
