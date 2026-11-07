"use client";
import { aiReady } from "@/lib/ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { indexOf } from "@/lib/timeline";
import { parseTags } from "@/lib/text";
import { BOXED_DEFAULTS, BROLL_INS, CAPTION_ANIMS, LOOKS, motionOf, TRANSITIONS } from "@/lib/edit";
import { LOOK_NAME } from "@/lib/motion";
import { aiPicture } from "@/lib/images";
import { getMedia, saveProject } from "@/lib/store";
import { buildTimeline } from "@/lib/timeline";
import { addToLibrary } from "@/lib/workflow";
import { LANGUAGES, translateSubtitles } from "@/lib/translate";
import { formatTime, playedLength, waitSavings, WAIT_SPEED } from "@/lib/screenrec";
import { pickTake, takeLines, type Take } from "@/lib/takes";
import { crutches, cutWords, findWords, restoreWords } from "@/lib/crutch";
import { applyFit, FIT_TARGETS, planFit, repeats } from "@/lib/fit";
import { unsureWords } from "@/lib/unsure";
import { postFit } from "@/lib/postfit";
import type { Asset, Broll, BrollIn, CaptionAnim, CaptionPreset, Edit, Look, Motion, Project, Range, Settings, Transition } from "@/lib/types";

const ANIM_NAME: Record<CaptionAnim, string> = { pop: "Pop", karaoke: "Karaoke", bounce: "Bounce", words: "Word by word", typewriter: "Typewriter",
  fade: "Fade", none: "Still" };
const CUT_NAME: Record<Transition, string> = { none: "Plain cut", punch: "Punch-in", whip: "Whip", flash: "Flash", fade: "Dip", glitch: "Glitch" };
const IN_NAME: Record<BrollIn, string> = { pop: "Pop", slide: "Slide up", zoom: "Zoom", spin: "Spin" };
const ACCENTS = ["#FFE14D", "#FF9F43", "#FF3D9A", "#7C5CFF", "#3DA9FF", "#2EE59D", "#FFFFFF"];
import { Icon } from "./Icons";
import { ScriptFix } from "./ScriptFix";

const TABS = ["Cut", "Subtitles", "Motion", "Music", "Pictures", "Cover", "Post"] as const;
const LABEL: Record<string, string> = { "card-above-head": "Picture above your head", "side-card": "Picture beside you",
  "phone-card": "In a phone", "full-frame": "Full screen", "split-top": "Top half", framed: "Framed screen (apps, sites)", "text-pop": "Words on screen", motion: "Animated card" };
const PLACES = ["card-above-head", "side-card", "phone-card", "full-frame", "split-top", "framed"] as const;
const CARD_NAME = { number: "A number that counts up", list: "A list that ticks in", compare: "Before and after", statement: "A statement" } as const;
const PRESETS: [CaptionPreset, string][] = [["studio", "Studio"], ["bold", "Bold"], ["white", "White"], ["block", "Block"], ["boxed", "Boxed"],
  ["minimal", "Minimal"]];

type Scan = { key: string; name: string; pct: number } | null;

export function Drawer({ project: p, edit, onApply, settings, onMakeMusic, onWords, scan = null, onFindWaits, onStopScan, onClip }: { project: Project; edit: Edit;
  onApply: (e: Edit, what: string) => void; settings?: Settings; onMakeMusic?: () => void; onWords?: () => void;
  scan?: Scan; onFindWaits?: (key: string) => void; onStopScan?: () => void; onClip?: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Cut");
  const [e, setE] = useState<Edit>(() => structuredClone(edit));
  const [tagsText, setTagsText] = useState<string | null>(null);   // hashtags as typed, until the field is left
  const [base, setBase] = useState(edit);
  if (base !== edit) { setBase(edit); setE(structuredClone(edit)); }     // a new version from outside (a note, a style, made music)
  const [picFor, setPicFor] = useState<string | null>(null);
  const [lang, setLang] = useState(edit.translation?.lang ?? "Spanish");
  const [tBusy, setTBusy] = useState(false);
  const [tErr, setTErr] = useState("");
  const [imgPrompt, setImgPrompt] = useState("");
  const [imgSize, setImgSize] = useState<"1024x1024" | "1024x1536" | "1536x1024">("1536x1024");
  const [imgBusy, setImgBusy] = useState(false);
  const [imgErr, setImgErr] = useState("");
  const [card, setCard] = useState<{ kind: keyof typeof CARD_NAME; text: string; value: string; items: string }>({ kind: "number", text: "", value: "", items: "" });
  const hasKey = aiReady(settings);
  const idx = useMemo(() => indexOf(p.words), [p.words]);
  const kept = useMemo(() => {
    const s = new Set<string>();
    for (const r of e.keep) { const a = idx.get(r.from)!, b = idx.get(r.to)!; for (let i = a; i <= b; i++) s.add(p.words[i].id); }
    return s;
  }, [e.keep, idx, p.words]);
  const lines = useMemo(() => takeLines(p, e.keep), [p, e.keep]);
  const habits = useMemo(() => crutches(p, e.keep), [p, e.keep]);
  // hear a take before picking it: that stretch of the original footage, played on its own. One player at a time:
  // a newer click, or the drawer closing while the footage loads, wins over an older one still loading.
  const ear = useRef<{ v: HTMLVideoElement; url: string; src: number } | null>(null);
  const earReq = useRef(0), alive = useRef(true);
  const [hearing, setHearing] = useState<string | null>(null);
  const stopHearing = () => { ear.current?.v.pause(); setHearing(null); };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; earReq.current++; if (ear.current) { ear.current.v.pause(); URL.revokeObjectURL(ear.current.url); ear.current = null; } };
  }, []);
  async function hear(t: Take) {
    const req = ++earReq.current;
    if (hearing === t.range.from) { stopHearing(); return; }
    ear.current?.v.pause();
    if (!ear.current || ear.current.src !== t.src) {
      const blob = await getMedia(p.sources[t.src]?.mediaKey ?? "").catch(() => undefined);
      if (req !== earReq.current || !alive.current) return;          // a newer click, or the drawer closed
      if (!blob) { setHearing(null); return; }
      if (ear.current) { ear.current.v.pause(); URL.revokeObjectURL(ear.current.url); }
      const v = document.createElement("video");
      v.playsInline = true; v.preload = "auto";
      const url = URL.createObjectURL(blob); v.src = url;
      ear.current = { v, url, src: t.src };
    }
    const v = ear.current.v, end = t.e + 0.1;
    v.currentTime = Math.max(0, t.s - 0.05);
    v.ontimeupdate = () => { if (req === earReq.current && v.currentTime >= end) stopHearing(); };
    v.onended = () => { if (req === earReq.current) stopHearing(); };
    setHearing(t.range.from);
    await v.play().catch(() => { if (req === earReq.current) setHearing(null); });
  }
  const [find, setFind] = useState("");
  const [fitTo, setFitTo] = useState<number | null>(null);
  const cutTl = useMemo(() => buildTimeline(p.words, e, p.sources.map((x) => x.duration)), [p.words, p.sources, e]);
  const length = cutTl.duration;
  const doubts = useMemo(() => unsureWords(cutTl, e.corrections), [cutTl, e.corrections]);
  const [okWords, setOkWords] = useState<Set<string>>(new Set());          // "looks right": hidden for this session
  // words a minute as it plays (talking speed included), from the cut's spoken words over its length
  const wpm = useMemo(() => {
    const n = cutTl.words.filter((w) => w.w.trim()).length;
    return cutTl.duration > 5 && n > 10 ? Math.round(n / (cutTl.duration / 60)) : 0;
  }, [cutTl]);
  const twice = useMemo(() => repeats(p, e), [p, e]);
  const fit = useMemo(() => (fitTo && fitTo < length ? planFit(p, e, fitTo) : null), [p, e, fitTo, length]);
  const found = useMemo(() => findWords(p, find), [p, find]);
  const hit = useMemo(() => new Set(found.flat()), [found]);
  const foundKept = found.filter((h) => h.some((id) => kept.has(id))).length;
  const changed = JSON.stringify(e) !== JSON.stringify(edit);
  const cap = (k: Partial<Edit["captions"]>) => setE({ ...e, captions: { ...e.captions, ...k } });
  const mo = motionOf(e);
  const mov = (k: Partial<Motion>) => setE({ ...e, motion: { ...mo, ...k } });

  function toggleWord(id: string) {
    const next = new Set(kept);
    // a word with a pasted script's text can hold the time of the empty words after it (lib/retext.ts): they go with it
    const i0 = idx.get(id)!, group = [id];
    for (let i = i0 + 1; i < p.words.length && !p.words[i].w.trim() && p.words[i].src === p.words[i0].src; i++) group.push(p.words[i].id);
    const on = !next.has(id);
    for (const g of group) if (on) next.add(g); else next.delete(g);
    // rebuild ranges in source order (re-ordering is the editor's job: keep it simple here)
    const keep: Range[] = [];
    p.words.forEach((w, i) => {
      if (!next.has(w.id)) return;
      const last = keep[keep.length - 1];
      if (last && idx.get(last.to) === i - 1 && p.words[i - 1].src === w.src) last.to = w.id; else keep.push({ from: w.id, to: w.id });
    });
    setE({ ...e, keep });      // translated lines follow their kept words when drawn (translatedCues)
  }

  const music = p.library.filter((a) => a.kind === "music");
  const pictures = p.library.filter((a) => a.kind !== "music");
  const screenClips = p.library.filter((a) => a.kind === "video" && !a.web && (a.screen || !!a.waits?.length));
  const textOf = (r: Range) => { const a = idx.get(r.from)!, b = idx.get(r.to)!; return p.words.slice(a, b + 1).map((w) => w.w).filter(Boolean).join(" "); };
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
          <div className="field"><span className="label">Talking speed</span>
            {opt(e.speed ?? 1, [[1, "As filmed"], [1.1, "1.1×"], [1.2, "1.2×"], [1.3, "1.3×"]], (v) => setE({ ...e, speed: v === 1 ? undefined : v }), "Talking speed")}
            <span className="hint">{wpm ? `You talk at about ${wpm} words a minute${wpm < 150 ? ": unhurried for a reel, where 160 to 190 feels brisk" : wpm > 200 ? ": already quick" : ""}. ` : ""}Faster talking holds attention; your voice keeps its pitch. Pictures and music play as they are.</span></div>
          {FIT_TARGETS.some((t) => t < length) && (
            <div className="field"><span className="label" id="fit-h">Fit to a length <span className="muted small num">(now {formatTime(length)})</span></span>
              <div className="seg" role="group" aria-labelledby="fit-h">
                {FIT_TARGETS.filter((t) => t < length).map((t) => <button key={t} aria-pressed={fitTo === t} onClick={() => setFitTo(fitTo === t ? null : t)}>Under {t} s</button>)}
              </div>
              {fit && (<div className="fit-plan" aria-live="polite">
                <p className="small">
                  {fit.gapCap < e.gapCap ? "Tighter pauses" : ""}{fit.gapCap < e.gapCap && fit.drop.length ? ", and cut " : fit.drop.length ? "Cut " : ""}
                  {fit.drop.length ? (fit.drop.length === 1 ? "the line that grips least" : `the ${fit.drop.length} lines that grip least`) : ""}
                  {fit.drop.length || fit.gapCap < e.gapCap ? `: ${formatTime(fit.now)} → ${formatTime(fit.after)}.` : ""}
                  {!fit.reached && ` That's as short as it goes keeping your hook, your ending, your list (“the first one”, “step 2”) and three lines: try “Faster talking”, or cut a line yourself below.`}
                </p>
                {fit.drop.length > 0 && <ul className="small muted fit-drop">{fit.drop.map((d) => <li key={d.ids[0]}>“{d.text}” <span className="num">({d.seconds.toFixed(1)} s)</span></li>)}</ul>}
                {(fit.drop.length > 0 || fit.gapCap < e.gapCap) && <button type="button" className="btn sm" onClick={() => { setE(applyFit(p, e, fit)); setFitTo(null); }}>
                  {fit.drop.length > 1 ? "Cut them" : fit.drop.length ? "Cut it" : "Tighten the pauses"}</button>}
                <span className="hint">Your hook and ending stay. Bring any line back by clicking its words below.</span>
              </div>)}
            </div>
          )}
          {lines.length > 0 && (
            <div className="field"><span className="label" id="takes-h">Lines you said more than once</span>
              <span className="hint">The pressed take plays now. Hear each one, then pick another to play it in its place.</span>
              <ul className="takes" aria-labelledby="takes-h">
                {lines.map((L) => (
                  <li key={L.takes[0].range.from}>
                    <div className="seg" role="group" aria-label={`Takes of “${L.takes[L.playing < 0 ? 0 : L.playing].text.slice(0, 40)}”`}>
                      {L.takes.map((t, k) => (
                        <button key={t.range.from} aria-pressed={k === L.playing} title={t.text}
                          onClick={() => setE(pickTake(p, e, L, k))}>
                          Take {k + 1}{p.sources.length > 1 ? ` (${p.sources[t.src]?.name ?? ""} ` : " ("}{formatTime(t.s)})
                        </button>
                      ))}
                    </div>
                    <span className="hear"><span className="small muted">Hear</span>{L.takes.map((t, k) => (
                      <button key={`hear-${t.range.from}`} type="button" className="btn ghost sm" onClick={() => void hear(t)}
                        aria-label={hearing === t.range.from ? `Stop take ${k + 1}` : `Hear take ${k + 1}`} title={`“${t.text}”`}>
                        <Icon name={hearing === t.range.from ? "stop" : "play"} />{k + 1}</button>
                    ))}</span>
                    <p className="small muted take-text">{L.playing < 0 ? "None of these plays now. " : ""}“{L.takes[L.playing < 0 ? L.takes.length - 1 : L.playing].text}”</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {twice.length > 0 && (
            <div className="field"><span className="label" id="twice-h">Lines you say twice</span>
              <span className="hint">The same line plays again later. Saying it once usually lands harder.</span>
              <ul className="takes" aria-labelledby="twice-h">
                {twice.slice(0, 5).map((r) => (
                  <li key={r.again.ids[0]} className="row">
                    <span className="grow">“{r.again.text}” <span className="muted small num">at {formatTime(r.first.at)} and {formatTime(r.again.at)}</span></span>
                    <button type="button" className="btn sm" onClick={() => setE({ ...e, keep: cutWords(p, e.keep, r.again.ids) })}>
                      Cut the one at {formatTime(r.again.at)}</button>
                  </li>
                ))}
              </ul>
              {twice.length > 5 && <span className="hint">And {twice.length - 5} more: cut these and the next ones show.</span>}
            </div>
          )}
          {habits.length > 0 && (
            <div className="field"><span className="label" id="crutch-h">Words you say out of habit</span>
              <span className="hint">They fill time without saying anything. Cut them all at once, or click single ones in the words below.</span>
              <ul className="takes" aria-labelledby="crutch-h">
                {habits.map((c) => (
                  <li key={c.name} className="row">
                    <span>“{c.name}” <span className="muted small">{c.hits.length === 1 ? "once" : `${c.hits.length} times`}</span></span>
                    <button type="button" className="btn sm" onClick={() => setE({ ...e, keep: cutWords(p, e.keep, c.hits.flat()) })}>
                      Cut {c.hits.length === 1 ? "it" : `all ${c.hits.length}`}<span className="sr-only"> “{c.name}”</span></button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="field">
            <label htmlFor="find-w">Find in what you said</label>
            <div className="row">
              <input id="find-w" className="input grow" type="search" placeholder="A word or a few, e.g. subscribe" value={find}
                onChange={(ev) => setFind(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter") document.querySelector(".words .w.hit")?.scrollIntoView({ block: "center", behavior: "smooth" }); }} />
              {found.length > 0 && foundKept > 0 && <button type="button" className="btn sm" onClick={() => setE({ ...e, keep: cutWords(p, e.keep, found.flat()) })}>
                Cut {foundKept === 1 ? "it" : `all ${foundKept}`}</button>}
              {found.length > foundKept && <button type="button" className="btn sm" onClick={() => setE({ ...e, keep: restoreWords(p, e.keep, found.flat()) })}>
                Bring back {found.length - foundKept === 1 ? "the cut one" : `${found.length - foundKept} cut`}</button>}
            </div>
            <span className="hint" aria-live="polite">{find.trim() ? (found.length ? `Said ${found.length === 1 ? "once" : `${found.length} times`}${found.length > foundKept ? `, ${found.length - foundKept} of them cut` : ""}. Enter jumps to the first.` : "Not said anywhere.") : ""}</span>
          </div>
          <div className="words" aria-label="Transcript">
            {p.words.map((w, i) => !w.w.trim() ? null : (
              <span key={w.id}>
                {i > 0 && (p.words[i - 1].src !== w.src || w.s - p.words[i - 1].e > 1) && <br />}
                <button className={`w ${kept.has(w.id) ? "" : "cut"}${hit.has(w.id) ? " hit" : ""}`} aria-pressed={!kept.has(w.id)} onClick={() => toggleWord(w.id)}>{w.w}</button>{" "}
              </span>
            ))}
          </div>
        </>)}

        {tab === "Subtitles" && (<>
          <label className="check"><input type="checkbox" checked={e.captions.enabled} onChange={(ev) => cap({ enabled: ev.target.checked })} />
            <span>Show subtitles</span></label>
          <div className="field"><span className="label">Style</span>{opt(e.captions.preset, PRESETS, (v) => cap(v === "boxed" && e.captions.preset !== "boxed" ? { preset: v, ...BOXED_DEFAULTS } : { preset: v }), "Subtitle style")}</div>
          <div className="field"><span className="label">Size</span>{opt(e.captions.size, [[84, "Small"], [105, "Medium"], [126, "Big"]], (v) => cap({ size: v }), "Size")}</div>
          <div className="field"><span className="label">Position</span>{opt(e.captions.position, [[0.66, "Higher"], [0.75, "Lower"]], (v) => cap({ position: v }), "Position")}</div>
          <div className="field">
            <label htmlFor="case">Case</label>
            <select id="case" className="select" value={e.captions.textCase} onChange={(ev) => cap({ textCase: ev.target.value as Edit["captions"]["textCase"] })}>
              <option value="upper">UPPER CASE</option><option value="as-is">As said</option><option value="lower">lower case</option></select>
          </div>
          <div className="field">
            <span className="label">Language</span>
            <div className="row">
              <span className="badge">{e.translation ? `${e.translation.lang} (translated)` : "As spoken"}</span>
              <label className="sr-only" htmlFor="lang">Translate into</label>
              <select id="lang" className="select w-200" value={lang} onChange={(ev) => setLang(ev.target.value)}>{LANGUAGES.map((l) => <option key={l}>{l}</option>)}</select>
              <button className="btn" disabled={!hasKey || tBusy} onClick={async () => {
                setTBusy(true); setTErr("");
                try {
                  const tl = buildTimeline(p.words, e, p.sources.map((x) => x.duration));
                  const tr = await translateSubtitles(settings!, tl, lang);
                  setE((cur) => ({ ...cur, translation: tr }));          // keep what was changed while it translated
                }
                catch (err) { setTErr((err as { userMessage?: string }).userMessage ?? String(err)); }
                setTBusy(false); }}>{tBusy ? <><span className="spin" />Translating…</> : "Translate"}</button>
              {e.translation && <button className="btn ghost" onClick={() => setE({ ...e, translation: undefined })}>Back to as spoken</button>}
            </div>
            {!hasKey && <span className="hint">Translating needs an AI key in Settings.</span>}
            {tErr && <span className="field-error">{tErr}</span>}
            {e.translation && <span className="hint">One subtitle line per phrase. Fix a line by editing it below.</span>}
            {e.translation && <div className="tr-lines">{e.translation.lines.map((l, i) => (
              <input key={l.from} className="input" aria-label={`Line ${i + 1}`} value={l.text}
                onChange={(ev) => setE({ ...e, translation: { ...e.translation!, lines: e.translation!.lines.map((x, k) => (k === i ? { ...x, text: ev.target.value } : x)) } })} />))}</div>}
          </div>
          <div className="field">
            <label htmlFor="font">Font (any Google Font name)</label>
            <input id="font" className="input" value={e.captions.font} autoComplete="off" spellCheck={false} onChange={(ev) => cap({ font: ev.target.value })}
              onBlur={(ev) => loadFont(ev.target.value)} />
          </div>
          {onWords && <ScriptFix project={p} onChange={onWords} />}
          {doubts.some((d) => !okWords.has(d.id)) && (
            <div className="field"><span className="label" id="doubt-h">Words I wasn&apos;t sure I heard</span>
              <span className="hint">Names and jargon are where subtitles go wrong. Type the right word to fix it everywhere it&apos;s said.</span>
              <ul className="takes" aria-labelledby="doubt-h">
                {doubts.filter((d) => !okWords.has(d.id)).map((d) => (
                  <li key={d.id}>
                    <form className="row" onSubmit={(ev) => {
                      ev.preventDefault();
                      const to = String(new FormData(ev.currentTarget).get("to") ?? "").trim();
                      if (to && to !== d.word) setE({ ...e, corrections: [...e.corrections, { from: d.word.replace(/[.,!?;:]+$/, ""), to }] });
                    }}>
                      <span className="grow small"><span className="muted num">{formatTime(d.at)}</span> {d.before} <b className="doubt">{d.word}</b> {d.after}</span>
                      <input name="to" className="input w-120" defaultValue={d.word.replace(/[.,!?;:]+$/, "")} aria-label={`Right word for “${d.word}” at ${formatTime(d.at)}`} autoComplete="off" />
                      <button className="btn sm">Fix</button>
                      <button type="button" className="btn ghost sm" onClick={() => setOkWords(new Set([...okWords, d.id]))}>Looks right</button>
                    </form>
                  </li>
                ))}
              </ul>
            </div>
          )}
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

        {tab === "Motion" && (<>
          <div className="field"><span className="label">Subtitle animation</span>
            {opt(mo.captionAnim, CAPTION_ANIMS.map((a) => [a, ANIM_NAME[a]] as [CaptionAnim, string]), (v) => mov({ captionAnim: v }), "Subtitle animation")}</div>
          <div className="field"><span className="label">Highlight colour</span>
            <div className="row">
              <div className="chips" role="group" aria-label="Highlight colour">{ACCENTS.map((c) => (
                <button key={c} className="dot-btn" style={{ background: c }} aria-pressed={mo.accent.toLowerCase() === c.toLowerCase()} aria-label={`Highlight ${c}`}
                  onClick={() => mov({ accent: c })} />))}</div>
              <label className="sr-only" htmlFor="accent">Pick any colour</label>
              <input id="accent" type="color" className="color" value={mo.accent} onChange={(ev) => mov({ accent: ev.target.value })} />
            </div>
          </div>
          <label className="check"><input type="checkbox" checked={mo.emphasis} onChange={(ev) => mov({ emphasis: ev.target.checked })} />
            <span>Highlight numbers and keywords</span></label>
          <div className="field"><span className="label">At every cut</span>
            {opt(mo.transition, TRANSITIONS.map((a) => [a, CUT_NAME[a]] as [Transition, string]), (v) => mov({ transition: v }), "Transition")}</div>
          <div className="field"><span className="label">Colour look</span>
            {opt(mo.look, LOOKS.map((a) => [a, LOOK_NAME[a]] as [Look, string]), (v) => mov({ look: v }), "Colour look")}</div>
          <div className="field"><span className="label">Pictures come in with</span>
            {opt(mo.brollIn, BROLL_INS.map((a) => [a, IN_NAME[a]] as [BrollIn, string]), (v) => mov({ brollIn: v }), "Picture entrance")}</div>
          <label className="check"><input type="checkbox" checked={mo.kenBurns} onChange={(ev) => mov({ kenBurns: ev.target.checked })} />
            <span>Slow push-in on still pictures</span></label>
          <label className="check"><input type="checkbox" checked={mo.progress} onChange={(ev) => mov({ progress: ev.target.checked })} />
            <span>Progress bar along the top</span></label>
        </>)}

        {tab === "Music" && (<>
          <div className="field" role="radiogroup" aria-label="Song">
            <label className="check"><input type="radio" name="song" checked={!e.music.asset} onChange={() => setE({ ...e, music: { ...e.music, asset: null } })} />
              <span>No music</span></label>
            {music.map((m) => (
              <label key={m.key} className="check"><input type="radio" name="song" checked={e.music.asset === m.key}
                onChange={() => setE({ ...e, music: { ...e.music, asset: m.key } })} /><span>{m.name} <span className="faint small">sounds {m.feel}</span>
                {m.origin === "composed" && <span className="badge good song-badge">Original · royalty-free</span>}</span></label>))}
            {!music.length && <p className="small muted">Add a song with &ldquo;Add a song, picture or clip&rdquo; under the notes, or make one.</p>}
          </div>
          {onMakeMusic && <div className="row">
            <button className="btn" onClick={onMakeMusic}><Icon name="music" />Make music</button>
            <span className="hint">An original bed for this video, composed in your browser. No key needed.</span>
          </div>}
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
              <span className="grow">On &ldquo;{textOf(b.anchor)}&rdquo;: {b.treatment === "text-pop" ? `“${b.text}”` : b.treatment === "motion" ? `“${b.card?.text || b.card?.items?.join(" / ") || ""}”` : p.library.find((a) => a.key === b.asset)?.name}
                <span className="faint"> · {LABEL[b.treatment]}</span></span>
              {b.treatment !== "text-pop" && b.treatment !== "motion" && <select className="select w-200" aria-label="Where it goes" value={b.treatment} onChange={(ev) => setE({ ...e,
                broll: e.broll.map((x) => (x.id === b.id ? { ...x, treatment: ev.target.value as Broll["treatment"] } : x)) })}>
                {PLACES.map((t) => <option key={t} value={t}>{LABEL[t]}</option>)}</select>}
              {b.treatment === "framed" && <label className="check"><input type="checkbox" checked={!!b.full} onChange={(ev) => setE({ ...e,
                broll: e.broll.map((x) => (x.id === b.id ? { ...x, full: ev.target.checked || undefined } : x)) })} /><span>Fill the frame</span></label>}
              <button className="btn ghost sm" onClick={() => setE({ ...e, broll: e.broll.filter((x) => x.id !== b.id) })}>Remove</button>
            </div>))}
          {screenClips.map((a) => <WaitsRow key={a.key} a={a} scan={scan?.key === a.key ? scan : null} onFind={onFindWaits} onStop={onStopScan}
            onChange={(on) => { a.speedWaits = on; onClip?.(); }} />)}
          <div className="field">
            <span className="label">Add an animated card</span>
            <div className="row">
              <label className="sr-only" htmlFor="card-kind">Kind</label>
              <select id="card-kind" className="select w-200" value={card.kind} onChange={(ev) => setCard({ ...card, kind: ev.target.value as keyof typeof CARD_NAME })}>
                {(Object.keys(CARD_NAME) as (keyof typeof CARD_NAME)[]).map((k) => <option key={k} value={k}>{CARD_NAME[k]}</option>)}</select>
              <input className="input grow" aria-label="Words on the card" value={card.text} autoComplete="off" onChange={(ev) => setCard({ ...card, text: ev.target.value })}
                placeholder={card.kind === "number" ? "What the number is, e.g. videos every Sunday…" : card.kind === "statement" ? "A short line…" : "A heading (optional)…"} />
            </div>
            {card.kind === "number" && <input className="input" type="number" aria-label="The number" value={card.value} onChange={(ev) => setCard({ ...card, value: ev.target.value })} placeholder="4" />}
            {(card.kind === "list" || card.kind === "compare") && <textarea className="textarea" rows={3} aria-label="One per line" value={card.items}
              onChange={(ev) => setCard({ ...card, items: ev.target.value })} placeholder={card.kind === "compare" ? "Before\nAfter…" : "One item per line…"} />}
            <div className="row"><button className="btn" disabled={card.kind === "number" ? !card.value : card.kind === "statement" ? !card.text.trim() : !card.items.trim()}
              onClick={() => setPicFor("__card")}>Pick the word where it shows</button></div>
          </div>
          <div className="field">
            <label htmlFor="ai-pic">Make a picture with AI</label>
            <div className="row">
              <input id="ai-pic" className="input grow" value={imgPrompt} autoComplete="off" onChange={(ev) => setImgPrompt(ev.target.value)}
                placeholder="e.g. a messy desk at 2am lit by a laptop, photo…" />
              <label className="sr-only" htmlFor="ai-size">Shape</label>
              <select id="ai-size" className="select w-200" value={imgSize} onChange={(ev) => setImgSize(ev.target.value as typeof imgSize)}>
                <option value="1536x1024">Wide</option><option value="1024x1024">Square</option><option value="1024x1536">Tall</option></select>
              <button className="btn" disabled={!settings?.openaiKey || !imgPrompt.trim() || imgBusy} onClick={async () => {
                setImgBusy(true); setImgErr("");
                try {
                  const blob = await aiPicture(settings!.openaiKey, imgPrompt, imgSize);
                  const name = `AI ${imgPrompt.trim().slice(0, 28)}.png`;
                  const [added] = await addToLibrary(p, [new File([blob], name, { type: "image/png" })]);
                  const a = [...p.library].reverse().find((x) => x.name === added);   // the one just added, not an older same-named one
                  if (a) { a.ai = true; a.credit = { title: imgPrompt.trim().slice(0, 120), creator: "AI (OpenAI gpt-image-1)", license: "ai", page: "", source: "openai" }; setPicFor(a.key); }
                  await saveProject(p);
                  setImgPrompt("");
                } catch (err) { setImgErr((err as { userMessage?: string }).userMessage ?? String(err)); }
                setImgBusy(false); }}>{imgBusy ? <><span className="spin" />Making it…</> : "Make it"}</button>
            </div>
            <span className="hint">{settings?.openaiKey ? "Uses your OpenAI key (a few cents a picture). Then click the word where it should pop up. AI pictures are labelled." : "Needs an OpenAI key in Settings."}</span>
            {imgErr && <span className="field-error">{imgErr}</span>}
          </div>
          <div className="field">
            <span className="label">Add a picture: pick one, then click the word where it should pop up</span>
            <div className="chips">{pictures.slice(0, 12).map((a) => (
              <button key={a.key} className="chip" aria-pressed={picFor === a.key} onClick={() => setPicFor(a.key)}>{a.name.slice(0, 24)}</button>))}</div>
            {!pictures.length && <p className="small muted">Add pictures or clips with &ldquo;Add a song, picture or clip&rdquo; under the notes.</p>}
          </div>
          {picFor && <div className="words" aria-label="Pick a word">
            {p.words.filter((w) => kept.has(w.id) && w.w.trim()).map((w, k, arr) => (
              <button key={w.id} className="w" onClick={() => {
                const end = arr.slice(k).find((x) => x.e - w.s >= (picFor === "__card" ? 2.6 : 2.0)) ?? arr[arr.length - 1];
                if (picFor === "__card") {
                  const items = card.items.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 5);
                  setE({ ...e, broll: [...e.broll, { id: `c${Date.now()}`, anchor: { from: w.id, to: end.id }, treatment: "motion",
                    card: { kind: card.kind, text: card.text.trim(), value: card.kind === "number" ? Number(card.value) : undefined, items: items.length ? items : undefined } }] });
                  setCard({ kind: card.kind, text: "", value: "", items: "" });
                } else setE({ ...e, broll: [...e.broll, { id: `m${Date.now()}`, anchor: { from: w.id, to: end.id }, asset: picFor,
                  treatment: p.library.find((a) => a.key === picFor)?.screen ? "framed" : "card-above-head" }] });
                setPicFor(null);
              }}>{w.w}</button>))}
          </div>}
        </>)}

        {tab === "Cover" && (<>
          <div className="field">
            <label htmlFor="cover-word">The moment for your cover (pick a word)</label>
            <select id="cover-word" className="select" value={e.cover.word ?? ""} onChange={(ev) => setE({ ...e, cover: { ...e.cover, word: ev.target.value || null } })}>
              <option value="">Automatic</option>
              {p.words.filter((w) => kept.has(w.id) && w.w.trim()).map((w) => <option key={w.id} value={w.id}>{w.w} ({w.s.toFixed(1)}s)</option>)}
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
            <input id="tags" className="input" value={tagsText ?? e.post.hashtags.join(" ")} autoComplete="off" spellCheck={false} onChange={(ev) => {
              setTagsText(ev.target.value);                            // the text as typed: spaces and commas stay while typing
              setE({ ...e, post: { ...e.post, hashtags: parseTags(ev.target.value) } });
            }} onBlur={() => setTagsText(null)} />
            <span className="hint num">{e.post.hashtags.length} of 5</span>
          </div>
          {(() => {
            const f = postFit(e.post.caption, e.post.hashtags);
            return (
              <div className="field"><span className="label" id="fit-apps-h">Fits each app</span>
                <ul className="fit-apps" aria-labelledby="fit-apps-h">
                  {f.fits.map((x) => <li key={x.app} className={x.ok ? "ok" : "bad"}><Icon name={x.ok ? "check" : "alert"} /><b>{x.app}</b>{" "}
                    <span className="muted small num">{x.text}</span></li>)}
                </ul>
                {f.shown && <p className="small"><span className="muted">Seen before &ldquo;…more&rdquo; on Instagram:</span> &ldquo;{f.shown}{f.cut ? "…" : ""}&rdquo;
                  {f.cut && <span className="hint block">Put the hook in those first words: the rest is hidden until someone taps.</span>}</p>}
              </div>
            );
          })()}
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

/** "Speed through waits" for one screen recording: the switch, what it saves, and a strip showing where the waits are.
 *  It belongs to the clip (like its trim), so it changes the preview straight away, in every version. */
function WaitsRow({ a, scan, onFind, onStop, onChange }: { a: Asset; scan: Scan; onFind?: (key: string) => void; onStop?: () => void;
  onChange: (on: boolean) => void }) {
  const id = `waits-${a.key.replace(/[^a-z0-9]/gi, "")}`;
  const name = a.name.length > 40 ? `${a.name.slice(0, 38)}…` : a.name;
  const dur = a.duration && Number.isFinite(a.duration) ? a.duration : 0;
  const w = waitSavings(a), on = a.speedWaits !== false;
  const pct = (x: number) => `${(100 * Math.min(Math.max(x, 0), dur)) / Math.max(0.001, dur)}%`;
  const trim = a.trim ?? { start: 0, end: dur };
  return (
    <div className="field waits" role="group" aria-labelledby={`${id}-h`}>
      <span className="waits-h" id={`${id}-h`}><Icon name="screen" /><span className="label">Screen recording</span><span className="waits-name">{name}</span></span>
      {a.waits === undefined ? (scan
        ? <p className="small muted waits-busy"><span className="spin" aria-hidden="true" />Looking for waits (stretches where nothing on screen moves)…
          <span className="num"> {scan.pct}%</span>
          {onStop && <button type="button" className="btn ghost sm" onClick={onStop}>Stop</button>}</p>
        : <div className="row">
          {onFind && <button type="button" className="btn sm" onClick={() => onFind(a.key)}>Find waits</button>}
          <span className="hint">Finds the stretches where nothing on screen moves, so they can play {WAIT_SPEED} times faster.</span></div>)
      : !w.count ? <p className="hint">No waits found: something on screen moves the whole time.</p>
      : <>
        <label className="check">
          <input type="checkbox" checked={on} aria-describedby={`${id}-d`} onChange={(ev) => onChange(ev.target.checked)} />
          <span>Speed through waits (×{WAIT_SPEED})<span className="hint block" id={`${id}-d`}>Found {w.count} wait{w.count === 1 ? "" : "s"}
            {" "}({Math.round(w.seconds)} s where nothing moves), saves {w.saves.toFixed(1)} s. It plays for <span className="num">
            {formatTime(playedLength(a) ?? dur, true)}</span>{on ? "" : " at normal speed"}.</span></span>
        </label>
        <div className="rec-strip waits-strip" aria-hidden="true">
          <i className="rec-keep" style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }} />
          {a.waits!.map(([s, e]) => <i key={s} className={`rec-wait ${on ? "on" : ""}`} style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} />)}
        </div>
      </>}
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
