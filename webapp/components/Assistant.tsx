"use client";
// The assistant on the side: asks once what you make, then coaches you (ideas for your next video, better edits, hooks,
// demos...) with your own AI, and tells you in plain words what's happening while a video, music or an export is made.
import { useEffect, useRef, useState } from "react";
import { aiReady, AiError } from "@/lib/ai";
import { askCoach, coachContext, KINDS, loadChat, loadCreator, saveChat, saveCreator, starters, type Activity, type Chat,
  type Creator, type Kind } from "@/lib/assistant";
import { listProjects, loadRules } from "@/lib/store";
import type { Project, Settings } from "@/lib/types";
import { Icon } from "./Icons";

export function Assistant({ settings, screen, project, onSettings }: { settings: Settings; screen: string; project?: Project | null;
  onSettings: () => void }) {
  const [open, setOpen] = useState(false);
  const [creator, setCreator] = useState<Creator | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Creator>({ kinds: [], about: "", goal: "" });
  const [chat, setChat] = useState<Chat[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<Activity | null>(null);       // what's happening right now
  const [bubble, setBubble] = useState<Activity | null>(null); // the same, next to the button while the panel is closed
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const c = loadCreator(); setCreator(c); setChat(loadChat());
    if (c) setDraft(c);
    const onAct = (ev: Event) => {
      const a = (ev as CustomEvent<Activity>).detail;
      setNow(a.pct >= 100 ? { ...a, friendly: a.friendly } : a);
      setBubble(a);
    };
    const onCreator = () => setCreator(loadCreator());
    window.addEventListener("cutmind:activity", onAct);
    window.addEventListener("cutmind:creator", onCreator);
    return () => { window.removeEventListener("cutmind:activity", onAct); window.removeEventListener("cutmind:creator", onCreator); };
  }, []);
  // the bubble steps back a while after the last update; the status line clears a little after "All done!"
  useEffect(() => { if (!bubble) return; const t = setTimeout(() => setBubble(null), bubble.pct >= 100 ? 4000 : 7000); return () => clearTimeout(t); }, [bubble]);
  useEffect(() => { if (!now || now.pct < 100) return; const t = setTimeout(() => setNow(null), 6000); return () => clearTimeout(t); }, [now]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [chat, open, busy]);
  useEffect(() => {
    if (!open) return;
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  const ready = aiReady(settings);
  const plan = settings.provider === "chat";
  const needsProfile = !creator || editing;

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const mine: Chat = { who: "me", text: question };
    const before = chat;
    setChat([...before, mine]); setText("");
    if (!ready) {
      const next = [...before, mine, { who: "coach" as const, text: "Connect an AI first (Settings → AI editor): an API key, or your Claude or ChatGPT plan by copy and paste. Then ask me again." }];
      setChat(next); saveChat(next); return;
    }
    setBusy(true);
    try {
      const ctx = coachContext(creator, await listProjects(), loadRules(), screen, project);
      const reply = await askCoach(settings, question, ctx, before);
      const next = [...before, mine, reply];
      setChat(next); saveChat(next);
    } catch (e) {
      const msg = e instanceof AiError ? e.userMessage : String((e as Error)?.message ?? e);
      const next = [...before, mine, { who: "coach" as const, text: `I couldn't answer that: ${msg}` }];
      setChat(next); saveChat(next);
    } finally { setBusy(false); }
  }

  function saveProfile() {
    if (!draft.kinds.length) return;
    saveCreator(draft); setCreator(draft); setEditing(false);
  }
  const toggleKind = (k: Kind) => setDraft((d) => ({ ...d, kinds: d.kinds.includes(k) ? d.kinds.filter((x) => x !== k) : [...d.kinds, k] }));

  return (<>
    {!open && bubble && (
      <button type="button" className="coach-bubble" onClick={() => setOpen(true)} aria-live="polite">
        <span className="spark-dot" aria-hidden="true" />{bubble.friendly}
      </button>
    )}
    <button type="button" className={`coach-fab${open ? " on" : ""}`} aria-expanded={open} aria-controls="coach"
      onClick={() => setOpen((o) => !o)}>
      <Icon name="spark" /><span>Assistant</span>{now && now.pct < 100 && <span className="spin" aria-hidden="true" />}
    </button>
    {open && (
      <aside id="coach" className="coach" aria-labelledby="coach-h">
        <div className="panel-head">
          <h2 id="coach-h">Your assistant</h2>
          <button type="button" className="btn ghost icon sm" aria-label="Close the assistant" onClick={() => setOpen(false)}>&times;</button>
        </div>
        {now && (
          <div className="coach-now" role="status">
            {now.pct < 100 ? <span className="spin" aria-hidden="true" /> : <Icon name="check" />}
            <span>{now.friendly}</span>
            {now.pct < 100 && <span className="coach-bar" aria-hidden="true"><i style={{ width: `${Math.max(3, now.pct)}%` }} /></span>}
          </div>
        )}
        {needsProfile ? (
          <div className="coach-profile">
            <p><b>What do you make?</b> Pick all that fit. I&apos;ll tailor my advice to it, and so will the AI editor&apos;s style.</p>
            <div className="chips" role="group" aria-label="What you make">
              {KINDS.map((k) => (
                <button key={k.id} type="button" className="chip" aria-pressed={draft.kinds.includes(k.id)} onClick={() => toggleKind(k.id)}>{k.label}</button>
              ))}
            </div>
            <label className="field"><span>About your channel or product <span className="faint">(optional)</span></span>
              <input className="input" value={draft.about} maxLength={200} placeholder="e.g. money tips for students, a habit-tracker app…"
                onChange={(e) => setDraft({ ...draft, about: e.target.value })} /></label>
            <label className="field"><span>Your goal right now <span className="faint">(optional)</span></span>
              <input className="input" value={draft.goal} maxLength={160} placeholder="e.g. 10k followers, a launch video by Friday…"
                onChange={(e) => setDraft({ ...draft, goal: e.target.value })} /></label>
            <div className="row">
              <button type="button" className="btn primary" disabled={!draft.kinds.length} onClick={saveProfile}>Save</button>
              {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(false); if (creator) setDraft(creator); }}>Cancel</button>}
            </div>
          </div>
        ) : (<>
          <p className="small muted coach-who">
            For {KINDS.filter((k) => creator!.kinds.includes(k.id)).map((k) => k.label).join(", ")}
            {creator!.goal && <>, aiming for {creator!.goal}</>}. <button type="button" className="linkish" onClick={() => setEditing(true)}>Change</button>
          </p>
          <div className="coach-log" ref={log}>
            {!chat.length && <p className="small muted">Ask me anything about editing or making videos: ideas, hooks, pacing, demos, growing an audience.
              {plan && " With your plan, each answer goes through the copy-and-paste window."}</p>}
            {chat.map((m, i) => (
              <div key={i} className={`coach-msg by-${m.who}`}>
                <p>{m.text}</p>
                {m.who === "coach" && i === chat.length - 1 && !!m.next?.length && (
                  <div className="chips">{m.next.map((n) => <button key={n} type="button" className="chip" onClick={() => void ask(n)}>{n}</button>)}</div>
                )}
              </div>
            ))}
            {busy && <div className="coach-msg by-coach"><p><span className="spin" aria-hidden="true" /> Thinking{plan ? " (answer in the copy-and-paste window)" : ""}…</p></div>}
          </div>
          {!ready && <div className="alert"><Icon name="alert" /><span>Connect an AI to chat: a key, or your Claude or ChatGPT plan.</span>
            <button type="button" className="btn sm" onClick={() => { setOpen(false); onSettings(); }}>Settings</button></div>}
          {!chat.length && <div className="chips">{starters(creator).map((q) => <button key={q} type="button" className="chip" onClick={() => void ask(q)}>{q}</button>)}</div>}
          <form className="coach-ask" onSubmit={(e) => { e.preventDefault(); void ask(text); }}>
            <label htmlFor="coach-q" className="sr-only">Ask your assistant</label>
            <textarea id="coach-q" className="textarea" rows={2} value={text} placeholder="Ask for ideas, feedback, a plan…"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(text); } }} />
            <button type="submit" className="btn primary" disabled={!text.trim() || busy}>Ask</button>
          </form>
          {chat.length > 0 && <button type="button" className="linkish small" onClick={() => { setChat([]); saveChat([]); }}>Clear the chat</button>}
        </>)}
      </aside>
    )}
  </>);
}
