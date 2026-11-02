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
};

export type Treatment = "card-above-head" | "side-card" | "phone-card" | "full-frame" | "split-top" | "text-pop";

export type Broll = {
  id: string; anchor: Range; treatment: Treatment;
  asset?: string;                 // library key (image or clip)
  text?: string; style?: "label" | "pop"; side?: "left" | "right" | "auto"; tilt?: number;
};

export type Zoom = { anchor: Range; scale: number };

export type CaptionPreset = "studio" | "bold" | "white" | "boxed" | "minimal";

export type Captions = {
  enabled: boolean; preset: CaptionPreset; size: number; position: number;
  textCase: "upper" | "as-is" | "lower"; maxWords: number; font: string;
};

export type Music = {
  asset: string | null; level: "under-voice" | "quiet" | "loud-intro"; startAt: number | null;
  automation: { anchor: Range; db: number }[];
};

export type Post = { caption: string; hashtags: string[]; keywords: string[] };

export type Edit = {
  keep: Range[]; gapCap: number;
  captions: Captions; corrections: { from: string; to: string }[];
  broll: Broll[]; zooms: Zoom[]; music: Music;
  cover: { word: string | null; text: string };
  post: Post;
  sfx: boolean;
};

export type Version = { n: number; edit: Edit; note: string; summary: string; at: string };

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
  library: Asset[]; versions: Version[]; current: number;
  faces?: FaceSample[];
  owner?: string;                 // the local account that made it (lib/auth.ts)
  status: "new" | "transcribed" | "edited";
};

export type Settings = {
  provider: "anthropic" | "openai";
  anthropicKey: string; openaiKey: string;
  anthropicModel: string; openaiModel: string;
  transcriber: "openai" | "browser";
  rememberKeys: boolean;
};

export type StyleRule = { id: string; text: string; at: string };
