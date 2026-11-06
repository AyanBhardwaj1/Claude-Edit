// "Record my screen": capture an app demo (a tab, a window or the whole screen, optionally with the microphone) straight
// into a video's library as a screen recording. Everything stays in the browser.
//
// The top half is pure maths (unit-tested in tests/screenrec.test.ts): which recording format the browser can make,
// names and times, spotting "waits" (stretches where nothing on screen moves) and turning a clip's trim and waits into
// a time map the player follows. The bottom half runs in the browser: one frame comparer (FrameDiff) shared by the
// recorder (around getDisplayMedia and MediaRecorder) and by findWaits, which scans a screen recording the user uploads.

import type { Asset } from "./types";

export const MAX_SECONDS = 5 * 60;      // a demo longer than this belongs in its own video
export const SAMPLE_MS = 250;           // how often a frame is compared with the one before (recording and uploads alike)
export const PROBE_WIDTH = 64;          // frames are compared as 64-px-wide greyscale copies
export const WAIT_SPEED = 6;            // "Speed through waits": frozen stretches play this many times faster
export const WAIT = { minLen: 1, threshold: 0.01, pad: 0.15 };   // a wait: >= 1 s with < 1% of the picture changing

// ------------------------------------------------------------------ format, names, times

/** Best first: MP4 / H.264 plays and seeks everywhere and keeps its length; WebM (VP9, then VP8) where MP4 can't be made. */
export const MIME_TYPES = [
  'video/mp4;codecs="avc1.640028,mp4a.40.2"', "video/mp4;codecs=avc1,opus", "video/mp4;codecs=avc1", "video/mp4",
  "video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8,opus", "video/webm;codecs=vp8", "video/webm",
];

/** The first recording format this browser supports ("" when none of them is: let the browser pick). */
export function pickMimeType(isSupported: (type: string) => boolean, candidates = MIME_TYPES): string {
  for (const t of candidates) { try { if (isSupported(t)) return t; } catch { /* a browser that throws on the question */ } }
  return "";
}

export const extFor = (mime: string) => (/mp4/i.test(mime) ? "mp4" : "webm");
export const baseType = (mime: string) => (mime ? mime.split(";")[0] : "video/webm");

const two = (n: number) => String(n).padStart(2, "0");

/** "Screen recording 2026-11-06 at 14.05.mp4": sorts by date, no characters a file system dislikes. */
export function recordingName(at: Date, mime: string): string {
  return `Screen recording ${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())} at ${two(at.getHours())}.${two(at.getMinutes())}.${extFor(mime)}`;
}

/** 7 -> "0:07", 65 -> "1:05", 600 -> "10:00"; with tenths 7.42 -> "0:07.4". Never negative, never NaN. */
export function formatTime(sec: number, tenths = false): string {
  const s = Number.isFinite(sec) ? Math.max(0, sec) : 0;
  const t = tenths ? Math.floor(s * 10 + 1e-6) / 10 : Math.floor(s + 1e-6);
  const m = Math.floor(t / 60), r = t - m * 60;
  return `${m}:${tenths ? r.toFixed(1).padStart(4, "0") : two(Math.floor(r))}`;
}

/** Spoken form for screen readers: "1 minute 5 seconds". */
export function sayTime(sec: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(sec) ? sec : 0)), m = Math.floor(s / 60), r = s % 60;
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return m ? (r ? `${part(m, "minute")} ${part(r, "second")}` : part(m, "minute")) : part(r, "second");
}

// ------------------------------------------------------------------ waits

/** How much of the picture changed between two small greyscale frames: the share of pixels that moved by more than `tol`
 *  levels (0-255). A few pixels of noise or a blinking caret stay well under 1%. */
export function frameChange(a: ArrayLike<number>, b: ArrayLike<number>, tol = 12): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 1;
  let moved = 0;
  for (let i = 0; i < n; i++) if (Math.abs(a[i] - b[i]) > tol) moved++;
  return moved / n;
}

/** RGBA pixels -> greyscale (Rec. 601 luma), the form frameChange compares. */
export function toGrey(rgba: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(Math.floor(rgba.length / 4));
  for (let i = 0; i < out.length; i++) out[i] = (77 * rgba[4 * i] + 150 * rgba[4 * i + 1] + 29 * rgba[4 * i + 2]) >> 8;
  return out;
}

/** One comparison: at `t` seconds into the recording, `change` of the picture differed from the previous sample. */
export type Sample = { t: number; change: number };

/** Evenly spaced samples from a plain list of changes (the first compares with nothing, so it counts as a change). */
export const samplesFrom = (changes: number[], step = SAMPLE_MS / 1000): Sample[] => changes.map((change, i) => ({ t: i * step, change }));

/** Frozen stretches: runs of samples whose picture barely changed (< threshold) lasting at least minLen seconds, from the
 *  last sample before the run (that frame is the one that stays up) to the run's last sample, pulled in by `pad` at each
 *  end so the viewer sees the screen settle before it speeds up. Timestamps are real, so slow sampling (a background tab
 *  is held to about one sample a second) still finds the waits; it only places their edges less exactly, never outside. */
export function detectWaits(samples: Sample[], o: Partial<typeof WAIT> = {}): [number, number][] {
  const { minLen, threshold, pad } = { ...WAIT, ...o };
  const out: [number, number][] = [];
  let from = -1;
  const close = (endIdx: number) => {
    if (from < 1) return;
    const s = samples[from - 1].t + pad, e = samples[endIdx].t - pad;
    if (samples[endIdx].t - samples[from - 1].t >= minLen && e - s > 0.05) out.push([round3(s), round3(e)]);
  };
  samples.forEach((x, i) => {
    const still = i > 0 && x.change < threshold;
    if (still && from < 0) from = i;
    if (!still && from >= 0) { close(i - 1); from = -1; }
  });
  if (from >= 0) close(samples.length - 1);
  return out;
}
const round3 = (x: number) => Math.round(x * 1000) / 1000;

// ------------------------------------------------------------------ trim + waits -> a time map

/** A run of the clip: source seconds `from`..`to` played at `rate`, landing at shot seconds `out0`..`out1`. */
export type Piece = { from: number; to: number; rate: number; out0: number; out1: number };

/** The clip as it plays: the trimmed range, with each wait inside it played `speed` times faster (Infinity cuts the wait
 *  out: a jump cut). Waits are clipped to the trim, sorted and merged; tiny leftovers are dropped. */
export function clipPieces(o: { duration: number; trim?: { start: number; end: number }; waits?: [number, number][]; speed?: number }): Piece[] {
  const dur = Number.isFinite(o.duration) && o.duration > 0 ? o.duration : 0;
  const a = Math.max(0, Math.min(o.trim?.start ?? 0, dur)), b = Math.max(a, Math.min(o.trim?.end ?? dur, dur));
  const speed = o.speed ?? WAIT_SPEED;
  const waits = (o.waits ?? []).map(([s, e]) => [Math.max(a, s), Math.min(b, e)] as [number, number])
    .filter(([s, e]) => e - s >= 0.1).sort((x, y) => x[0] - y[0])
    .reduce<[number, number][]>((m, w) => { const l = m[m.length - 1]; if (l && w[0] <= l[1]) l[1] = Math.max(l[1], w[1]); else m.push([...w]); return m; }, []);
  const runs: { from: number; to: number; rate: number }[] = [];
  let at = a;
  for (const [s, e] of waits) {
    if (s - at > 0.01) runs.push({ from: at, to: s, rate: 1 });
    if (Number.isFinite(speed) && speed > 0) runs.push({ from: s, to: e, rate: speed });
    at = e;
  }
  if (b - at > 0.01 || !runs.length) runs.push({ from: at, to: b, rate: 1 });
  let out = 0;
  return runs.map((r) => { const len = (r.to - r.from) / r.rate; const p = { ...r, out0: round3(out), out1: round3(out + len) }; out += len; return p; });
}

export const piecesLength = (pieces: Piece[]) => (pieces.length ? pieces[pieces.length - 1].out1 : 0);

/** Where in the clip (source seconds) to be `local` seconds into the shot, and how fast to play there. Loops like the
 *  player's clips do (a shot longer than the trimmed clip starts it again). */
export function clipTimeAt(pieces: Piece[], local: number, loop = true): { t: number; rate: number } {
  const len = piecesLength(pieces);
  if (!pieces.length || len <= 0) return { t: pieces[0]?.from ?? 0, rate: 1 };
  let x = Math.max(0, local);
  if (loop) x %= len; else x = Math.min(x, len - 1e-6);
  const p = pieces.find((q) => x < q.out1) ?? pieces[pieces.length - 1];
  return { t: Math.min(p.to, p.from + (x - p.out0) * p.rate), rate: p.rate };
}

/** Playing the clip itself (the trim preview): at source time `t`, the speed to play at, or where to jump (a cut wait,
 *  before the in-point, or past the out-point, which goes back to the start). */
export function stepAt(pieces: Piece[], t: number): { rate: number; jump?: number } {
  if (!pieces.length) return { rate: 1 };
  const p = pieces.find((q) => t >= q.from - 0.02 && t < q.to);
  if (p) return { rate: p.rate };
  const next = pieces.find((q) => q.from > t);
  return { rate: next?.rate ?? pieces[0].rate, jump: next ? next.from : pieces[0].from };
}

type PlanFields = Pick<Asset, "kind" | "duration" | "trim" | "waits" | "speedWaits">;

/** The waits a clip plays faster: its waits, unless "Speed through waits" is off for it (speedWaits false; on by default). */
export const spedWaits = (a: Pick<Asset, "waits" | "speedWaits">) => (a.speedWaits === false ? [] : a.waits ?? []);

/** The time map for a library clip, or null when it plays straight through (no trim, no waits sped: nothing to map). */
export function clipPlan(a: PlanFields | undefined): Piece[] | null {
  if (!a || a.kind !== "video" || !a.duration || !Number.isFinite(a.duration)) return null;
  const waits = spedWaits(a);
  if (!a.trim && !waits.length) return null;
  return clipPieces({ duration: a.duration, trim: a.trim, waits });
}

/** How long a library clip plays for once trimmed and sped through (its full length otherwise). */
export function playedLength(a: PlanFields): number | undefined {
  const plan = clipPlan(a);
  return plan ? piecesLength(plan) : a.duration;
}

/** What "Speed through waits" does for a clip: how many waits fall inside its trim, their length, and the seconds saved. */
export function waitSavings(a: PlanFields): { count: number; seconds: number; saves: number } {
  const dur = a.duration && Number.isFinite(a.duration) ? a.duration : 0;
  if (a.kind !== "video" || !dur || !a.waits?.length) return { count: 0, seconds: 0, saves: 0 };
  const plain = piecesLength(clipPieces({ duration: dur, trim: a.trim }));
  const pieces = clipPieces({ duration: dur, trim: a.trim, waits: a.waits });
  const sped = pieces.filter((x) => x.rate !== 1);
  const seconds = sped.reduce((t, x) => t + x.to - x.from, 0);
  return { count: sped.length, seconds: round3(seconds), saves: round3(plain - piecesLength(pieces)) };
}

/** The asset fields a finished recording adds: always a screen; a trim only when it trims; the waits found inside the
 *  trim (an empty list when there are none, so they're never looked for again), switched off when not sped through. */
export function recordingMeta(duration: number, trim: { start: number; end: number }, waits: [number, number][] | null, speed = true): Partial<Asset> {
  const out: Partial<Asset> = { screen: true, duration: round3(duration) };
  const start = Math.max(0, trim.start), end = Math.min(duration, trim.end);
  if (start > 0.05 || end < duration - 0.05) out.trim = { start: round3(start), end: round3(end) };
  if (!waits) return out;
  out.waits = waits.filter(([s, e]) => e > start && s < end).map(([s, e]) => [round3(s), round3(e)]);
  if (!speed && out.waits.length) out.speedWaits = false;
  return out;
}

// ------------------------------------------------------------------ plain-language errors

/** A recorder failure in words a person can act on. */
export function errorMessage(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "", msg = e?.message ?? String(err ?? "");
  if (name === "UnsupportedError") return msg;
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    if (/system/i.test(msg)) return "Your computer blocked screen recording for this browser. On a Mac, turn it on in System Settings, " +
      "Privacy & Security, Screen Recording, then restart the browser and try again.";
    return "Nothing was recorded: screen sharing wasn't allowed. Press Start and pick a tab, a window or your screen to try again.";
  }
  if (name === "NotFoundError") return "There's nothing to record right now. Open the app or page you want to show, then try again.";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError")
    return "Your browser couldn't start the recording. Close other apps that are recording or sharing your screen, then try again.";
  if (name === "InvalidStateError") return "Press Start yourself to begin a recording (the browser only allows it after a click).";
  return `The recording stopped with a problem${msg ? ` (${msg})` : ""}. Try again, or record with your computer's own screen recorder and add the file.`;
}

export const UNSUPPORTED = "This browser can't record the screen. Use Chrome, Edge, Firefox or Safari on a computer, " +
  "or record with your phone's screen recorder and add the clip.";

/** Can this browser record the screen? (Phones and tablets can't: iOS Safari and Android Chrome have no screen capture.) */
export function canRecordScreen(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return !!navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === "function" && typeof window.MediaRecorder === "function";
}

// ------------------------------------------------------------------ comparing frames (browser only)

/** Compares each frame it's given with the one before, as a PROBE_WIDTH-px-wide greyscale copy (frameChange). The
 *  recorder and the upload scan both use it, so a wait means the same thing whichever way the clip arrived. */
export class FrameDiff {
  private c = document.createElement("canvas");
  private g = this.c.getContext("2d", { willReadFrequently: true });
  private prev: Uint8Array | null = null;

  /** The share of the picture that changed since the last frame (1 for the first frame, or one of another size); null
   *  when there's nothing to draw yet. */
  next(src: CanvasImageSource, srcW: number, srcH: number): number | null {
    if (!this.g || !srcW || !srcH) return null;
    const w = PROBE_WIDTH, h = Math.max(8, Math.round((PROBE_WIDTH * srcH) / srcW));
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h; }
    this.g.drawImage(src, 0, 0, w, h);
    const grey = toGrey(this.g.getImageData(0, 0, w, h).data);
    const change = this.prev && this.prev.length === grey.length ? frameChange(this.prev, grey) : 1;
    this.prev = grey;
    return change;
  }
}

export type ScanOpts = {
  onProgress?: (fraction: number) => void;     // 0..1 through the clip
  signal?: AbortSignal;                         // abort to stop: findWaits then rejects with an AbortError
  mode?: "auto" | "play" | "seek";              // auto: fast muted playback where the browser can, seeking otherwise
  rate?: number;                                // playback speed for "play" (default 8x, 16x past 90 s; browsers allow 16)
  step?: number;                                // seconds between samples (default SAMPLE_MS)
  waits?: Partial<typeof WAIT>;
  onDone?: (r: { samples: Sample[]; mode: "play" | "seek"; seconds: number }) => void;   // how the scan went (for timing)
};

const abortError = () => new DOMException("The scan was stopped.", "AbortError");

/** Finds the waits in a video file (a screen recording made with QuickTime, OBS, a phone...): the same detector the
 *  recorder runs live, fed by a hidden, muted <video>. Fast path: play it at `rate` (8x or 16x) and compare each painted frame
 *  (requestVideoFrameCallback) at least `step` apart; if the browser can't (no requestVideoFrameCallback, playback
 *  refused, a hidden tab that stops painting), it carries on by seeking every `step` seconds from where it got to.
 *  Never re-encodes anything; the file is only read. */
export async function findWaits(videoUrl: string, duration: number, o: ScanOpts = {}): Promise<[number, number][]> {
  const t0 = performance.now();
  const step = o.step ?? SAMPLE_MS / 1000;
  const v = document.createElement("video");
  v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = videoUrl;
  const diff = new FrameDiff();
  const samples: Sample[] = [];
  let mode: "play" | "seek" = "seek";
  const dur = () => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration);
  const report = (t: number) => o.onProgress?.(Math.min(1, Math.max(0, t / Math.max(0.001, dur()))));
  const take = (t: number) => {
    const change = diff.next(v, v.videoWidth, v.videoHeight);
    if (change !== null) samples.push({ t: round3(t), change });
    report(t);
  };
  const stopped = () => { if (o.signal?.aborted) throw abortError(); };
  try {
    stopped();
    await new Promise<void>((ok, bad) => {
      if (v.readyState >= 2) return ok();
      v.onloadeddata = () => ok();
      v.onerror = () => bad(new Error("This clip can't be played in your browser, so I couldn't look for waits in it."));
      o.signal?.addEventListener("abort", () => bad(abortError()), { once: true });
    });
    const end = dur();
    let from = 0;
    const rvfc = typeof (v as HTMLVideoElement & { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === "function";
    if ((o.mode ?? "auto") !== "seek" && rvfc) {
      mode = "play";
      // 8x keeps painted frames about 0.27 s apart (sharp wait edges); past 90 s, 16x keeps a long demo under ~15 s
      from = await playScan(v, o.rate ?? (end > 90 ? 16 : 8), step, take, o.signal);
      if (from < end - 2 * step) mode = "seek";                 // it stalled part way: seek the rest
      else from = end;
    }
    const start = samples.length ? from + step : 0;
    for (let t = start; t < end; t += step) {
      stopped();
      await seekTo(v, t, o.signal);
      take(t);
    }
    stopped();
    report(end);
    o.onDone?.({ samples, mode, seconds: (performance.now() - t0) / 1000 });
    return detectWaits(samples, o.waits);
  } finally {
    v.pause();
    v.removeAttribute("src");
    v.load();
  }
}

/** Plays the clip muted at `rate`, sampling painted frames at least `step` apart. Resolves with the media time it got to
 *  (the end, or where it stalled: no new frame for 1.5 s). */
function playScan(v: HTMLVideoElement, rate: number, step: number, take: (t: number) => void, signal?: AbortSignal): Promise<number> {
  type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
  const req = (v as unknown as { requestVideoFrameCallback: RVFC }).requestVideoFrameCallback.bind(v);
  return new Promise<number>((ok, bad) => {
    let last = -Infinity, seen = performance.now(), done = false, at = 0;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true; clearInterval(watch); v.pause(); v.onended = null;
      if (err) bad(err); else ok(at);
    };
    const onFrame = (_: number, meta: { mediaTime: number }) => {
      if (done) return;
      seen = performance.now();
      if (meta.mediaTime - last >= step - 0.02) { take(meta.mediaTime); last = meta.mediaTime; at = meta.mediaTime; }
      req(onFrame);
    };
    const watch = window.setInterval(() => {
      if (signal?.aborted) return finish(abortError());
      if (performance.now() - seen > 1500) finish();            // stalled: hand over to seeking from `at`
    }, 250);
    v.onended = () => { at = Math.max(at, v.duration || at); finish(); };
    try { v.playbackRate = rate; } catch { try { v.playbackRate = 8; } catch { /* keep 1x */ } }
    req(onFrame);
    v.play().catch(() => finish());                              // playback refused: seek instead
  });
}

function seekTo(v: HTMLVideoElement, t: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((ok, bad) => {
    const done = () => { clearTimeout(slow); v.removeEventListener("seeked", done); signal?.removeEventListener("abort", stop); ok(); };
    const stop = () => { clearTimeout(slow); v.removeEventListener("seeked", done); bad(abortError()); };
    const slow = setTimeout(done, 3000);                         // a seek that never lands: compare what's there
    v.addEventListener("seeked", done);
    signal?.addEventListener("abort", stop, { once: true });
    v.currentTime = t;
  });
}

// ------------------------------------------------------------------ the recorder (browser only)

export type Recording = {
  blob: Blob; mime: string; name: string; duration: number; width: number; height: number;
  samples: Sample[]; hasAudio: boolean;
};

export type RecState = "idle" | "starting" | "recording" | "paused" | "stopped";

type Opts = {
  mic: boolean; maxSeconds?: number;
  onState?: (s: RecState) => void; onTick?: (elapsed: number) => void;
  onStop: (r: Recording) => void; onError: (message: string) => void; onNote?: (message: string) => void;
};

/** One recording. Nothing starts until start() (call it from a click); stop() or the browser's own "Stop sharing" ends it;
 *  dispose() ends it without keeping anything. Every track it opened is stopped whichever way it ends. */
export class ScreenRecorder {
  state: RecState = "idle";
  private tracks: MediaStreamTrack[] = [];
  private audio?: AudioContext;
  private rec?: MediaRecorder;
  private mime = "";
  private chunks: Blob[] = [];
  private acc = 0;
  private since = 0;
  private timers: number[] = [];
  private probe?: HTMLVideoElement;
  private samples: Sample[] = [];
  private size = { width: 0, height: 0 };
  private hasAudio = false;
  private discard = false;
  private startedAt = new Date();

  constructor(private o: Opts) {}

  /** Seconds recorded so far (pauses don't count). */
  elapsed(): number {
    return (this.acc + (this.state === "recording" ? performance.now() - this.since : 0)) / 1000;
  }

  private set(s: RecState) { this.state = s; this.o.onState?.(s); }

  async start(): Promise<void> {
    if (this.state !== "idle") return;
    if (!canRecordScreen()) { this.o.onError(UNSUPPORTED); return; }
    this.set("starting");
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30, max: 30 } }, audio: false });
    } catch (e) { this.set("idle"); this.o.onError(errorMessage(e)); return; }
    if (this.discard) { display.getTracks().forEach((t) => t.stop()); return; }    // the panel closed while the picker was open
    const video = display.getVideoTracks()[0];
    this.tracks.push(...display.getTracks());
    let mic: MediaStream | null = null;
    if (this.o.mic) {
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); this.tracks.push(...mic.getTracks()); }
      catch { this.o.onNote?.("Your microphone wasn't available, so this recording has no sound. The screen is recording."); }
    }
    if (this.discard) { this.release(); return; }
    // one audio track: every sound source mixed through Web Audio (the microphone, plus any audio the shared tab sends)
    const sources = [display, mic].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
    let audioTrack: MediaStreamTrack | null = null;
    if (sources.length) {
      try {
        this.audio = new AudioContext();
        const dest = this.audio.createMediaStreamDestination();
        for (const s of sources) this.audio.createMediaStreamSource(s).connect(dest);
        audioTrack = dest.stream.getAudioTracks()[0] ?? null;
        void this.audio.resume().catch(() => undefined);
      } catch { audioTrack = sources[0].getAudioTracks()[0] ?? null; }
    }
    this.hasAudio = !!audioTrack;
    this.mime = pickMimeType((t) => MediaRecorder.isTypeSupported(t), this.hasAudio ? MIME_TYPES : MIME_TYPES.filter((t) => !/opus|mp4a/.test(t)));
    const stream = new MediaStream(audioTrack ? [video, audioTrack] : [video]);
    try {
      this.rec = new MediaRecorder(stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    } catch (e) { this.release(); this.set("idle"); this.o.onError(errorMessage(e)); return; }
    this.mime = this.rec.mimeType || this.mime;
    this.rec.ondataavailable = (ev) => { if (ev.data.size) this.chunks.push(ev.data); };
    this.rec.onstop = () => this.finish();
    this.rec.onerror = (ev) => { this.o.onError(errorMessage((ev as unknown as { error?: unknown }).error ?? ev)); this.stop(); };
    // the browser's own "Stop sharing" button (or closing the shared window) ends the recording, keeping what was made
    video.addEventListener("ended", () => this.stop());
    const st = video.getSettings();
    this.size = { width: st.width ?? 0, height: st.height ?? 0 };
    this.startProbe(display);
    this.startedAt = new Date();
    this.rec.start(1000);
    this.since = performance.now();
    this.set("recording");
    const max = this.o.maxSeconds ?? MAX_SECONDS;
    this.timers.push(window.setInterval(() => {
      const t = this.elapsed();
      this.o.onTick?.(t);
      if (t >= max) this.stop();
    }, 200));
  }

  /** Compares a small greyscale copy of the screen with the last one, every 250 ms, to find the waits. */
  private startProbe(display: MediaStream) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.srcObject = display;
    void v.play().catch(() => undefined);
    this.probe = v;
    const diff = new FrameDiff();
    this.timers.push(window.setInterval(() => {
      if (this.state !== "recording" || v.readyState < 2 || !v.videoWidth) return;
      const change = diff.next(v, v.videoWidth, v.videoHeight);
      if (change !== null) this.samples.push({ t: this.elapsed(), change });
      if (!this.size.width) this.size = { width: v.videoWidth, height: v.videoHeight };
    }, SAMPLE_MS));
  }

  pause() {
    if (this.state !== "recording" || this.rec?.state !== "recording") return;
    this.rec.pause();
    this.acc += performance.now() - this.since;
    this.set("paused");
  }

  resume() {
    if (this.state !== "paused" || this.rec?.state !== "paused") return;
    this.rec.resume();
    this.since = performance.now();
    this.set("recording");
  }

  /** End the recording and keep it (onStop gets the file). */
  stop() {
    if (this.state !== "recording" && this.state !== "paused") return;
    if (this.state === "recording") this.acc += performance.now() - this.since;
    this.set("stopped");
    this.clearTimers();
    if (this.rec && this.rec.state !== "inactive") this.rec.stop(); else this.finish();
    this.release();
  }

  /** End without keeping anything: the panel closed. */
  dispose() {
    this.discard = true;
    this.clearTimers();
    if (this.rec && this.rec.state !== "inactive") { try { this.rec.stop(); } catch { /* already stopped */ } }
    this.release();
    this.chunks = [];
  }

  private finish() {
    if (this.discard) return;
    const duration = this.acc / 1000;
    const blob = new Blob(this.chunks, { type: baseType(this.mime) });
    this.chunks = [];
    this.o.onStop({ blob, mime: baseType(this.mime), name: recordingName(this.startedAt, this.mime), duration, ...this.size,
      samples: this.samples, hasAudio: this.hasAudio });
  }

  private clearTimers() { this.timers.forEach((t) => clearInterval(t)); this.timers = []; }

  private release() {
    this.tracks.forEach((t) => { try { t.stop(); } catch { /* gone */ } });
    this.tracks = [];
    if (this.probe) { this.probe.srcObject = null; this.probe = undefined; }
    if (this.audio && this.audio.state !== "closed") void this.audio.close().catch(() => undefined);
    this.audio = undefined;
  }
}
