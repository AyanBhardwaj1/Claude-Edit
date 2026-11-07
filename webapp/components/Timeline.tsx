"use client";
// The timeline: the edit as tracks, like a video editor's (video clips, pictures and text, zooms, music), with a playhead.
// Split at the playhead, delete, reorder (drag or arrows), trim a clip's ends (drag its edges: they snap to whole
// words), nudge pictures and zooms, undo / redo. Changes preview live in the player; "Save as a new version" keeps them.
import { useEffect, useMemo, useRef, useState } from "react";
import { addPicture, addText, addZoom, clipsOf, deleteClip, deleteLayer, duplicateClip, moveClip, nudgeLayer, setText, splitAt, trimClip, trimToTime, type LayerKind } from "@/lib/cutline";
import { buildTimeline, spanOf } from "@/lib/timeline";
import type { Edit, Project } from "@/lib/types";
import { Icon } from "./Icons";

type Sel = { kind: "clip"; k: number } | { kind: LayerKind; i: number } | null;
const GUT = 76;                         // px before 0:00, for the track names
const clock = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`;

export function Timeline({ project: p, edit, t, onSeek, onPreview, onSave, onClose, onThumbs, onPlay }: { project: Project; edit: Edit; t: number;
  onSeek: (t: number) => void; onPreview: (e: Edit | null) => void; onSave: (e: Edit, what: string) => void; onClose: () => void;
  onThumbs?: (times: number[]) => Promise<string[] | null>; onPlay?: () => void }) {
  // onPreview(draft) also tells the editor there are unsaved changes (null: none), so export and compare wait for a save
  const [draft, setDraft] = useState<Edit>(() => structuredClone(edit));
  const [past, setPast] = useState<Edit[]>([]);
  const [future, setFuture] = useState<Edit[]>([]);
  const [sel, setSel] = useState<Sel>(null);
  const [pps, setPps] = useState(40);                 // pixels per second: the zoom
  const [say, setSay] = useState("");
  const [typing, setTyping] = useState<string | null>(null);   // the "Add text" box, open with what's typed
  const [drag, setDrag] = useState<{ kind: "move" | "from" | "to"; k: number; x0: number; dx: number } | null>(null);
  const [base, setBase] = useState(edit);
  const [retry, setRetry] = useState(0);             // thumbnails asked again after a busy player said no
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  if (base !== edit) { setBase(edit); setDraft(structuredClone(edit)); setPast([]); setFuture([]); setSel(null); setThumbs({}); }   // a new version from outside
  const tl = useMemo(() => buildTimeline(p.words, draft, p.sources.map((s) => s.duration)), [p.words, p.sources, draft]);
  const clips = useMemo(() => clipsOf(p, draft, tl), [p, draft, tl]);
  // a frame from each clip, drawn on it: by what the clip shows (its words), so moving a clip keeps its picture
  const thumbKey = (c: { from: string; to: string }) => `${p.format ?? "9:16"}:${c.from}-${c.to}`;   // a new shape draws them again
  useEffect(() => {
    if (!onThumbs || drag) return;
    const want = clips.filter((c) => !thumbs[thumbKey(c)]).slice(0, 12);
    if (!want.length) return;
    let live = true;
    const id = setTimeout(async () => {                 // after the preview has the new cut (it remounts on each change)
      try {
        const urls = await onThumbs(want.map((c) => (c.start + c.end) / 2));
        if (live && !urls) setRetry((n) => n + 1);            // busy (playing, exporting): try again in a moment
        if (live && urls) setThumbs((m) => {
          const now = new Set(clips.map(thumbKey));                 // only the clips there are now: trims and splits leave old ones
          return Object.fromEntries([...Object.entries(m).filter(([k]) => now.has(k)), ...want.map((c, i) => [thumbKey(c), urls[i]])]);
        });
      } catch { /* the player was busy (playing, exporting): no pictures this time */ }
    }, retry ? 2000 : 900);
    return () => { live = false; clearTimeout(id); };
  }, [clips, drag, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(draft) !== JSON.stringify(edit);
  const width = Math.max(600, Math.ceil(tl.duration * pps) + GUT + 24);
  const box = useRef<HTMLDivElement>(null);
  // Fit: the whole video in view (also how the timeline opens)
  const fit = () => { const el = box.current; if (el && tl.duration > 0) setPps(Math.max(10, Math.min(160, Math.floor((el.clientWidth - GUT - 24) / tl.duration)))); };
  useEffect(fit, []); // eslint-disable-line react-hooks/exhaustive-deps
  // the playhead stays in view as the video plays (or when it's moved off screen)
  useEffect(() => {
    const el = box.current; if (!el || drag) return;
    const x = GUT + t * pps;
    if (x < el.scrollLeft + GUT || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = Math.max(0, x - el.clientWidth / 3);
  }, [t, pps, drag]);

  // the player previews the draft; leaving the timeline puts the saved version back
  const preview = useRef(onPreview);
  preview.current = onPreview;                       // the latest: closing after a save shows the saved version
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } preview.current(changed ? draft : null); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => preview.current(null), []);

  // keys keep working after a click or a delete (the clicked clip may be gone): focus stays on the tracks
  const keepFocus = () => { const a = document.activeElement; if (!a || a === document.body || box.current?.contains(a)) box.current?.focus({ preventScroll: true }); };
  function apply(next: Edit | null, what: string) {
    if (!next) { setSay(`Can't ${what} there.`); return; }
    setPast((h) => [...h.slice(-49), draft]); setFuture([]); setDraft(next); setSay(`${what[0].toUpperCase()}${what.slice(1)}.`);
    keepFocus();
  }
  const undo = () => { const prev = past[past.length - 1]; if (!prev) return; setFuture((f) => [draft, ...f]); setPast((h) => h.slice(0, -1)); setDraft(prev); setSay("Undone."); };
  const redo = () => { const nx = future[0]; if (!nx) return; setPast((h) => [...h, draft]); setFuture((f) => f.slice(1)); setDraft(nx); setSay("Redone."); };

  const split = () => apply(splitAt(p, draft, tl, t), "split at the playhead");
  function remove() {
    if (!sel) return;
    if (sel.kind === "clip") { apply(deleteClip(p, draft, sel.k), "delete the clip"); setSel(null); }
    else { apply(deleteLayer(draft, sel.kind, sel.i), sel.kind === "zoom" ? "delete the zoom" : "delete the picture"); setSel(null); }
  }
  function move(d: number) {
    if (sel?.kind === "clip") { const n = moveClip(draft, sel.k, sel.k + d); apply(n, d < 0 ? "move the clip earlier" : "move the clip later"); if (n) setSel({ kind: "clip", k: sel.k + d }); }
    else if (sel) apply(nudgeLayer(p, draft, sel.kind, sel.i, d), d < 0 ? "nudge it earlier" : "nudge it later");
  }
  const trim = (end: "from" | "to", d: number) => sel?.kind === "clip" && apply(trimClip(p, draft, sel.k, end, d), d * (end === "from" ? -1 : 1) > 0 ? "lengthen the clip" : "shorten the clip");

  function onKey(ev: React.KeyboardEvent) {
    if ((ev.target as HTMLElement).closest("input, textarea, select")) return;      // typing a text card
    const mod = ev.metaKey || ev.ctrlKey;
    if (mod && ev.key.toLowerCase() === "s") { ev.preventDefault(); ev.stopPropagation(); if (changed) onSave(draft, "my changes on the timeline"); return; }
    if (mod && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.stopPropagation(); if (ev.shiftKey) redo(); else undo(); return; }
    if (mod) return;
    if (ev.key === "s" || ev.key === "S") { ev.preventDefault(); ev.stopPropagation(); split(); }
    else if (ev.key === "t" || ev.key === "T") { ev.preventDefault(); ev.stopPropagation(); setTyping(""); }
    else if (ev.key === "z" || ev.key === "Z") { ev.preventDefault(); ev.stopPropagation(); apply(addZoom(p, draft, tl, t), "add a zoom at the playhead"); }
    else if ((ev.key === "Delete" || ev.key === "Backspace") && sel) { ev.preventDefault(); ev.stopPropagation(); remove(); }
    else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && sel) { ev.preventDefault(); ev.stopPropagation(); move(ev.key === "ArrowLeft" ? -1 : 1); }
    else if (ev.key === "Escape") { setSel(null); }
    else if (ev.key === " " && !(ev.target as HTMLElement).closest("button, select")) { ev.preventDefault(); ev.stopPropagation(); onPlay?.(); }
    else if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && !sel) {      // nothing selected: the arrows move the playhead
      ev.preventDefault(); ev.stopPropagation();
      onSeek(Math.max(0, Math.min(tl.duration, t + (ev.key === "ArrowLeft" ? -1 : 1) * (ev.shiftKey ? 5 : 1))));
    }
  }

  const seekAt = (clientX: number) => {
    const r = box.current?.getBoundingClientRect(); if (!r) return;
    onSeek(Math.max(0, Math.min(tl.duration, (clientX - r.left + (box.current?.scrollLeft ?? 0) - GUT) / pps)));
  };

  // dragging a clip: its body reorders, its edges trim (to whole words)
  function startDrag(ev: React.PointerEvent, kind: "move" | "from" | "to", k: number) {
    ev.stopPropagation(); (ev.target as Element).setPointerCapture?.(ev.pointerId);
    setSel({ kind: "clip", k }); setDrag({ kind, k, x0: ev.clientX, dx: 0 }); box.current?.focus({ preventScroll: true });
  }
  function onMove(ev: React.PointerEvent) { if (drag) setDrag({ ...drag, dx: ev.clientX - drag.x0 }); }
  function endDrag() {
    if (!drag) return;
    const d = drag; setDrag(null);
    if (Math.abs(d.dx) < 4) return;                                  // a click, not a drag
    const c = clips.find((x) => x.k === d.k); if (!c) return;
    if (d.kind === "move") {
      const mid = (c.start + c.end) / 2 + d.dx / pps;
      const to = clips.filter((x) => x.k !== d.k && (x.start + x.end) / 2 < mid).length;
      const n = moveClip(draft, d.k, to); apply(n, "move the clip"); if (n) setSel({ kind: "clip", k: to });
    } else {
      const idx = new Map(p.words.map((w, i) => [w.id, i]));
      const w = p.words[idx.get(d.kind === "from" ? c.from : c.to)!];
      const speed = draft.speed ?? 1;
      apply(trimToTime(p, draft, d.k, d.kind, (d.kind === "from" ? w.s : w.e) + (d.dx / pps) * speed), "trim the clip");
    }
  }

  const layers = (["broll", "zoom"] as LayerKind[]).map((kind) => ({ kind, items: (kind === "broll" ? draft.broll.map((b) => b.anchor) : draft.zooms.map((z) => z.anchor))
    .map((a, i) => ({ i, span: spanOf(tl, a), label: kind === "zoom" ? `Zoom ${Math.round(draft.zooms[i].scale * 100)}%` : labelOf(p, draft.broll[i]) })) }));
  const music = draft.music?.asset ? p.library.find((a) => a.key === draft.music!.asset) : undefined;
  const selClip = sel?.kind === "clip" ? clips.find((c) => c.k === sel.k) : undefined;
  const ticks = Array.from({ length: Math.floor(tl.duration / (pps >= 60 ? 1 : pps >= 25 ? 2 : 5)) + 1 }, (_, i) => i * (pps >= 60 ? 1 : pps >= 25 ? 2 : 5));

  return (
    <section className="panel tl-panel" aria-labelledby="tl-h" onKeyDown={onKey}>
      <div className="panel-head"><h2 id="tl-h">Timeline</h2>
        <button type="button" className="btn ghost icon sm" aria-label="Close the timeline"
          onClick={() => { if (!changed || window.confirm("Close the timeline and drop your unsaved changes? (Save as a new version keeps them.)")) onClose(); }}>&times;</button></div>
      <div className="tl-tools" role="toolbar" aria-label="Timeline tools">
        <button type="button" className="btn sm" onClick={split} title="Split the clip at the playhead (S)"><Icon name="scissors" />Split</button>
        <button type="button" className="btn sm" onClick={remove} disabled={!sel} title="Delete what's selected (Delete)">Delete</button>
        <button type="button" className="btn sm" onClick={() => move(-1)} disabled={!sel} aria-label={sel?.kind === "clip" ? "Move the clip earlier" : "Nudge earlier"} title="Earlier (←)">←</button>
        <button type="button" className="btn sm" onClick={() => move(1)} disabled={!sel} aria-label={sel?.kind === "clip" ? "Move the clip later" : "Nudge later"} title="Later (→)">→</button>
        {selClip && <button type="button" className="btn sm" onClick={() => { apply(duplicateClip(draft, selClip.k), "duplicate the clip"); setSel({ kind: "clip", k: selClip.k + 1 }); }} title="Play this clip twice">Duplicate</button>}
        <button type="button" className="btn sm" aria-expanded={typing !== null} onClick={() => setTyping(typing === null ? "" : null)} title="A text card at the playhead (T)"><Icon name="pen" />Text</button>
        {p.library.some((a) => a.kind !== "music") && (
          <select className="tl-level" aria-label="Add a picture or clip at the playhead" value=""
            onChange={(ev) => { if (ev.target.value) apply(addPicture(p, draft, tl, t, ev.target.value), "add a picture at the playhead"); }}>
            <option value="">+ Picture…</option>
            {p.library.filter((a) => a.kind !== "music").map((a) => <option key={a.key} value={a.key}>{a.name.slice(0, 40)}</option>)}
          </select>
        )}
        <button type="button" className="btn sm" onClick={() => apply(addZoom(p, draft, tl, t), "add a zoom at the playhead")} title="A punch-in zoom at the playhead (Z)">Zoom</button>
        <select className="tl-level" aria-label="Talking speed" value={String(draft.speed ?? 1)}
          onChange={(ev) => { const v = Number(ev.target.value); apply({ ...draft, speed: v === 1 ? undefined : v }, v === 1 ? "play it as filmed" : `speed it up to ${v}×`); }}>
          <option value="1">Speed: as filmed</option><option value="1.1">Speed 1.1×</option><option value="1.2">Speed 1.2×</option><option value="1.3">Speed 1.3×</option>
        </select>
        <button type="button" className="btn sm" aria-pressed={draft.captions.enabled} onClick={() => apply({ ...draft, captions: { ...draft.captions, enabled: !draft.captions.enabled } }, draft.captions.enabled ? "turn subtitles off" : "turn subtitles on")}>Subtitles</button>
        {selClip && (<span className="tl-trim" role="group" aria-label="Trim the selected clip">
          <span className="small muted">Start</span>
          <button type="button" className="btn ghost sm" onClick={() => trim("from", -1)} aria-label="Start one word earlier">−</button>
          <button type="button" className="btn ghost sm" onClick={() => trim("from", 1)} aria-label="Start one word later">+</button>
          <span className="small muted">End</span>
          <button type="button" className="btn ghost sm" onClick={() => trim("to", -1)} aria-label="End one word earlier">−</button>
          <button type="button" className="btn ghost sm" onClick={() => trim("to", 1)} aria-label="End one word later">+</button>
        </span>)}
        {music && (
          <select className="tl-level" aria-label="Music level" value={draft.music.level}
            onChange={(ev) => apply({ ...draft, music: { ...draft.music, level: ev.target.value as Edit["music"]["level"] } }, "change the music level")}>
            <option value="under-voice">Music under the voice</option><option value="quiet">Music quiet</option><option value="loud-intro">Music: loud intro</option>
          </select>
        )}
        <span className="grow" />
        <button type="button" className="btn ghost sm" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl/⌘+Z)"><Icon name="undo" /></button>
        <button type="button" className="btn ghost sm" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl/⌘+Shift+Z)"><span className="flip"><Icon name="undo" /></span></button>
        <button type="button" className="btn ghost sm" onClick={fit} title="Show the whole video">Fit</button>
        <label className="tl-zoom small"><span className="sr-only">Zoom</span>
          <input type="range" min={10} max={160} step={5} value={pps} onChange={(e) => setPps(Number(e.target.value))} aria-label="Timeline zoom" /></label>
      </div>
      {typing !== null && (
        <form className="row tl-text" onSubmit={(ev) => { ev.preventDefault(); const n = addText(p, draft, tl, t, typing); apply(n, "add text at the playhead"); if (n) setTyping(null); }}>
          <label htmlFor="tl-text-in" className="small">Text at {clock(t)}</label>
          <input id="tl-text-in" className="input" autoFocus maxLength={80} value={typing} placeholder="e.g. 3 tips that doubled my views"
            onChange={(ev) => setTyping(ev.target.value)} onKeyDown={(ev) => { if (ev.key === "Escape") setTyping(null); }} />
          <button type="submit" className="btn primary sm" disabled={!typing.trim()}>Add</button>
        </form>
      )}
      {sel && sel.kind === "broll" && draft.broll[sel.i]?.treatment === "text-pop" && (
        <div className="row tl-text">
          <label htmlFor="tl-text-edit" className="small">Selected text</label>
          <input id="tl-text-edit" key={`${sel.i}-${draft.broll[sel.i].id}-${draft.broll[sel.i].text}`} className="input" maxLength={80} defaultValue={draft.broll[sel.i].text ?? ""}
            onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); apply(setText(draft, sel.i, (ev.target as HTMLInputElement).value), "change the text"); } }}
            onBlur={(ev) => { const n = setText(draft, sel.i, ev.target.value); if (n) apply(n, "change the text"); }} />
        </div>
      )}
      <div className="tl-scroll" ref={box} tabIndex={0} aria-label="Timeline tracks: S splits, Delete deletes, arrows move the selection"
        onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={() => setDrag(null)}>
        <div className="tl-inner" style={{ width }} onPointerDown={(e) => {   // a click on an empty bit of a track moves the playhead
          const el = e.target as HTMLElement;
          if (el.classList.contains("tl-track") || el.classList.contains("tl-inner")) { seekAt(e.clientX); setSel(null); box.current?.focus({ preventScroll: true }); }
        }}>
          <div className="tl-ruler" onPointerDown={(e) => seekAt(e.clientX)}>
            {ticks.map((x) => <span key={x} style={{ left: GUT + x * pps }}>{clock(x).replace(/\.0$/, "")}</span>)}
          </div>
          <div className="tl-track video" aria-label="Video">
            <span className="tl-name">Video</span>
            {clips.map((c) => {
              const moving = drag?.k === c.k ? drag : null;
              const left = GUT + c.start * pps + (moving?.kind === "move" || moving?.kind === "from" ? moving.dx : 0);
              const w = Math.max(6, (c.end - c.start) * pps + (moving?.kind === "to" ? moving.dx : moving?.kind === "from" ? -moving.dx : 0));
              const on = sel?.kind === "clip" && sel.k === c.k;
              return (
                <div key={`${c.k}-${c.from}`} className={`tl-clip${on ? " on" : ""}${moving ? " drag" : ""}${thumbs[thumbKey(c)] ? " pic" : ""}`}
                  style={{ left, width: w, ...(thumbs[thumbKey(c)] ? { backgroundImage: `url(${thumbs[thumbKey(c)]})` } : {}) }}
                  role="button" aria-pressed={on} aria-label={`Clip ${c.k + 1}: ${c.text.slice(0, 60)}`} title={c.text}
                  onPointerDown={(e) => startDrag(e, "move", c.k)}>
                  <i className="tl-edge l" onPointerDown={(e) => startDrag(e, "from", c.k)} aria-hidden="true" />
                  <span>{c.text}</span>
                  <i className="tl-edge r" onPointerDown={(e) => startDrag(e, "to", c.k)} aria-hidden="true" />
                </div>
              );
            })}
          </div>
          {layers.map(({ kind, items }) => (
            <div key={kind} className={`tl-track ${kind}`} aria-label={kind === "broll" ? "Pictures and text" : "Zooms"}>
              <span className="tl-name">{kind === "broll" ? "Pictures" : "Zooms"}</span>
              {items.map(({ i, span, label }) => span && (
                <button key={i} type="button" className={`tl-item${sel && sel.kind === kind && sel.i === i ? " on" : ""}`}
                  style={{ left: GUT + span[0] * pps, width: Math.max(6, (span[1] - span[0]) * pps) }}
                  aria-pressed={!!sel && sel.kind === kind && sel.i === i} title={label}
                  onClick={(e) => { e.stopPropagation(); setSel({ kind, i }); onSeek(span[0]); box.current?.focus(); }}>{label}</button>
              ))}
            </div>
          ))}
          <div className="tl-track music" aria-label="Music">
            <span className="tl-name">Music</span>
            {music && <span className="tl-item static" style={{ left: GUT, width: tl.duration * pps }}>{music.name}</span>}
          </div>
          <div className="tl-head" style={{ left: GUT + t * pps }} aria-hidden="true" />
        </div>
      </div>
      <div className="row tl-foot">
        <span className="small muted" role="status">{say || `${clips.length} clip${clips.length === 1 ? "" : "s"}, ${clock(tl.duration)} long. Click a clip, then S to split at the playhead, Delete, or ← →. Drag a clip's edges to trim.`}</span>
        <span className="grow" />
        <button type="button" className="btn ghost" disabled={!changed} onClick={() => { setPast((h) => [...h, draft]); setDraft(structuredClone(edit)); setSel(null); setSay("Back to the saved version."); }}>Discard</button>
        <button type="button" className="btn primary" disabled={!changed} onClick={() => onSave(draft, "my changes on the timeline")} title="Ctrl/⌘+S">Save as a new version</button>
      </div>
    </section>
  );
}

function labelOf(p: Project, b: Edit["broll"][number]): string {
  if (b.text) return b.text;
  if (b.card?.text) return b.card.text;
  const a = b.asset ? p.library.find((x) => x.key === b.asset) : undefined;
  return a?.name ?? b.treatment;
}
