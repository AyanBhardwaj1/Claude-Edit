"use client";
import { useMemo, useState } from "react";
import { indexOf } from "@/lib/timeline";
import type { Broll, CaptionPreset, Edit, Project, Range } from "@/lib/types";
import { Icon } from "./Icons";

const TABS = ["Cut", "Subtitles", "Music", "Pictures", "Cover", "Post"] as const;
const LABEL: Record<string, string> = { "card-above-head": "Picture above your head", "side-card": "Picture beside you",
  "phone-card": "In a phone", "full-frame": "Full screen", "split-top": "Top half", "text-pop": "Words on screen" };
const PRESETS: [CaptionPreset, string][] = [["studio", "Studio"], ["bold", "Bold"], ["white", "White"], ["boxed", "Boxed"], ["minimal", "Minimal"]];

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
  const cap = (k: Partial<Edit["captions"]>) => setE({ ...e, captions: { ...e.captions, ...k } });

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
  const opt = <T,>(cur: T, list: [T, string][], set: (v: T) => void, label: string) => (
    <div className="seg" role="group" aria-label={label}>
      {list.map(([v, n]) => <button key={n} aria-pressed={cur === v} onClick={() => set(v)}>{n}</button>)}
    </div>
  );

  return (
    <div>
      <div className="tabs" role="tablist" aria-label="Edit it myself">
        {TABS.map((t) => <button key={t} role="tab" id={`tab-${t}`} aria-selected={t === tab} aria-controls="tabpanel" className="tab" onClick={() => setTab(t)}>{t}</button>)}
      </div>

      <div id="tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="stack">
        {tab === "Cut" && (<>
          <p className="small muted">Crossed-out words are cut. Click a word to bring it back, or a kept word to cut it.</p>
          <label className="check">
            <input type="checkbox" checked={!!p.sources[0]?.mirror} onChange={(ev) => { p.sources.forEach((s) => (s.mirror = ev.target.checked)); setE({ ...e }); }} />
            <span>Flip picture (it&apos;s mirrored: writing behind you reads backwards)</span>
          </label>
          <div className="field">
            <label htmlFor="gap">Longest pause kept: <span className="num">{e.gapCap.toFixed(2)} s</span></label>
            <input id="gap" className="range" type="range" min={0.05} max={0.6} step={0.01} value={e.gapCap} onChange={(ev) => setE({ ...e, gapCap: +ev.target.value })} />
          </div>
          <div className="words" aria-label="Transcript">
            {p.words.map((w, i) => (
              <span key={w.id}>
                {i > 0 && (p.words[i - 1].src !== w.src || w.s - p.words[i - 1].e > 1) && <br />}
                <button className={`w ${kept.has(w.id) ? "" : "cut"}`} aria-pressed={!kept.has(w.id)} onClick={() => toggleWord(w.id)}>{w.w}</button>{" "}
              </span>
            ))}
          </div>
        </>)}

        {tab === "Subtitles" && (<>
          <label className="check"><input type="checkbox" checked={e.captions.enabled} onChange={(ev) => cap({ enabled: ev.target.checked })} />
            <span>Show subtitles</span></label>
          <div className="field"><span className="label">Style</span>{opt(e.captions.preset, PRESETS, (v) => cap({ preset: v }), "Subtitle style")}</div>
          <div className="field"><span className="label">Size</span>{opt(e.captions.size, [[84, "Small"], [105, "Medium"], [126, "Big"]], (v) => cap({ size: v }), "Size")}</div>
          <div className="field"><span className="label">Position</span>{opt(e.captions.position, [[0.66, "Higher"], [0.75, "Lower"]], (v) => cap({ position: v }), "Position")}</div>
          <div className="field">
            <label htmlFor="case">Case</label>
            <select id="case" className="select" value={e.captions.textCase} onChange={(ev) => cap({ textCase: ev.target.value as Edit["captions"]["textCase"] })}>
              <option value="upper">UPPER CASE</option><option value="as-is">As said</option><option value="lower">lower case</option></select>
          </div>
          <div className="field">
            <label htmlFor="font">Font (any Google Font name)</label>
            <input id="font" className="input" value={e.captions.font} autoComplete="off" spellCheck={false} onChange={(ev) => cap({ font: ev.target.value })}
              onBlur={(ev) => loadFont(ev.target.value)} />
          </div>
          <div className="field">
            <span className="label">Fix a word</span>
            {e.corrections.map((c, i) => (
              <div key={i} className="pic-row"><span className="grow">&ldquo;{c.from}&rdquo; becomes &ldquo;{c.to}&rdquo;</span>
                <button className="btn ghost sm" onClick={() => setE({ ...e, corrections: e.corrections.filter((_, k) => k !== i) })}>Remove</button></div>))}
            <form className="row" onSubmit={(ev) => { ev.preventDefault(); const f = new FormData(ev.currentTarget);
              const from = String(f.get("from")).trim(), to = String(f.get("to")).trim();
              if (from && to) setE({ ...e, corrections: [...e.corrections, { from, to }] }); ev.currentTarget.reset(); }}>
              <input name="from" className="input grow" placeholder="Wrong word…" aria-label="Wrong word" autoComplete="off" />
              <input name="to" className="input grow" placeholder="Right word…" aria-label="Right word" autoComplete="off" />
              <button className="btn">Add</button>
            </form>
          </div>
        </>)}

        {tab === "Music" && (<>
          <div className="field" role="radiogroup" aria-label="Song">
            <label className="check"><input type="radio" name="song" checked={!e.music.asset} onChange={() => setE({ ...e, music: { ...e.music, asset: null } })} />
              <span>No music</span></label>
            {music.map((m) => (
              <label key={m.key} className="check"><input type="radio" name="song" checked={e.music.asset === m.key}
                onChange={() => setE({ ...e, music: { ...e.music, asset: m.key } })} /><span>{m.name} <span className="faint small">sounds {m.feel}</span></span></label>))}
            {!music.length && <p className="small muted">Add a song with &ldquo;Add a song, picture or clip&rdquo; under the notes.</p>}
          </div>
          <div className="field">
            <label htmlFor="level">How loud</label>
            <select id="level" className="select" value={e.music.level} onChange={(ev) => setE({ ...e, music: { ...e.music, level: ev.target.value as Edit["music"]["level"] } })}>
              <option value="under-voice">Under my voice</option><option value="quiet">Quiet</option><option value="loud-intro">Loud at the start, then under my voice</option></select>
          </div>
          <label className="check"><input type="checkbox" checked={e.sfx} onChange={(ev) => setE({ ...e, sfx: ev.target.checked })} />
            <span>Soft whoosh when a picture appears</span></label>
        </>)}

        {tab === "Pictures" && (<>
          {!e.broll.length && <p className="small muted">No pictures or text cards in this version yet.</p>}
          {e.broll.map((b) => (
            <div key={b.id} className="pic-row">
              <span className="grow">On &ldquo;{textOf(b.anchor)}&rdquo;: {b.treatment === "text-pop" ? `“${b.text}”` : p.library.find((a) => a.key === b.asset)?.name}
                <span className="faint"> · {LABEL[b.treatment]}</span></span>
              {b.treatment !== "text-pop" && <select className="select w-200" aria-label="Where it goes" value={b.treatment} onChange={(ev) => setE({ ...e,
                broll: e.broll.map((x) => (x.id === b.id ? { ...x, treatment: ev.target.value as Broll["treatment"] } : x)) })}>
                {["card-above-head", "side-card", "phone-card", "full-frame", "split-top"].map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select>}
              <button className="btn ghost sm" onClick={() => setE({ ...e, broll: e.broll.filter((x) => x.id !== b.id) })}>Remove</button>
            </div>))}
          <div className="field">
            <span className="label">Add a picture: pick one, then click the word where it should pop up</span>
            <div className="chips">{pictures.slice(0, 12).map((a) => (
              <button key={a.key} className="chip" aria-pressed={picFor === a.key} onClick={() => setPicFor(a.key)}>{a.name.slice(0, 24)}</button>))}</div>
            {!pictures.length && <p className="small muted">Add pictures or clips with &ldquo;Add a song, picture or clip&rdquo; under the notes.</p>}
          </div>
          {picFor && <div className="words" aria-label="Pick a word">
            {p.words.filter((w) => kept.has(w.id)).map((w, k, arr) => (
              <button key={w.id} className="w" onClick={() => {
                const end = arr.slice(k).find((x) => x.e - w.s >= 2.0) ?? arr[arr.length - 1];
                setE({ ...e, broll: [...e.broll, { id: `m${Date.now()}`, anchor: { from: w.id, to: end.id }, asset: picFor, treatment: "card-above-head" }] });
                setPicFor(null);
              }}>{w.w}</button>))}
          </div>}
        </>)}

        {tab === "Cover" && (<>
          <div className="field">
            <label htmlFor="cover-word">The moment for your cover (pick a word)</label>
            <select id="cover-word" className="select" value={e.cover.word ?? ""} onChange={(ev) => setE({ ...e, cover: { ...e.cover, word: ev.target.value || null } })}>
              <option value="">Automatic</option>
              {p.words.filter((w) => kept.has(w.id)).map((w) => <option key={w.id} value={w.id}>{w.w} ({w.s.toFixed(1)}s)</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="cover-text">Words on the cover (1-3)</label>
            <input id="cover-text" className="input" value={e.cover.text} placeholder="Leave empty for no words…" autoComplete="off"
              onChange={(ev) => setE({ ...e, cover: { ...e.cover, text: ev.target.value } })} />
          </div>
        </>)}

        {tab === "Post" && (<>
          <div className="field">
            <label htmlFor="post-cap">The caption under your post</label>
            <textarea id="post-cap" className="textarea" rows={5} value={e.post.caption} onChange={(ev) => setE({ ...e, post: { ...e.post, caption: ev.target.value } })} />
          </div>
          <div className="field">
            <label htmlFor="tags">Hashtags (exactly 5 work best)</label>
            <input id="tags" className="input" value={e.post.hashtags.join(" ")} autoComplete="off" spellCheck={false} onChange={(ev) => setE({ ...e, post: { ...e.post,
              hashtags: ev.target.value.split(/[\s,]+/).filter(Boolean).map((h) => "#" + h.replace(/^#+/, "")) } })} />
            <span className="hint num">{e.post.hashtags.length} of 5</span>
          </div>
        </>)}
      </div>

      <div className="drawer-foot">
        <span className="small faint grow">{changed ? "You changed something." : "Nothing changed yet."}</span>
        <button className="btn ghost" disabled={!changed} onClick={() => setE(structuredClone(edit))}>Undo</button>
        <button className="btn primary" disabled={!changed} onClick={() => onApply(e, `my changes to ${tab.toLowerCase()}`)}>Make a new version</button>
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
