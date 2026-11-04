"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { postText } from "@/lib/edit";
import { FORMATS } from "@/lib/compositor";
import { Player } from "@/lib/player";
import { applyBrand, brandOf, hasBrand } from "@/lib/brand";
import { applyTemplate, brandTemplate, templateOf, TEMPLATES } from "@/lib/templates";
import { loadRules, saveProject, saveRules } from "@/lib/store";
import type { Edit, Format, Project, Settings } from "@/lib/types";
import { addToLibrary, applyUserNote, mediaUrls, saveManual } from "@/lib/workflow";
import { Drawer } from "./Drawer";
import { Icon } from "./Icons";
import { clock } from "./Tiles";

type Msg = { who: "you" | "ed"; text: string; rule?: string };

export function Editor({ project, settings, firstSummary, onBack }: { project: Project; settings: Settings; firstSummary?: string;
  onBack: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const mounts = useRef(0);
  const chat = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(project);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => (firstSummary ? [{ who: "ed", text: firstSummary }] :
    project.versions.map((v) => ({ who: "ed" as const, text: `Version ${v.n}: ${v.summary}` }))));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [exp, setExp] = useState<{ pct: number; video?: string; ext?: string; cover?: string; caption?: string; label?: string } | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [track, setTrack] = useState<{ segs: [number, number][]; layers: { s: number; e: number; text: boolean; label: string }[]; zooms: [number, number][] } | null>(null);
  const [all, setAll] = useState<{ f: Format; url: string; ext: string }[] | null>(null);
  const version = p.versions.find((v) => v.n === p.current) ?? p.versions[p.versions.length - 1];

  const mount = useCallback(async (edit: Edit) => {
    const gen = ++mounts.current;
    player.current?.dispose();
    await applyBrand(settings.brand);
    const urls = await mediaUrls(p);
    // left the editor, or a newer version/shape/style started loading meanwhile
    if (!canvas.current || gen !== mounts.current) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
    player.current?.dispose();
    const pl = new Player(canvas.current, p, edit, urls);
    pl.onTime = setT;
    pl.onEnd = () => setPlaying(false);
    player.current = pl;
    await pl.load();
    if (!canvas.current || gen !== mounts.current) return;
    canvas.current!.dataset.cuts = pl.scene.cuts.map((c) => c.toFixed(3)).join(",");   // for tests and tools
    setTrack({ segs: pl.tl.segments.map((x) => [x.outStart, x.outEnd]), zooms: pl.scene.zooms.map((z) => [z.s, z.e]),
      layers: pl.scene.layers.map((L) => ({ s: L.start, e: L.end, text: L.b.treatment === "text-pop", label: L.b.text ?? p.library.find((x) => x.key === L.b.asset)?.name ?? "Picture" })) });
    setDur(pl.tl.duration); setT(0); setPlaying(false);
  }, [p, settings.brand]);

  useEffect(() => { if (version) void mount(version.edit); return () => player.current?.dispose(); }, [version, mount]);
  useEffect(() => { chat.current?.scrollTo({ top: chat.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(""), 2200); return () => clearTimeout(id); }, [toast]);
  useEffect(() => {
    const rec = !!exp && exp.pct < 100;
    if (!rec && !busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [exp, busy]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]") || (!!exp && exp.pct < 100)) return;
      const pl = player.current; if (!pl) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (ev.key === " " && !mod) { ev.preventDefault(); void toggle(); return; }
      const step = ev.key === "ArrowLeft" ? -1 : ev.key === "ArrowRight" ? 1 : ev.key === "," ? -1 / 30 : ev.key === "." ? 1 / 30 : 0;
      if (step && !mod) { ev.preventDefault(); const v = Math.max(0, Math.min(dur, pl.t + step * (ev.shiftKey ? 5 : 1))); setT(v); void pl.seek(v); return; }
      if (mod && (ev.key === "z" || ev.key === "Z" || ev.key === "y")) {
        ev.preventDefault();
        const ns = p.versions.map((v) => v.n), at = ns.indexOf(p.current);
        const to = (ev.key === "y" || ev.shiftKey) ? ns[at + 1] : ns[at - 1];
        if (to !== undefined) { p.current = to; void saveProject(p).then(() => { setP({ ...p }); setToast(`Version ${to}`); }); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function toggle() {
    const pl = player.current;
    if (!pl) return;
    if (playing) { pl.pause(); setPlaying(false); } else { setPlaying(true); await pl.play(); }
  }

  async function send() {
    const text = note.trim();
    if (!text || busy) return;
    const hasKey = settings.provider === "anthropic" ? !!settings.anthropicKey : !!settings.openaiKey;
    setMsgs((m) => [...m, { who: "you", text }]);
    setNote("");
    if (!hasKey) { setMsgs((m) => [...m, { who: "ed", text: "I can't change the video from a note without an AI editor. Add your key in Settings, or use \"Edit it myself\"." }]); return; }
    setBusy("Working on your note…"); setErr("");
    try {
      const r = await applyUserNote(p, settings, loadRules(), text, (m) => setBusy(m));
      setP({ ...p });
      const always = /\b(always|from now on|every (video|time)|remember|next time|never again)\b/i.test(text);
      if (r.styleRule && always) addRule(r.styleRule);
      setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: ${r.summary}` + (r.styleRule && always ? " I'll remember that for next time." : ""),
        rule: r.styleRule && !always ? r.styleRule : undefined }]);
    } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
    setBusy("");
  }

  function addRule(text: string) {
    const rules = loadRules();
    if (!rules.some((r) => r.text.toLowerCase() === text.toLowerCase())) saveRules([...rules, { id: Math.random().toString(36).slice(2), text, at: new Date().toISOString() }]);
  }

  async function exportAll() {
    if (!version) return;
    const keep = p.format ?? "9:16";
    const out: { f: Format; url: string; ext: string }[] = [];
    setAll(null); setPlaying(true);
    try {
      for (const [i, f] of (Object.keys(FORMATS) as Format[]).entries()) {
        p.format = f;
        await mount(version.edit);
        const pl = player.current; if (!pl) break;
        setExp({ pct: 0, label: `${FORMATS[f].name} (${i + 1} of 4)` });
        const { blob, ext } = await pl.record((pct) => setExp((x) => ({ ...x!, pct })));
        out.push({ f, url: URL.createObjectURL(blob), ext });
      }
    } catch (e) { setErr(String(e)); }
    p.format = keep;
    await mount(version.edit);
    setExp(null); setAll(out); setPlaying(false);
  }

  async function exportVideo() {
    const pl = player.current;
    if (!pl) return;
    setExp({ pct: 0 }); setPlaying(true);
    try {
      const { blob, ext } = await pl.record((pct) => setExp((x) => ({ ...x!, pct })));
      const cover = await pl.cover();
      setExp({ pct: 100, video: URL.createObjectURL(blob), ext, cover: URL.createObjectURL(cover),
        caption: URL.createObjectURL(new Blob([post], { type: "text/plain" })) });
    } catch (e) { setErr(String(e)); setExp(null); }
    setPlaying(false);
  }

  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setToast("Caption copied"); } catch { setToast("Couldn't copy: select the text instead"); } };
  const post = version ? postText(p, version.edit) : "";
  const e = version?.edit;
  const pics = e?.broll.filter((b) => b.treatment !== "text-pop").length ?? 0, cards = e ? e.broll.length - pics : 0;
  const song = e?.music.asset ? p.library.find((a) => a.key === e.music.asset) : undefined;
  const fmt: Format = p.format ?? "9:16";
  const shape = FORMATS[fmt];
  const base = p.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80) + ` - Version ${p.current}` + (fmt === "9:16" ? "" : ` (${shape.name.toLowerCase()} ${fmt.replace(":", "x")})`);
  const reshape = async (f: Format) => { if (f === fmt || recording) return; p.format = f; await saveProject(p); setExp(null); setP({ ...p }); };
  const recording = !!exp && exp.pct < 100;
  const did: [boolean, string][] = e ? [
    [true, `Kept your best takes · ${clock(dur)} long`],
    [e.captions.enabled, e.captions.enabled ? "Added subtitles" : "Subtitles off"],
    [!!song, song ? `Added music: ${song.name}` : "No music (add a song below)"],
    [pics + cards > 0, pics + cards ? `${pics} picture${pics === 1 ? "" : "s"} and ${cards} text card${cards === 1 ? "" : "s"}` : "No pictures yet"],
    [e.zooms.length > 0, e.zooms.length ? `${e.zooms.length} zoom${e.zooms.length === 1 ? "" : "s"}` : "No zooms"],
    [!!e.post.caption, e.post.caption ? "Wrote your post caption" : "No post caption yet"],
  ] : [];

  return (
    <div className="page">
      <div className="ed-head">
        <button className="btn ghost sm" onClick={onBack}><Icon name="arrowLeft" />My videos</button>
        <h1 className="grow trunc">{p.title}</h1>
        <button className="btn" aria-pressed={drawer} onClick={() => setDrawer(!drawer)}><Icon name="scissors" />{drawer ? "Close the editor" : "Edit it myself"}</button>
        <button className="btn primary" onClick={exportVideo} disabled={recording}><Icon name="download" />Export</button>
      </div>

      {p.sample && <div className="alert info sample-note"><Icon name="spark" /><span>This is the sample: a drawn presenter and a computer voice, not a
        real person. Play it, open &ldquo;Edit it myself&rdquo;, change its shape and export it. Notes need an AI key in Settings.</span></div>}
      <div className={`ed-grid ${shape.w > shape.h ? "wide" : ""}`}>
        <div className="preview">
          <div className={`phone ${shape.w >= shape.h ? "flat" : ""}`}><canvas ref={canvas} style={{ aspectRatio: `${shape.w} / ${shape.h}` }}
            aria-label={`Preview of ${p.title}, version ${p.current}, ${shape.name.toLowerCase()} ${fmt}`} role="img" /></div>
          <div className="transport">
            <button className="play" onClick={toggle} disabled={recording} aria-label={playing ? "Pause" : "Play"}><Icon name={playing ? "pause" : "play"} /></button>
            <input type="range" className="scrub" min={0} max={dur || 1} step={0.01} value={t} aria-label="Position"
              onChange={(ev) => { const v = +ev.target.value; setT(v); void player.current?.seek(v); }} />
            <span className="time">{clock(t)} / {clock(dur)}</span>
          </div>
          {track && dur > 0 && (
            <div className="track" aria-hidden="true" onPointerDown={(ev) => {
              const r = ev.currentTarget.getBoundingClientRect(); const v = Math.max(0, Math.min(dur, ((ev.clientX - r.left) / r.width) * dur));
              setT(v); void player.current?.seek(v); }}>
              <div className="lane">{track.segs.map(([a, b], i) => <i key={i} className={`seg ${i % 2 ? "alt" : ""}`} style={{ left: `${(100 * a) / dur}%`, width: `${(100 * (b - a)) / dur}%` }} />)}</div>
              <div className="lane">{track.layers.map((L, i) => <i key={i} className={`lay ${L.text ? "txt" : ""}`} title={L.label}
                style={{ left: `${(100 * L.s) / dur}%`, width: `${Math.max(0.8, (100 * (L.e - L.s)) / dur)}%` }}><span>{L.label}</span></i>)}</div>
              <div className="lane thin">{track.zooms.map(([a, b], i) => <i key={i} className="zm" style={{ left: `${(100 * a) / dur}%`, width: `${(100 * (b - a)) / dur}%` }} />)}</div>
              <b className="head" style={{ left: `${(100 * t) / dur}%` }} />
            </div>
          )}
          <p className="hint keys">Space plays · ← → move 1 s (Shift: 5 s) · , . move a frame · ⌘Z and ⌘⇧Z step through versions</p>
          <div className="shape">
            <span className="label">Shape</span>
            <div className="seg" role="group" aria-label="Shape">
              {(Object.keys(FORMATS) as Format[]).map((f) => (
                <button key={f} aria-pressed={f === fmt} disabled={recording} title={FORMATS[f].for} onClick={() => reshape(f)}>
                  {f} {FORMATS[f].name}</button>))}
            </div>
            <span className="hint">{shape.for}</span>
          </div>
          {version && (
            <div className="shape">
              <span className="label">Style</span>
              <div className="chips" role="group" aria-label="Style">
                {[...(hasBrand(settings.brand) ? [brandTemplate(brandOf(settings.brand))] : []), ...TEMPLATES].map((tp) => (
                  <button key={tp.id} className="chip" title={tp.line} disabled={recording} aria-pressed={templateOf(version.edit) === tp.id}
                    onClick={async () => { await saveManual(p, applyTemplate(version.edit, tp), `the ${tp.name} style`); setP({ ...p });
                      setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: the ${tp.name} style. ${tp.line}` }]); }}>{tp.name}</button>))}
              </div>
            </div>
          )}
          <div className="versions" role="group" aria-label="Versions">
            {p.versions.map((v) => (
              <button key={v.n} title={v.note} className="chip" aria-pressed={v.n === p.current}
                onClick={async () => { p.current = v.n; await saveProject(p); setP({ ...p }); }}>Version {v.n}</button>
            ))}
          </div>
        </div>

        <div className="ed-col">
          {all && (
            <section className="panel" aria-live="polite">
              <div className="panel-head"><h2>Every shape is ready</h2><button className="btn ghost icon sm" aria-label="Close" onClick={() => setAll(null)}>&times;</button></div>
              <div className="row">{all.map((x) => <a key={x.f} className="btn" href={x.url}
                download={`${p.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 60)} - ${FORMATS[x.f].name.toLowerCase()} ${x.f.replace(":", "x")}.${x.ext}`}>
                <Icon name="download" />{x.f} {FORMATS[x.f].name}</a>)}</div>
            </section>
          )}
          {exp && (
            <section className="panel" aria-live="polite">
              {exp.pct < 100 ? (<>
                <div className="panel-head"><h2>Making the video{exp.label ? `: ${exp.label}` : ""}</h2><span className="small faint num">{Math.round(exp.pct)}%</span></div>
                <div className="progress"><i style={{ transform: `scaleX(${exp.pct / 100})` }} /></div>
                <p className="small muted">It plays through once in real time to record. Keep this tab open and in front.</p></>) : (
                <div className="export-ready">
                  <div className="panel-head mb-0"><h2>Ready to post</h2>
                    <button className="btn ghost icon sm" aria-label="Close" onClick={() => setExp(null)}>&times;</button></div>
                  <div className="row">
                    <a className="btn primary" href={exp.video} download={`${base}.${exp.ext}`}><Icon name="download" />Download video (.{exp.ext})</a>
                    <a className="btn" href={exp.cover} download={`${base} cover.jpg`}>Download cover</a>
                    <a className="btn" href={exp.caption} download={`${base} caption.txt`}>Caption .txt</a>
                    <button className="btn ghost" onClick={() => copy(post)}><Icon name="copy" />Copy caption</button>
                  </div>
                  <div className="row"><button className="btn ghost sm" onClick={() => { setExp(null); void exportAll(); }}>Also make every shape (4 files, about {Math.ceil(4 * dur / 60)} min)</button></div>
                  {exp.ext === "webm" && <p className="small muted">Your browser recorded WebM. For Instagram, export from Chrome, Edge or Safari
                    to get MP4, or convert the file.</p>}
                </div>)}
            </section>
          )}

          <section className="panel" aria-labelledby="did-h">
            <div className="panel-head"><h2 id="did-h">What I did</h2><span className="badge good"><span className="dot" />Version {p.current}</span></div>
            <ul className="did">
              {did.map(([on, text]) => <li key={text} className={on ? "" : "off"}><Icon name={on ? "check" : "dot"} />{text}</li>)}
            </ul>
          </section>

          <section className="panel" aria-labelledby="notes-h">
            <div className="panel-head"><h2 id="notes-h">Notes for your editor</h2></div>
            <div className="chat" ref={chat} aria-live="polite">
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.who}`}>
                  <span className="who-said">{m.who === "you" ? "You" : "Your editor"}</span>
                  <span>{m.text}</span>
                  {m.rule && (
                    <div className="ask">
                      <div className="small">Remember this for next time? &ldquo;{m.rule}&rdquo;</div>
                      <div className="row mt-8">
                        <button className="btn sm primary" onClick={() => { addRule(m.rule!); setMsgs((x) => x.map((y, k) => (k === i ? { ...y, rule: undefined, text: y.text + "\nSaved to My style." } : y))); }}>Yes, remember it</button>
                        <button className="btn sm ghost" onClick={() => setMsgs((x) => x.map((y, k) => (k === i ? { ...y, rule: undefined } : y)))}>No, just this video</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="msg ed busy"><span className="spin" aria-hidden="true" />{busy}</div>}
            </div>
            {err && <div className="alert err mt-12" role="alert"><Icon name="alert" /><span>{err}</span></div>}
            <div className="composer">
              <label className="sr-only" htmlFor="note">Note for your editor</label>
              <textarea id="note" rows={1} value={note} placeholder="Tell your editor what to change…" aria-describedby="note-hint"
                autoComplete="off" onChange={(ev) => setNote(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); void send(); } }} />
              <button className="btn primary" onClick={send} disabled={!!busy || !note.trim()}><Icon name="send" />Send</button>
            </div>
            <p className="hint note-hint" id="note-hint">For example: &ldquo;music too loud at the start&rdquo;, &ldquo;show the Spotify logo when I say
              Spotify&rdquo;, &ldquo;cut the part about my cat&rdquo;. Enter sends, Shift+Enter starts a new line.</p>
            <label className="attach">
              <Icon name="paperclip" />Add a song, picture or clip your editor can use
              <input type="file" multiple accept="audio/*,image/*,video/*"
                onChange={async (ev) => { if (!ev.target.files?.length) return; const n = await addToLibrary(p, [...ev.target.files]); await saveProject(p); setP({ ...p });
                  ev.target.value = "";
                  setMsgs((m) => [...m, { who: "ed", text: `Added ${n.join(", ")}. Tell me where to use ${n.length > 1 ? "them" : "it"}.` }]); }} />
            </label>
          </section>

          {drawer && version && (
            <section className="panel" aria-label="Edit it myself">
              <Drawer project={p} edit={version.edit} onApply={async (edit, what) => { await saveManual(p, edit, what); setP({ ...p }); setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: ${what}` }]); }} />
            </section>
          )}

          <section className="panel" aria-labelledby="post-h">
            <div className="panel-head"><h2 id="post-h">Post caption</h2>
              {post && <button className="btn ghost sm" onClick={() => copy(post)}><Icon name="copy" />Copy</button>}</div>
            <p className="caption-box">{post || "No caption yet."}</p>
          </section>
        </div>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
