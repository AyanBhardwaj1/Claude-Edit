// "Film it here": film takes with the camera and microphone inside Cutmind while the script scrolls on a teleprompter,
// then make a new video from those takes with the script already applied to the subtitles (components/FilmRecorder.tsx).
// Everything stays in the browser.
//
// The top half is pure maths (unit-tested in tests/camrec.test.ts): camera settings, take names, the 3-2-1 countdown,
// plain-language errors and the teleprompter clock (where the script is at time t for a speed in words per minute,
// with pauses and speed changes). The bottom half is the camera itself, around getUserMedia and MediaRecorder; the
// recording format comes from the same chooser as "Record my screen" (lib/screenrec.ts).

import { baseType, extFor, MIME_TYPES, pickMimeType } from "./screenrec";

export { formatTime, sayTime } from "./screenrec";

export const MAX_TAKE_SECONDS = 10 * 60;   // a take longer than this is a long video: film it with the camera app
export const COUNTDOWN_FROM = 3;           // 3, 2, 1, then the take starts
export const COUNT_MS = 1000;
export const DEFAULT_WPM = 150;            // a relaxed talking pace
export const WPM_MIN = 80, WPM_MAX = 240;
export const DEFAULT_TEXT_PX = 36, TEXT_MIN = 22, TEXT_MAX = 72;

// ------------------------------------------------------------------ camera settings

/** Portrait on phones and tall screens (a reel is 9:16), landscape on a computer's webcam. */
export function wantsPortrait(o: { width: number; height: number; coarse?: boolean }): boolean {
  return o.height > o.width || (!!o.coarse && Math.min(o.width, o.height) < 820);
}

/** The camera facing you, at 1080x1920 portrait where it can (phones), else 1920x1080; the microphone cleaned up for a
 *  voice. "ideal" means the browser gets as close as the camera allows instead of failing. */
export function cameraConstraints(portrait: boolean): MediaStreamConstraints {
  const [width, height] = portrait ? [1080, 1920] : [1920, 1080];
  return {
    video: { facingMode: "user", width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: 30, max: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  };
}

/** The fallback when a camera refuses the sizes: any camera facing you, still with the cleaned-up microphone. */
export const BASIC_CONSTRAINTS: MediaStreamConstraints = { video: { facingMode: "user" }, audio: { echoCancellation: true, noiseSuppression: true } };

/** The recording format: MP4 / H.264 where the browser makes it, else WebM (same order as screen recordings). */
export const chooseMimeType = (isSupported: (type: string) => boolean) => pickMimeType(isSupported, MIME_TYPES);

// ------------------------------------------------------------------ takes

/** "Take 1.webm", "Take 2.mp4": the same names whichever browser films them, apart from the format's extension. */
export const takeName = (n: number, mime: string) => `Take ${n}.${extFor(mime)}`;

/** The number for the next take: one more than the highest so far, so a deleted take's number is never reused. */
export const nextTakeNumber = (takes: { n: number }[]) => takes.reduce((m, t) => Math.max(m, t.n), 0) + 1;

/** A take as a file, ready for createProject exactly like a dropped take. */
export function takeFile(blob: Blob, n: number, mime: string): File {
  return new File([blob], takeName(n, mime), { type: baseType(mime) });
}

// ------------------------------------------------------------------ the 3-2-1 countdown

/** The number showing `ms` after the countdown started: 3, 2, 1, then 0 (go: start recording). */
export function countdownAt(ms: number, from = COUNTDOWN_FROM, step = COUNT_MS): number {
  if (!(ms >= 0)) return from;
  return Math.max(0, from - Math.floor(ms / step));
}
export const countdownLength = (from = COUNTDOWN_FROM, step = COUNT_MS) => from * step;

// ------------------------------------------------------------------ plain-language errors

export const CAMERA_UNSUPPORTED = "This browser can't film here. Use a recent Chrome, Edge, Firefox or Safari, or film with your camera app and " +
  "drop the file in.";

/** A camera failure in words a person can act on. */
export function cameraErrorMessage(err: unknown): string {
  const e = err as { name?: string; message?: string } | null;
  const name = e?.name ?? "", msg = e?.message ?? String(err ?? "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    if (/system|os|denied by system/i.test(msg)) return "Your computer blocked the camera for this browser. On a Mac, turn it on in System Settings, " +
      "Privacy & Security, Camera (and Microphone), then restart the browser.";
    return "Your camera is blocked for Cutmind. Click the camera icon in the address bar, allow the camera and microphone, then press Try again.";
  }
  if (name === "SecurityError") return "The camera only works on a secure page (https). Open Cutmind from its https address and try again.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError")
    return "No camera or microphone found. Plug one in (or turn it on), then press Try again.";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
    return "Your camera is in use by another app, like Zoom, Teams or FaceTime. Close it there, then press Try again.";
  if (name === "UnsupportedError" || name === "NotSupportedError" || name === "TypeError") return CAMERA_UNSUPPORTED;
  return `The camera stopped with a problem${msg ? ` (${msg})` : ""}. Press Try again, or film with your camera app and drop the file in.`;
}

/** Can this browser film here? */
export function canFilm(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function" && typeof window.MediaRecorder === "function";
}

// ------------------------------------------------------------------ the teleprompter

/** The script as words for the teleprompter; `para` marks the first word of a new paragraph (a blank line before it). */
export function prompterWords(script: string): { w: string; para: boolean }[] {
  const out: { w: string; para: boolean }[] = [];
  script.replace(/\r/g, "").split(/\n\s*\n/).forEach((block) => {
    block.split(/\s+/).filter(Boolean).forEach((w, i) => out.push({ w, para: i === 0 && out.length > 0 }));
  });
  return out;
}

/** How many words are read `ms` into scrolling at `wpm` words per minute. */
export const wordsAt = (ms: number, wpm: number) => (Math.max(0, ms) / 60000) * Math.max(0, wpm);

/** The teleprompter's clock: how far through the script it is (in words, a fraction past the current word), with pause,
 *  resume and speed changes that never make it jump. Time comes from the caller (performance.now() in the browser). */
export class PrompterClock {
  private base = 0;          // words read before `since`
  private since = 0;
  running = false;
  constructor(public wpm = DEFAULT_WPM, private total = Infinity) {}

  /** Words read at `now` (never past the end of the script). */
  position(now: number): number {
    const p = this.base + (this.running ? wordsAt(now - this.since, this.wpm) : 0);
    return Math.min(p, this.total);
  }
  /** At the end of the script? (It stops there.) */
  done(now: number) { return this.position(now) >= this.total; }
  start(now: number) { if (!this.running) { this.since = now; this.running = true; } }
  pause(now: number) { if (this.running) { this.base = this.position(now); this.running = false; } }
  resume(now: number) { this.start(now); }
  toggle(now: number) { if (this.running) this.pause(now); else this.resume(now); return this.running; }
  /** Back to the first word (and stopped). */
  reset() { this.base = 0; this.running = false; }
  /** A new speed from now on: what was read so far stays read. */
  setWpm(wpm: number, now: number) { this.base = this.position(now); this.since = now; this.wpm = wpm; }
  setTotal(total: number, now: number) { this.base = Math.min(this.position(now), total); this.since = now; this.total = total; }
}

/** The script's lines as laid out: each line's top (px) and its words (from `first`, `count` of them). */
export type PromptLine = { top: number; first: number; count: number };

/** Groups the words' tops (px, in reading order) into lines. */
export function promptLines(tops: number[]): PromptLine[] {
  const out: PromptLine[] = [];
  tops.forEach((top, i) => {
    const last = out[out.length - 1];
    if (last && Math.abs(top - last.top) < 2) last.count++;
    else out.push({ top, first: i, count: 1 });
  });
  return out;
}

/** How far (px) to move the script up so the line being read sits on the reading line: it glides from one line's top to
 *  the next as that line's words are read, so the motion is smooth whatever the line lengths. */
export function scrollOffset(pos: number, lines: PromptLine[]): number {
  if (!lines.length) return 0;
  const i = lines.findIndex((l) => pos < l.first + l.count);
  if (i < 0) return lines[lines.length - 1].top;
  const l = lines[i], next = lines[i + 1];
  const frac = Math.min(1, Math.max(0, (pos - l.first) / l.count));
  return l.top + (next ? (next.top - l.top) * frac : 0);
}

/** About how long the script takes to say at this speed, in seconds. */
export const readingSeconds = (words: number, wpm: number) => (wpm > 0 ? (60 * words) / wpm : 0);

// ------------------------------------------------------------------ the camera (browser only)

export type Take = { n: number; file: File; url: string; duration: number };

type Opts = {
  maxSeconds?: number;
  onTick?: (elapsed: number) => void;
  onTake: (t: { blob: Blob; mime: string; duration: number }) => void;
  onError: (message: string) => void;
  onMaxed?: () => void;
};

/** The camera for one panel: open() asks for it (from a click or on opening), record() / stop() make takes on the same
 *  stream, close() stops every track. A take still recording when it closes is thrown away. */
export class Camera {
  stream: MediaStream | null = null;
  private rec?: MediaRecorder;
  private chunks: Blob[] = [];
  private mime = "";
  private since = 0;
  private until = 0;
  private timer = 0;
  private closed = false;
  private discard = false;

  constructor(private o: Opts) {}

  get recording() { return !!this.rec && this.rec.state !== "inactive"; }

  elapsed(): number { return this.recording ? (performance.now() - this.since) / 1000 : 0; }

  /** Asks for the camera and microphone. Throws the plain-language message when it can't. */
  async open(portrait: boolean): Promise<MediaStream> {
    if (!canFilm()) throw new Error(CAMERA_UNSUPPORTED);
    let s: MediaStream;
    try { s = await navigator.mediaDevices.getUserMedia(cameraConstraints(portrait)); }
    catch (e) {
      const name = (e as { name?: string }).name;
      if (name !== "OverconstrainedError" && name !== "NotReadableError") throw new Error(cameraErrorMessage(e));
      try { s = await navigator.mediaDevices.getUserMedia(BASIC_CONSTRAINTS); }      // a camera that can't do those sizes
      catch (e2) { throw new Error(cameraErrorMessage(e2)); }
    }
    if (this.closed) { s.getTracks().forEach((t) => t.stop()); throw new Error("closed"); }
    this.stream = s;
    s.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.recording) this.stop();
      if (!this.closed) this.o.onError("The camera turned off (unplugged, or another app took it). Press Try again.");
    });
    return s;
  }

  /** The camera's picture size, once it is running. */
  size(): { width: number; height: number } {
    const st = this.stream?.getVideoTracks()[0]?.getSettings();
    return { width: st?.width ?? 0, height: st?.height ?? 0 };
  }

  record() {
    if (!this.stream || this.recording) return;
    const audio = this.stream.getAudioTracks().length > 0;
    this.mime = chooseMimeType((t) => MediaRecorder.isTypeSupported(t) && (audio || !/opus|mp4a/.test(t)));
    try {
      this.rec = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    } catch (e) { this.o.onError(cameraErrorMessage(e)); return; }
    this.mime = this.rec.mimeType || this.mime;
    this.chunks = [];
    this.discard = false;
    const rec = this.rec;
    rec.ondataavailable = (ev) => { if (ev.data.size) this.chunks.push(ev.data); };
    rec.onstop = () => {
      const duration = ((this.until || performance.now()) - this.since) / 1000;
      const blob = new Blob(this.chunks, { type: baseType(this.mime) });
      this.chunks = [];
      if (!this.discard) this.o.onTake({ blob, mime: baseType(this.mime), duration });
    };
    rec.onerror = (ev) => { this.o.onError(cameraErrorMessage((ev as unknown as { error?: unknown }).error ?? ev)); this.stop(); };
    rec.start(1000);
    this.since = performance.now();
    this.until = 0;
    const max = this.o.maxSeconds ?? MAX_TAKE_SECONDS;
    this.timer = window.setInterval(() => {
      const t = this.elapsed();
      this.o.onTick?.(t);
      if (t >= max) { this.o.onMaxed?.(); this.stop(); }
    }, 200);
  }

  /** End the take and keep it (onTake gets the file's blob). */
  stop() {
    clearInterval(this.timer);
    if (this.rec && this.rec.state !== "inactive") { this.until = performance.now(); this.rec.stop(); }
  }

  /** End the take without keeping it. */
  cancel() { this.discard = true; this.stop(); }

  /** Stop everything: the take in progress is thrown away and the camera light goes off. */
  close() {
    this.closed = true;
    this.cancel();
    this.stream?.getTracks().forEach((t) => { try { t.stop(); } catch { /* gone */ } });
    this.stream = null;
  }
}
