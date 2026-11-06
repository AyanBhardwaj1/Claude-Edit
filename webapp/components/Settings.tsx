"use client";
import { useEffect, useState } from "react";
import { listModels } from "@/lib/ai";
import { accountMode, AuthError, changePassword, rename, type Mode, type User } from "@/lib/auth";
import { brandOf } from "@/lib/brand";
import { effortOf } from "@/lib/effort";
import { uid } from "@/lib/media";
import { getMedia, putMedia } from "@/lib/store";
import { THEMES, type ThemeId } from "@/lib/theme";
import { estimate, estimateText } from "@/lib/timings";
import type { Brand, Settings as S } from "@/lib/types";
import { EffortPicker } from "./EffortPicker";
import { Icon } from "./Icons";

type Note = { ok: boolean; text: string } | null;

export function Settings({ settings, user, theme, onTheme, onUser, onSignOut, onSave }: { settings: S; user: User; theme: ThemeId;
  onTheme: (t: ThemeId) => void; onUser: (u: User) => void; onSignOut: () => void; onSave: (s: S) => void }) {
  const [s, setS] = useState<S>(settings);
  const [models, setModels] = useState<{ anthropic: string[]; openai: string[] }>({ anthropic: [], openai: [] });
  const [checking, setChecking] = useState<S["provider"] | null>(null);
  const [msg, setMsg] = useState<Note>(null);
  const [saved, setSaved] = useState<Note>(null);
  const [show, setShow] = useState({ anthropic: false, openai: false });
  const [name, setName] = useState(user.name);
  const [acct, setAcct] = useState<Note>(null);
  const [pw, setPw] = useState({ cur: "", next: "" });
  const [pwMsg, setPwMsg] = useState<Note>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const [where, setWhere] = useState<Mode>("local");
  useEffect(() => { void accountMode().then(setWhere); }, []);
  const set = (k: Partial<S>) => { setS({ ...s, ...k }); setSaved(null); };
  const dirty = JSON.stringify(s) !== JSON.stringify(settings);
  const b = brandOf(s.brand);
  const setB = (k: Partial<Brand>) => set({ brand: { ...b, ...k } });
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    if (b.logo) void getMedia(b.logo).then((blob) => { if (blob) { u = URL.createObjectURL(blob); setLogoUrl(u); } });
    else setLogoUrl(null);
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [b.logo]);

  async function check(provider: S["provider"]) {
    setMsg(null);
    const key = provider === "anthropic" ? s.anthropicKey : s.openaiKey;
    if (!key) return setMsg({ ok: false, text: "Paste a key first, then check it." });
    setChecking(provider);
    try {
      const r = await listModels(provider, key);
      setModels((m) => ({ ...m, [provider]: r.models }));
      const cur = provider === "anthropic" ? s.anthropicModel : s.openaiModel;
      if (r.suggested && (!cur || !r.models.includes(cur))) set(provider === "anthropic" ? { anthropicModel: r.suggested } : { openaiModel: r.suggested });
      setMsg({ ok: true, text: `Key works. ${r.models.length} models available. Save settings to use it.` });
    } catch (e) {
      setMsg({ ok: false, text: (e as { userMessage?: string }).userMessage ?? String(e) });
    }
    setChecking(null);
  }

  const keyField = (p: S["provider"]) => {
    const label = p === "anthropic" ? "Anthropic" : "OpenAI";
    const val = p === "anthropic" ? s.anthropicKey : s.openaiKey;
    const list = models[p];
    const model = p === "anthropic" ? s.anthropicModel : s.openaiModel;
    return (
      <div className="stack tight">
        <div className="field">
          <label htmlFor={`${p}-key`}>{label} API key {s.provider === p && <span className="badge good">Your editor</span>}</label>
          <div className="key-row">
            <input id={`${p}-key`} name={`${p}-key`} className="input" type={show[p] ? "text" : "password"} autoComplete="off" spellCheck={false}
              placeholder={p === "anthropic" ? "sk-ant-…" : "sk-…"} value={val}
              onChange={(e) => set(p === "anthropic" ? { anthropicKey: e.target.value.trim() } : { openaiKey: e.target.value.trim() })} />
            <button className="btn icon" aria-label={show[p] ? `Hide ${label} key` : `Show ${label} key`} onClick={() => setShow({ ...show, [p]: !show[p] })}>
              <Icon name={show[p] ? "eyeOff" : "eye"} /></button>
            <button className="btn" onClick={() => check(p)} disabled={checking === p}>{checking === p ? <><span className="spin" />Checking…</> : "Check key"}</button>
          </div>
        </div>
        <div className="field">
          <label htmlFor={`${p}-model`}>{label} model</label>
          {list.length ? (
            <select id={`${p}-model`} className="select" value={model} onChange={(e) => set(p === "anthropic" ? { anthropicModel: e.target.value } : { openaiModel: e.target.value })}>
              {list.map((m) => <option key={m}>{m}</option>)}
            </select>
          ) : <input id={`${p}-model`} className="input" spellCheck={false} autoComplete="off" placeholder="Press Check key to pick from your models…" value={model}
              onChange={(e) => set(p === "anthropic" ? { anthropicModel: e.target.value } : { openaiModel: e.target.value })} />}
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p>Your account, the look of the app, and the AI editor that runs on your own key.</p></div></div>
      <div className="set-grid">
        <section className="set-sec" aria-labelledby="look-h">
          <div><h2 id="look-h">Look</h2><p>Five looks for the whole app. Your choice is kept on this device.</p></div>
          <div className="themes" role="group" aria-label="Look">
            {THEMES.map((t) => (
              <button key={t.id} className="theme-card" aria-pressed={theme === t.id} onClick={() => onTheme(t.id)}>
                <span className="mini" data-theme={t.id} aria-hidden="true">
                  <span className="ms"><i /><i /><i /><i /></span>
                  <span className="mm"><b>Good evening</b><span>3 reels made</span><em>New video</em></span>
                </span>
                <span className="tn">{t.name}{theme === t.id && <Icon name="check" />}</span>
                <span className="tl">{t.line}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="set-sec" aria-labelledby="brand-h">
          <div><h2 id="brand-h">Brand</h2><p>Your colours, font, logo and handle. They power the brand style in the editor, a corner watermark and the Brand
            colours in Animate. Save settings to keep them.</p></div>
          <div className="stack">
            <div className="row">
              <div className="field grow"><label htmlFor="b-name">Brand or channel name</label>
                <input id="b-name" className="input" value={b.name} autoComplete="organization" onChange={(e) => setB({ name: e.target.value.slice(0, 40) })} placeholder="Northside Coffee…" /></div>
              <div className="field grow"><label htmlFor="b-handle">Handle</label>
                <input id="b-handle" className="input" value={b.handle} spellCheck={false} autoComplete="off" onChange={(e) => setB({ handle: e.target.value.replace(/\s+/g, "").slice(0, 30) })} placeholder="@northside…" /></div>
            </div>
            <div className="row">
              <div className="field"><label htmlFor="b-acc">Main colour</label><input id="b-acc" type="color" className="color big" value={b.accent} onChange={(e) => setB({ accent: e.target.value })} /></div>
              <div className="field"><label htmlFor="b-acc2">Second colour</label><input id="b-acc2" type="color" className="color big" value={b.accent2} onChange={(e) => setB({ accent2: e.target.value })} /></div>
              <div className="field grow"><label htmlFor="b-font">Font (any Google Font)</label>
                <input id="b-font" className="input" list="b-fonts" value={b.font} onChange={(e) => setB({ font: e.target.value.slice(0, 40) })}
                  onBlur={(e) => { const n = e.target.value; if (n && !document.querySelector(`link[data-font="${n}"]`)) { const l = document.createElement("link"); l.rel = "stylesheet";
                    l.dataset.font = n; l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(n)}:wght@500;700;800;900&display=swap`; document.head.appendChild(l); } }} />
                <datalist id="b-fonts">{["Montserrat", "Bricolage Grotesque", "Fraunces", "Plus Jakarta Sans", "Inter", "Poppins", "Anton", "Bebas Neue", "Archivo Black", "DM Serif Display"].map((f) => <option key={f} value={f} />)}</datalist></div>
            </div>
            <div className="brand-preview" style={{ fontFamily: `"${b.font}", Montserrat, sans-serif` }}>
              {logoUrl && <img src={logoUrl} alt="Your logo" width={48} height={48} />}
              <span><b style={{ color: b.accent }}>{b.name || "Your brand"}</b> <em style={{ background: b.accent2 }}>{b.handle || "@handle"}</em></span>
            </div>
            <div className="row">
              <label className="btn"><Icon name="image" />{b.logo ? "Change logo" : "Add a logo"}
                <input type="file" accept="image/png,image/svg+xml,image/webp,image/jpeg" className="sr-only" onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return; const key = `brand:${uid()}`; await putMedia(key, f); setB({ logo: key }); }} /></label>
              {b.logo && <button className="btn ghost" onClick={() => setB({ logo: undefined })}>Remove logo</button>}
            </div>
            <label className="check"><input type="checkbox" checked={b.watermark} onChange={(e) => setB({ watermark: e.target.checked })} />
              <span>Put my logo and handle in the corner of every video<span className="hint block">A transparent PNG logo looks best. The logo stays on this
                device; your colours, font and handle follow your account.</span></span></label>
            <div className="row"><button className="btn primary" disabled={!dirty} onClick={() => { onSave(s); setSaved({ ok: true, text: "Settings saved." }); }}>Save settings</button>
              {saved && <span className="small say-ok" role="status">{saved.text}</span>}</div>
          </div>
        </section>

        <section className="set-sec" aria-labelledby="ai-h">
          <div><h2 id="ai-h">AI editor</h2><p>Keys go straight from this browser to Anthropic or OpenAI. Cutmind&apos;s server never sees them, and your videos never
            leave your computer.</p></div>
          <div className="stack">
            <div className="field"><span className="label">Who edits your videos</span>
              <div className="seg" role="group" aria-label="Who edits your videos">
                {(["anthropic", "openai"] as const).map((p) => (
                  <button key={p} aria-pressed={s.provider === p} onClick={() => set({ provider: p })}>{p === "anthropic" ? "Anthropic" : "OpenAI"}</button>))}
              </div>
            </div>
            {keyField("anthropic")}
            {keyField("openai")}
            {msg && <div className={`alert ${msg.ok ? "ok" : "err"}`} role="status"><Icon name={msg.ok ? "check" : "alert"} /><span>{msg.text}</span></div>}
          </div>
        </section>

        <section className="set-sec" aria-labelledby="effort-h">
          <div><h2 id="effort-h">Speed vs quality</h2><p>How much time the editor takes on a new video. You can still pick for each video. Times are
            learned from the videos you make on this device.</p></div>
          <div className="stack">
            <EffortPicker legend="Default speed vs quality" value={effortOf(s)} onChange={(effort) => set({ effort })} time={(e) => {
              const est = estimate(e, 60, { transcriber: s.transcriber, ai: !!(s.provider === "anthropic" ? s.anthropicKey : s.openaiKey) });
              return estimateText(est, "for a 1-min video");
            }} />
            <div className="row">
              <button className="btn primary" disabled={!dirty} onClick={() => { onSave(s); setSaved({ ok: true, text: "Settings saved." }); }}>Save settings</button>
              {saved && <span className="small say-ok" role="status">{saved.text}</span>}
              {dirty && !saved && <span className="small faint">Unsaved changes</span>}
            </div>
          </div>
        </section>

        <section className="set-sec" aria-labelledby="listen-h">
          <div><h2 id="listen-h">Listening</h2><p>How Cutmind turns your speech into a word-timed transcript.</p></div>
          <div className="stack">
            <div className="seg" role="group" aria-label="Listening">
              <button aria-pressed={s.transcriber === "openai"} onClick={() => set({ transcriber: "openai" })}>OpenAI (fast)</button>
              <button aria-pressed={s.transcriber === "browser"} onClick={() => set({ transcriber: "browser" })}>In my browser (free)</button>
            </div>
            <p className="small muted">OpenAI is fast and accurate (needs the OpenAI key, about $0.006 a minute). &ldquo;In my browser&rdquo; listens on your
              computer: free and private, one download of about 150&nbsp;MB, slower. Anthropic keys don&apos;t include speech to text, so with only an
              Anthropic key use &ldquo;In my browser&rdquo;.</p>
            <label className="check"><input type="checkbox" checked={s.rememberKeys} onChange={(e) => set({ rememberKeys: e.target.checked })} />
              <span>Remember my keys on this computer<span className="hint block">Off: keys are forgotten when you close this tab.
                On: kept in this browser&apos;s storage. Don&apos;t turn it on for a shared computer.</span></span></label>
            <div className="row">
              <button className="btn primary" disabled={!dirty} onClick={() => { onSave(s); setSaved({ ok: true, text: "Settings saved." }); }}>Save settings</button>
              {saved && <span className="small say-ok" role="status">{saved.text}</span>}
              {dirty && !saved && <span className="small faint">Unsaved changes</span>}
            </div>
          </div>
        </section>

        <section className="set-sec" aria-labelledby="acct-h">
          <div><h2 id="acct-h">Account</h2><p>{where === "server" ? "Your account works on any device: your settings, style and look follow you. Videos and API keys stay in each browser."
            : "Your account lives in this browser and keeps your videos, keys and style apart from anyone else who uses it."}</p></div>
          <div className="stack">
            <form className="stack" onSubmit={async (e) => { e.preventDefault(); try { onUser(await rename(user.id, name)); setAcct({ ok: true, text: "Name saved." }); }
              catch (err) { setAcct({ ok: false, text: (err as Error).message }); } }}>
              <div className="field"><label htmlFor="acct-name">Name</label>
                <input id="acct-name" name="name" className="input" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setAcct(null); }} /></div>
              <div className="field"><label htmlFor="acct-email">Email</label>
                <input id="acct-email" className="input" type="email" value={user.email} readOnly spellCheck={false} /></div>
              <div className="row"><button className="btn" disabled={name.trim() === user.name}>Save name</button>
                {acct && <span className={`small ${acct.ok ? "say-ok" : "say-bad"}`} role="status">{acct.text}</span>}</div>
            </form>
            <form className="stack" onSubmit={async (e) => {
              e.preventDefault(); setPwBusy(true); setPwMsg(null);
              try { await changePassword(user.id, pw.cur, pw.next); setPw({ cur: "", next: "" }); setPwMsg({ ok: true, text: "Password changed." }); }
              catch (err) { setPwMsg({ ok: false, text: err instanceof AuthError ? err.message : String(err) }); }
              setPwBusy(false);
            }}>
              <input type="email" name="email" autoComplete="username" value={user.email} readOnly hidden />
              <div className="field"><label htmlFor="pw-cur">Current password</label>
                <input id="pw-cur" name="current-password" className="input" type="password" autoComplete="current-password" value={pw.cur}
                  onChange={(e) => setPw({ ...pw, cur: e.target.value })} /></div>
              <div className="field"><label htmlFor="pw-new">New password</label>
                <input id="pw-new" name="new-password" className="input" type="password" autoComplete="new-password" value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })} />
                <span className="hint">At least 8 characters, with a number or a symbol.</span></div>
              <div className="row"><button className="btn" disabled={!pw.cur || !pw.next || pwBusy}>{pwBusy ? <><span className="spin" />Changing…</> : "Change password"}</button>
                {pwMsg && <span className={`small ${pwMsg.ok ? "say-ok" : "say-bad"}`} role="status">{pwMsg.text}</span>}</div>
            </form>
            <div><button className="btn danger" onClick={onSignOut}><Icon name="out" />Sign out</button></div>
          </div>
        </section>
      </div>
    </div>
  );
}
