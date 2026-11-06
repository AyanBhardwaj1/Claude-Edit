"use client";
// "Your Claude or ChatGPT plan": every AI step shows its request here to copy into the user's own chat (claude.ai,
// chatgpt.com, any chat AI), and takes the answer pasted back. One request at a time; a second waits its turn.
import { useEffect, useRef, useState } from "react";
import { AiError } from "@/lib/ai";
import { parseRelayAnswer, relayPrompt, setRelay, type RelayAsk } from "@/lib/relay";
import { Icon } from "./Icons";

type Json = Record<string, unknown>;
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
    setAnswer(""); setErr(""); setCopied(false);
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
    if (!v) { setErr("I couldn't find the answer's JSON in that. Copy the whole reply (the chat's copy button under it works best) and paste it again."); return; }
    cur.done(v);
    next();
  }
  async function copy() {
    if (!cur) return;
    try { await navigator.clipboard.writeText(cur.text); setCopied(true); }
    catch { document.getElementById("relay-req")?.focus(); (document.getElementById("relay-req") as HTMLTextAreaElement | null)?.select(); }
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
              <button type="button" className="btn primary sm" onClick={() => void copy()}><Icon name="copy" />{copied ? "Copied" : "Copy request"}</button>
              <details><summary className="small">Show it</summary>
                <textarea id="relay-req" className="textarea mono" readOnly rows={6} value={cur.text} aria-label="The request to copy" /></details>
            </div></li>
          <li><span><b>Paste it into a new chat</b> on your plan and send it:{" "}
            <a href="https://claude.ai/new" target="_blank" rel="noreferrer">claude.ai</a>,{" "}
            <a href="https://chatgpt.com/" target="_blank" rel="noreferrer">chatgpt.com</a> or any chat AI.</span></li>
          <li><label htmlFor="relay-ans"><b>Paste its whole reply here</b></label>
            <textarea id="relay-ans" className="textarea mono" rows={5} placeholder='{ "keep": [ … ] … }' value={answer}
              onChange={(e) => { setAnswer(e.target.value); setErr(""); }} /></li>
        </ol>
        {err && <div className="alert err" role="alert"><Icon name="alert" /><span>{err}</span></div>}
        <div className="row relay-actions">
          <button type="button" className="btn ghost" onClick={cancel}>Stop</button>
          <button type="button" className="btn primary" disabled={!answer.trim()} onClick={use}>Use this answer</button>
        </div>
        {queue.current.length > 1 && <p className="small muted">{queue.current.length - 1} more after this one.</p>}
      </>)}
    </dialog>
  );
}
