"use client";
import { useEffect, useState } from "react";
import { writeScript } from "@/lib/ai";
import { deleteProject, listProjects, loadRules, saveRules } from "@/lib/store";
import type { Project, Settings, StyleRule } from "@/lib/types";

export function Home({ onOpen, onNew }: { onOpen: (p: Project) => void; onNew: () => void }) {
  const [ps, setPs] = useState<Project[] | null>(null);
  useEffect(() => { listProjects().then(setPs); }, []);
  if (!ps) return null;
  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>My videos</h1>
        <button className="primary" onClick={onNew}>New video</button>
      </div>
      {!ps.length && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Make your first reel</h2>
          <p className="muted">Drop in a raw talking-head video. The editor transcribes it, keeps your best take of every line, cuts the
            pauses, adds subtitles, a hook title, pictures, zooms and your music, picks a cover and writes your post caption. Then
            tell it what to change, in plain English.</p>
          <button className="primary" onClick={onNew}>Start</button>
        </div>
      )}
      <div className="grid" style={{ marginTop: 16 }}>
        {ps.map((p) => (
          <div key={p.id} className="card tile" onClick={() => onOpen(p)}>
            <b>{p.title.length > 34 ? p.title.slice(0, 31) + "…" : p.title}</b>
            <div style={{ margin: "6px 0" }}>
              <span className="badge">{p.status === "edited" ? `Ready · Version ${p.current}` : "Not finished"}</span>
            </div>
            <div className="small muted">{new Date(p.updatedAt).toLocaleString()}</div>
            <button className="small ghost" style={{ marginTop: 8 }} onClick={async (e) => {
              e.stopPropagation();
              if (confirm(`Delete "${p.title}" and all its versions from this browser?`)) { await deleteProject(p); setPs(await listProjects()); }
            }}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Script({ settings }: { settings: Settings }) {
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ hook: string; script: string; onScreenText: string[] } | null>(null);
  const [err, setErr] = useState("");
  const hasKey = settings.provider === "anthropic" ? !!settings.anthropicKey : !!settings.openaiKey;
  return (
    <div style={{ maxWidth: 760 }}>
      <h1>Write a script</h1>
      <p className="muted">Tell me what the video is about. You&apos;ll get a hook, what to say, and the words for the screen.</p>
      <textarea rows={4} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="e.g. how I cut my editing time from 3 hours to 20 minutes" />
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={!idea.trim() || busy || !hasKey} onClick={async () => {
          setBusy(true); setErr("");
          try { setRes(await writeScript(settings, idea, loadRules())); } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
          setBusy(false);
        }}>{busy ? "Writing…" : "Write my script"}</button>
        {!hasKey && <span className="small muted">Needs an API key (Settings).</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {res && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Hook</h2><p>{res.hook}</p>
          <h2>What to say</h2><p style={{ whiteSpace: "pre-wrap" }}>{res.script}</p>
          <h2>Words on screen</h2><ul>{res.onScreenText.map((t) => <li key={t}>{t}</li>)}</ul>
          <button onClick={() => navigator.clipboard.writeText(`${res.script}\n\nOn screen:\n${res.onScreenText.join("\n")}`)}>Copy</button>
        </div>
      )}
    </div>
  );
}

export function StyleRules() {
  const [rules, setRules] = useState<StyleRule[]>([]);
  useEffect(() => setRules(loadRules()), []);
  return (
    <div style={{ maxWidth: 680 }}>
      <h1>My style</h1>
      <p className="muted">When a note is a lasting preference (&quot;always use big subtitles&quot;), the editor asks to remember it. Remembered
        rules apply to every new video.</p>
      {!rules.length && <div className="card muted">Nothing yet.</div>}
      {rules.map((r) => (
        <div key={r.id} className="card row" style={{ marginTop: 8 }}>
          <span className="grow">{r.text}</span>
          <button className="small" onClick={() => { const n = rules.filter((x) => x.id !== r.id); saveRules(n); setRules(n); }}>Remove</button>
        </div>
      ))}
    </div>
  );
}
