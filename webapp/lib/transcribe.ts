// Word-timed transcripts. Two engines:
//   openai   OpenAI's whisper-1 with word timestamps (the user's OpenAI key, called from the browser)
//   browser  Whisper running in this tab (transformers.js, loaded from a CDN on first use, ~150 MB model, no key)
// Anthropic has no speech-to-text API, so Anthropic-only users get the in-browser engine.

import { decodeMono, wav } from "./media";
import type { Word } from "./types";

type Progress = (msg: string, pct?: number) => void;

export async function transcribe(file: Blob, src: number, firstId: number, engine: "openai" | "browser", openaiKey: string,
                                 onProgress: Progress, decoded?: Float32Array): Promise<Word[]> {
  onProgress("Listening to your video", 2);
  const audio = decoded ?? await decodeMono(file, 16000);      // decoded once by the caller when it has it
  const raw = engine === "openai" && openaiKey ? await viaOpenAI(audio, openaiKey, onProgress) : await inBrowser(audio, onProgress);
  return raw.filter((w) => w.w.trim()).map((w, i) => ({ id: `w${firstId + i}`, src, s: +w.s.toFixed(3), e: +Math.max(w.e, w.s + 0.05).toFixed(3),
    w: w.w.trim(), p: w.p }));
}

type RawWord = { w: string; s: number; e: number; p?: number };

async function viaOpenAI(audio: Float32Array, key: string, onProgress: Progress): Promise<RawWord[]> {
  const rate = 16000, chunk = rate * 600;           // 10-minute pieces stay under the 25 MB upload limit
  const out: RawWord[] = [];
  for (let off = 0; off < audio.length; off += chunk) {
    const piece = audio.subarray(off, Math.min(audio.length, off + chunk));
    const fd = new FormData();
    fd.append("file", wav(piece, rate), "audio.wav");
    fd.append("model", "whisper-1");
    fd.append("response_format", "verbose_json");
    fd.append("timestamp_granularities[]", "word");
    fd.append("timestamp_granularities[]", "segment");
    onProgress("Listening to your video", 5 + Math.round((80 * off) / audio.length));
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST",
      headers: { Authorization: `Bearer ${key}` }, body: fd });
    if (!r.ok) throw new Error(r.status === 401 ? "Your OpenAI key was not accepted (Settings)." :
      `Transcription failed (${r.status}): ${(await r.text()).slice(0, 160)}`);
    const data = await r.json() as { words?: { word: string; start: number; end: number }[];
      segments?: { start: number; end: number; avg_logprob: number }[] };
    const t0 = off / rate;
    for (const w of data.words ?? []) {
      const seg = data.segments?.find((s) => w.start >= s.start - 0.01 && w.start <= s.end);
      out.push({ w: w.word, s: w.start + t0, e: w.end + t0, p: seg ? Math.min(1, Math.exp(seg.avg_logprob)) : undefined });
    }
  }
  return punctuate(out);
}

/** whisper-1's word list has no punctuation; leave as is (captions don't need it), but keep sentence ends from
 * long pauses so phrases and captions break naturally. */
function punctuate(ws: RawWord[]): RawWord[] {
  return ws.map((w, i) => (i + 1 < ws.length && ws[i + 1].s - w.e > 0.6 && !/[.!?,]$/.test(w.w) ? { ...w, w: w.w + "." } : w));
}

let asr: ((x: Float32Array, o: Record<string, unknown>) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[] }>) | null = null;

async function inBrowser(audio: Float32Array, onProgress: Progress): Promise<RawWord[]> {
  if (!asr) {
    onProgress("Getting the listening model ready (one download, about 150 MB)", 3);
    const url = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2";
    const mod = await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ url);
    const device = (navigator as Navigator & { gpu?: unknown }).gpu ? "webgpu" : "wasm";
    asr = await mod.pipeline("automatic-speech-recognition", "onnx-community/whisper-base_timestamped",
      { device, dtype: device === "webgpu" ? "fp32" : "q8" });
  }
  onProgress("Listening to your video (in your browser)", 20);
  const res = await asr!(audio, { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, language: "en" });
  return (res.chunks ?? []).map((c) => ({ w: c.text, s: c.timestamp[0], e: c.timestamp[1] ?? c.timestamp[0] + 0.3 }));
}
