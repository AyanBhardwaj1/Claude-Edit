// The assistant: a coach on the side for whatever you make. It knows what you make (your creator profile, asked once),
// adapts both its advice and the AI editor's style to it, tells you in plain words what's happening while a video is
// being made, and answers questions with your own AI (a key, or your Claude / ChatGPT plan by copy and paste).
import { callJson } from "./ai";
import { readLocal, writeLocal } from "./store";
import type { Project, Settings, StyleRule } from "./types";

type Json = Record<string, unknown>;

// ---- what you make -----------------------------------------------------------------------------------------------
export type Kind = "reels" | "youtube" | "explainer" | "demo" | "podcast" | "course";
export type Creator = { kinds: Kind[]; about: string; goal: string };

export const KINDS: { id: Kind; label: string; line: string; style: string }[] = [
  { id: "reels", label: "Reels, TikToks & Shorts", line: "short vertical videos",
    style: "Short-form vertical (Reels / TikTok / Shorts): a hook in the first 2 seconds, tight cuts with no dead air, big word-synced captions, something new on screen every 2-3 seconds, under 60 seconds when it can be." },
  { id: "youtube", label: "YouTube videos", line: "longer YouTube videos",
    style: "YouTube (longer, often 16:9): keep natural pacing and breaths, cut retakes and dead air but not every pause, clean captions, chapters, a picture when a thing is named." },
  { id: "explainer", label: "Explainers & infographic videos", line: "explainer and infographic videos",
    style: "Explainers / infographic videos: a card, number or picture on screen for each point, key figures as text cards, a calm clear pace, readable captions." },
  { id: "demo", label: "Product demos & launches", line: "product demos",
    style: "Product demos: show the product on screen while it's described (screen recordings, framed screens), label each feature, keep the pace brisk, end on a clear call to action." },
  { id: "podcast", label: "Podcast & interview clips", line: "podcast and interview clips",
    style: "Podcast / interview clips: one strong idea per clip, stay on the speaker, karaoke-style captions, few pictures, tight but natural pacing." },
  { id: "course", label: "Tutorials & courses", line: "tutorials",
    style: "Tutorials: clarity over hype, label each step, a slower pace, keep demonstrations whole." },
];

const KEY = "ce.creator";
export function loadCreator(): Creator | null {
  try {
    const c = JSON.parse(readLocal(KEY) ?? "null") as Creator | null;
    return c && Array.isArray(c.kinds) ? { kinds: c.kinds.filter((k) => KINDS.some((x) => x.id === k)), about: String(c.about ?? ""), goal: String(c.goal ?? "") } : null;
  } catch { return null; }
}
export function saveCreator(c: Creator) {
  writeLocal(KEY, JSON.stringify(c));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("cutmind:creator"));
}

/** Style rules the AI editor follows for what you make (added to your own rules in every edit, lib/ai.ts). */
export function creatorRules(c: Creator | null = loadCreator()): StyleRule[] {
  if (!c) return [];
  const out: StyleRule[] = KINDS.filter((k) => c.kinds.includes(k.id)).map((k) => ({ id: `creator-${k.id}`, text: k.style, at: "" }));
  if (c.about.trim()) out.push({ id: "creator-about", text: `What this creator makes: ${c.about.trim().slice(0, 200)}`, at: "" });
  return out;
}

/** The shape a new video starts in: 16:9 when you only make YouTube videos or tutorials, else upright. */
export function creatorFormat(c: Creator | null = loadCreator()): "16:9" | null {
  return c && c.kinds.length && c.kinds.every((k) => k === "youtube" || k === "course") ? "16:9" : null;
}

export function describeCreator(c: Creator | null): string {
  if (!c || !c.kinds.length) return "not told yet";
  const what = KINDS.filter((k) => c.kinds.includes(k.id)).map((k) => k.line).join(", ");
  return [what, c.about.trim() && `about: ${c.about.trim()}`, c.goal.trim() && `goal: ${c.goal.trim()}`].filter(Boolean).join("; ");
}

// ---- live updates while a video is being made ---------------------------------------------------------------------
export type Activity = { msg: string; pct: number; friendly: string; at: number };

/** What a progress step means, said like a person would: "Composing music for the background…". */
export function friendly(msg: string, pct: number): string {
  const m = msg.toLowerCase();
  const rules: [RegExp, string][] = [
    [/copying/, "Saving your footage in this browser so nothing gets lost."],
    [/listening model/, "Getting the listening model ready. It's a one-time download."],
    [/listen/, "Listening to every word you said, so the subtitles and cuts land exactly on them."],
    [/retake/, "Spotting the lines you said twice, so only your best take stays."],
    [/script/, "Lining your script up with what you actually said."],
    [/face/, "Finding your face, so zooms and pictures never cover it."],
    [/review/, "Taking a second look at the edit, like a senior editor would."],
    [/picking|planning the edit|edit/, "Picking your best takes and planning the cuts, the hook and the pictures."],
    [/picture|image/, "Finding pictures to show when you name something."],
    [/writing the parts/, "Composing new music for the background: writing the chords and the melody."],
    [/playing it through/, "Playing the new music through, instrument by instrument."],
    [/mixing/, "Mixing the music so it sits under your voice."],
    [/mastering/, "Mastering the music to streaming loudness."],
    [/export|record/, "Rendering your video frame by frame. Keep this tab in front."],
    [/note/, "Working on your note: finding the moment and making the smallest change."],
    [/sample/, "Fetching the sample video."],
    [/ready|done/, "All done!"],
  ];
  const hit = rules.find(([re]) => re.test(m));
  const base = hit ? hit[1] : `${msg}…`;
  return pct > 0 && pct < 100 && !/done!$/.test(base) ? `${base} (${Math.round(pct)}%)` : base;
}

let lastSent = { msg: "", pct: -10 };
/** Tells the assistant what's happening. Called from every long step (making a video, a note, music, an export). */
export function announce(msg: string, pct: number) {
  if (typeof window === "undefined") return;
  // the same step only every 10%: a progress bar ticks many times a second
  if (msg === lastSent.msg && Math.abs(pct - lastSent.pct) < 10 && pct < 100) return;
  lastSent = { msg, pct };
  const a: Activity = { msg, pct, friendly: friendly(msg, pct), at: Date.now() };
  window.dispatchEvent(new CustomEvent<Activity>("cutmind:activity", { detail: a }));
}

// ---- asking it -----------------------------------------------------------------------------------------------------
export type Chat = { who: "me" | "coach"; text: string; next?: string[] };

const SCHEMA = { type: "object", properties: {
  reply: { type: "string", description: "Your answer: plain, friendly, specific to this creator, under 180 words." },
  next: { type: "array", items: { type: "string" }, description: "Up to 3 short follow-up questions or actions the creator could tap next." },
}, required: ["reply"] };

const SYSTEM = `You are the assistant inside Cutmind, a video editor that turns raw footage into finished videos. You are a
friendly, expert coach for video editing and content creation: short-form (Reels, TikTok, Shorts), YouTube, explainers and
infographic videos, product demos, podcast clips and tutorials. Adapt everything to what this creator makes and wants.
Give specific, practical advice: ideas for their next video (with a hook line), how to improve their edits, hooks, pacing,
captions, b-roll, thumbnails, posting, growing an audience, planning product demos. When something can be done in Cutmind,
say where (New video, Edit it myself → Cut / Subtitles / Motion / Music / Pictures / Cover / Post, the timeline, Write a
script, Animate, My style, Settings). Never invent numbers about their account: you only know what's below. Be brief.`;

/** What the coach knows: who you are, what you make, your videos so far and your style. */
export function coachContext(c: Creator | null, projects: Project[], rules: StyleRule[], screen: string, current?: Project | null): string {
  const mine = projects.filter((p) => !p.sample).slice(0, 12);
  const secs = (p: Project) => Math.round(p.sources.reduce((a, s) => a + s.duration, 0));
  const lines = [
    `Creator: ${describeCreator(c)}`,
    `They are on: ${screen}`,
    `Their videos (${mine.length}${projects.length > mine.length ? "+" : ""}, newest first):`,
    ...(mine.length ? mine.map((p) => `- "${p.title}" (${secs(p)} s filmed, ${p.versions.length} version${p.versions.length === 1 ? "" : "s"}, ${p.format ?? "9:16"})`) : ["- none yet"]),
    `Their style rules: ${rules.length ? rules.slice(0, 12).map((r) => r.text).join(" | ") : "none yet"}`,
  ];
  if (current) {
    const said = current.words.map((w) => w.w).filter(Boolean).join(" ");
    lines.push(`Open now: "${current.title}". It starts: "${said.slice(0, 700)}${said.length > 700 ? "…" : ""}"`);
  }
  return lines.join("\n");
}

export async function askCoach(s: Settings, question: string, context: string, history: Chat[]): Promise<Chat> {
  const recent = history.slice(-6).map((m) => `${m.who === "me" ? "Creator" : "You"}: ${m.text}`).join("\n");
  const user = `${context}\n\n${recent ? `Conversation so far:\n${recent}\n\n` : ""}Creator asks: ${question}`;
  const r = await callJson(s, SYSTEM, user, SCHEMA as Json, "submit_coach");
  const next = Array.isArray(r.next) ? r.next.filter((x): x is string => typeof x === "string").slice(0, 3) : [];
  return { who: "coach", text: String(r.reply ?? "").trim() || "I didn't get an answer back. Try asking again.", next };
}

/** Starter questions, for what you make. */
export function starters(c: Creator | null): string[] {
  const k = c?.kinds ?? [];
  const out = ["Give me 3 ideas for my next video", "How can my edits get better?"];
  if (k.includes("demo")) out.push("Help me plan a product demo");
  else if (k.includes("youtube")) out.push("How do I keep people watching a long video?");
  else if (k.includes("explainer")) out.push("How should I show numbers on screen?");
  else out.push("Write me 3 hooks for my next video");
  return out;
}

const CHAT = "ce.coach";
export function loadChat(): Chat[] {
  try { const v = JSON.parse(readLocal(CHAT) ?? "[]"); return Array.isArray(v) ? v.slice(-40) : []; } catch { return []; }
}
export function saveChat(c: Chat[]) { writeLocal(CHAT, JSON.stringify(c.slice(-40))); }
