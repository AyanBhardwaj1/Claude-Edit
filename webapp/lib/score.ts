// The reel check: a 0-100 readiness score with plain fixes, computed from the edit and its timeline (no AI).
// The thresholds follow the editing doctrine: a hook on screen from the first word, the picture changing every
// 3-5 seconds, 140-200 spoken words a minute, 15-60 seconds for a reel, subtitles on, exactly 5 hashtags.

import { motionOf } from "./edit";
import { MIN_GAP, QUIET_VOICE_RMS, speechGap } from "./mix";
import type { Timeline } from "./timeline";
import { spanOf } from "./timeline";
import { WEAK } from "./scrolltest";
import type { Edit, Project } from "./types";

export type Check = { id: string; ok: boolean; warn?: boolean; weight: number; title: string; detail: string; fix?: string };

export function reelCheck(p: Project, e: Edit, tl: Timeline): { score: number; checks: Check[] } {
  const dur = tl.duration;
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const hook = e.broll.find((b) => b.treatment === "text-pop" && b.style === "label" && b.tilt === 0);
  const hs = hook ? spanOf(tl, hook.anchor) : null;
  add({ id: "hook", weight: 20, ok: !!hs && hs[0] <= 0.5, title: "A hook on screen from the first word",
    detail: hs ? (hs[0] <= 0.5 ? `"${hook!.text}" appears at ${hs[0].toFixed(1)} s.` : `The hook title only appears at ${hs[0].toFixed(1)} s.`) : "There's no hook title.",
    fix: hs ? undefined : hook ? "Anchor the hook title on the first words (write a note: “hook title from the first word”)." : "Write one in the Hook title panel beside the video, or press Try 5 hooks there." });
  const spoken = tl.words.filter((w) => w.w.trim());     // a pasted script can leave empty words: skip them
  const first = spoken.slice(0, 3).map((w) => w.w.toLowerCase().replace(/[^a-z']/g, ""));
  const weak = WEAK.includes(first[0] ?? "");          // the same list as the scroll test, so the two agree
  add({ id: "open", weight: 10, ok: !weak, title: "Starts mid-thought", detail: weak ? `It opens with “${spoken[0]?.w.trim()}”: viewers swipe on throat clearing.` : "The first word is the point.",
    fix: weak ? "In Edit it myself → Cut, click the first words to cut them." : undefined });
  const wpm = dur > 0 ? (tl.words.length / dur) * 60 : 0;
  add({ id: "pace", weight: 10, ok: wpm >= 140 && wpm <= 210, warn: wpm >= 120 && wpm < 140, title: "Talking pace",
    detail: `${Math.round(wpm)} words a minute${wpm < 140 ? ": slow for a reel" : wpm > 210 ? ": very fast, hard to follow" : ""}.`,
    fix: wpm < 140 ? "Lower the longest pause kept (Edit it myself → Cut)." : undefined });
  // visual rhythm: something new on screen (a cut with punch-in, a picture, a card, a zoom) at least every ~4.5 s
  const m = motionOf(e);
  const changes = [0, ...(m.transition !== "none" ? tl.segments.slice(1).map((s) => s.outStart) : []),
    ...e.broll.map((b) => spanOf(tl, b.anchor)?.[0]).filter((x): x is number => x !== undefined),
    ...e.zooms.map((z) => spanOf(tl, z.anchor)?.[0]).filter((x): x is number => x !== undefined), dur].sort((a, b) => a - b);
  let gap = 0, at = 0;
  for (let i = 1; i < changes.length; i++) if (changes[i] - changes[i - 1] > gap) { gap = changes[i] - changes[i - 1]; at = changes[i - 1]; }
  add({ id: "rhythm", weight: 20, ok: gap <= 4.5, warn: gap > 4.5 && gap <= 7, title: "The picture keeps changing",
    detail: gap <= 4.5 ? `Never more than ${gap.toFixed(1)} s without something new.` : `${gap.toFixed(1)} s of the same shot from ${at.toFixed(1)} s.`,
    fix: gap > 4.5 ? "Add a zoom, a picture or an animated card there, or turn on punch-in cuts (Motion)." : undefined });
  add({ id: "length", weight: 10, ok: dur >= 12 && dur <= 60, warn: dur > 60 && dur <= 90, title: "Length",
    detail: `${dur.toFixed(0)} s.${dur < 12 ? " Very short: say one more thing." : dur > 90 ? " Long for a reel: try Find the best clips." : dur > 60 ? " Fine, but 15-60 s gets watched to the end most." : ""}` });
  add({ id: "subs", weight: 10, ok: e.captions.enabled && e.captions.size >= 84, title: "Subtitles on, big enough",
    detail: e.captions.enabled ? `On, ${e.captions.size} px.` : "Off: most people watch with the sound off.", fix: e.captions.enabled ? undefined : "Edit it myself → Subtitles → Show subtitles." });
  const song = e.music.asset ? p.library.find((a) => a.key === e.music.asset) : undefined;
  add({ id: "music", weight: 5, ok: !!song, warn: !song, title: "Music under the voice", detail: song ? `${song.name}, ${e.music.level === "quiet" ? "quiet" : "under your voice"}.` : "No music.",
    fix: song ? undefined : "Add a song you own with “Add a song, picture or clip”." });
  if (song) {
    const { gap, at } = speechGap(e, tl);
    add({ id: "hear", weight: 10, ok: gap >= MIN_GAP, warn: gap >= MIN_GAP - 4 && gap < MIN_GAP, title: "Your voice is clearly heard",
      detail: gap >= MIN_GAP ? `The song stays at least ${gap} dB under your voice while you talk.`
        : `At ${at!.toFixed(1)} s the song is only ${gap} dB under your voice: people may not hear what you say.`,
      fix: gap >= MIN_GAP ? undefined : "Write a note: “keep the music quiet while we talk”, or lower that music lift." });
  }
  const quiet = p.sources.filter((s) => s.rms !== undefined && s.rms < QUIET_VOICE_RMS);
  if (quiet.length) add({ id: "voice", weight: 5, ok: false, warn: true, title: "Voice level",
    detail: `Take${quiet.length > 1 ? "s" : ""} ${quiet.map((s) => s.id + 1).join(", ")} ${quiet.length > 1 ? "are" : "is"} quiet: the mic was far away or the room was loud.`,
    fix: "Next time hold the phone closer or use a clip-on mic; the editor already cleans and levels it." });
  add({ id: "post", weight: 10, ok: !!e.post.caption && e.post.hashtags.length === 5, warn: !!e.post.caption, title: "Caption and 5 hashtags",
    detail: e.post.caption ? `${e.post.hashtags.length} hashtag${e.post.hashtags.length === 1 ? "" : "s"}.` : "No post caption yet.",
    fix: e.post.hashtags.length === 5 ? undefined : "Edit it myself → Post." });
  add({ id: "cover", weight: 5, ok: !!e.cover.word || !!e.cover.text, warn: true, title: "A chosen cover", detail: e.cover.text ? `“${e.cover.text}”.` : e.cover.word ? "A chosen moment." : "Automatic.",
    fix: e.cover.word || e.cover.text ? undefined : "Edit it myself → Cover." });
  const total = checks.reduce((n, c) => n + c.weight, 0);
  const got = checks.reduce((n, c) => n + (c.ok ? c.weight : c.warn ? c.weight * 0.5 : 0), 0);
  return { score: Math.round((100 * got) / total), checks };
}
