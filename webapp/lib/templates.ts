// One-click styles: a subtitle look plus a motion set, applied to the current edit as a new version.

import { DEFAULT_MOTION, motionOf } from "./edit";
import type { Brand, Captions, Edit, Motion } from "./types";

export type Template = { id: string; name: string; line: string; captions: Partial<Captions>; motion: Partial<Motion> };

export const TEMPLATES: Template[] = [
  { id: "punchy", name: "Punchy", line: "Heavy words that bounce in, yellow highlights, punch-in cuts, vivid colour.",
    captions: { preset: "bold", textCase: "upper", maxWords: 2, size: 118, font: "Montserrat" },
    motion: { captionAnim: "bounce", accent: "#FFE14D", emphasis: true, transition: "punch", look: "vivid", brollIn: "zoom", progress: false } },
  { id: "karaoke", name: "Karaoke", line: "The spoken word lights up on a colour box. Great for explainers.",
    captions: { preset: "studio", textCase: "upper", maxWords: 3, size: 105, font: "Montserrat" },
    motion: { captionAnim: "karaoke", accent: "#7C5CFF", emphasis: false, transition: "punch", look: "natural", brollIn: "pop", progress: true } },
  { id: "clean", name: "Clean", line: "Quiet subtitles that fade in, soft cuts, natural colour.",
    captions: { preset: "minimal", textCase: "as-is", maxWords: 4, size: 92, font: "Inter" },
    motion: { captionAnim: "fade", accent: "#FFFFFF", emphasis: false, transition: "none", look: "natural", brollIn: "slide", progress: false } },
  { id: "cinematic", name: "Cinematic", line: "Typewriter words, dips between lines, a teal and shadow grade.",
    captions: { preset: "white", textCase: "upper", maxWords: 3, size: 96, font: "Montserrat" },
    motion: { captionAnim: "typewriter", accent: "#F2C14E", emphasis: true, transition: "fade", look: "cinematic", brollIn: "slide", progress: false } },
  { id: "neon", name: "Neon", line: "Pink karaoke, glitch cuts, cool colour. Loud on purpose.",
    captions: { preset: "boxed", textCase: "upper", maxWords: 2, size: 112, font: "Montserrat" },
    motion: { captionAnim: "karaoke", accent: "#FF3D9A", emphasis: true, transition: "glitch", look: "cool", brollIn: "spin", progress: true } },
  { id: "podcast", name: "Podcast", line: "Warm picture, words that appear as said, whip cuts between points.",
    captions: { preset: "white", textCase: "as-is", maxWords: 4, size: 96, font: "Montserrat" },
    motion: { captionAnim: "words", accent: "#FF9F43", emphasis: true, transition: "whip", look: "warm", brollIn: "pop", progress: false } },
  { id: "film", name: "Film", line: "Black and white with grain-dark edges, fades and quiet captions.",
    captions: { preset: "minimal", textCase: "upper", maxWords: 3, size: 90, font: "Montserrat" },
    motion: { captionAnim: "fade", accent: "#FFFFFF", emphasis: false, transition: "fade", look: "mono", brollIn: "slide", progress: false } },
];

/** "My brand": the user's font and colour on the karaoke look. */
export const brandTemplate = (b: Brand): Template => ({ id: "brand", name: b.name.trim() ? b.name.trim().slice(0, 18) : "My brand",
  line: "Your font and your colour on every word.",
  captions: { preset: "studio", textCase: "upper", maxWords: 3, size: 105, font: b.font || "Montserrat" },
  motion: { captionAnim: "karaoke", accent: b.accent, emphasis: true, transition: "punch", look: "natural", brollIn: "pop", progress: false } });

export function applyTemplate(e: Edit, t: Template): Edit {
  return { ...structuredClone(e), captions: { ...e.captions, ...t.captions, enabled: true }, motion: { ...DEFAULT_MOTION, ...motionOf(e), ...t.motion } };
}

/** Which template an edit currently matches, if any. */
export function templateOf(e: Edit): string | null {
  const m = motionOf(e);
  return TEMPLATES.find((t) => Object.entries(t.motion).every(([k, v]) => m[k as keyof Motion] === v)
    && Object.entries(t.captions).every(([k, v]) => e.captions[k as keyof Captions] === v))?.id ?? null;
}
