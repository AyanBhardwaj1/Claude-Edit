"use client";
// "Your Claude or ChatGPT plan": every AI step shows its request here to copy into the user's own chat (claude.ai,
// chatgpt.com, any chat AI), and takes the answer pasted back. One request at a time; a second waits its turn.
import { useEffect, useRef, useState } from "react";
import { AiError } from "@/lib/ai";
import { fitAnswer, missingParts, offShape, parseRelayAnswer, relayPrompt, relayReminder, setRelay, type RelayAsk } from "@/lib/relay";
import { Icon } from "./Icons";

type Json = Record<string, unknown>;
const CHAT_KEY = "cutmind.relay.chat";
type Pending = { ask: RelayAsk; text: string; done: (v: Json) => void; fail: (e: Error) => void };

const WHAT: Record<string, string> = { submit_edit: "the edit", submit_script: "your script", submit_hooks: "hook ideas",
  submit_titles: "chapter titles", submit_clips: "the best clips", submit_animation: "the animation's scenes",
  submit_lines: "the translation" };

export function Relay() {
  const ref = useRef<HTMLDialogElement>(null);
  const queue = useRef<Pending[]>([]);
  const [cur, setCur] = useState<Pending | null>(null);
  const [answer, setAnswer] = useState("");
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);   // parts the pasted reply lacked
  const [remCopied, setRemCopied] = useState(false);
  useEffect(() => setRemCopied(false), [missing]);
  const [fav, setFav] = useState<"claude" | "chatgpt">("claude");      // the chat you used last goes first
  useEffect(() => { try { if (localStorage.getItem(CHAT_KEY) === "chatgpt") setFav("chatgpt"); } catch { /* storage blocked */ } }, []);

  useEffect(() => {
    setRelay((ask) => new Promise<Json>((done, fail) => {
      const p: Pending = { ask, text: relayPrompt(ask), done, fail };
      queue.current.push(p);
      setCur((c) => c ?? queue.current[0]);
    }));
    return () => {
      setRelay(null);
      for (const p of queue.current) p.fail(new AiError("closed", "The copy-and-paste window closed, so I stopped there."));
      queue.current = [];
    };
  }, []);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (cur && !d.open) d.showModal();
    if (!cur && d.open) d.close();
    setAnswer(""); setErr(""); setCopied(false); setMissing([]);
  }, [cur]);

  function next() {
    queue.current.shift();
    setCur(queue.current[0] ?? null);
  }
  function cancel() {
    if (!cur) return;
    cur.fail(new AiError("cancelled", "You closed the copy-and-paste window, so nothing changed."));
    next();
  }
  function use() {
    if (!cur) return;
    const v = parseRelayAnswer(answer);
    if (!v) { setErr("I couldn't find the answer's JSON in that. Copy the whole reply (the chat's copy button under it works best) and paste it again."); setMissing([]); return; }
    const fit = fitAnswer(cur.ask.schema, v);
    const gone = missingParts(cur.ask.schema, fit);
    if (offShape(cur.ask.schema, fit)) {   // the chat answered in its own shape: say what's missing, offer a message back
      setMissing(gone);
      setErr(`That reply isn't in the asked-for shape (no ${gone.map((k) => `“${k}”`).join(", ") || "asked-for fields"}). Copy the reminder, send it in the same chat, then paste its new reply here.`);
      return;
    }
    cur.done(fit);
    next();
  }
  async function copy(): Promise<boolean> {
    if (!cur) return false;
    try { await navigator.clipboard.writeText(cur.text); setCopied(true); return true; }
    catch {
      const t = document.getElementById("relay-req") as HTMLTextAreaElement | null;
      t?.closest("details")?.setAttribute("open", ""); t?.focus(); t?.select();
      return false;
    }
  }
  async function copyReminder() {
    if (!cur || !missing.length) return;
    try { await navigator.clipboard.writeText(relayReminder(cur.ask, missing)); setRemCopied(true); }
    catch { setErr(`Tell the chat: “Your answer is missing ${missing.join(", ")}: reply again with one JSON object in the shape I asked for.”`); }
  }
  // copy, then open the chat in a new tab: the request is on the clipboard, ready to paste
  async function copyAndOpen(url: string) {
    const copying = copy();                                 // started while this tab still has focus
    const tab = window.open(url, "_blank");                 // inside the click, so pop-up blockers allow it
    if (tab) tab.opener = null;                             // the chat tab can't reach back into Cutmind
    try { localStorage.setItem(CHAT_KEY, url.includes("chatgpt") ? "chatgpt" : "claude"); setFav(url.includes("chatgpt") ? "chatgpt" : "claude"); } catch { /* storage blocked */ }
    const ok = await copying;
    if (!ok) setErr("The request didn't copy: select it under “Show it” and copy it by hand, then paste it in the chat.");
    else if (!tab) setErr("Your browser blocked the new tab: open the chat yourself, the request is copied.");
  }
  // the reply from the clipboard in one click (the browser may ask first); if it won't, the box takes Cmd/Ctrl+V
  async function pasteReply() {
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) { setAnswer(t); setErr(""); setMissing([]); return; }
    } catch { /* not allowed here */ }
    document.getElementById("relay-ans")?.focus();
  }
  function download() {
    if (!cur) return;
    const url = URL.createObjectURL(new Blob([cur.text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url; a.download = `cutmind-request-${cur.ask.name.replace(/^submit_/, "")}.txt`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const words = cur ? Math.round(cur.text.split(/\s+/).length / 100) * 100 : 0;
  return (
    <dialog ref={ref} className="relay" aria-labelledby="relay-h" onCancel={(ev) => { ev.preventDefault(); cancel(); }}>
      {cur && (<>
        <div className="panel-head"><h2 id="relay-h">Ask your AI plan for {WHAT[cur.ask.name] ?? "the next step"}</h2>
          <button className="btn ghost icon sm" aria-label="Stop and close" onClick={cancel}>&times;</button></div>
        <ol className="relay-steps">
          <li><span><b>Copy the request</b> <span className="muted small">(about {words.toLocaleString()} words)</span></span>
            <div className="row">
              {(fav === "claude" ? ["claude", "chatgpt"] : ["chatgpt", "claude"]).map((c, i) => (
                <button key={c} type="button" className={`btn sm${i === 0 ? " primary" : ""}`}
                  onClick={() => void copyAndOpen(c === "claude" ? "https://claude.ai/new" : "https://chatgpt.com/")}>
                  <Icon name="copy" />Copy &amp; open {c === "claude" ? "Claude" : "ChatGPT"}</button>))}
              <button type="button" className="btn ghost sm" onClick={() => void copy()}>{copied ? "Copied" : "Just copy"}</button>
              {words > 3000 && <button type="button" className="btn ghost sm" onClick={download}><Icon name="download" />As a .txt file</button>}
              <details className="relay-show"><summary className="small">Show it</summary>
                <textarea id="relay-req" className="textarea mono" readOnly rows={6} value={cur.text} aria-label="The request to copy" /></details>
            </div></li>
          <li><span><b>Paste it into a new chat</b> on your plan and send it (claude.ai, chatgpt.com or any chat AI).
            {words > 3000 && " A long request pastes as an attachment, or attach the .txt file: either works."}</span></li>
          <li><span className="row"><label htmlFor="relay-ans"><b>Paste its whole reply here</b></label>
            <button type="button" className="btn ghost sm" onClick={() => void pasteReply()}><Icon name="paperclip" />Paste the reply</button></span>
            <textarea id="relay-ans" className="textarea mono" rows={5} placeholder='{ "keep": [ … ] … }' value={answer}
              onChange={(e) => { setAnswer(e.target.value); setErr(""); setMissing([]); }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && answer.trim()) { e.preventDefault(); use(); } }}
              aria-describedby="relay-ans-hint" />
            <span id="relay-ans-hint" className="hint">Ctrl or ⌘ + Enter uses it.</span></li>
        </ol>
        {err && <div className="alert err" role="alert"><Icon name="alert" /><span>{err}</span>
          {missing.length > 0 && <button type="button" className="btn sm" onClick={() => void copyReminder()}><Icon name="copy" />{remCopied ? "Reminder copied" : "Copy the reminder"}</button>}</div>}
        <div className="row relay-actions">
          <button type="button" className="btn ghost" onClick={cancel}>Stop</button>
          <button type="button" className="btn primary" disabled={!answer.trim()} onClick={use}>Use this answer</button>
        </div>
        {queue.current.length > 1 && <p className="small muted">{queue.current.length - 1} more after this one.</p>}
      </>)}
    </dialog>
  );
}
