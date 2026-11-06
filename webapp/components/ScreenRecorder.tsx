"use client";
// "Record my screen": a button (with its privacy note) that opens a small recorder: pick a tab, window or screen, record,
// trim the ends, speed through the waits, and add the clip to the video as a screen recording (lib/screenrec.ts).

import { useEffect, useMemo, useRef, useState } from "react";
import { canRecordScreen, clipPieces, detectWaits, formatTime, MAX_SECONDS, piecesLength, recordingMeta, ScreenRecorder,
  sayTime, stepAt, WAIT_SPEED, type Recording, type RecState } from "@/lib/screenrec";
import { fileMeta } from "@/lib/workflow";
import { Icon } from "./Icons";

const PRIVACY = "Recording stays in this browser. Close tabs with private info first.";

/** The "Record my screen" button and its note; opens the recorder under it. Hidden (with a reason) where the browser
 *  can't capture the screen, such as phones. `onAdd` gets the finished file (already tagged as a screen recording). */
export function RecordScreen({ onAdd, className = "" }: { onAdd: (f: File) => Promise<void> | void; className?: string }) {
  const [ok, setOk] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOk(canRecordScreen()); }, []);
  if (ok === null) return null;
  if (!ok) return <p className={`small faint rec-none ${className}`}><Icon name="screen" />Screen recording needs Chrome, Edge, Firefox or Safari on a
    computer. On a phone, use its own screen recorder and add the clip.</p>;
  const close = () => { setOpen(false); requestAnimationFrame(() => btn.current?.focus()); };
  return (
    <div className={`rec ${open ? "open" : ""} ${className}`}>
      {!open && <>
        <button ref={btn} type="button" className="attach rec-open" aria-expanded={false} aria-describedby="rec-privacy" onClick={() => setOpen(true)}>
          <Icon name="screen" />Record my screen</button>
        <p id="rec-privacy" className="small faint rec-privacy">{PRIVACY}</p>
      </>}
      {open && <RecorderPanel onClose={close} onAdd={async (f) => { await onAdd(f); close(); }} />}
    </div>
  );
}

type Phase = "ready" | "live" | "review" | "adding";

function RecorderPanel({ onAdd, onClose }: { onAdd: (f: File) => Promise<void>; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [mic, setMic] = useState(false);
  const [state, setState] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [err, setErr] = useState("");
  const [note, setNote] = useState("");
  const [say, setSay] = useState("");
  const [rec, setRec] = useState<Recording | null>(null);
  const [url, setUrl] = useState("");
  const [trim, setTrim] = useState({ start: 0, end: 0 });
  const [speed, setSpeed] = useState(true);
  const [head, setHead] = useState(0);
  const recorder = useRef<ScreenRecorder | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stopBtn = useRef<HTMLButtonElement>(null);
  const reviewHead = useRef<HTMLHeadingElement>(null);
  const startBtn = useRef<HTMLButtonElement>(null);

  // closing the panel (or leaving the page) stops every track and throws the unsaved recording away
  useEffect(() => () => { recorder.current?.dispose(); recorder.current = null; }, []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => { startBtn.current?.focus(); }, []);

  const waits = useMemo(() => (rec ? detectWaits(rec.samples) : []), [rec]);
  const inTrim = useMemo(() => waits.filter(([s, e]) => e > trim.start && s < trim.end), [waits, trim]);
  const plan = useMemo(() => (rec ? clipPieces({ duration: rec.duration, trim, waits: speed ? waits : [] }) : []), [rec, trim, waits, speed]);
  const plays = piecesLength(plan);
  const waitSecs = inTrim.reduce((a, [s, e]) => a + Math.min(e, trim.end) - Math.max(s, trim.start), 0);

  function start() {
    setErr(""); setNote("");
    const r = new ScreenRecorder({
      mic,
      onState: (s) => {
        setState(s);
        if (s === "recording") { setPhase("live"); setSay(r.elapsed() < 0.5 ? "Recording started." : "Recording again."); }
        if (s === "paused") setSay("Paused.");
      },
      onTick: setElapsed,
      onNote: setNote,
      onError: (m) => { setErr(m); if (r.state === "idle") { recorder.current = null; setPhase("ready"); } },
      onStop: (x) => {
        recorder.current = null;
        if (x.duration < 0.5 || !x.blob.size) { setPhase("ready"); setState("idle"); setErr("That recording was too short to keep. Press Start and record a little longer."); return; }
        setRec(x);
        setUrl(URL.createObjectURL(x.blob));
        setTrim({ start: 0, end: x.duration });
        setHead(0);
        setPhase("review");
        setSay(`Recording stopped: ${sayTime(x.duration)} recorded. Trim it, then add it to this video.`);
      },
    });
    recorder.current = r;
    void r.start();                               // getDisplayMedia is asked inside this click
  }

  useEffect(() => { if (phase === "live") stopBtn.current?.focus(); if (phase === "review") reviewHead.current?.focus(); }, [phase]);

  // a recorded WebM has no length in its header: ask the browser to find the end once, so seeking and the controls work
  function loaded() {
    const v = video.current;
    if (!v) return;
    if (Number.isFinite(v.duration)) return adopt(v.duration);
    const back = () => { if (!Number.isFinite(v.duration)) return; v.removeEventListener("durationchange", back); v.currentTime = 0; adopt(v.duration); };
    v.addEventListener("durationchange", back);
    v.currentTime = 1e7;
  }
  // the file's own length is the truth (the timer can be a frame or two off); keep an untouched out-point on the end
  function adopt(d: number) {
    if (!rec || !(d > 0.5) || Math.abs(d - rec.duration) < 0.02 || Math.abs(d - rec.duration) > 2) return;
    setRec({ ...rec, duration: d });
    setTrim((t) => ({ start: Math.min(t.start, d - 0.5), end: t.end >= rec.duration - 0.01 ? d : Math.min(t.end, d) }));
  }

  // the preview plays the clip the way the video will: from the in-point to the out-point, waits 6x faster, round again
  useEffect(() => {
    const v = video.current;
    if (phase !== "review" || !v) return;
    let raf = 0;
    const tick = () => {
      const s = stepAt(plan, v.currentTime);
      if (!v.paused) {
        if (s.jump !== undefined && Math.abs(v.currentTime - s.jump) > 0.05) v.currentTime = s.jump;
        if (v.playbackRate !== s.rate) v.playbackRate = s.rate;
      }
      setHead(v.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, plan]);

  function seek(t: number) { const v = video.current; if (v) { v.pause(); v.currentTime = t; setHead(t); } }

  async function add() {
    if (!rec) return;
    setPhase("adding"); setErr("");
    try {
      const f = new File([rec.blob], rec.name, { type: rec.mime });
      fileMeta.set(f, recordingMeta(rec.duration, trim, waits, speed));
      await onAdd(f);
    } catch (e) {
      setErr((e as { userMessage?: string }).userMessage ?? (e as Error).message ?? String(e));
      setPhase("review");
    }
  }

  function again() {
    video.current?.pause();
    setRec(null); setUrl(""); setElapsed(0); setState("idle"); setPhase("ready"); setSay("");
    requestAnimationFrame(() => startBtn.current?.focus());
  }

  const dur = rec?.duration ?? 0;
  const pct = (x: number) => `${(100 * Math.min(Math.max(x, 0), dur)) / Math.max(0.001, dur)}%`;
  const left = MAX_SECONDS - elapsed;

  return (
    <section className="rec-panel" aria-labelledby="rec-title">
      <div className="rec-top">
        <h3 id="rec-title"><Icon name="screen" />Record my screen</h3>
        <button type="button" className="btn ghost sm" onClick={onClose}
          aria-label={phase === "live" ? "Close and throw this recording away" : "Close the recorder"}>{phase === "live" ? "Cancel" : "Close"}</button>
      </div>
      <p className="sr-only" aria-live="polite">{say}</p>

      {phase === "ready" && (
        <div className="stack tight">
          <p className="small muted">Your browser asks what to share: a tab, a window or your whole screen. A browser tab gives the sharpest
            picture. Up to {MAX_SECONDS / 60} minutes.</p>
          <label className="check">
            <input type="checkbox" checked={mic} onChange={(e) => setMic(e.target.checked)} />
            <span>Include my microphone<span className="hint block">Talk people through it as you click.</span></span>
          </label>
          <div>
            <button ref={startBtn} type="button" className="btn primary lg rec-go" disabled={state === "starting"} onClick={start}>
              <span className="rec-dot" aria-hidden="true" />{state === "starting" ? "Waiting for you to pick…" : "Start recording"}</button>
          </div>
          <p className="small faint">{PRIVACY}</p>
        </div>
      )}

      {phase === "live" && (
        <div className="stack tight">
          <div className="rec-live">
            <span className={`rec-dot ${state === "recording" ? "on" : ""}`} aria-hidden="true" />
            <b>{state === "paused" ? "Paused" : "Recording"}</b>
            <span className="rec-time num" role="timer" aria-label={`${sayTime(elapsed)} recorded`}>{formatTime(elapsed)}</span>
            <span className="small faint">of {formatTime(MAX_SECONDS)}</span>
          </div>
          <p className="small muted">Show your app in what you shared. Come back and press Stop, or use your browser&apos;s
            &ldquo;Stop sharing&rdquo; button.{left <= 30 && left > 0 ? ` It stops by itself in ${Math.ceil(left)} seconds.` : ""}</p>
          <div className="row">
            <button ref={stopBtn} type="button" className="btn primary lg rec-stop" onClick={() => recorder.current?.stop()}>
              <Icon name="stop" />Stop</button>
            {state === "paused"
              ? <button type="button" className="btn lg" onClick={() => recorder.current?.resume()}><Icon name="play" />Resume</button>
              : <button type="button" className="btn lg ghost" onClick={() => recorder.current?.pause()}><Icon name="pause" />Pause</button>}
          </div>
        </div>
      )}

      {(phase === "review" || phase === "adding") && rec && (
        <div className="stack tight">
          <h4 ref={reviewHead} tabIndex={-1} className="rec-h">Trim it <span className="faint small num">({formatTime(dur)} recorded)</span></h4>
          <video ref={video} className="rec-preview" src={url} controls playsInline muted={!rec.hasAudio} preload="auto" onLoadedMetadata={loaded}
            aria-label="Your recording" />
          <div className="rec-strip" aria-hidden="true">
            <i className="rec-keep" style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }} />
            {waits.map(([s, e]) => <i key={s} className={`rec-wait ${speed ? "on" : ""}`} style={{ left: pct(s), width: `calc(${pct(e)} - ${pct(s)})` }} />)}
            <i className="rec-head" style={{ left: pct(head) }} />
          </div>
          <div className="rec-trim">
            <div className="field">
              <label htmlFor="rec-in">Starts at <span className="num">{formatTime(trim.start, true)}</span></label>
              <input id="rec-in" className="range" type="range" min={0} max={dur} step={0.1} value={trim.start}
                aria-valuetext={formatTime(trim.start, true)}
                onChange={(e) => { const v = Math.min(Number(e.target.value), trim.end - 0.5); setTrim({ ...trim, start: Math.max(0, v) }); seek(Math.max(0, v)); }} />
            </div>
            <div className="field">
              <label htmlFor="rec-out">Ends at <span className="num">{formatTime(trim.end, true)}</span></label>
              <input id="rec-out" className="range" type="range" min={0} max={dur} step={0.1} value={trim.end}
                aria-valuetext={formatTime(trim.end, true)}
                onChange={(e) => { const v = Math.max(Number(e.target.value), trim.start + 0.5); setTrim({ ...trim, end: Math.min(dur, v) }); seek(Math.max(0, Math.min(dur, v) - 0.05)); }} />
            </div>
          </div>
          {inTrim.length ? (
            <label className="check">
              <input type="checkbox" checked={speed} onChange={(e) => setSpeed(e.target.checked)} />
              <span>Speed through waits (×{WAIT_SPEED})<span className="hint block">{inTrim.length === 1
                ? `I found a ${Math.max(1, Math.round(waitSecs))} s stretch where nothing moves. It plays`
                : `I found ${inTrim.length} stretches where nothing moves (${Math.round(waitSecs)} s in all). They play`}
                {speed ? ` ${WAIT_SPEED} times faster.` : " at normal speed."}</span></span>
            </label>
          ) : <p className="hint">No waits found: something moves the whole time.</p>}
          <p className="small">It plays for <b className="num">{formatTime(plays, true)}</b> in your video, framed as a screen.</p>
          <div className="row">
            <button type="button" className="btn primary" disabled={phase === "adding"} onClick={add}>
              {phase === "adding" ? <><span className="spin" aria-hidden="true" />Adding…</> : <><Icon name="plus" />Add to this video</>}</button>
            <button type="button" className="btn ghost" disabled={phase === "adding"} onClick={again}>Record again</button>
          </div>
        </div>
      )}

      {note && <div className="alert info mt-12" role="status"><Icon name="alert" /><span>{note}</span></div>}
      {err && <div className="alert err mt-12" role="alert"><Icon name="alert" /><span>{err}</span></div>}
    </section>
  );
}
