// Plays an edit live on a canvas, and records it to a video file (MP4 where the browser can, else WebM).
// Two <video> elements per take swap at every cut: while one plays, the other has already sought to the next
// segment, so cuts land without a seek stall. Audio runs through Web Audio: a light voice clean-up, the song
// set a measured gap under the voice, dipping under words and lifting in pauses, and a whoosh on picture entrances.

import { buildScene, drawFrame, H, setFormat, W, type Scene } from "./compositor";
import { LEVEL_GAP } from "./mix";
import { clipTimeAt } from "./screenrec";
import { bleepSpans } from "./bleep";
import { buildTimeline, outAt, spanOf, srcAt, type Segment, type Timeline } from "./timeline";
import type { Edit, Project } from "./types";

const db = (x: number) => Math.pow(10, x / 20);

type Pair = { a: HTMLVideoElement; b: HTMLVideoElement; gainA: GainNode; gainB: GainNode };

const STOPPED = "The export stopped before the end (playback was paused or the video changed). Export again.";

export class Player {
  tl!: Timeline;
  scene!: Scene;
  t = 0;
  playing = false;
  onTime?: (t: number) => void;
  onEnd?: () => void;
  private g: CanvasRenderingContext2D;
  private ctx?: AudioContext;
  private master?: GainNode;
  private pairs: Pair[] = [];
  private seg = -1;
  private cur?: HTMLVideoElement;
  private music?: HTMLAudioElement;
  private musicGain?: GainNode;
  private raf = 0;
  private recDest?: MediaStreamAudioDestinationNode;
  private speakers?: GainNode;
  private stopRec?: () => void;
  private voiceGate?: GainNode;
  private toneGain?: GainNode;
  private bleeps: [number, number][] = [];
  private bleeping = false;            // ends an export in progress (see record)
  private silent = false;
  private woosh?: AudioBuffer;
  private fired = new Set<string>();
  private media = new Map<string, HTMLImageElement | HTMLVideoElement>();

  constructor(private canvas: HTMLCanvasElement, public project: Project, public edit: Edit,
              private urls: Map<string, string>) {
    setFormat(project.format);
    // resizing clears the canvas: only do it when the shape changes, so the last frame stays up while a version loads
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    this.g = canvas.getContext("2d")!;
  }

  async load() {
    await document.fonts.load(`900 100px Montserrat`).catch(() => undefined);
    await document.fonts.load(`600 100px "${this.edit.captions.font}"`).catch(() => undefined);
    for (const a of this.project.library) {
      const url = this.urls.get(a.key);
      if (!url || a.kind === "music" || this.media.has(a.key)) continue;
      if (a.kind === "image") {
        const img = new Image(); img.crossOrigin = "anonymous"; img.src = url;
        await img.decode().catch(() => undefined);
        this.media.set(a.key, img);
      } else {
        const v = document.createElement("video");
        v.muted = true; v.playsInline = true; v.preload = "auto"; v.loop = true; v.src = url;
        this.media.set(a.key, v);
      }
    }
    this.rebuild(this.edit);
    this.drawAt(0);
  }

  rebuild(edit: Edit) {
    this.edit = edit;
    this.tl = buildTimeline(this.project.words, edit, this.project.sources.map((s) => s.duration));
    this.scene = buildScene(this.project, edit, this.tl, this.media);
    this.bleeps = bleepSpans(this.tl, edit.bleeps);
  }

  private ensureAudio() {
    if (this.ctx) return;
    const ctx = new AudioContext({ sampleRate: 48000 });
    this.ctx = ctx;
    // master: gentle compression then a limiter, -1 dB ceiling
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 3; comp.attack.value = 0.008; comp.release.value = 0.15;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -2; limit.ratio.value = 20; limit.attack.value = 0.001; limit.release.value = 0.05;
    this.master = ctx.createGain();
    this.speakers = ctx.createGain(); this.speakers.gain.value = this.silent ? 0 : 1;
    this.master.connect(comp); comp.connect(limit); limit.connect(this.speakers); this.speakers.connect(ctx.destination);
    this.recDest = ctx.createMediaStreamDestination();
    limit.connect(this.recDest);
    const voice = ctx.createBiquadFilter(); voice.type = "highpass"; voice.frequency.value = 80;
    const presence = ctx.createBiquadFilter(); presence.type = "peaking"; presence.frequency.value = 3500; presence.gain.value = 2; presence.Q.value = 1.2;
    // bleeps: the voice passes a gate that closes on a bleeped word while a 1 kHz tone opens (lib/bleep.ts)
    this.voiceGate = ctx.createGain();
    voice.connect(presence); presence.connect(this.voiceGate); this.voiceGate.connect(this.master);
    const tone = ctx.createOscillator(); tone.frequency.value = 1000;
    this.toneGain = ctx.createGain(); this.toneGain.gain.value = 0;
    tone.connect(this.toneGain); this.toneGain.connect(this.master); tone.start();
    for (const [i, s] of this.project.sources.entries()) {
      const mk = () => { const v = document.createElement("video"); v.playsInline = true; v.preload = "auto"; v.src = this.urls.get(s.mediaKey)!; return v; };
      const a = mk(), b = mk();
      const gainA = ctx.createGain(), gainB = ctx.createGain();
      const norm = s.rms ? Math.min(4, 0.12 / s.rms) : 1;        // even out takes recorded at different levels
      ctx.createMediaElementSource(a).connect(gainA); ctx.createMediaElementSource(b).connect(gainB);
      gainA.connect(voice); gainB.connect(voice);
      gainA.gain.value = 0; gainB.gain.value = 0;
      (gainA as GainNode & { norm?: number }).norm = norm; (gainB as GainNode & { norm?: number }).norm = norm;
      this.pairs[i] = { a, b, gainA, gainB };
    }
    const m = this.edit.music.asset && this.urls.get(this.edit.music.asset);
    if (m) {
      this.music = new Audio(m); this.music.loop = true;
      this.musicGain = ctx.createGain(); this.musicGain.gain.value = 0;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90;
      const shelf = ctx.createBiquadFilter(); shelf.type = "lowshelf"; shelf.frequency.value = 160; shelf.gain.value = -6;
      ctx.createMediaElementSource(this.music).connect(hp); hp.connect(shelf); shelf.connect(this.musicGain); this.musicGain.connect(this.master);
    }
    this.woosh = whoosh(ctx);
  }

  private gainOf(el: HTMLVideoElement): GainNode | undefined {
    for (const p of this.pairs) { if (p.a === el) return p.gainA; if (p.b === el) return p.gainB; }
  }

  /** The element for segment k: alternate a/b within a take so the next one can pre-seek. */
  private elFor(k: number): HTMLVideoElement {
    const s = this.tl.segments[k];
    const pair = this.pairs[s.src];
    let n = 0;
    for (let i = 0; i < k; i++) if (this.tl.segments[i].src === s.src) n++;
    return n % 2 ? pair.b : pair.a;
  }

  private async seekEl(el: HTMLVideoElement, time: number) {
    if (Math.abs(el.currentTime - time) < 0.01 && el.readyState >= 2) return;
    el.currentTime = time;
    await new Promise<void>((ok) => { const f = () => { el.removeEventListener("seeked", f); ok(); }; el.addEventListener("seeked", f); setTimeout(ok, 1500); });
  }

  async play(from = this.t) {
    if (!this.tl.segments.length) { this.onEnd?.(); return; }      // every word cut: nothing to play
    this.ensureAudio();
    await this.ctx!.resume();
    if (from >= this.tl.duration - 0.05) from = 0;
    const k = Math.max(0, this.tl.segments.findIndex((s) => from >= s.outStart && from < s.outEnd));
    this.seg = k;
    this.cur = this.elFor(k);
    const s = this.tl.segments[k];
    this.rate(this.cur, s);
    await this.seekEl(this.cur, srcAt(s, from));
    this.preload(k + 1);
    this.fired = new Set(this.scene.layers.filter((L) => L.start < from).map((L) => L.b.id));
    if (this.music) {
      const start = this.edit.music.startAt ?? this.project.library.find((a) => a.key === this.edit.music.asset)?.entry ?? 0;
      this.music.currentTime = start + from;
      await this.music.play().catch(() => undefined);
    }
    this.gainOf(this.cur)!.gain.value = (this.gainOf(this.cur) as GainNode & { norm?: number }).norm ?? 1;
    await this.cur.play();
    this.playing = true;
    this.loop();
  }

  /** Mutes the speakers only (an export still records the sound): watching the way most people scroll, sound off. */
  set muted(m: boolean) { this.silent = m; if (this.speakers) this.speakers.gain.value = m ? 0 : 1; }
  get muted() { return this.silent; }

  /** Stops playback; an export in progress ends with an error (see record). */
  pause() {
    const stop = this.stopRec;
    this.stopRec = undefined;
    stop?.();
    this.halt();
  }

  private halt() {
    this.playing = false;
    this.setBleep(false);
    cancelAnimationFrame(this.raf);
    this.cur?.pause();
    this.music?.pause();
    for (const L of this.scene.layers) if (L.el instanceof HTMLVideoElement) L.el.pause();
  }

  private preload(k: number) {
    const s = this.tl.segments[k];
    if (!s) return;
    const el = this.elFor(k);
    if (el !== this.cur && !(el.seeking || Math.abs(el.currentTime - s.start) < 0.01)) void this.seekEl(el, s.start);
  }

  private loop = () => {
    if (!this.playing || !this.cur) return;
    const s = this.tl.segments[this.seg];
    let t = outAt(s, this.cur.currentTime);
    if (this.cur.currentTime >= s.end - 0.017 || this.cur.ended) {
      const next = this.seg + 1;
      const old = this.cur;
      if (next >= this.tl.segments.length) { this.finish(); return; }
      this.seg = next;
      this.cur = this.elFor(next);
      const ns = this.tl.segments[next];
      if (Math.abs(this.cur.currentTime - ns.start) > 0.05) this.cur.currentTime = ns.start;
      this.rate(this.cur, ns);
      void this.cur.play();
      old.pause();
      const go = this.gainOf(old), gn = this.gainOf(this.cur) as GainNode & { norm?: number };
      const now = this.ctx!.currentTime;
      go?.gain.setTargetAtTime(0, now, 0.006);                          // ~6 ms fades at every cut: no clicks
      gn.gain.cancelScheduledValues(now); gn.gain.setValueAtTime(0, now); gn.gain.setTargetAtTime(gn.norm ?? 1, now, 0.006);
      this.preload(next + 1);
      t = ns.outStart;
    }
    this.t = Math.min(t, this.tl.duration);
    this.syncLayers(this.t);
    this.mixMusic(this.t);
    this.mixBleep(this.t);
    if (this.cur.readyState >= 2 && !this.cur.seeking)              // else hold the last frame: never flash black at a cut
      drawFrame(this.g, this.project, this.edit, this.scene, this.t, this.cur, this.tl.segments[this.seg].src,
        srcAt(this.tl.segments[this.seg], this.t));
    this.onTime?.(this.t);
    this.raf = requestAnimationFrame(this.loop);
  };

  private syncLayers(t: number) {
    for (const L of this.scene.layers) {
      const on = t >= L.start && t < L.end;
      if (L.el instanceof HTMLVideoElement) {
        const want = L.plan ? clipTimeAt(L.plan, t - L.start) : null;      // a trimmed clip, waits played faster
        if (on && L.el.paused) {
          L.el.currentTime = want ? want.t : Math.max(0, t - L.start);
          if (want) L.el.playbackRate = want.rate;
          void L.el.play().catch(() => undefined);
        } else if (on && want) {
          if (L.el.playbackRate !== want.rate) L.el.playbackRate = want.rate;
          // past the out-point, over a cut, or drifted: put it back where the map says (sped-up runs may drift a little more)
          if (!L.el.seeking && Math.abs(L.el.currentTime - want.t) > 0.25 * Math.max(1, want.rate)) L.el.currentTime = want.t;
        }
        if (!on && !L.el.paused) L.el.pause();
      }
      if (on && !this.fired.has(L.b.id)) {
        this.fired.add(L.b.id);
        if (this.edit.sfx && this.woosh && L.b.treatment !== "text-pop" && this.ctx) {
          const n = this.ctx.createBufferSource(); n.buffer = this.woosh;
          const gn = this.ctx.createGain(); gn.gain.value = db(-24);
          n.connect(gn); gn.connect(this.master!); n.start();
        }
      }
    }
  }

  /** The song: a measured gap under the voice, dipping under words, lifting in pauses, plus word-anchored lifts. */
  /** A take plays at the edit's talking speed (the browser keeps the pitch). */
  private rate(el: HTMLVideoElement, s: Segment) {
    if (el.playbackRate !== s.speed) el.playbackRate = s.speed;
    el.preservesPitch = true;
  }

  private mixBleep(t: number) {
    this.setBleep(this.bleeps.some(([a, b]) => t >= a && t < b));
  }

  private setBleep(on: boolean) {
    if (on === this.bleeping || !this.ctx || !this.voiceGate || !this.toneGain) return;
    this.bleeping = on;
    const now = this.ctx.currentTime;
    this.voiceGate.gain.setTargetAtTime(on ? 0 : 1, now, 0.004);
    this.toneGain.gain.setTargetAtTime(on ? 0.16 : 0, now, 0.004);
  }

  private mixMusic(t: number) {
    if (!this.musicGain || !this.ctx) return;
    const e = this.edit;
    const asset = this.project.library.find((a) => a.key === e.music.asset);
    const voiceRms = 0.12;                                           // takes are normalised to about this level
    const musicRms = asset?.rms ?? 0.1;
    let gdb = 20 * Math.log10(voiceRms / musicRms) - LEVEL_GAP[e.music.level];
    const first = this.tl.words[0]?.os ?? 0;
    if (e.music.level === "loud-intro" && t < first + 0.25) gdb += 9;
    const talking = this.tl.words.some((w) => t >= w.os - 0.25 && t <= w.oe + 0.3);
    if (!talking) gdb += e.music.level === "quiet" ? 2 : 3;
    for (const a of e.music.automation) {
      const sp = spanOf(this.tl, a.anchor);
      if (sp && t >= sp[0] && t <= sp[1]) gdb += a.db;
    }
    const fadeIn = Math.min(1, t / 0.6), fadeOut = Math.min(1, Math.max(0, (this.tl.duration - t) / 0.6));
    this.musicGain.gain.setTargetAtTime(db(gdb) * fadeIn * fadeOut, this.ctx.currentTime, 0.08);
  }

  private finish() {
    this.halt();
    this.t = this.tl.duration;
    this.onTime?.(this.t);
    this.onEnd?.();
  }

  async seek(t: number) {
    const was = this.playing;
    if (was) this.pause();
    this.t = Math.max(0, Math.min(t, this.tl.duration));
    await this.drawAt(this.t);
    if (was) await this.play(this.t);
  }

  /** Draw one exact frame (paused): for scrubbing, the cover and still checks. */
  async drawAt(t: number) {
    const k = Math.max(0, this.tl.segments.findIndex((s) => t >= s.outStart && t < s.outEnd));
    const s = this.tl.segments[k];
    if (!s) { this.g.fillStyle = "#000"; this.g.fillRect(0, 0, W, H); return; }
    if (!this.pairs.length) this.ensureAudio();
    const el = this.elFor(k);
    const st = srcAt(s, t);
    await this.seekEl(el, st);
    for (const L of this.scene.layers) if (L.el instanceof HTMLVideoElement && t >= L.start && t < L.end) {
      L.el.currentTime = L.plan ? clipTimeAt(L.plan, t - L.start).t : t - L.start;
      await new Promise((ok) => { L.el!.onseeked = ok; setTimeout(ok, 800); });
    }
    drawFrame(this.g, this.project, this.edit, this.scene, t, el, s.src, st);
  }

  /** Record the whole edit in real time. Returns the file and its type. */
  async record(onProgress: (pct: number) => void): Promise<{ blob: Blob; ext: string }> {
    if (!this.tl.segments.length) throw new Error("Nothing is kept: bring some words back (Edit it myself → Cut) before exporting.");
    this.ensureAudio();
    const types = ['video/mp4;codecs="avc1.640028,mp4a.40.2"', "video/mp4;codecs=avc1,opus", "video/mp4",
      "video/webm;codecs=vp9,opus", "video/webm"];
    const mime = types.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
    const stream = new MediaStream([...this.canvas.captureStream(30).getVideoTracks(), ...this.recDest!.stream.getAudioTracks()]);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000, audioBitsPerSecond: 256_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    const done = new Promise<void>((ok) => (rec.onstop = () => ok()));
    const prevTime = this.onTime, prevEnd = this.onEnd;
    this.onTime = (t) => { onProgress(Math.round((100 * t) / this.tl.duration)); prevTime?.(t); };
    // a pause or a dispose (another version loading) mid-export would leave this waiting for an end that never comes
    const ended = new Promise<void>((ok, no) => { this.onEnd = () => ok(); this.stopRec = () => no(new Error(STOPPED)); });
    let stopped = false;
    try {
      await this.seek(0);
      rec.start(1000);
      await this.play(0);
      await ended;
      await new Promise((ok) => setTimeout(ok, 250));
    } catch (e) { stopped = true; throw e; }
    finally {
      this.stopRec = undefined;
      if (rec.state !== "inactive") rec.stop();
      if (!stopped) await done;
      this.onTime = prevTime; this.onEnd = prevEnd;
    }
    return { blob: new Blob(chunks, { type: mime.split(";")[0] || "video/webm" }), ext: mime.includes("mp4") ? "mp4" : "webm" };
  }

  /** The cover: a frame at the chosen word with 1-3 big words on it. */
  async cover(): Promise<Blob> {
    const e = this.edit;
    const w = e.cover.word ? this.tl.byId.get(e.cover.word) : undefined;
    const t = w ? (w.os + w.oe) / 2 : Math.min(this.tl.duration * 0.25, 3);
    const saved = this.scene;
    this.scene = { ...saved, cues: [], layers: [] };                 // a clean frame: no captions or pictures
    await this.drawAt(t);
    this.scene = saved;
    if (e.cover.text) {
      const g = this.g;
      let size = 0.13 * Math.min(W, H);
      g.font = `900 ${size}px Montserrat, Arial, sans-serif`;
      const text = e.cover.text.toUpperCase();
      while (g.measureText(text).width > W * 0.88 && size > 0.05 * Math.min(W, H)) { size *= 0.9; g.font = `900 ${size}px Montserrat, Arial, sans-serif`; }
      g.save(); g.translate(W / 2, 0.22 * H); g.rotate((-4 * Math.PI) / 180);
      g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
      g.lineWidth = 0.18 * size; g.strokeStyle = "#000"; g.strokeText(text, 0, 0); g.fillStyle = "#fff"; g.fillText(text, 0, 0);
      g.restore();
    }
    const blob = await new Promise<Blob>((ok) => this.canvas.toBlob((b) => ok(b!), "image/jpeg", 0.92));
    await this.drawAt(this.t);
    return blob;
  }

  dispose() {
    this.pause();
    const ctx = this.ctx;
    this.ctx = undefined;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    for (const p of this.pairs) { p.a.src = ""; p.b.src = ""; }
  }
}

function whoosh(ctx: BaseAudioContext): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * 0.45);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / ctx.sampleRate;
    const env = t < 0.22 ? (t / 0.22) ** 2 : Math.exp(-(t - 0.22) / 0.07);
    const cut = 0.05 + 0.5 * Math.min(1, t / 0.3);
    lp += cut * ((Math.random() * 2 - 1) - lp);
    d[i] = lp * env * 0.9;
  }
  return buf;
}
