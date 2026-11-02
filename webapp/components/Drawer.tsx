"use client";
import { useMemo, useState } from "react";
import { indexOf } from "@/lib/timeline";
import type { Broll, CaptionPreset, Edit, Project, Range } from "@/lib/types";

const TABS = ["Cut", "Subtitles", "Music", "Pictures", "Cover", "Post"] as const;
const LABEL: Record<string, string> = { "card-above-head": "Picture above your head", "side-card": "Picture beside you",
  "phone-card": "In a phone", "full-frame": "Full screen", "split-top": "Top half", "text-pop": "Words on screen" };

export function Drawer({ project: p, edit, onApply }: { project: Project; edit: Edit; onApply: (e: Edit, what: string) => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Cut");
  const [e, setE] = useState<Edit>(() => structuredClone(edit));
  const [picFor, setPicFor] = useState<string | null>(null);
  const idx = useMemo(() => indexOf(p.words), [p.words]);
  const kept = useMemo(() => {
    const s = new Set<string>();
    for (const r of e.keep) { const a = idx.get(r.from)!, b = idx.get(r.to)!; for (let i = a; i <= b; i++) s.add(p.words[i].id); }
    return s;
  }, [e.keep, idx, p.words]);
  const changed = JSON.stringify(e) !== JSON.stringify(edit);

  function toggleWord(id: string) {
    const next = new Set(kept);
    if (next.has(id)) next.delete(id); else next.add(id);
    // rebuild ranges in source order (re-ordering is the editor's job: keep it simple here)
    const keep: Range[] = [];
    p.words.forEach((w, i) => {
      if (!next.has(w.id)) return;
      const last = keep[keep.length - 1];
      if (last && idx.get(last.to) === i - 1 && p.words[i - 1].src === w.src) last.to = w.id; else keep.push({ from: w.id, to: w.id });
    });
    setE({ ...e, keep });
  }

  const music = p.library.filter((a) => a.kind === "music");
  const pictures = p.library.filter((a) => a.kind !== "music");
  const textOf = (r: Range) => { const a = idx.get(r.from)!, b = idx.get(r.to)!; return p.words.slice(a, b + 1).map((w) => w.w).join(" "); };

  return (
    <div>
      <div className="tabs">{TABS.map((t) => <button key={t} className={`tab ${t === tab ? "on" : ""}`} onClick={() => setTab(t)}>{t}</button>)}</div>

      {tab === "Cut" && (<>
        <p className="small muted">Crossed-out words are cut. Click a word to bring it back, or a kept word to cut it.</p>
        <label className="row" style={{ color: "var(--fg)" }}>
          <input type="checkbox" style={{ width: "auto" }} checked={!!p.sources[0]?.mirror} onChange={(ev) => { p.sources.forEach((s) => (s.mirror = ev.target.checked)); setE({ ...e }); }} />
          Flip picture (it&apos;s mirrored: writing behind you reads backwards)
        </label>
        <label>Longest pause kept: {e.gapCap.toFixed(2)} s</label>
        <input type="range" min={0.05} max={0.6} step={0.01} value={e.gapCap} onChange={(ev) => setE({ ...e, gapCap: +ev.target.value })} />
        <div className="words" style={{ maxHeight: 320, overflow: "auto", marginTop: 8 }}>
          {p.words.map((w, i) => (
            <span key={w.id}>
              {i > 0 && (p.words[i - 1].src !== w.src || w.s - p.words[i - 1].e > 1) && <br />}
              <span className={`w ${kept.has(w.id) ? "" : "cut"}`} onClick={() => toggleWord(w.id)}>{w.w}</span>{" "}
            </span>
          ))}
        </div>
      </>)}

      {tab === "Subtitles" && (<>
        <label className="row" style={{ color: "var(--fg)" }}><input type="checkbox" style={{ width: "auto" }} checked={e.captions.enabled}
          onChange={(ev) => setE({ ...e, captions: { ...e.captions, enabled: ev.target.checked } })} /> Show subtitles</label>
        <label>Style</label>
        <div className="row">{(["studio", "bold", "white", "boxed", "minimal"] as CaptionPreset[]).map((s) => (
          <button key={s} className={`small ${e.captions.preset === s ? "primary" : ""}`} onClick={() => setE({ ...e, captions: { ...e.captions, preset: s } })}>{s}</button>))}</div>
        <label>Size</label>
        <div className="row">{[["Small", 84], ["Medium", 105], ["Big", 126]].map(([n, v]) => (
          <button key={n} className={`small ${e.captions.size === v ? "primary" : ""}`} onClick={() => setE({ ...e, captions: { ...e.captions, size: v as number } })}>{n}</button>))}</div>
        <label>Position</label>
        <div className="row">{[["Higher", 0.66], ["Lower", 0.75]].map(([n, v]) => (
          <button key={n} className={`small ${e.captions.position === v ? "primary" : ""}`} onClick={() => setE({ ...e, captions: { ...e.captions, position: v as number } })}>{n}</button>))}</div>
        <label>Case</label>
        <select value={e.captions.textCase} onChange={(ev) => setE({ ...e, captions: { ...e.captions, textCase: ev.target.value as Edit["captions"]["textCase"] } })}>
          <option value="upper">UPPER CASE</option><option value="as-is">As said</option><option value="lower">lower case</option></select>
        <label>Font (any Google Font name)</label>
        <input value={e.captions.font} onChange={(ev) => setE({ ...e, captions: { ...e.captions, font: ev.target.value } })}
          onBlur={(ev) => loadFont(ev.target.value)} />
        <label>Fix a word</label>
        {e.corrections.map((c, i) => (
          <div key={i} className="row small">&quot;{c.from}&quot; becomes &quot;{c.to}&quot;
            <button className="small ghost" onClick={() => setE({ ...e, corrections: e.corrections.filter((_, k) => k !== i) })}>Remove</button></div>))}
        <form className="row" onSubmit={(ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget);
          const from = String(f.get("from")).trim(), to = String(f.get("to")).trim();
          if (from && to) setE({ ...e, corrections: [...e.corrections, { from, to }] }); ev.currentTarget.reset(); }}>
          <input name="from" placeholder="Wrong word" style={{ width: 150 }} /><input name="to" placeholder="Right word" style={{ width: 150 }} />
          <button className="small">Add</button>
        </form>
      </>)}

      {tab === "Music" && (<>
        <label className="row" style={{ color: "var(--fg)" }}><input type="radio" style={{ width: "auto" }} checked={!e.music.asset}
          onChange={() => setE({ ...e, music: { ...e.music, asset: null } })} /> No music</label>
        {music.map((m) => (
          <label key={m.key} className="row" style={{ color: "var(--fg)" }}><input type="radio" style={{ width: "auto" }} checked={e.music.asset === m.key}
            onChange={() => setE({ ...e, music: { ...e.music, asset: m.key } })} /> {m.name} <span className="muted small">sounds {m.feel}</span></label>))}
        {!music.length && <p className="small muted">Add a song with &quot;Add files&quot; under the notes.</p>}
        <label>How loud</label>
        <select value={e.music.level} onChange={(ev) => setE({ ...e, music: { ...e.music, level: ev.target.value as Edit["music"]["level"] } })}>
          <option value="under-voice">Under my voice</option><option value="quiet">Quiet</option><option value="loud-intro">Loud at the start, then under my voice</option></select>
        <label className="row" style={{ color: "var(--fg)" }}><input type="checkbox" style={{ width: "auto" }} checked={e.sfx}
          onChange={(ev) => setE({ ...e, sfx: ev.target.checked })} /> Soft whoosh when a picture appears</label>
      </>)}

      {tab === "Pictures" && (<>
        {e.broll.map((b) => (
          <div key={b.id} className="row small" style={{ margin: "6px 0" }}>
            <span className="grow">On &quot;{textOf(b.anchor)}&quot;: {b.treatment === "text-pop" ? `"${b.text}"` : p.library.find((a) => a.key === b.asset)?.name}
              <span className="muted"> · {LABEL[b.treatment]}</span></span>
            {b.treatment !== "text-pop" && <select style={{ width: 170 }} value={b.treatment} onChange={(ev) => setE({ ...e,
              broll: e.broll.map((x) => (x.id === b.id ? { ...x, treatment: ev.target.value as Broll["treatment"] } : x)) })}>
              {["card-above-head", "side-card", "phone-card", "full-frame", "split-top"].map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select>}
            <button className="small ghost" onClick={() => setE({ ...e, broll: e.broll.filter((x) => x.id !== b.id) })}>Remove</button>
          </div>))}
        <label>Add a picture: pick one, then click the word where it should pop up</label>
        <div className="row">{pictures.slice(0, 12).map((a) => (
          <button key={a.key} className={`small ${picFor === a.key ? "primary" : ""}`} onClick={() => setPicFor(a.key)}>{a.name.slice(0, 24)}</button>))}</div>
        {picFor && <div className="words" style={{ maxHeight: 200, overflow: "auto", marginTop: 8 }}>
          {p.words.filter((w) => kept.has(w.id)).map((w, k, arr) => (
            <span key={w.id} className="w" onClick={() => {
              const end = arr.slice(k).find((x) => x.e - w.s >= 2.0) ?? arr[arr.length - 1];
              setE({ ...e, broll: [...e.broll, { id: `m${Date.now()}`, anchor: { from: w.id, to: end.id }, asset: picFor, treatment: "card-above-head" }] });
              setPicFor(null);
            }}>{w.w} </span>))}
        </div>}
      </>)}

      {tab === "Cover" && (<>
        <label>The moment for your cover (pick a word)</label>
        <select value={e.cover.word ?? ""} onChange={(ev) => setE({ ...e, cover: { ...e.cover, word: ev.target.value || null } })}>
          <option value="">Automatic</option>
          {p.words.filter((w) => kept.has(w.id)).map((w) => <option key={w.id} value={w.id}>{w.w} ({w.s.toFixed(1)}s)</option>)}
        </select>
        <label>Words on the cover (1-3)</label>
        <input value={e.cover.text} placeholder="Leave empty for no words" onChange={(ev) => setE({ ...e, cover: { ...e.cover, text: ev.target.value } })} />
      </>)}

      {tab === "Post" && (<>
        <label>The caption under your post</label>
        <textarea rows={5} value={e.post.caption} onChange={(ev) => setE({ ...e, post: { ...e.post, caption: ev.target.value } })} />
        <label>Hashtags (exactly 5 work best)</label>
        <input value={e.post.hashtags.join(" ")} onChange={(ev) => setE({ ...e, post: { ...e.post,
          hashtags: ev.target.value.split(/[\s,]+/).filter(Boolean).map((h) => "#" + h.replace(/^#+/, "")) } })} />
      </>)}

      <div className="row" style={{ marginTop: 16 }}>
        <span className="small muted grow">{changed ? "You changed something." : "Nothing changed yet."}</span>
        <button className="ghost" disabled={!changed} onClick={() => setE(structuredClone(edit))}>Undo</button>
        <button className="primary" disabled={!changed} onClick={() => onApply(e, `my changes to ${tab.toLowerCase()}`)}>Make a new version</button>
      </div>
    </div>
  );
}

function loadFont(name: string) {
  if (!name || document.querySelector(`link[data-font="${name}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.dataset.font = name;
  l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@500;600;700;800;900&display=swap`;
  document.head.appendChild(l);
}
