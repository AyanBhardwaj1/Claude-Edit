"use client";
import { useEffect, useRef, useState } from "react";
import { transcribe } from "@/lib/transcribe";
import type { Settings } from "@/lib/types";
import { Icon } from "./Icons";

const LIMIT = 60;                          // seconds: a note, not a monologue

/** Say a note instead of typing it: the mic records you, the listening you chose in Settings writes it down, and the
 *  text lands in the note box to check before sending. Nothing is sent to the editor until you press Send. */
export function VoiceNote({ settings, onText, disabled }: { settings: Settings; onText: (t: string) => void; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "rec" | "busy">("idle");
  const [secs, setSecs] = useState(0);
  const [say, setSay] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); rec.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  const engine = settings.transcriber === "openai" && settings.openaiKey ? "openai" : "browser";

  const start = async () => {
    setSay("");
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { setSay("Cutmind can't use the microphone: allow it in your browser's site settings."); return; }
    const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((t) => MediaRecorder.isTypeSupported?.(t));
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      if (timer.current) clearInterval(timer.current);
      setState("busy"); setSay(engine === "browser" ? "Writing it down in your browser…" : "Writing it down…");
      try {
        const words = await transcribe(new Blob(parts, { type: r.mimeType || type || "audio/webm" }), 0, 0, engine, settings.openaiKey, () => {});
        const text = words.map((w) => w.w).join(" ").replace(/\s+([,.!?])/g, "$1").trim();
        if (text) { onText(text.charAt(0).toUpperCase() + text.slice(1)); setSay("Check it, then send."); }
        else setSay("I didn't hear anything. Try again a little closer to the mic.");
      } catch (e) { setSay((e as Error).message); }
      setState("idle");
    };
    rec.current = r; r.start(); setState("rec"); setSecs(0);
    timer.current = setInterval(() => setSecs((s) => { if (s + 1 >= LIMIT) r.stop(); return s + 1; }), 1000);
  };
  const stop = () => { if (rec.current?.state === "recording") rec.current.stop(); };

  return (
    <>
      <button type="button" className={`btn ghost sm voice-btn ${state === "rec" ? "on" : ""}`} disabled={disabled || state === "busy"}
        aria-pressed={state === "rec"} onClick={state === "rec" ? stop : start}
        aria-label={state === "rec" ? `Stop and write down your note (${secs} s)` : "Say your note"} title="Say your note">
        <Icon name={state === "rec" ? "stop" : "mic"} />{state === "rec" ? <span className="num">{secs}s</span> : null}
      </button>
      <span className="sr-only" aria-live="polite">{state === "rec" ? "Recording your note" : ""}</span>
      <span className="voice-say small faint" role="status">{state !== "rec" ? say : ""}</span>
    </>
  );
}
