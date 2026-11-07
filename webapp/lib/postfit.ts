// Does the post fit each app? Caption length and hashtag limits, and what people see before "…more". The limits are the
// apps' published ones (Instagram 2,200 characters and 30 hashtags, about 125 shown before "more"; TikTok 4,000; a
// YouTube title 100): checked here so a long caption isn't cut off or refused at posting.

export type Fit = { app: string; ok: boolean; text: string };

const IG_MAX = 2200, IG_TAGS = 30, IG_SHOWN = 125, TT_MAX = 4000, YT_TITLE = 100;

export function postText(caption: string, hashtags: string[]): string {
  return [caption.trim(), hashtags.join(" ")].filter(Boolean).join("\n\n");
}

export function postFit(caption: string, hashtags: string[]): { fits: Fit[]; shown: string; cut: boolean } {
  const all = postText(caption, hashtags);
  const n = [...all].length;                                        // characters as people count them (emoji are one)
  const first = caption.trim().split("\n")[0] ?? "";
  const titleLen = [...first].length;
  const fits: Fit[] = [
    { app: "Instagram", ok: n <= IG_MAX && hashtags.length <= IG_TAGS,
      text: hashtags.length > IG_TAGS ? `${hashtags.length} hashtags: Instagram takes 30` : `${n.toLocaleString()} of ${IG_MAX.toLocaleString()} characters` },
    { app: "TikTok", ok: n <= TT_MAX, text: `${n.toLocaleString()} of ${TT_MAX.toLocaleString()}` },
    { app: "YouTube Shorts title", ok: titleLen > 0 && titleLen <= YT_TITLE, text: titleLen ? `first line, ${titleLen.toLocaleString()} of ${YT_TITLE}${titleLen > YT_TITLE ? ": give it a shorter title when you post" : ""}` : "no first line to use" },
  ];
  const chars = [...caption.trim()];
  return { fits, shown: chars.slice(0, IG_SHOWN).join(""), cut: chars.length > IG_SHOWN };
}
