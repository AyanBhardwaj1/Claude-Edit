// Faster-than-real-time export for Motion Studio animations: every frame is drawn at its exact time and encoded with
// WebCodecs (H.264 + AAC) into an MP4; the music and voiceover are mixed offline. Browsers without WebCodecs fall back
// to the real-time recorder (StudioPlayer.record).

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { drawAnim, frameSize, timeline, total, type Anim } from "./studio";

const FPS = 30, RATE = 48000;

export const canFastExport = () => typeof window !== "undefined" && "VideoEncoder" in window && "AudioEncoder" in window && "VideoFrame" in window;

async function pickVideoConfig(W: number, H: number): Promise<VideoEncoderConfig | null> {
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.640033"]) {
    const cfg: VideoEncoderConfig = { codec, width: W, height: H, bitrate: 12_000_000, framerate: FPS, avc: { format: "avc" } };
    const ok = await VideoEncoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (ok.supported) return cfg;
  }
  return null;
}

async function mix(a: Anim, urls: Map<string, string>): Promise<AudioBuffer | null> {
  const dur = total(a);
  const voiced = Object.keys(a.voice?.keys ?? {}).length > 0;
  if (!a.music && !voiced) return null;
  const ctx = new OfflineAudioContext(2, Math.ceil((dur + 0.2) * RATE), RATE);
  const load = async (key?: string) => {
    const url = key ? urls.get(key) : undefined;
    if (!url) return null;
    try { return await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer()); } catch { return null; }
  };
  const music = await load(a.music);
  if (music) {
    const src = ctx.createBufferSource(); src.buffer = music; src.loop = true;
    const g = ctx.createGain(); const level = voiced ? 0.22 : 0.7;
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(level, 0.6);
    g.gain.setValueAtTime(level, Math.max(0.6, dur - 1.2)); g.gain.linearRampToValueAtTime(0, dur);
    src.connect(g); g.connect(ctx.destination); src.start(0); src.stop(dur + 0.1);
  }
  for (const seg of timeline(a)) {
    const b = await load(a.voice?.keys[seg.s.id]);
    if (!b) continue;
    const src = ctx.createBufferSource(); src.buffer = b; src.connect(ctx.destination); src.start(seg.start + 0.15);
  }
  return ctx.startRendering();
}

export async function exportAnimFast(a: Anim, urls: Map<string, string>, onProgress: (pct: number) => void): Promise<Blob> {
  const { W, H } = frameSize(a.format);
  const cfg = await pickVideoConfig(W, H);
  if (!cfg) throw new Error("no H.264 encoder");
  const audio = await mix(a, urls);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), fastStart: "in-memory", firstTimestampBehavior: "offset",
    video: { codec: "avc", width: W, height: H, frameRate: FPS },
    ...(audio ? { audio: { codec: "aac" as const, numberOfChannels: 2, sampleRate: RATE } } : {}) });
  let failed: Error | null = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failed = e as Error; } });
  venc.configure(cfg);
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext("2d")!;
  const frames = Math.ceil(total(a) * FPS);
  for (let i = 0; i < frames; i++) {
    if (failed) throw failed;
    drawAnim(g, a, i / FPS);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    venc.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    if (venc.encodeQueueSize > 8) await new Promise((ok) => setTimeout(ok, 0));
    if (i % 15 === 0) { onProgress(Math.round((85 * i) / frames)); await new Promise((ok) => setTimeout(ok, 0)); }
  }
  await venc.flush(); venc.close();
  if (audio) {
    const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => { failed = e as Error; } });
    aenc.configure({ codec: "mp4a.40.2", sampleRate: RATE, numberOfChannels: 2, bitrate: 192_000 });
    const L = audio.getChannelData(0), R = audio.numberOfChannels > 1 ? audio.getChannelData(1) : L;
    const step = 1024;
    for (let off = 0; off < audio.length; off += step) {
      const n = Math.min(step, audio.length - off);
      const data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0); data.set(R.subarray(off, off + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: RATE, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off * 1e6) / RATE), data });
      aenc.encode(ad); ad.close();
    }
    await aenc.flush(); aenc.close();
  }
  if (failed) throw failed;
  muxer.finalize();
  onProgress(100);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}
