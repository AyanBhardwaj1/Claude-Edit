/** Across your videos: how your reels are doing over time, from the same reel check the editor shows (the current
 *  version of each video), and the one thing that most often holds them back, with where to fix it. */
import { reelCheck } from "./score";
import { buildTimeline } from "./timeline";
import type { Project } from "./types";

const FIX: Record<string, string> = {
  hook: "Put a hook title on screen from the first word (the Hook title panel beside the video).",
  open: "Start on the point: cut the warm-up words at the start.",
  pace: "Tighten the pauses (Edit it myself → Cut).",
  rhythm: "Keep the picture changing: the attention map's Add zooms there does it in one click.",
  length: "Aim for 15–60 s, or use Find the best clips on long takes.",
  subs: "Turn the subtitles on and keep them big.",
  music: "Add a song, or No song? Make music under the note box.",
  hear: "Lower the music under your voice (Edit it myself → Music).",
  voice: "Some takes are quiet: record closer to the mic, or keep the louder take.",
  post: "Write the post caption and 5 hashtags (Edit it myself → Post).",
  cover: "Pick a cover frame and a short title (Edit it myself → Cover).",
};

export type Insights = { videos: number; scores: { title: string; score: number; at: string }[]; average: number;
  change: number | null; averageLength: number; top: { id: string; title: string; count: number; fix: string } | null };

export function insights(projects: Project[]): Insights | null {
  const done = projects.filter((p) => !p.sample && p.versions.length && p.words.length)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (done.length < 2) return null;                         // a trend needs at least two videos
  const scores: Insights["scores"] = [], fails: Record<string, { title: string; count: number }> = {};
  let length = 0;
  for (const p of done) {
    const v = p.versions.find((x) => x.n === p.current) ?? p.versions[p.versions.length - 1];
    try {
      const tl = buildTimeline(p.words, v.edit, p.sources.map((s) => s.duration));
      if (!tl.duration) continue;
      const r = reelCheck(p, v.edit, tl);
      scores.push({ title: p.title, score: r.score, at: p.createdAt });
      length += tl.duration;
      for (const c of r.checks) if (!c.ok && !c.warn) (fails[c.id] ??= { title: c.title, count: 0 }).count++;
    } catch { /* a video that can't be measured is left out */ }
  }
  if (scores.length < 2) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const half = Math.floor(scores.length / 2);
  const early = scores.slice(0, half).map((s) => s.score), late = scores.slice(-half).map((s) => s.score);
  const topId = Object.keys(fails).sort((a, b) => fails[b].count - fails[a].count)[0];
  return {
    videos: scores.length, scores, average: Math.round(avg(scores.map((s) => s.score))),
    change: scores.length >= 4 ? Math.round(avg(late) - avg(early)) : null,
    averageLength: Math.round(length / scores.length),
    top: topId && fails[topId].count >= 2 ? { id: topId, title: fails[topId].title, count: fails[topId].count, fix: FIX[topId] ?? "" } : null,
  };
}
