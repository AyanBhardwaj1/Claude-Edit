"use client";
import { useEffect, useState } from "react";
import { writeScript } from "@/lib/ai";
import { loadRules, saveLastScript, saveRules } from "@/lib/store";
import type { Settings, StyleRule } from "@/lib/types";
import { Icon } from "./Icons";

const IDEAS = ["How I cut my editing time from 3 hours to 20 minutes", "The one setting that made my videos look expensive",
  "3 things I wish I knew before posting my first reel"];

export function Script({ settings }: { settings: Settings }) {
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ hook: string; script: string; onScreenText: string[] } | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const hasKey = settings.provider === "anthropic" ? !!settings.anthropicKey : !!settings.openaiKey;
  async function go() {
    setBusy(true); setErr("");
    try { const r = await writeScript(settings, idea, loadRules()); setRes(r); saveLastScript(`${r.hook}\n\n${r.script}`); } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
    setBusy(false);
  }
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>Write a script</h1><p>Say what the video is about. You get a hook, what to say, and the words for the screen,
        in your voice and your saved style.</p></div></div>
      <section className="panel stack">
        <div className="field">
          <label htmlFor="idea">What&apos;s the video about?</label>
          <textarea id="idea" className="textarea" rows={4} value={idea} onChange={(e) => setIdea(e.target.value)}
            placeholder="e.g. how I cut my editing time from 3 hours to 20 minutes…" />
        </div>
        <div className="chips" aria-label="Ideas to start from">
          {IDEAS.map((i) => <button key={i} className="chip" onClick={() => setIdea(i)}>{i}</button>)}
        </div>
        <div className="row">
          <button className="btn primary" disabled={!idea.trim() || busy || !hasKey} onClick={go}>
            {busy ? <><span className="spin" />Writing…</> : <><Icon name="pen" />Write my script</>}</button>
          {!hasKey && <span className="small muted">Needs an API key. Add one in Settings.</span>}
        </div>
        {err && <div className="alert err" role="alert"><Icon name="alert" /><span>{err}</span></div>}
      </section>
      {busy && !res && <div className="skel skel-script mt-16" aria-hidden="true" />}
      {res && (
        <section className="panel script-out mt-16" aria-live="polite">
          <div><h2 className="faint">Hook</h2><p className="hook">{res.hook}</p></div>
          <div><h2 className="faint">What to say</h2><p className="pre mt-6">{res.script}</p></div>
          <div><h2 className="faint">Words on screen</h2><ul className="onscreen mt-8">{res.onScreenText.map((t) => <li key={t}>{t}</li>)}</ul></div>
          <div className="row">
            <button className="btn" onClick={async () => { await navigator.clipboard.writeText(`${res.hook}\n\n${res.script}\n\nOn screen:\n${res.onScreenText.join("\n")}`); setCopied(true); }}>
              <Icon name="copy" />{copied ? "Copied" : "Copy script"}</button>
            <button className="btn ghost" onClick={go} disabled={busy}>Write another</button>
          </div>
        </section>
      )}
    </div>
  );
}

export function StyleRules() {
  const [rules, setRules] = useState<StyleRule[]>([]);
  const [text, setText] = useState("");
  useEffect(() => setRules(loadRules()), []);
  const save = (n: StyleRule[]) => { saveRules(n); setRules(n); };
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>My style</h1><p>Rules your editor follows on every new video. When a note is a lasting preference, like
        &ldquo;always use big subtitles&rdquo;, your editor offers to remember it here.</p></div></div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); const t = text.trim(); if (!t) return;
        save([...rules, { id: Math.random().toString(36).slice(2), text: t, at: new Date().toISOString() }]); setText(""); }}>
        <label className="sr-only" htmlFor="rule">New rule</label>
        <input id="rule" className="input grow" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off"
          placeholder="Add a rule, e.g. “Keep music quieter under talking.”…" />
        <button className="btn primary" disabled={!text.trim()}><Icon name="plus" />Add rule</button>
      </form>
      <div className="stack tight mt-16">
        {!rules.length && <div className="empty"><h2>Nothing learned yet</h2><p>Leave notes on your videos. Anything you&apos;d want on every video becomes a
          rule here, and your first edits start to look like your own.</p></div>}
        {rules.map((r) => (
          <div key={r.id} className="rule">
            <Icon name="spark" />
            <span className="grow">{r.text}</span>
            <span className="small faint">{new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(r.at))}</span>
            <button className="btn ghost sm" onClick={() => save(rules.filter((x) => x.id !== r.id))}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
