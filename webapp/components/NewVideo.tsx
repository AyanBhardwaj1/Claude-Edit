"use client";
import { useRef, useState } from "react";
import { loadRules } from "@/lib/store";
import type { Project, Settings } from "@/lib/types";
import { createProject, kindOf, listen, makeFirstEdit } from "@/lib/workflow";

const STAGES = ["Copying your video", "Listening to your video", "Finding your retakes", "Finding your face",
  "Picking your best takes and planning the edit", "Finding pictures online", "Ready"];

export function NewVideo({ settings, onDone, onSettings }: { settings: Settings; onDone: (p: Project, summary: string) => void;
  onSettings: () => void }) {
  const [takes, setTakes] = useState<File[]>([]);
  const [extras, setExtras] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const hasKey = settings.provider === "anthropic" ? !!settings.anthropicKey : !!settings.openaiKey;
  const canListen = settings.transcriber === "browser" || !!settings.openaiKey;

  function take(files: FileList | File[]) {
    const fs = [...files];
    const vids = fs.filter((f) => kindOf(f) === "video");
    const rest = fs.filter((f) => kindOf(f) && kindOf(f) !== "video");
    if (!takes.length) { setTakes(vids); } else setExtras((x) => [...x, ...vids]);
    setExtras((x) => [...x, ...rest]);
  }

  async function go() {
    setBusy(true); setErr("");
    const progress = (m: string, p?: number) => { setMsg(m); if (p !== undefined) setPct((x) => Math.max(x, p)); };
    try {
      const p = await createProject(takes, extras, progress);
      await listen(p, settings, progress);
      const summary = await makeFirstEdit(p, settings, loadRules(), progress);
      progress("Ready", 100);
      onDone(p, summary);
    } catch (e) {
      setErr((e as { userMessage?: string }).userMessage ?? (e as Error).message ?? String(e));
      setBusy(false);
    }
  }

  if (busy) {
    const at = STAGES.findIndex((s) => msg.startsWith(s.split(" ")[0]) && msg.includes(s.split(" ")[1] ?? ""));
    return (
      <div style={{ maxWidth: 620 }}>
        <h1>Making your reel</h1>
        <div className="bar"><div style={{ width: `${Math.min(99, pct)}%` }} /></div>
        <p>{msg}</p>
        <ul className="check muted small">
          {STAGES.slice(0, -1).map((s, i) => <li key={s}>{i < at ? "✓" : i === at ? "…" : "·"} {s}</li>)}
        </ul>
        <p className="small muted">Everything runs in this tab: keep it open. Your video isn&apos;t uploaded anywhere
          {settings.transcriber === "openai" ? " (only its sound goes to OpenAI for the transcript)" : ""}.</p>
        {err && <div className="err">{err}</div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1>New video</h1>
      <p className="muted">Retakes and fumbles are fine: the editor picks your best takes.</p>
      {!hasKey && <div className="err">No AI editor yet: you&apos;ll get a simple cut with subtitles. <a href="#" onClick={onSettings}>Add your key</a> for
        best-take picking, pictures, music choices and your post caption.</div>}
      {!canListen && <div className="err">Listening needs an OpenAI key, or switch Listening to &quot;In my browser&quot; in <a href="#" onClick={onSettings}>Settings</a>.</div>}
      <div className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
        <p style={{ fontSize: 17, margin: "0 0 6px" }}>Drop your video here</p>
        <p className="small muted" style={{ margin: 0 }}>One or more takes (MP4, MOV, WebM). Add a song, pictures or clips too and the
          editor can use them.</p>
        <div className="row" style={{ justifyContent: "center", marginTop: 14 }}>
          <button onClick={() => input.current?.click()}>Choose files</button>
          <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={(e) => e.target.files && take(e.target.files)} />
        </div>
        <div className="files">
          {takes.map((f) => <span key={f.name} className="chip on">🎬 {f.name}</span>)}
          {extras.map((f) => <span key={f.name} className="chip">{kindOf(f) === "music" ? "🎵" : kindOf(f) === "image" ? "🖼" : "🎞"} {f.name}</span>)}
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" disabled={!takes.length || !canListen} onClick={go}>Make my reel</button>
        {(takes.length > 0 || extras.length > 0) && <button className="ghost" onClick={() => { setTakes([]); setExtras([]); }}>Clear</button>}
      </div>
      <p className="small muted" style={{ marginTop: 14 }}>The first video file is your take; later video files become b-roll clips. Only use
        music and pictures you own or are licensed to use.</p>
    </div>
  );
}
