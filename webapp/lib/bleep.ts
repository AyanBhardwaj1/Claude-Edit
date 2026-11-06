/** Bleeps: strong swear words found in what's said, bleeped in one click. A bleeped word plays under a 1 kHz tone with
 *  the voice muted (lib/player.ts, so the preview and the export match) and its subtitle shows "f***"
 *  (captionWords). Platforms limit ads on strong language, and many brands won't sponsor it; mild words ("damn",
 *  "hell", "crap") are left alone. */
import type { Timeline, OutWord } from "./timeline";

const STRONG = /^(fuck\w*|motherfuck\w*|\w*fucker|shit|shits|shitty|shitting|bullshit|horseshit|bitch\w*|asshole\w*|cunt\w*|dickhead\w*|bastard\w*|wtf|stfu|goddamn\w*)$/;

export const isSwear = (word: string) => STRONG.test(word.toLowerCase().replace(/[^a-z]/g, ""));

/** The swear words said in the edited reel, in order. */
export const swears = (tl: Timeline): OutWord[] => tl.words.filter((w) => w.w.trim() && isSwear(w.w));

/** Output-time spans to bleep, a little wider than each word so its edges don't leak. */
export function bleepSpans(tl: Timeline, ids: string[] | undefined): [number, number][] {
  if (!ids?.length) return [];
  return ids.map((id) => tl.byId.get(id)).filter((w): w is OutWord => !!w)
    .map((w) => [Math.max(0, w.os - 0.03), w.oe + 0.03] as [number, number]).sort((a, b) => a[0] - b[0]);
}
