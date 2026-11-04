"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { FORMATS } from "@/lib/compositor";
import { uid } from "@/lib/media";
import { deleteAnim, getMedia, listAnims, putMedia, saveAnim } from "@/lib/store";
import { hasBrand, applyBrand } from "@/lib/brand";
import { FONTS, fontOf, KIND_NAME, newAnim, PACE_NAME, paletteOf, PALETTES, planScenes, readTime, total, type Anim, type FontId, type Pace, type PaletteId, type Scene, type SceneKind } from "@/lib/studio";
import { narration, planWithAi, speak, voicedDuration, VOICES, type Tone } from "@/lib/studioAi";
import { StudioPlayer } from "@/lib/studioPlay";
import { canFastExport, exportAnimFast } from "@/lib/fastExport";
import { aiPicture } from "@/lib/images";
import type { Format, Settings } from "@/lib/types";
import { Icon } from "./Icons";
import { ago, clock } from "./Tiles";

const EXAMPLES = [
  { name: "Product launch", text: "Cutmind turns raw takes into finished reels.\nIt keeps your best take of every line.\nEditing used to take 3 hours. Now it takes 20 minutes.\n- Subtitles on every word\n- Pictures that miss your face\n- Music under your voice\nTry it on your next video." },
  { name: "Editing tips", text: "Why your videos stop getting views.\nMost viewers decide in the first 2 seconds.\nA slow intro loses 65% of them.\nOpen with the payoff, not the setup.\nCut every pause longer than half a second.\nFollow for one editing tip a day." },
  { name: "Milestone", text: "We just hit 10,000 creators.\nThank you for every video, note and idea.\nFrom 12 people in a group chat to 10,000 makers.\nNext month: four new styles and team folders.\nJoin the community." },
];
const palIdsFor = (brand: boolean): PaletteId[] => [...(brand ? ["brand" as PaletteId] : []), ...(Object.keys(PALETTES) as PaletteId[])];
const fontIdsFor = (brand: boolean): FontId[] => [...(Object.keys(FONTS) as FontId[]), ...(brand ? ["brand" as FontId] : [])];

const TONES: [Tone, string][] = [["explainer", "Explainer"], ["promo", "Promo"], ["story", "Story"], ["announcement", "Announcement"]];

export function Studio({ settings, onSettings, openId }: { settings: Settings; onSettings: () => void; openId?: string }) {
  const [list, setList] = useState<Anim[] | null>(null);
  const [a, setA] = useState<Anim | null>(null);
  const [text, setText] = useState("");
  const [tone, setTone] = useState<Tone>("explainer");
  const [palette, setPalette] = useState<PaletteId>("midnight");
  const [font, setFont] = useState<FontId>("grotesk");
  const [format, setFormat] = useState<Format>("9:16");
  const [pace, setPace] = useState<Pace>("normal");
  const [voiceOn, setVoiceOn] = useState(false);
  const [voice, setVoice] = useState<string>("nova");
  const [song, setSong] = useState<File | null>(null);
  const [link, setLink] = useState("");
  const [reading, setReading] = useState(false);
  const [aiPics, setAiPics] = useState(true);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const aiKey = settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;
  const branded = hasBrand(settings.brand);
  const palIds = palIdsFor(branded), fontIds = fontIdsFor(branded);
  const [, setBrandReady] = useState(0);
  useEffect(() => { void applyBrand(settings.brand).then(() => setBrandReady((n) => n + 1)); }, [settings.brand]);
  const refresh = useCallback(() => void listAnims().then(setList), []);
  useEffect(refresh, [refresh]);
  useEffect(() => { if (openId && list && !a) { const hit = list.find((x) => x.id === openId); if (hit) setA(hit); } }, [openId, list, a]);

  async function create() {
    setErr(""); setBusy(aiKey ? "Planning the scenes…" : "Laying out the scenes…");
    try {
      let plan: { title: string; palette?: PaletteId; font?: FontId; scenes: Scene[] };
      if (aiKey) plan = await planWithAi(settings, text, tone, format);
      else plan = { title: "", scenes: planScenes(text) };
      if (!plan.scenes.length) throw Object.assign(new Error("empty"), { userMessage: "Write a little more: a line or two is enough." });
      const anim = newAnim(text, plan.scenes, { title: plan.title || undefined, palette: plan.palette ?? palette, font: plan.font ?? font, format, pace });
      if (!plan.title) anim.title = plan.scenes[0].text.slice(0, 60);
      if (song) { const key = `anim:${anim.id}:music`; await putMedia(key, song); anim.music = key; }
      if (aiPics && settings.openaiKey) {
        const pics = anim.scenes.filter((x) => x.kind === "image");
        for (const [i, sc] of pics.entries()) {
          setBusy(`Making picture ${i + 1} of ${pics.length}…`);
          try { sc.image = await makePicture(settings.openaiKey, anim, sc.picture || sc.text); } catch { /* the scene shows "Add a picture" */ }
        }
      }
      if (voiceOn && settings.openaiKey) await addVoice(anim, voice, setBusy);
      await saveAnim(anim);
      setA(anim); refresh();
    } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
    setBusy("");
  }

  async function addVoice(anim: Anim, name: string, progress: (m: string) => void) {
    const keys: Record<string, string> = {};
    for (const [i, s] of anim.scenes.entries()) {
      progress(`Recording the voiceover (${i + 1} of ${anim.scenes.length})…`);
      const { blob, seconds } = await speak(settings.openaiKey, narration(s), name);
      const key = `anim:${anim.id}:voice:${s.id}:${uid()}`;
      await putMedia(key, blob);
      keys[s.id] = key;
      s.duration = voicedDuration(s, seconds);
    }
    anim.voice = { name, keys };
  }

  if (a) return <StudioEditor key={a.id} anim={a} settings={settings} onBack={() => { setA(null); refresh(); if (openId) history.replaceState(null, "", "#animate"); }}
    onVoice={async (anim, name, progress) => { await addVoice(anim, name, progress); }} />;

  return (
    <div className="page">
      <div className="page-head"><div><h1>Animate</h1><p>Turn any text into a polished animated video: kinetic type, counters, lists, charts and a closing
        card, in your colours. Paste a script, an announcement or a few bullet points.</p></div></div>
      <div className="studio-new">
        <section className="panel stack">
          <div className="field">
            <label htmlFor="anim-link">Start from a link (optional)</label>
            <div className="key-row">
              <input id="anim-link" className="input" type="url" inputMode="url" spellCheck={false} autoComplete="off" value={link}
                onChange={(e) => setLink(e.target.value)} placeholder="https://… an article, a launch post, a product page…" />
              <button className="btn" disabled={!/^https?:\/\/\S+\.\S+/.test(link) || reading} onClick={async () => {
                setReading(true); setErr("");
                try { const r = await fetch(`/api/read?url=${encodeURIComponent(link)}`); const d = await r.json() as { title?: string; text?: string; error?: string };
                  if (!r.ok) throw Object.assign(new Error(d.error), { userMessage: d.error });
                  setText([d.title, d.text].filter(Boolean).join("\n").slice(0, 6000)); }
                catch (e) { setErr((e as { userMessage?: string }).userMessage ?? "That page couldn't be read."); }
                setReading(false); }}>{reading ? <><span className="spin" />Reading…</> : "Read it"}</button>
            </div>
            <span className="hint">Cutmind reads the page's text into the box below. Your AI then picks what matters.</span>
          </div>
          <div className="field">
            <label htmlFor="anim-text">What should it say?</label>
            <textarea id="anim-text" className="textarea" rows={9} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"Your idea, script or notes. Short lines work best. Numbers become counters, bullet points become lists…"} />
          </div>
          <div className="chips" aria-label="Examples">
            {EXAMPLES.map((x) => <button key={x.name} className="chip" onClick={() => setText(x.text)}>{x.name}</button>)}
          </div>
          <div className="field"><span className="label">It&apos;s a</span>
            <div className="seg" role="group" aria-label="Tone">{TONES.map(([v, n]) => <button key={v} aria-pressed={tone === v} onClick={() => setTone(v)}>{n}</button>)}</div>
          </div>
          {err && <div className="alert err" role="alert"><Icon name="alert" /><span>{err}</span></div>}
          <div className="row">
            <button className="btn primary lg" disabled={!text.trim() || !!busy} onClick={create}>
              {busy ? <><span className="spin" />{busy}</> : <><Icon name="wand" />Animate it</>}</button>
            <span className="small muted">{aiKey ? "Your AI plans the scenes and writes the voiceover lines." : <>No AI key: the scenes follow your lines. <button className="link" onClick={onSettings}>Add a key</button> for AI planning.</>}</span>
          </div>
        </section>
        <section className="panel stack">
          <h2>Look and sound</h2>
          <div className="field"><span className="label">Colours</span>
            <div className="palettes" role="group" aria-label="Colours">
              {palIds.map((k) => (
                <button key={k} className="pal" aria-pressed={palette === k} onClick={() => setPalette(k)} title={paletteOf(k).name}>
                  <span style={{ background: paletteOf(k).bg }}><i style={{ background: paletteOf(k).accent }} /><i style={{ background: paletteOf(k).accent2 }} /></span>
                  {paletteOf(k).name}</button>))}
            </div>
            {aiKey && <span className="hint">The AI may pick colours and type that suit the subject; change them after.</span>}
          </div>
          <div className="field"><span className="label">Type</span>
            <div className="seg" role="group" aria-label="Type">{fontIds.map((k) => (
              <button key={k} aria-pressed={font === k} onClick={() => setFont(k)} style={{ fontFamily: fontOf(k).family }}>{fontOf(k).name}</button>))}</div>
          </div>
          <div className="field"><span className="label">Shape</span>
            <div className="seg" role="group" aria-label="Shape">{(Object.keys(FORMATS) as Format[]).map((f) => (
              <button key={f} aria-pressed={format === f} onClick={() => setFormat(f)}>{f} {FORMATS[f].name}</button>))}</div>
          </div>
          <div className="field"><span className="label">Pace</span>
            <div className="seg" role="group" aria-label="Pace">{(Object.keys(PACE_NAME) as Pace[]).map((v) => (
              <button key={v} aria-pressed={pace === v} onClick={() => setPace(v)}>{PACE_NAME[v]}</button>))}</div>
            <span className="hint">Hype puts one huge word on screen at a time, the colours flipping on the key words.</span>
          </div>
          <label className="check"><input type="checkbox" checked={voiceOn} disabled={!settings.openaiKey} onChange={(e) => setVoiceOn(e.target.checked)} />
            <span>Read it aloud{settings.openaiKey ? "" : " (needs an OpenAI key)"}<span className="hint block">A natural AI voice reads each scene, and the scenes
              take as long as the voice.</span></span></label>
          {voiceOn && <div className="field"><label htmlFor="voice">Voice</label>
            <select id="voice" className="select" value={voice} onChange={(e) => setVoice(e.target.value)}>{VOICES.map((v) => <option key={v} value={v}>{v}</option>)}</select></div>}
          <label className="check"><input type="checkbox" checked={aiPics && !!settings.openaiKey} disabled={!settings.openaiKey} onChange={(e) => setAiPics(e.target.checked)} />
            <span>Make AI pictures for picture scenes{settings.openaiKey ? "" : " (needs an OpenAI key)"}<span className="hint block">When the AI plans a picture
              scene, OpenAI makes the picture (a few cents each). AI pictures are labelled when you export.</span></span></label>
          <div className="field"><label htmlFor="anim-song">Music (optional)</label>
            <input id="anim-song" type="file" accept="audio/*" className="input" onChange={(e) => setSong(e.target.files?.[0] ?? null)} />
            <span className="hint">Only music you own or are licensed to use.</span></div>
        </section>
      </div>

      <section className="panel mt-16" aria-labelledby="anims-h">
        <div className="panel-head"><h2 id="anims-h">Your animations</h2></div>
        {!list && <div className="skel boot-head" />}
        {list && !list.length && <p className="muted">Nothing yet. Pick an example above and press Animate it.</p>}
        {list && list.length > 0 && (
          <div className="anim-list">
            {list.map((x) => (
              <div key={x.id} className="anim-row">
                <span className="sw" style={{ background: paletteOf(x.palette).bg }}><i style={{ background: paletteOf(x.palette).accent }} /></span>
                <button className="grow anim-open" onClick={() => setA(x)}><b className="trunc">{x.title}</b>
                  <span className="small faint">{x.scenes.length} scenes · {clock(total(x))} · {x.format} · {ago(x.updatedAt)}</span></button>
                <button className="btn ghost sm" onClick={async () => { if (confirm(`Delete "${x.title}"?`)) { await deleteAnim(x); refresh(); } }}><Icon name="trash" />Delete</button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StudioEditor({ anim, settings, onBack, onVoice }: { anim: Anim; settings: Settings; onBack: () => void;
  onVoice: (a: Anim, name: string, progress: (m: string) => void) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<StudioPlayer | null>(null);
  const [a, setA] = useState<Anim>(anim);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<"Scenes" | "Look">("Scenes");
  const [exp, setExp] = useState<{ pct: number; url?: string; ext?: string; still?: string; fast?: boolean } | null>(null);
  const [fast, setFast] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const dur = total(a);
  const branded = hasBrand(settings.brand);
  const palIds = palIdsFor(branded), fontIds = fontIdsFor(branded);

  const urlsFor = useCallback(async (x: Anim) => {
    const m = new Map<string, string>();
    for (const k of [x.music, ...Object.values(x.voice?.keys ?? {}), ...x.scenes.map((sc) => sc.image)].filter(Boolean) as string[]) {
      const b = await getMedia(k); if (b) m.set(k, URL.createObjectURL(b));
    }
    return m;
  }, []);

  useEffect(() => {
    let live = true;
    void (async () => {
      await document.fonts.load(`800 80px ${fontOf(a.font).family}`).catch(() => undefined);
      const urls = await urlsFor(a);
      if (!live || !canvas.current) return;
      const pl = new StudioPlayer(canvas.current, a, urls);
      pl.onTime = setT; pl.onEnd = () => setPlaying(false);
      player.current = pl;
      pl.draw(Math.min(1.4, a.scenes[0]?.duration ?? 1));
    })();
    return () => { live = false; player.current?.dispose(); player.current = null; };
    // the player is made once; edits go through setAnim below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = useCallback((next: Anim) => {
    setA(next);
    void document.fonts.load(`800 80px ${fontOf(next.font).family}`).catch(() => undefined).then(() => player.current?.setAnim(next));
    void saveAnim(next);
  }, []);
  const scene = (id: string, k: Partial<Scene>) => update({ ...a, scenes: a.scenes.map((s) => (s.id === id ? { ...s, ...k } : s)) });
  const move = (i: number, d: number) => { const sc = [...a.scenes]; const [x] = sc.splice(i, 1); sc.splice(i + d, 0, x); update({ ...a, scenes: sc }); };
  const jump = (i: number) => { const start = a.scenes.slice(0, i).reduce((n, s) => n + s.duration, 0); player.current?.seek(start + Math.min(1.4, a.scenes[i].duration - 0.2)); };

  async function toggle() {
    const pl = player.current; if (!pl) return;
    if (playing) { pl.pause(); setPlaying(false); } else { setPlaying(true); await pl.play(); }
  }
  async function exportIt() {
    const pl = player.current; if (!pl) return;
    setExp({ pct: 0 }); setPlaying(true);
    try {
      let out: { blob: Blob; ext: string } | null = null;
      if (canFastExport()) {
        pl.pause();
        const t0 = performance.now();
        try { out = { blob: await exportAnimFast(a, await urlsFor(a), (pct) => setExp((x) => ({ ...x!, pct, fast: true }))), ext: "mp4" }; }
        catch (e) { console.warn("fast export fell back to recording", e); }
        if (out) setFast(+((dur * 1000) / (performance.now() - t0)).toFixed(1));
      }
      const { blob, ext } = out ?? await pl.record((pct) => setExp((x) => ({ ...x!, pct })));
      const still = await pl.still();
      setExp({ pct: 100, url: URL.createObjectURL(blob), ext, still: URL.createObjectURL(still) });
    } catch (e) { setErr(String(e)); setExp(null); }
    setPlaying(false);
  }
  async function revoice(name: string) {
    setErr(""); setBusy("Recording the voiceover…");
    try {
      const next = structuredClone(a);
      await onVoice(next, name, setBusy);
      player.current?.setUrls(await urlsFor(next));
      update(next);
    } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
    setBusy("");
  }

  async function setPicture(id: string, key: string) {
    const next = { ...a, scenes: a.scenes.map((x) => (x.id === id ? { ...x, image: key } : x)) };
    player.current?.setUrls(await urlsFor(next));
    update(next);
  }

  const shape = FORMATS[a.format];
  const recording = !!exp && exp.pct < 100;
  const name = a.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 60) || "animation";
  return (
    <div className="page">
      <div className="ed-head">
        <button className="btn ghost sm" onClick={onBack}><Icon name="arrowLeft" />All animations</button>
        <h1 className="grow trunc">{a.title}</h1>
        <button className="btn primary" onClick={exportIt} disabled={recording}><Icon name="download" />Export</button>
      </div>
      <div className={`ed-grid ${shape.w > shape.h ? "wide" : ""}`}>
        <div className="preview">
          <div className={`phone ${shape.w >= shape.h ? "flat" : ""}`}><canvas ref={canvas} style={{ aspectRatio: `${shape.w} / ${shape.h}` }} role="img"
            aria-label={`Preview of the animation ${a.title}`} /></div>
          <div className="transport">
            <button className="play" onClick={toggle} disabled={recording} aria-label={playing ? "Pause" : "Play"}><Icon name={playing ? "pause" : "play"} /></button>
            <input type="range" className="scrub" min={0} max={dur || 1} step={0.01} value={t} aria-label="Position"
              onChange={(ev) => { const v = +ev.target.value; setT(v); player.current?.seek(v); }} />
            <span className="time">{clock(t)} / {clock(dur)}</span>
          </div>
          <div className="scene-strip" role="group" aria-label="Scenes">
            {a.scenes.map((s, i) => <button key={s.id} className="chip" onClick={() => jump(i)} title={s.text}>{i + 1}. {KIND_NAME[s.kind]}</button>)}
          </div>
        </div>
        <div className="ed-col">
          {exp && (
            <section className="panel" aria-live="polite">
              {exp.pct < 100 ? (<><div className="panel-head"><h2>Making the video</h2><span className="small faint num">{Math.round(exp.pct)}%</span></div>
                <div className="progress"><i style={{ transform: `scaleX(${exp.pct / 100})` }} /></div>
                <p className="small muted">{exp.fast ? "Rendering every frame at full quality, faster than real time." : "It plays through once in real time to record. Keep this tab open and in front."}</p></>) : (
                <div className="export-ready"><div className="panel-head mb-0"><h2>Ready{fast ? ` · rendered ${fast}× faster than real time` : ""}</h2>
                  <button className="btn ghost icon sm" aria-label="Close" onClick={() => setExp(null)}>&times;</button></div>
                  <div className="row"><a className="btn primary" href={exp.url} download={`${name}.${exp.ext}`}><Icon name="download" />Download video (.{exp.ext})</a>
                    <a className="btn" href={exp.still} download={`${name} cover.jpg`}>Download cover</a></div>
                  {a.scenes.some((x) => x.image?.includes(":img:ai:")) && <p className="alert info small"><Icon name="alert" /><span>This animation has
                    AI-made pictures. Switch on the platform&apos;s AI label when you post it.</span></p>}</div>)}
            </section>
          )}
          {err && <div className="alert err" role="alert"><Icon name="alert" /><span>{err}</span></div>}
          <section className="panel">
            <div className="tabs" role="tablist" aria-label="Animation">
              {(["Scenes", "Look"] as const).map((x) => <button key={x} role="tab" aria-selected={tab === x} className="tab" onClick={() => setTab(x)}>{x}</button>)}
            </div>
            {tab === "Scenes" && (
              <div className="stack">
                {a.scenes.map((s, i) => (
                  <div key={s.id} className="scene-card">
                    <div className="row">
                      <b className="num">{i + 1}</b>
                      <select className="select grow" aria-label={`Scene ${i + 1} kind`} value={s.kind} onChange={(e) => scene(s.id, { kind: e.target.value as SceneKind })}>
                        {(Object.keys(KIND_NAME) as SceneKind[]).map((k) => <option key={k} value={k}>{KIND_NAME[k]}</option>)}</select>
                      <button className="btn ghost icon sm" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                      <button className="btn ghost icon sm" aria-label="Move down" disabled={i === a.scenes.length - 1} onClick={() => move(i, 1)}>↓</button>
                      <button className="btn ghost icon sm" aria-label={`Delete scene ${i + 1}`} disabled={a.scenes.length < 2}
                        onClick={() => update({ ...a, scenes: a.scenes.filter((x) => x.id !== s.id) })}><Icon name="trash" /></button>
                    </div>
                    <input className="input" aria-label="Words on screen" value={s.text} onChange={(e) => scene(s.id, { text: e.target.value })} />
                    {(s.kind === "title" || s.kind === "statement" || s.kind === "quote" || s.kind === "cta" || s.kind === "number") && (
                      <input className="input" aria-label="Second line" placeholder={s.kind === "cta" ? "Button words…" : s.kind === "quote" ? "Who said it…" : "A second line (optional)…"}
                        value={s.sub ?? ""} onChange={(e) => scene(s.id, { sub: e.target.value || undefined })} />)}
                    {s.kind === "number" && <div className="row">
                      <input className="input w-80" aria-label="Before the number" placeholder="$" value={s.prefix ?? ""} onChange={(e) => scene(s.id, { prefix: e.target.value })} />
                      <input className="input grow" type="number" aria-label="The number" value={s.value ?? 0} onChange={(e) => scene(s.id, { value: +e.target.value })} />
                      <input className="input w-120" aria-label="After the number" placeholder="%" value={s.suffix ?? ""} onChange={(e) => scene(s.id, { suffix: e.target.value })} />
                    </div>}
                    {(s.kind === "list" || s.kind === "compare" || s.kind === "bars") && (
                      <textarea className="textarea" rows={Math.max(2, (s.items ?? []).length)} aria-label="One per line"
                        placeholder={s.kind === "bars" ? "Label: 42 (one per line)…" : s.kind === "compare" ? "Before\nAfter…" : "One item per line…"}
                        value={(s.items ?? []).join("\n")} onChange={(e) => scene(s.id, { items: e.target.value.split("\n").slice(0, 6) })} />)}
                    {(s.kind === "title" || s.kind === "statement" || s.kind === "cta") && (
                      <input className="input" aria-label="Words to highlight" placeholder="Words to highlight, comma separated…"
                        value={(s.emphasis ?? []).join(", ")} onChange={(e) => scene(s.id, { emphasis: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />)}
                    {s.kind === "image" && (
                      <div className="stack tight">
                        <input className="input" aria-label="Picture description" placeholder="Describe the picture for AI, e.g. a sunrise over a quiet city…"
                          value={s.picture ?? ""} onChange={(e) => scene(s.id, { picture: e.target.value })} />
                        <div className="row">
                          <label className="btn sm"><Icon name="image" />{s.image ? "Change picture" : "Upload a picture"}
                            <input type="file" accept="image/*" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return;
                              const key = `anim:${a.id}:img:${uid()}`; await putMedia(key, f); await setPicture(s.id, key); }} /></label>
                          {settings.openaiKey && <button className="btn sm" disabled={!!busy} onClick={async () => {
                            setBusy("Making the picture…"); setErr("");
                            try { await setPicture(s.id, await makePicture(settings.openaiKey, a, s.picture || s.text)); }
                            catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
                            setBusy(""); }}>{busy === "Making the picture…" ? <><span className="spin" />Making it…</> : "Make it with AI"}</button>}
                        </div>
                      </div>)}
                    <div className="field">
                      <label htmlFor={`d-${s.id}`}>On screen for <span className="num">{s.duration.toFixed(1)} s</span>{a.voice?.keys[s.id] ? " (fits the voice)" : ""}</label>
                      <input id={`d-${s.id}`} className="range" type="range" min={1.8} max={10} step={0.1} value={s.duration} onChange={(e) => scene(s.id, { duration: +e.target.value })} />
                    </div>
                  </div>
                ))}
                <div className="row">
                  <button className="btn" onClick={() => { const s: Scene = { id: uid(), kind: "statement", text: "A new idea", duration: 3 }; s.duration = readTime(s);
                    update({ ...a, scenes: [...a.scenes.slice(0, -1), s, ...a.scenes.slice(-1)] }); }}><Icon name="plus" />Add a scene</button>
                </div>
              </div>
            )}
            {tab === "Look" && (
              <div className="stack">
                <div className="field"><label htmlFor="anim-title">Name</label>
                  <input id="anim-title" className="input" value={a.title} onChange={(e) => update({ ...a, title: e.target.value })} /></div>
                <div className="field"><span className="label">Colours</span>
                  <div className="palettes" role="group" aria-label="Colours">
                    {palIds.map((k) => (
                      <button key={k} className="pal" aria-pressed={a.palette === k} onClick={() => update({ ...a, palette: k })}>
                        <span style={{ background: paletteOf(k).bg }}><i style={{ background: paletteOf(k).accent }} /><i style={{ background: paletteOf(k).accent2 }} /></span>
                        {paletteOf(k).name}</button>))}
                  </div></div>
                <div className="field"><span className="label">Type</span>
                  <div className="seg" role="group" aria-label="Type">{fontIds.map((k) => (
                    <button key={k} aria-pressed={a.font === k} onClick={() => update({ ...a, font: k })} style={{ fontFamily: fontOf(k).family }}>{fontOf(k).name}</button>))}</div></div>
                <div className="field"><span className="label">Shape</span>
                  <div className="seg" role="group" aria-label="Shape">{(Object.keys(FORMATS) as Format[]).map((f) => (
                    <button key={f} aria-pressed={a.format === f} disabled={recording} onClick={() => update({ ...a, format: f })}>{f} {FORMATS[f].name}</button>))}</div></div>
                <div className="field"><span className="label">Pace</span>
                  <div className="seg" role="group" aria-label="Pace">{(Object.keys(PACE_NAME) as Pace[]).map((v) => (
                    <button key={v} aria-pressed={(a.pace ?? "normal") === v} onClick={() => update({ ...a, pace: v })}>{PACE_NAME[v]}</button>))}</div></div>
                <div className="field"><label htmlFor="anim-song2">Music</label>
                  <input id="anim-song2" type="file" accept="audio/*" className="input" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return; const key = `anim:${a.id}:music:${uid()}`; await putMedia(key, f);
                    const next = { ...a, music: key }; player.current?.setUrls(await urlsFor(next)); update(next); }} />
                  {a.music && <button className="link small" onClick={() => update({ ...a, music: undefined })}>Remove the music</button>}</div>
                <div className="field"><span className="label">Voiceover</span>
                  {settings.openaiKey ? (
                    <div className="row">
                      <select className="select grow" aria-label="Voice" defaultValue={a.voice?.name ?? "nova"} id="revoice">{VOICES.map((v) => <option key={v}>{v}</option>)}</select>
                      <button className="btn" disabled={!!busy} onClick={() => revoice((document.getElementById("revoice") as HTMLSelectElement).value)}>
                        {busy ? <><span className="spin" />{busy}</> : a.voice ? "Record it again" : "Add a voiceover"}</button>
                      {a.voice && <button className="btn ghost" onClick={() => update({ ...a, voice: undefined })}>Remove</button>}
                    </div>) : <p className="small muted">An OpenAI key in Settings adds a natural AI voice that reads every scene.</p>}
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/** An AI picture for a picture scene, in the animation's shape; returns its media key. */
async function makePicture(key: string, a: Anim, prompt: string): Promise<string> {
  const size = a.format === "16:9" ? "1536x1024" : a.format === "1:1" ? "1024x1024" : "1024x1536";
  const blob = await aiPicture(key, `${prompt}. A photograph, natural light, no text, no logos, no real people's faces.`, size);
  const k = `anim:${a.id}:img:ai:${uid()}`;
  await putMedia(k, blob);
  return k;
}
