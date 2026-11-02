"use client";
import { useState } from "react";
import { listModels } from "@/lib/ai";
import type { Settings as S } from "@/lib/types";

export function Settings({ settings, onSave }: { settings: S; onSave: (s: S) => void }) {
  const [s, setS] = useState<S>(settings);
  const [models, setModels] = useState<{ anthropic: string[]; openai: string[] }>({ anthropic: [], openai: [] });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: Partial<S>) => setS({ ...s, ...k });

  async function check(provider: S["provider"]) {
    setMsg(null);
    const key = provider === "anthropic" ? s.anthropicKey : s.openaiKey;
    if (!key) return setMsg({ ok: false, text: "Paste a key first." });
    try {
      const r = await listModels(provider, key);
      setModels((m) => ({ ...m, [provider]: r.models }));
      const cur = provider === "anthropic" ? s.anthropicModel : s.openaiModel;
      if (r.suggested && (!cur || !r.models.includes(cur))) set(provider === "anthropic" ? { anthropicModel: r.suggested } : { openaiModel: r.suggested });
      setMsg({ ok: true, text: `Key works. ${r.models.length} models available.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as { userMessage?: string }).userMessage ?? String(e) });
    }
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <h1>Settings</h1>
      <p className="muted">Your AI editor runs on your own API key. Keys stay in this browser and go only to Anthropic or
        OpenAI: this site's server never sees them, and your videos never leave your computer.</p>

      <div className="card">
        <h2>AI editor</h2>
        <div className="row">
          {(["anthropic", "openai"] as const).map((p) => (
            <button key={p} className={s.provider === p ? "primary" : ""} onClick={() => set({ provider: p })}>
              {p === "anthropic" ? "Anthropic" : "OpenAI"}
            </button>
          ))}
        </div>

        <label>Anthropic API key {s.provider === "anthropic" && <b style={{ color: "var(--accent-2)" }}>(editor)</b>}</label>
        <div className="row">
          <input className="grow" type="password" autoComplete="off" placeholder="sk-ant-..." value={s.anthropicKey}
            onChange={(e) => set({ anthropicKey: e.target.value.trim() })} style={{ width: "auto" }} />
          <button onClick={() => check("anthropic")}>Check</button>
        </div>
        <label>Anthropic model</label>
        {models.anthropic.length ? (
          <select value={s.anthropicModel} onChange={(e) => set({ anthropicModel: e.target.value })}>
            {models.anthropic.map((m) => <option key={m}>{m}</option>)}
          </select>
        ) : <input value={s.anthropicModel} onChange={(e) => set({ anthropicModel: e.target.value })} />}

        <label>OpenAI API key {s.provider === "openai" && <b style={{ color: "var(--accent-2)" }}>(editor)</b>}</label>
        <div className="row">
          <input className="grow" type="password" autoComplete="off" placeholder="sk-..." value={s.openaiKey}
            onChange={(e) => set({ openaiKey: e.target.value.trim() })} style={{ width: "auto" }} />
          <button onClick={() => check("openai")}>Check</button>
        </div>
        <label>OpenAI model</label>
        {models.openai.length ? (
          <select value={s.openaiModel} onChange={(e) => set({ openaiModel: e.target.value })}>
            {models.openai.map((m) => <option key={m}>{m}</option>)}
          </select>
        ) : <input placeholder="press Check to pick from your models" value={s.openaiModel} onChange={(e) => set({ openaiModel: e.target.value })} />}
        {msg && <div className={msg.ok ? "ok" : "err"}>{msg.text}</div>}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Listening (speech to text)</h2>
        <div className="row">
          <button className={s.transcriber === "openai" ? "primary" : ""} onClick={() => set({ transcriber: "openai" })}>OpenAI (fast)</button>
          <button className={s.transcriber === "browser" ? "primary" : ""} onClick={() => set({ transcriber: "browser" })}>In my browser (free)</button>
        </div>
        <p className="small muted">OpenAI is fast and accurate (needs the OpenAI key, about $0.006 a minute).
          &quot;In my browser&quot; listens on your computer: free and private, one ~150 MB download, slower. Anthropic keys
          don&apos;t include speech-to-text, so with only an Anthropic key use &quot;In my browser&quot;.</p>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <label className="row" style={{ color: "var(--fg)", fontSize: 15 }}>
          <input type="checkbox" checked={s.rememberKeys} style={{ width: "auto" }} onChange={(e) => set({ rememberKeys: e.target.checked })} />
          Remember my keys on this computer
        </label>
        <p className="small muted">Off: keys are forgotten when you close this tab. On: kept in this browser&apos;s storage
          (don&apos;t turn it on for a shared computer).</p>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="primary" onClick={() => { onSave(s); setMsg({ ok: true, text: "Saved." }); }}>Save settings</button>
      </div>
    </div>
  );
}
