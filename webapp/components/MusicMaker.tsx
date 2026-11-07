"use client";
// "Make music": compose an original, royalty-free bed fitted to the edit, preview it, and use it as the video's music.
import { announce } from "@/lib/assistant";
import { useEffect, useMemo, useRef, useState } from "react";
import { bedName, fitToVideo, KEY_NAMES, MOOD_IDS, MOODS, renderBed, suggestMood, type Bed, type Mood } from "@/lib/compose";
import type { Asset, Project } from "@/lib/types";
import { addToLibrary } from "@/lib/workflow";
import { Icon } from "./Icons";
import { clock } from "./Tiles";

type Result = Omit<Bed, "channels"> & { url: string; peaks: number[] };

function peaksOf(ch: Float32Array[], n = 96): number[] {
  const step = Math.max(1, Math.floor(ch[0].length / n));
  const out: number[] = [];
  for (let b = 0; b < n; b++) {
    let pk = 0;
    for (let i = b * step, e = Math.min(ch[0].length, i + step); i < e; i += 16) pk = Math.max(pk, Math.abs(ch[0][i]), Math.abs(ch[1][i]));
    out.push(pk);
  }
  return out;
}

export function MusicMaker({ project: p, length, wordsPerMinute, onUse, onClose }: {
  project: Project; length: number; wordsPerMinute: number | null; onUse: (a: Asset) => Promise<void> | void; onClose: () => void }) {
  const suggested = useMemo(() => suggestMood(wordsPerMinute), [wordsPerMinute]);
  const [mood, setMood] = useState<Mood>(suggested);
  const [bpm, setBpm] = useState(MOODS[suggested].bpm);
  const [key, setKey] = useState("D");
  const [secs, setSecs] = useState(() => Math.max(4, Math.round(length * 10) / 10));
  const [secsText, setSecsText] = useState<string | null>(null);
  const [busy, setBusy] = useState<{ msg: string; pct: number } | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [err, setErr] = useState("");
  const [using, setUsing] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => { head.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); head.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => () => { if (res) URL.revokeObjectURL(res.url); }, [res]);
  const fit = fitToVideo(secs);
  const fitted = Math.abs(secs - Math.max(4, Math.round(length * 10) / 10)) < 0.05;

  function pickMood(m: Mood, focus = false) {
    setMood(m); setBpm(MOODS[m].bpm);
    if (focus) chips.current[MOOD_IDS.indexOf(m)]?.focus();
  }
  function onChipKey(ev: React.KeyboardEvent) {
    const d = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
    if (ev.key === "Home" || ev.key === "End") { ev.preventDefault(); pickMood(MOOD_IDS[ev.key === "Home" ? 0 : MOOD_IDS.length - 1], true); return; }
    if (!d) return;
    ev.preventDefault();
    pickMood(MOOD_IDS[(MOOD_IDS.indexOf(mood) + d + MOOD_IDS.length) % MOOD_IDS.length], true);
  }

  async function compose() {
    stop(); setErr(""); setBusy({ msg: "Writing the parts", pct: 1 });
    try {
      const bed = await renderBed({ length: fit.length, endChordAt: fit.endChordAt, mood, bpm, key },
        (msg, pct) => { setBusy({ msg, pct }); announce(msg, pct); });
      const { channels, ...rest } = bed;
      setRes({ ...rest, url: URL.createObjectURL(bed.wav), peaks: peaksOf(channels) });
      setAt(0);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setBusy(null);
  }
  function stop() { const a = audio.current; if (a) { a.pause(); a.currentTime = 0; } setPlaying(false); setAt(0); }
  async function play() { const a = audio.current; if (!a) return; try { await a.play(); setPlaying(true); } catch (e) { setErr(String(e)); } }

  async function use() {
    if (!res) return;
    stop(); setUsing(true); setErr("");
    try {
      const name = bedName(res.mood, res.bpm);
      const file = new File([res.wav], `${name}.wav`, { type: "audio/wav" });
      await addToLibrary(p, [file]);
      const a = [...p.library].reverse().find((x) => x.kind === "music" && x.name === file.name);
      if (!a) throw new Error("The music couldn't be added to this video's library.");
      Object.assign(a, { name, origin: "composed", entry: 0,
        composed: { mood: res.mood, bpm: res.bpm, key: res.key, mode: res.mode, length: res.seconds, endChordAt: res.plan.endChordAt,
          lufs: Math.round(res.lufs * 10) / 10 } } satisfies Partial<Asset>);
      await onUse(a);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setUsing(false);
  }

  const dur = res?.seconds ?? 0;
  return (
    <section className="panel mm" id="make-music" aria-labelledby="mm-h">
      <div className="panel-head">
        <h2 id="mm-h" ref={head} tabIndex={-1}>Make music</h2>
        <button className="btn ghost icon sm" aria-label="Close Make music" onClick={() => { stop(); onClose(); }}>&times;</button>
      </div>
      <p className="small muted">An original bed, written for this video in your browser: no key, nothing uploaded, yours to post. It
        ends on a final chord as your video ends.</p>

      <div className="field mt-12">
        <span className="label" id="mm-mood">Mood</span>
        <div className="chips" role="radiogroup" aria-labelledby="mm-mood" onKeyDown={onChipKey}>
          {MOOD_IDS.map((m, i) => (
            <button key={m} ref={(el) => { chips.current[i] = el; }} type="button" role="radio" className="chip" aria-checked={mood === m}
              tabIndex={mood === m ? 0 : -1} disabled={!!busy} onClick={() => pickMood(m)}>{MOODS[m].name}</button>))}
        </div>
        <span className="hint">{MOODS[mood].line}.{mood === suggested && wordsPerMinute ? ` Suggested for your pace (${Math.round(wordsPerMinute)} words a minute).` : ""}</span>
      </div>

      <div className="mm-grid">
        <div className="field mm-wide">
          <label htmlFor="mm-bpm">Tempo <span className="num faint">{bpm} BPM</span></label>
          <input id="mm-bpm" className="range" type="range" min={70} max={130} step={1} value={bpm} disabled={!!busy}
            aria-valuetext={`${bpm} beats a minute`} onChange={(ev) => setBpm(+ev.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="mm-key">Key</label>
          <select id="mm-key" className="select" value={key} disabled={!!busy} onChange={(ev) => setKey(ev.target.value)}>
            <optgroup label="Major">{KEY_NAMES.map((k) => <option key={k} value={k}>{k} major</option>)}</optgroup>
            <optgroup label="Minor">{KEY_NAMES.map((k) => <option key={k + "m"} value={k + "m"}>{k} minor</option>)}</optgroup>
          </select>
        </div>
        <div className="field">
          <label htmlFor="mm-len">Length (seconds)</label>
          <input id="mm-len" className="input num" type="number" min={4} max={600} step={0.1} value={secsText ?? secs} disabled={!!busy}
            onChange={(ev) => {                    // typed as is ("3" on the way to "30"), clamped once the field is left
              setSecsText(ev.target.value);
              const n = +ev.target.value; if (n >= 4 && n <= 600) setSecs(n);
            }}
            onBlur={() => { if (secsText !== null) setSecs(Math.max(4, Math.min(600, +secsText || 4))); setSecsText(null); }} />
        </div>
      </div>
      <p className="hint mt-8">{fitted ? "Fitted to your edit" : <>Your edit is {clock(length)}. <button className="link" type="button" onClick={() => setSecs(Math.max(4, Math.round(length * 10) / 10))}>Fit to it</button></>}
        {" "}· the last chord lands at <span className="num">{fit.endChordAt.toFixed(1)} s</span>.</p>

      <div className="row mt-12">
        <button className="btn primary" disabled={!!busy || using} onClick={compose}>
          {busy ? <><span className="spin" />Composing…</> : <><Icon name="music" />{res ? "Compose again" : "Compose"}</>}</button>
        {busy && <span className="small faint" aria-live="polite">{busy.msg}</span>}
      </div>
      {busy && <div className="progress" role="progressbar" aria-label="Composing" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(busy.pct)}>
        <i style={{ transform: `scaleX(${busy.pct / 100})` }} /></div>}
      {err && <div className="alert err mt-12" role="alert"><Icon name="alert" /><span>{err}</span></div>}

      {res && !busy && (
        <div className="mm-result" aria-live="polite" data-render-ms={Math.round(res.renderMs)}
          data-timings={JSON.stringify(Object.fromEntries(Object.entries(res.timings).map(([k, v]) => [k, Math.round(v)])))} data-oscillators={res.nodes}>
          <div className="mm-player">
            <button className="play" aria-label={playing ? "Stop the preview" : "Play the preview"} onClick={() => (playing ? stop() : play())}>
              <Icon name={playing ? "stop" : "play"} /></button>
            <div className="mm-wave" aria-hidden="true">
              <svg viewBox={`0 0 ${res.peaks.length} 20`} preserveAspectRatio="none">
                <path d={res.peaks.map((v, i) => `M${i + 0.5} ${10 - v * 9}V${10 + v * 9}`).join("")} /></svg>
              <b style={{ left: `${dur ? (100 * at) / dur : 0}%` }} />
            </div>
            <span className="time num">{clock(at)} / {clock(dur)}</span>
          </div>
          <audio ref={audio} src={res.url} preload="auto" data-testid="mm-audio" onEnded={() => { setPlaying(false); setAt(0); }}
            onTimeUpdate={(ev) => setAt(ev.currentTarget.currentTime)} />
          <div className="row">
            <span className="grow small"><b>{bedName(res.mood, res.bpm)}</b>
              <span className="faint block">{res.key.replace(/m$/, "")} {res.mode === "major" ? "major" : res.mode === "harmonic" ? "harmonic minor" : "minor"} · {res.plan.sections.length} sections ·{" "}
                <span className="num">{res.lufs.toFixed(1)} LUFS</span></span></span>
            <span className="badge good">Original · royalty-free</span>
          </div>
          <div className="row">
            <button className="btn primary" disabled={using} onClick={use}>{using ? <><span className="spin" />Adding…</> : <><Icon name="check" />Use this</>}</button>
            <a className="btn ghost" href={res.url} download={`${bedName(res.mood, res.bpm)}.wav`}><Icon name="download" />Download .wav</a>
          </div>
        </div>
      )}
    </section>
  );
}
