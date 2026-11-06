// How long a new video takes on this device, learned from every video made here. Each stage keeps its speed in seconds
// per minute of footage (anything under a minute counts as a minute): built-in guesses at first, then the first real
// measurement, then a moving average (new = 0.6 old + 0.4 sample) so one slow run (a sleeping laptop) can't take over.
// Kept per device and per account in localStorage; never synced, since another computer has another speed.

import { EFFORT, type Effort } from "./effort";
import { readLocal, writeLocal } from "./store";
import type { Settings } from "./types";

export type Stage = "listen" | "faces" | "edit";
type Rate = { r: number; n: number };            // seconds per minute of footage, samples seen
type Book = Record<string, Rate>;

const KEY = "ce.timings";
/** Built-in guesses (seconds per minute of footage) until this device has measured a stage. */
export const PRIOR: Record<string, number> = {
  "listen:openai": 15, "listen:browser": 50,     // transcript + retake analysis (in-browser listening is much slower)
  faces: 12,                                      // MediaPipe, two frames a second
  "edit:fast": 25, "edit:balanced": 60, "edit:best": 150,   // the AI edit, pictures, and Best's review pass
};

/** Listening and face finding don't depend on the effort, so every video teaches them; the AI edit is learned per effort. */
export function rateKey(stage: Stage, effort: Effort, transcriber: Settings["transcriber"] = "openai"): string {
  return stage === "listen" ? `listen:${transcriber}` : stage === "faces" ? "faces" : `edit:${effort}`;
}

export const minutesOf = (footageSeconds: number) => Math.max(1, footageSeconds / 60);

/** One new measurement folded into a stage's speed. */
export function nextRate(old: Rate | undefined, sample: number): Rate {
  if (!old || !(old.n > 0)) return { r: sample, n: 1 };
  const s = Math.min(old.r * 4, Math.max(old.r / 4, sample));
  return { r: 0.6 * old.r + 0.4 * s, n: old.n + 1 };
}

function load(): Book {
  try {
    const b = JSON.parse(readLocal(KEY) || "{}") as Book;
    return b && typeof b === "object" ? b : {};
  } catch { return {}; }
}

export function record(stage: Stage, effort: Effort, seconds: number, footageSeconds: number, transcriber: Settings["transcriber"] = "openai") {
  if (!(seconds > 0) || !(footageSeconds > 0) || !Number.isFinite(seconds)) return;
  const book = load();
  const key = rateKey(stage, effort, transcriber);
  book[key] = nextRate(book[key], seconds / minutesOf(footageSeconds));
  writeLocal(KEY, JSON.stringify(book));
}

/** The stages a new video runs at this effort: no face finding when Fast, no AI edit without a key. */
export function stagesFor(effort: Effort, ai = true): Stage[] {
  return ["listen", ...(EFFORT[effort].faces ? ["faces" as const] : []), ...(ai ? ["edit" as const] : [])];
}

/** Seconds for a new video of this length; learned is true once this device has timed every stage it needs. */
export function estimate(effort: Effort, footageSeconds: number, opts: { transcriber?: Settings["transcriber"]; ai?: boolean } = {}):
  { seconds: number; learned: boolean } {
  const book = load();
  let seconds = 0, learned = true;
  for (const stage of stagesFor(effort, opts.ai !== false)) {
    const key = rateKey(stage, effort, opts.transcriber);
    const known = book[key]?.n > 0 && Number.isFinite(book[key].r);
    seconds += (known ? book[key].r : PRIOR[key]) * minutesOf(footageSeconds);
    learned &&= known;
  }
  if (opts.ai === false) seconds += 2;            // the simple cut without AI is near instant
  return { seconds: Math.round(seconds), learned };
}

/** "under a minute", "about 4 min", "about 1 h 10 min". */
export function formatEstimate(seconds: number): string {
  if (seconds < 50) return "under a minute";
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `about ${m} min` : `about ${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** "About 4 min (estimate)" until this device has timed every stage, then "About 4 min on this device". */
export function estimateText(est: { seconds: number; learned: boolean }, what = ""): string {
  const t = formatEstimate(est.seconds);
  return t[0].toUpperCase() + t.slice(1) + (what ? ` ${what}` : "") + (est.learned ? " on this device" : " (estimate)");
}

const LABEL: Record<string, string> = {
  "listen:openai": "Listening (OpenAI)", "listen:browser": "Listening (in your browser)", faces: "Finding your face",
  "edit:fast": "AI edit, Fast", "edit:balanced": "AI edit, Balanced", "edit:best": "AI edit, Best quality",
};

/** What this device has measured, for Settings: one line per stage it has timed. */
export function learnedSummary(): { stage: string; perMinute: number; videos: number }[] {
  const book = load();
  return Object.keys(LABEL).filter((k) => book[k]?.n > 0)
    .map((k) => ({ stage: LABEL[k], perMinute: Math.round(book[k].r), videos: book[k].n }));
}

/** Forget every measurement on this device (estimates go back to the built-in guesses). */
export function resetLearned() { writeLocal(KEY, "{}"); }
