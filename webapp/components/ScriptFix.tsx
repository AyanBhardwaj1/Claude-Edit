"use client";
import { useEffect, useState } from "react";
import { applyScript, restoreHeard } from "@/lib/retext";
import { lastScript, saveProject } from "@/lib/store";
import type { Project } from "@/lib/types";
import { Icon } from "./Icons";

/** "Paste your script" in Edit it myself → Subtitles: the script's words on the timing it heard (lib/retext.ts). */
export function ScriptFix({ project: p, onChange }: { project: Project; onChange: () => void }) {
  const [text, setText] = useState(p.script ?? "");
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState("");
  useEffect(() => { setMine(lastScript()); }, []);
  const using = !!p.wordsHeard;

  async function fix() {
    setBusy(true);
    const r = applyScript(p, text);
    if (r.ok) { await saveProject(p); onChange(); }
    setRes(r);
    setBusy(false);
  }
  async function heard() {
    restoreHeard(p);
    await saveProject(p);
    onChange();
    setRes({ ok: true, message: "Back to the words as I heard them." });
  }

  return (
    <div className="field script-fix">
      <label htmlFor="script-paste">Paste your script</label>
      <span className="hint" id="script-hint">Names and brand words come out right in your subtitles. The timing stays exactly as I heard it, and words you
        added on the day stay in.</span>
      <textarea id="script-paste" className="textarea" rows={5} value={text} aria-describedby="script-hint" spellCheck={false}
        onChange={(ev) => setText(ev.target.value)} placeholder="Paste what you meant to say…" />
      <div className="row">
        <button className="btn" disabled={!text.trim() || busy} onClick={fix}><Icon name="check" />Fix the words</button>
        {using && <button className="btn ghost" onClick={heard}>Use what it heard</button>}
        {mine && text.trim() !== mine.trim() && <button className="link small" onClick={() => setText(mine)}>Use the script I wrote in Cutmind</button>}
      </div>
      <p role="status" aria-live="polite" className={res && !res.ok ? "field-error" : "small muted"}>
        {res ? res.message : using ? "Your subtitles use your script's words." : ""}</p>
    </div>
  );
}

/** The optional script box on the New video screen: used right after listening, before the first edit. */
export function ScriptBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [mine, setMine] = useState("");
  const [open, setOpen] = useState(!!value);
  useEffect(() => { setMine(lastScript()); }, []);
  return (
    <details className="script-box" open={open} onToggle={(ev) => setOpen((ev.currentTarget as HTMLDetailsElement).open)}>
      <summary><Icon name="pen" />Have a script? Paste it <span className="faint small">(optional)</span></summary>
      <div className="field mt-8">
        <label htmlFor="new-script" className="sr-only">Your script</label>
        <span className="hint" id="new-script-hint">Your subtitles get its spelling of names and brand words, on the timing of what you said.</span>
        <textarea id="new-script" className="textarea" rows={5} value={value} aria-describedby="new-script-hint" spellCheck={false}
          onChange={(ev) => onChange(ev.target.value)} placeholder="Paste what you meant to say…" />
        {mine && value.trim() !== mine.trim() && <p className="small"><button className="link" onClick={() => onChange(mine)}>Use the script I wrote in Cutmind</button></p>}
      </div>
    </details>
  );
}
