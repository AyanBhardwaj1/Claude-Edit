// Where the face is in each take, sampled twice a second (MediaPipe face detector, runs in the browser).
// The reframe follows it and every picture keeps clear of the eyes-to-chin zone.

import type { FaceSample, Source } from "./types";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export async function trackFaces(sources: Source[], urls: string[], onProgress: (pct: number) => void): Promise<FaceSample[]> {
  const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const det = await FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: MODEL }, runningMode: "IMAGE",
    minDetectionConfidence: 0.5 });
  const out: FaceSample[] = [];
  const total = sources.reduce((a, s) => a + s.duration, 0);
  let done = 0;
  try {
  for (const [k, s] of sources.entries()) {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.src = urls[k];
    await new Promise((ok) => (v.onloadeddata = ok));
    const c = document.createElement("canvas");
    const scale = Math.min(1, 480 / s.width);
    c.width = Math.round(s.width * scale); c.height = Math.round(s.height * scale);
    const g = c.getContext("2d", { willReadFrequently: true })!;
    const step = s.duration > 300 ? 1 : 0.5;
    for (let t = 0.1; t < s.duration; t += step) {
      v.currentTime = t;
      await new Promise((ok) => (v.onseeked = ok));
      g.drawImage(v, 0, 0, c.width, c.height);
      const d = det.detect(c).detections.sort((a, b) => (b.boundingBox!.width * b.boundingBox!.height) - (a.boundingBox!.width * a.boundingBox!.height))[0];
      if (d?.boundingBox) {
        const b = d.boundingBox;
        const kp = d.keypoints ?? [];
        out.push({ src: k, t, cx: (b.originX + b.width / 2) / c.width, cy: (b.originY + b.height / 2) / c.height,
          w: b.width / c.width, h: b.height / c.height,
          eyesY: kp.length >= 2 ? (kp[0].y + kp[1].y) / 2 : undefined, mouthY: kp.length >= 4 ? kp[3].y : undefined });
      }
      onProgress(Math.round((100 * (done + t)) / total));
    }
    done += s.duration;
  }
  } finally { det.close(); }                         // a failed frame still frees the detector
  return out;
}

/** The face (fractions of the source frame) around a source time, smoothed over +/- 0.75 s. */
export function faceAt(samples: FaceSample[] | undefined, src: number, t: number) {
  const near = (samples ?? []).filter((f) => f.src === src && Math.abs(f.t - t) <= 0.75);
  if (!near.length) return null;
  const avg = (k: "cx" | "cy" | "w" | "h") => near.reduce((a, f) => a + f[k], 0) / near.length;
  const eyes = near.filter((f) => f.eyesY !== undefined);
  return { cx: avg("cx"), cy: avg("cy"), w: avg("w"), h: avg("h"),
    eyesY: eyes.length ? eyes.reduce((a, f) => a + f.eyesY!, 0) / eyes.length : undefined };
}
