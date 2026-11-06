"use client";
import { useEffect, useRef, useState } from "react";
import { EFFORT, effortOf, type Effort } from "@/lib/effort";
import { probeVideo } from "@/lib/media";
import { lastScript, loadRules } from "@/lib/store";
import { estimate, estimateText } from "@/lib/timings";
import type { Project, Settings } from "@/lib/types";
import { fileMeta, kindOf, makeReel, REVIEWING } from "@/lib/workflow";
import { EffortPicker } from "./EffortPicker";
import { FilmPanel } from "./FilmRecorder";
import { Icon, type IconName } from "./Icons";
import { RecordScreen } from "./ScreenRecorder";
import { ScriptBox } from "./ScriptFix";

const FACE = "Finding your face";
const STAGES = ["Copying your video", "Listening to your video", "Finding your retakes", FACE,
  "Picking your best takes and planning the edit", "Finding pictures online", REVIEWING, "Ready"];
/** The steps this effort runs: no face finding when Fast, the review pass only for Best quality. */
const stagesOf = (e: Effort) => STAGES.filter((s) => (s !== FACE || EFFORT[e].faces) && (s !== REVIEWING || EFFORT[e].review));
const stageAt = (stages: string[], msg: string) => stages.findIndex((s) => msg.startsWith(s.split(" ")[0]) && msg.includes(s.split(" ")[1] ?? ""));
const ICON: Record<string, IconName> = { video: "clip", music: "music", image: "image" };
const size = (b: number) => new Intl.NumberFormat(undefined, { style: "unit", unit: b > 1e9 ? "gigabyte" : "megabyte", maximumFractionDigits: 1 })
  .format(b > 1e9 ? b / 1e9 : b / 1e6);

export function NewVideo({ settings, initial = [], film = false, onFilmOpened, onDone, onSettings, onSaveSettings }: { settings: Settings;
  initial?: File[]; film?: boolean; onFilmOpened?: () => void;
  onDone: (p: Project, summary: string) => void; onSettings: () => void; onSaveSettings?: (s: Settings) => void }) {
  const [takes, setTakes] = useState<File[]>([]);
  const [extras, setExtras] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState("");
  const [at, setAt] = useState(-1);
  const [picked, setPicked] = useState<Effort | null>(null);   // this video's choice; until then the saved default
  const [footage, setFootage] = useState(0);
  const [script, setScript] = useState("");
  const effort = picked ?? effortOf(settings);
  const [filming, setFilming] = useState<{ script: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const filmBtn = useRef<HTMLButtonElement>(null);
  const hasKey = settings.provider === "anthropic" ? !!settings.anthropicKey : !!settings.openaiKey;
  const canListen = settings.transcriber === "browser" || !!settings.openaiKey;

  const [skipped, setSkipped] = useState("");
  function take(files: FileList | File[], fresh = false) {
    const fs = [...files];
    const bad = fs.filter((f) => !kindOf(f)).map((f) => f.name);   // say so: a silent drop looks broken
    setSkipped(bad.length ? `${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ` and ${bad.length - 3} more` : ""} ${bad.length === 1 ? "isn't" : "aren't"} a video, a song or a picture, so I left ${bad.length === 1 ? "it" : "them"} out. Takes are video files (MP4, MOV or WebM).` : "");
    const vids = fs.filter((f) => kindOf(f) === "video");
    const rest = fs.filter((f) => kindOf(f) && kindOf(f) !== "video");
    if (fresh || !takes.length) { setTakes(vids); setExtras((x) => [...(fresh ? [] : x), ...rest]); }
    else setExtras((x) => [...x, ...vids, ...rest]);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (initial.length) take(initial, true); }, [initial]);
  // "Film it here" from Write a script: open the camera with that script on the teleprompter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (film) { setFilming({ script: script.trim() || lastScript() }); onFilmOpened?.(); } }, [film]);
  useEffect(() => {                                   // how long the takes are, for the time estimates
    let live = true;
    void Promise.all(takes.map(async (f) => {
      const url = URL.createObjectURL(f);
      try { return (await probeVideo(url)).duration || 0; } catch { return 0; } finally { URL.revokeObjectURL(url); }
    })).then((d) => { if (live) setFootage(d.reduce((a, x) => a + x, 0)); });
    return () => { live = false; };
  }, [takes]);
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  async function go(filmed?: { takes: File[]; script: string }) {
    const use = filmed ?? { takes, script };
    setBusy(true); setErr(""); setPct(0); setAt(-1);
    const stages = stagesOf(effort);
    const progress = (m: string, p?: number) => {
      setMsg(m);
      if (p !== undefined) setPct((x) => Math.max(x, p));
      const i = stageAt(stages, m);
      if (i >= 0) setAt((x) => Math.max(x, i));       // a step never goes back (the review can look for pictures again)
    };
    const s = { ...settings, effort };                 // this video's effort; the saved default stays as it is
    try {
      const { project, summary } = await makeReel(use.takes, extras, use.script, s, loadRules(), progress);
      onDone(project, summary);
    } catch (e) {
      setErr((e as { userMessage?: string }).userMessage ?? (e as Error).message ?? String(e));
    }
  }

  function closeFilm() { setFilming(null); requestAnimationFrame(() => filmBtn.current?.focus()); }
  /** "Use these takes": the filmed takes become this video's takes (like a fresh drop) and the teleprompter's script is the
   *  pasted script, then the reel is made straight away. Without a way to listen yet, they wait here with the key message. */
  function takeFilmed(files: File[], text: string) {
    setFilming(null);
    setTakes(files); setScript(text);
    if (canListen) void go({ takes: files, script: text });
    else requestAnimationFrame(() => filmBtn.current?.focus());
  }

  if (busy) {
    const stages = stagesOf(effort);
    return (
      <div className="page narrow">
        <div className="page-head"><div><h1>Making your reel</h1><p>Everything runs in this tab, so keep it open. Your video isn&apos;t uploaded
          anywhere{settings.transcriber === "openai" ? " (only its sound goes to OpenAI for the transcript)" : ""}.</p></div></div>
        <section className="panel">
          <div className="row"><p aria-live="polite" className="grow"><b>{msg || "Starting…"}</b></p>
            <span className="badge">{EFFORT[effort].label}</span></div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="Progress">
            <i style={{ transform: `scaleX(${Math.min(99, pct) / 100})` }} /></div>
          <ol className="steps">
            {stages.slice(0, -1).map((s, i) => (
              <li key={s} className={i < at ? "done" : i === at ? "now" : ""}>
                <span className="tick">{i < at ? <Icon name="check" /> : null}</span>{s}
              </li>))}
          </ol>
          {err && <div className="stack mt-16">
            <div className="alert err" role="alert"><Icon name="alert" /><span>{err}</span></div>
            <div className="row"><button className="btn primary" onClick={() => void go()}>Try again</button>
              <button className="btn ghost" onClick={() => setBusy(false)}>Back to my files</button></div>
          </div>}
        </section>
      </div>
    );
  }

  const files = [...takes.map((f) => ({ f, take: true })), ...extras.map((f) => ({ f, take: false }))];
  return (
    <div className="page narrow">
      <div className="page-head"><div><h1>New video</h1><p>Retakes and fumbles are fine: your editor keeps your best take of every line.</p></div></div>
      <div className="stack">
        {!hasKey && <div className="alert info"><Icon name="key" /><span>No AI editor yet, so you&apos;ll get a simple cut with subtitles.{" "}
          <button className="link" onClick={onSettings}>Add your key</button> for best-take picking, pictures, music choices and your post caption.</span></div>}
        {!canListen && <div className="alert err" role="alert"><Icon name="alert" /><span>Listening needs an OpenAI key, or switch Listening to
          &ldquo;In my browser&rdquo; in <button className="link" onClick={onSettings}>Settings</button></span></div>}

        <div className={`drop ${over ? "over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}>
          <Icon name="upload" className="big" />
          <h2>Drop your video here</h2>
          <p className="muted small">One or more takes (MP4, MOV, WebM). Add a song, pictures or clips and the editor can use them.</p>
          <div className="row drop-acts">
            <button className="btn" onClick={() => input.current?.click()}>Choose files</button>
            <button ref={filmBtn} className="btn" aria-haspopup="dialog" onClick={() => setFilming({ script })}><Icon name="camera" />Film it here</button>
          </div>
          <p className="small faint">Film it here: your camera, with your script scrolling as a teleprompter.</p>
          <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={(e) => { if (e.target.files) take(e.target.files); e.target.value = ""; }} />
          {skipped && <p className="alert err small mt-12" role="alert"><Icon name="alert" /><span>{skipped}</span></p>}
        </div>

        <div className="rec-extra">
          <p className="small muted">Showing an app? Record a demo now and it goes in as b-roll, framed as a screen.</p>
          <RecordScreen onAdd={(f) => setExtras((x) => [...x, f])} />
        </div>

        {files.length > 0 && (
          <div className="files" aria-label="Your files">
            {files.map(({ f, take: t }, i) => (
              <div key={`${f.name}-${i}`} className="file">
                <span className={`ic ${t ? "take" : ""}`}><Icon name={t ? "film" : fileMeta.get(f)?.screen ? "screen" : ICON[kindOf(f) ?? "video"] ?? "clip"} /></span>
                <span className="grow"><b className="trunc">{f.name}</b>
                  <span className="small faint">{t ? "Your take" : fileMeta.get(f)?.screen ? "Screen recording (b-roll)" : kindOf(f) === "music" ? "Song" : kindOf(f) === "image" ? "Picture" : "B-roll clip"} · {size(f.size)}</span></span>
                <button className="btn ghost icon sm" aria-label={`Remove ${f.name}`}
                  onClick={() => (t ? setTakes((x) => x.filter((y) => y !== f)) : setExtras((x) => x.filter((y) => y !== f)))}><Icon name="trash" /></button>
              </div>
            ))}
          </div>
        )}

        <ScriptBox value={script} onChange={setScript} />

        <div className="stack tight">
          <EffortPicker legend="How much time should I take?" value={effort} onChange={setPicked} time={(e) => {
            if (!takes.length || !footage) return null;
            return estimateText(estimate(e, footage, { transcriber: settings.transcriber, ai: hasKey }));
          }} />
          {onSaveSettings && effort !== effortOf(settings) && <p className="small">
            <button className="link" onClick={() => onSaveSettings({ ...settings, effort })}>Make {EFFORT[effort].label} my default</button></p>}
        </div>

        <div className="row">
          <button className="btn primary lg" disabled={!takes.length || !canListen} onClick={() => void go()}><Icon name="wand" />Make my reel</button>
          {files.length > 0 && <button className="btn ghost" onClick={() => { setTakes([]); setExtras([]); }}>Clear</button>}
        </div>
        <p className="small faint">Videos in your first drop are your takes; videos you add after that, and screen recordings, become b-roll clips. Only use music and pictures you own or
          are licensed to use.</p>
      </div>
      {filming && <FilmPanel initialScript={filming.script} onClose={closeFilm} onUse={takeFilmed} />}
    </div>
  );
}
