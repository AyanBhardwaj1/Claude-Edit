// Plays a Motion Studio animation on a canvas with its music and voiceover, and records it (MediaRecorder).

import { drawAnim, frameSize, timeline, total, type Anim } from "./studio";

export class StudioPlayer {
  t = 0;
  playing = false;
  onTime?: (t: number) => void;
  onEnd?: () => void;
  private g: CanvasRenderingContext2D;
  private ctx?: AudioContext;
  private out?: GainNode;
  private rec?: MediaStreamAudioDestinationNode;
  private bufs = new Map<string, AudioBuffer>();
  private live: AudioBufferSourceNode[] = [];
  private raf = 0;
  private t0 = 0;
  private from = 0;

  constructor(private canvas: HTMLCanvasElement, public anim: Anim, private urls: Map<string, string>) {
    this.g = canvas.getContext("2d")!;
    this.setAnim(anim);
  }

  setAnim(a: Anim) {
    this.anim = a;
    const { W, H } = frameSize(a.format);
    if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; }
    this.t = Math.min(this.t, total(a));
    if (!this.playing) this.draw(this.t);
  }

  setUrls(urls: Map<string, string>) { this.urls = urls; }

  get duration() { return total(this.anim); }

  draw(t: number) { drawAnim(this.g, this.anim, t); }

  private ensure() {
    if (this.ctx) return;
    this.ctx = new AudioContext({ sampleRate: 48000 });
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    this.rec = this.ctx.createMediaStreamDestination();
    this.out.connect(this.rec);
  }

  private async buf(key?: string): Promise<AudioBuffer | null> {
    if (!key) return null;
    if (this.bufs.has(key)) return this.bufs.get(key)!;
    const url = this.urls.get(key);
    if (!url) return null;
    try {
      const b = await this.ctx!.decodeAudioData(await (await fetch(url)).arrayBuffer());
      this.bufs.set(key, b);
      return b;
    } catch { return null; }
  }

  async play(from = this.t) {
    this.ensure();
    const ctx = this.ctx!;
    if (ctx.state === "suspended") await ctx.resume();
    this.stopSources();
    const dur = this.duration;
    if (from >= dur - 0.05) from = 0;
    const music = await this.buf(this.anim.music);
    const voiced = Object.keys(this.anim.voice?.keys ?? {}).length > 0;
    const startAt = ctx.currentTime + 0.05;
    if (music) {
      const src = ctx.createBufferSource(); src.buffer = music; src.loop = true;
      const g = ctx.createGain();
      const level = voiced ? 0.22 : 0.7;
      g.gain.setValueAtTime(0, startAt); g.gain.linearRampToValueAtTime(level, startAt + 0.6);
      const end = startAt + (dur - from);
      g.gain.setValueAtTime(level, Math.max(startAt + 0.6, end - 1.2)); g.gain.linearRampToValueAtTime(0, end);
      src.connect(g); g.connect(this.out!);
      src.start(startAt, from % music.duration);
      src.stop(end + 0.05);
      this.live.push(src);
    }
    for (const seg of timeline(this.anim)) {
      const key = this.anim.voice?.keys[seg.s.id];
      const b = await this.buf(key);
      if (!b || seg.start + b.duration < from) continue;
      const src = ctx.createBufferSource(); src.buffer = b; src.connect(this.out!);
      const at = seg.start + 0.15 - from;
      if (at >= 0) src.start(startAt + at); else src.start(startAt, -at);
      this.live.push(src);
    }
    this.from = from; this.t0 = startAt; this.playing = true;
    const tick = () => {
      if (!this.playing) return;
      const t = this.from + Math.max(0, ctx.currentTime - this.t0);
      this.t = Math.min(t, dur);
      this.draw(this.t);
      this.onTime?.(this.t);
      if (t >= dur) { this.playing = false; this.stopSources(); this.onEnd?.(); return; }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopSources() { for (const s of this.live) { try { s.stop(); } catch { /* already stopped */ } } this.live = []; }

  pause() { this.playing = false; cancelAnimationFrame(this.raf); this.stopSources(); }

  seek(t: number) { const was = this.playing; this.pause(); this.t = Math.max(0, Math.min(t, this.duration)); this.draw(this.t); if (was) void this.play(this.t); }

  async record(onProgress: (pct: number) => void): Promise<{ blob: Blob; ext: string }> {
    this.ensure();
    const types = ['video/mp4;codecs="avc1.640028,mp4a.40.2"', "video/mp4;codecs=avc1,opus", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm"];
    const mime = types.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...this.rec!.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14_000_000, audioBitsPerSecond: 192_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise<void>((ok) => (rec.onstop = () => ok()));
    const prevT = this.onTime, prevE = this.onEnd;
    const ended = new Promise<void>((ok) => { this.onEnd = () => ok(); });
    this.onTime = (t) => { onProgress(Math.round((100 * t) / this.duration)); prevT?.(t); };
    this.pause(); this.t = 0; this.draw(0);
    rec.start(1000);
    await this.play(0);
    await ended;
    await new Promise((ok) => setTimeout(ok, 300));
    rec.stop(); await stopped;
    this.onTime = prevT; this.onEnd = prevE;
    return { blob: new Blob(chunks, { type: mime.split(";")[0] || "video/webm" }), ext: mime.includes("mp4") ? "mp4" : "webm" };
  }

  /** A still for the cover / thumbnail: the first scene once its words are in. */
  async still(): Promise<Blob> {
    const t = Math.min(1.6, (this.anim.scenes[0]?.duration ?? 2) - 0.4);
    this.draw(t);
    const b = await new Promise<Blob>((ok) => this.canvas.toBlob((x) => ok(x!), "image/jpeg", 0.9));
    this.draw(this.t);
    return b;
  }

  dispose() {
    this.pause();
    const c = this.ctx; this.ctx = undefined;
    if (c && c.state !== "closed") void c.close().catch(() => undefined);
  }
}
