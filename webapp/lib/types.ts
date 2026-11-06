// The project model. Like the editing toolkit's EDL, every placement is anchored to word ids, never to seconds,
// so re-cutting never breaks a picture, a zoom or a music lift.

export type Word = { id: string; src: number; s: number; e: number; w: string; p?: number };

export type Source = {
  id: number; name: string; mediaKey: string; duration: number; width: number; height: number;
  mirror?: boolean; rms?: number;
};

export type Range = { from: string; to: string };

export type Credit = { title: string; creator: string; license: string; page: string; source: string };

export type Asset = {
  key: string; name: string; kind: "image" | "video" | "music";
  width?: number; height?: number; duration?: number; credit?: Credit; feel?: string; energy?: number; rms?: number;
  entry?: number;                 // music: seconds in to start (a bar before the first big hit)
  web?: boolean;
  ai?: boolean;                   // made by an AI image model (labelled; platforms want an AI label)
  screen?: boolean;               // looks like a screenshot / screen recording (flat UI colours; lib/framed.ts looksLikeScreen)
  origin?: "composed";            // music: an original bed composed in the browser (lib/compose.ts), royalty-free
  composed?: { mood: string; bpm: number; key: string; mode: string; length: number; endChordAt: number; lufs: number };
  // a clip's own in and out points and the frozen stretches that play 6x faster (lib/screenrec.ts clipPlan): metadata
  // only, the file itself is never re-encoded. The player maps a shot's time onto the clip with them.
  trim?: { start: number; end: number };
  waits?: [number, number][];     // [] = looked for, none found; missing = not looked for yet (an uploaded screen recording)
  speedWaits?: boolean;           // "Speed through waits" for this clip (default on; false plays the waits at 1x)
};

export type Treatment = "card-above-head" | "side-card" | "phone-card" | "full-frame" | "split-top" | "framed" | "text-pop" | "motion";

export type Broll = {
  id: string; anchor: Range; treatment: Treatment;
  asset?: string;                 // library key (image or clip)
  text?: string; style?: "label" | "pop"; side?: "left" | "right" | "auto"; tilt?: number;
  card?: MotionCard; palette?: string;   // treatment "motion": an animated card drawn by Motion Studio's engine
  // treatment "framed" (app screens, lib/framed.ts): focus 0-1 in the asset, a punch-in `at` seconds into the shot,
  // a backdrop colour (default: a tint of the brand accent, else ivory #f4f1e6), full = cover the frame even over the face
  focus?: { x: number; y: number }; punch?: { at: number; zoom: number }; backdrop?: string; full?: boolean;
};

export type MotionCard = { kind: "number" | "list" | "compare" | "bars" | "statement" | "title"; text: string; sub?: string; items?: string[];
  value?: number; prefix?: string; suffix?: string };

export type Zoom = { anchor: Range; scale: number };

// boxed: a phrase at a time on a dark rounded box, bottom centre (up to 2 lines of ~42 characters); block: the older
// word-by-word look on a black box
export type CaptionPreset = "studio" | "bold" | "white" | "block" | "boxed" | "minimal";

export type Captions = {
  enabled: boolean; preset: CaptionPreset; size: number; position: number;
  textCase: "upper" | "as-is" | "lower"; maxWords: number; font: string;
};

export type Music = {
  asset: string | null; level: "under-voice" | "quiet" | "loud-intro"; startAt: number | null;
  automation: { anchor: Range; db: number }[];
};

export type Post = { caption: string; hashtags: string[]; keywords: string[] };

export type CaptionAnim = "pop" | "karaoke" | "bounce" | "words" | "typewriter" | "fade" | "none";
export type Transition = "none" | "punch" | "whip" | "flash" | "fade" | "glitch";
export type Look = "natural" | "warm" | "cool" | "cinematic" | "mono" | "vivid" | "film";
export type BrollIn = "pop" | "slide" | "zoom" | "spin";

/** How the edit moves: subtitle animation, highlights, transitions at cuts, the colour look, picture motion. */
export type Motion = {
  captionAnim: CaptionAnim; accent: string; emphasis: boolean;
  transition: Transition; look: Look; progress: boolean; kenBurns: boolean; brollIn: BrollIn;
};

export type Edit = {
  keep: Range[]; gapCap: number;
  speed?: number;                 // talking speed, 1 (as filmed) to 1.3: the takes play faster, pitch kept
  captions: Captions; corrections: { from: string; to: string }[];
  broll: Broll[]; zooms: Zoom[]; music: Music;
  cover: { word: string | null; text: string };
  post: Post;
  sfx: boolean;
  motion?: Motion;                // missing on edits made before motion existed: DEFAULT_MOTION applies
  translation?: Translation;      // subtitles in another language (lib/translate.ts)
  bleeps?: string[];              // word ids bleeped: voice muted under a tone, subtitles masked (lib/bleep.ts)
  loudness?: number;              // dB added before the master compressor and limiter, set by Match loudness
  chapters?: { from: string; title: string }[];   // YouTube chapters, anchored on their first words (lib/chapters.ts)
  chapterPills?: boolean;         // show each chapter's title on screen as it starts
};

/** Subtitles in another language: one translated line per spoken phrase, timed by the words it covers. */
export type Translation = { lang: string; lines: { from: string; to: string; text: string }[] };

export type Version = { n: number; edit: Edit; note: string; summary: string; at: string; from?: number };   // from: the version it was made from

export type RetakeGroup = { phrases: Range[]; texts: string[]; chosen: number };

export type Analysis = {
  phrases: (Range & { text: string; src: number; s: number; e: number })[];
  pauses: { after: string; seconds: number }[];
  retakes: RetakeGroup[];
  dropped: (Range & { reason: string; text: string })[];
  defaultKeep: Range[];
  names: string[];
  unsure: string[];
};

export type FaceSample = { src: number; t: number; cx: number; cy: number; w: number; h: number;
  eyesY?: number; mouthY?: number };

export type Project = {
  id: string; title: string; createdAt: string; updatedAt: string;
  sources: Source[]; words: Word[]; analysis?: Analysis;
  // "Paste your script" (lib/retext.ts): the words as the recogniser heard them (same ids and times; only the text differs),
  // kept for "Use what it heard", and the script that was used
  wordsHeard?: Word[]; script?: string;
  library: Asset[]; versions: Version[]; current: number;
  faces?: FaceSample[];
  owner?: string;                 // the local account that made it (lib/auth.ts)
  sample?: boolean;               // the built-in sample project (lib/demo.ts)
  parent?: string;                // a clip made from a longer video (lib/clips.ts) shares that video's media
  format?: Format;                // the shape it plays and exports in (default 9:16)
  status: "new" | "transcribed" | "edited";
};

export type Format = "9:16" | "4:5" | "1:1" | "16:9";

/** The user's brand: used for highlights, subtitles, a corner watermark and Motion Studio's "Brand" colours. */
export type Brand = { name: string; handle: string; accent: string; accent2: string; font: string; logo?: string; watermark: boolean };

export type Settings = {
  brand?: Brand;
  provider: "anthropic" | "openai";
  anthropicKey: string; openaiKey: string;
  anthropicModel: string; openaiModel: string;
  transcriber: "openai" | "browser";
  rememberKeys: boolean;
  effort: "fast" | "balanced" | "best";   // speed vs quality (lib/effort.ts); missing on old saved settings: balanced
};

export type StyleRule = { id: string; text: string; at: string };
