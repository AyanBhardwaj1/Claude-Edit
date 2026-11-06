"use client";
// "Film it here": a full-screen recorder on New video. The camera preview with the script on a teleprompter band at the top
// (near the lens, so your eyes stay on it), a record button with a 3-2-1 countdown, and the takes you've filmed. "Use these
// takes" makes the video from them with the script already on the subtitles (lib/camrec.ts, lib/workflow.ts makeReel).

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Camera, COUNT_MS, COUNTDOWN_FROM, countdownAt, countdownLength, DEFAULT_TEXT_PX, DEFAULT_WPM, formatTime, MAX_TAKE_SECONDS,
  nextTakeNumber, PrompterClock, promptLines, prompterWords, readingSeconds, sayTime, scrollOffset, takeFile, TEXT_MAX, TEXT_MIN,
  wantsPortrait, WPM_MAX, WPM_MIN, type PromptLine, type Take } from "@/lib/camrec";
import { createPortal } from "react-dom";
import { lastScript } from "@/lib/store";
import { Icon } from "./Icons";

type Phase = "idle" | "count" | "rec";
const READ_LINE = 0.3;              // the line being read sits 30% down the band

const isTextField = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  if (!e) return false;
  if (e.tagName === "TEXTAREA" || e.tagName === "SELECT" || e.isContentEditable) return true;
  return e.tagName === "INPUT" && !["checkbox", "radio", "range", "button", "submit"].includes((e as HTMLInputElement).type);
};
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex='-1'])";

export function FilmPanel({ initialScript = "", onUse, onClose }: {
  initialScript?: string; onUse: (takes: File[], script: string) => void; onClose: () => void;
}) {
  const [cam, setCam] = useState<"asking" | "ready" | "error">("asking");
  const [camErr, setCamErr] = useState("");
  const [tall, setTall] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [count, setCount] = useState(COUNTDOWN_FROM);
  const [elapsed, setElapsed] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  const [playing, setPlaying] = useState<number | null>(null);
  const [script, setScript] = useState(initialScript);
  const [mine, setMine] = useState("");
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [px, setPx] = useState(DEFAULT_TEXT_PX);
  const [mirror, setMirror] = useState(false);
  const [follow, setFollow] = useState(true);
  const [still, setStill] = useState(false);
  const [running, setRunning] = useState(false);
  const [moved, setMoved] = useState(0);          // bumps when the script jumps while paused (back to the start, a new speed)
  const [say, setSay] = useState("");
  const [err, setErr] = useState("");
  const [confirm, setConfirm] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLVideoElement>(null);
  const camera = useRef<Camera | null>(null);
  const recBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const takesHead = useRef<HTMLHeadingElement>(null);
  const timer = useRef(0);
  const recN = useRef(1);
  const takesRef = useRef<Take[]>([]);
  const spaceTaken = useRef(false);
  const words = useMemo(() => prompterWords(script), [script]);
  const clock = useRef(new PrompterClock(DEFAULT_WPM));
  takesRef.current = takes;

  const reveal = useCallback((v: HTMLVideoElement | null) => { v?.scrollIntoView({ block: "nearest" }); }, []);
  const announce = (m: string) => { setSay(""); requestAnimationFrame(() => setSay(m)); };

  // ---------------------------------------------------------------- the camera
  const open = useCallback(async () => {
    camera.current?.close();
    setCam("asking"); setCamErr("");
    const c = new Camera({
      maxSeconds: MAX_TAKE_SECONDS,
      onTick: setElapsed,
      onMaxed: () => announce(`That take reached ${MAX_TAKE_SECONDS / 60} minutes, so it stopped by itself.`),
      onError: (m) => { setErr(m); },
      onTake: ({ blob, mime, duration }) => {
        clock.current.pause(performance.now()); setRunning(false);
        setPhase("idle"); setElapsed(0);
        if (duration < 0.5 || !blob.size) { setErr("That take was too short to keep. Press Record and talk a little longer."); return; }
        const n = recN.current;
        const file = takeFile(blob, n, mime);
        setTakes((t) => [...t, { n, file, url: URL.createObjectURL(file), duration }]);
        announce(`Take ${n} saved: ${sayTime(duration)}. Record another, or use your takes.`);
      },
    });
    camera.current = c;
    try {
      const s = await c.open(wantsPortrait({ width: innerWidth, height: innerHeight, coarse: matchMedia("(pointer: coarse)").matches }));
      if (camera.current !== c) return;
      if (live.current) { live.current.srcObject = s; void live.current.play().catch(() => undefined); }
      const { width, height } = c.size();
      setTall(height > width);
      setCam("ready");
      announce("Camera on. Press Record when you're ready.");
    } catch (e) {
      if (camera.current !== c || (e as Error).message === "closed") return;
      setCam("error"); setCamErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void open();
    setMine(lastScript());
    setStill(matchMedia("(prefers-reduced-motion: reduce)").matches);
    return () => {
      // closing the panel turns the camera and microphone off and lets go of every take that wasn't used
      camera.current?.close(); camera.current = null;
      clearInterval(timer.current);
      takesRef.current.forEach((t) => URL.revokeObjectURL(t.url));
    };
  }, [open]);
  // everything behind the panel is out of reach (keyboard, screen readers, clicks) while it's open, and doesn't scroll.
  // A layout effect, so it's undone before the opener gets its focus back.
  useLayoutEffect(() => {
    const back = document.activeElement as HTMLElement | null;      // the button that opened it gets the focus back
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const behind = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && !el.contains(root.current) && !el.inert);
    behind.forEach((el) => { el.inert = true; });
    return () => {
      document.body.style.overflow = overflow;
      behind.forEach((el) => { el.inert = false; });
      if (back?.isConnected) back.focus();
    };
  }, []);

  // focus starts on Close while the camera starts, then moves to Record (unless you've already moved on, e.g. into the script)
  useEffect(() => { closeBtn.current?.focus(); }, []);
  useEffect(() => {
    const at = document.activeElement;
    if (cam === "ready" && (at === closeBtn.current || !root.current?.contains(at))) recBtn.current?.focus();
  }, [cam]);
  useEffect(() => { const now = performance.now(); clock.current.setWpm(wpm, now); }, [wpm]);
  useEffect(() => {
    const now = performance.now();
    clock.current.setTotal(words.length, now);
    if (!clock.current.running) clock.current.reset();
  }, [words.length]);

  // ---------------------------------------------------------------- recording
  function record() {
    if (phase === "rec") { camera.current?.stop(); return; }
    if (phase === "count") { clearInterval(timer.current); setPhase("idle"); announce("Countdown cancelled."); return; }
    if (cam !== "ready") return;
    setErr(""); setPlaying(null);
    stage.current?.scrollIntoView({ block: "start" });      // phones: back up to the camera and the script if you scrolled down
    recN.current = nextTakeNumber(takes);
    const t0 = performance.now();
    setPhase("count"); setCount(COUNTDOWN_FROM); announce(`Take ${recN.current} in ${COUNTDOWN_FROM}`);
    let shown = COUNTDOWN_FROM;
    timer.current = window.setInterval(() => {
      const ms = performance.now() - t0, n = countdownAt(ms);
      if (n !== shown && n > 0) { shown = n; setCount(n); announce(String(n)); }
      if (ms >= countdownLength()) { clearInterval(timer.current); begin(); }
    }, COUNT_MS / 10);
  }

  function begin() {
    const c = camera.current;
    if (!c?.stream) { setPhase("idle"); return; }
    c.record();
    setPhase("rec"); setElapsed(0);
    announce(`Recording take ${recN.current}.`);
    if (follow && words.length) { clock.current.reset(); clock.current.start(performance.now()); setRunning(true); }
  }

  function toggleScript() {
    if (!words.length || still) return;
    const now = performance.now();
    if (clock.current.done(now)) clock.current.reset();
    const on = clock.current.toggle(now);
    setRunning(on);
    announce(on ? "Script scrolling." : "Script paused.");
  }
  function toTop() { clock.current.reset(); setRunning(false); setMoved((m) => m + 1); announce("Script back to the start."); }

  function remove(t: Take) {
    URL.revokeObjectURL(t.url);
    setTakes((x) => x.filter((y) => y !== t));
    if (playing === t.n) setPlaying(null);
    announce(`Take ${t.n} deleted.`);
    requestAnimationFrame(() => takesHead.current?.focus());
  }

  function use() {
    if (!takes.length || phase !== "idle") return;
    onUse(takes.map((t) => t.file), script.trim());
  }

  // ---------------------------------------------------------------- keyboard: Esc, Space, focus trap
  const requestClose = () => { if (takes.length || phase !== "idle") setConfirm(true); else onClose(); };
  useEffect(() => { if (confirm) root.current?.querySelector<HTMLButtonElement>(".film-confirm button")?.focus(); }, [confirm]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault(); e.stopPropagation();
      if (confirm) { setConfirm(false); requestAnimationFrame(() => recBtn.current?.focus()); } else requestClose();
      return;
    }
    if (e.key === " " && !confirm && !isTextField(e.target) && words.length && !still && (phase === "rec" || running)) {
      e.preventDefault(); spaceTaken.current = true; toggleScript();       // while filming, Space is the script's pause
      return;
    }
    if (e.key === "Tab") {
      const scope = (confirm ? root.current?.querySelector(".film-confirm") : root.current) as HTMLElement | null;
      const els = [...(scope?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((x) => x.getClientRects().length);
      if (!els.length) return;
      const first = els[0], last = els[els.length - 1], at = document.activeElement;
      if (e.shiftKey && (at === first || !scope?.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !scope?.contains(at))) { e.preventDefault(); first.focus(); }
    }
  }
  function onKeyUp(e: React.KeyboardEvent) { if (e.key === " " && spaceTaken.current) { e.preventDefault(); spaceTaken.current = false; } }

  const recLabel = phase === "rec" ? `Stop recording take ${recN.current}` : phase === "count" ? "Cancel the countdown"
    : `Record take ${nextTakeNumber(takes)}`;
  const left = MAX_TAKE_SECONDS - elapsed;
  const total = takes.reduce((a, t) => a + t.duration, 0);

  return createPortal(
    <div ref={root} className="film" role="dialog" aria-modal="true" aria-labelledby="film-title" onKeyDown={onKeyDown} onKeyUp={onKeyUp}>
      <header className="film-top">
        <h2 id="film-title"><Icon name="camera" />Film it here</h2>
        <span className="film-state small" aria-hidden="true">
          {phase === "rec" ? <><span className="rec-dot on" />Recording</> : phase === "count" ? "Get ready…" : cam === "ready" ? "Camera on" : ""}</span>
        <button ref={closeBtn} type="button" className="btn ghost sm" onClick={requestClose}
          aria-label={takes.length || phase !== "idle" ? "Close the camera (asks before throwing takes away)" : "Close the camera"}>
          <Icon name="close" />Close</button>
      </header>
      <p className="sr-only" aria-live="assertive" aria-atomic="true">{say}</p>

      <div className="film-body">
        <div ref={stage} className={`film-stage ${tall ? "tall" : "wide"}`}>
          <video ref={live} className="film-cam" muted playsInline autoPlay aria-label="Camera preview (mirrored, like a mirror; the take isn't)" />
          {cam === "asking" && <div className="film-msg"><span className="spin" aria-hidden="true" /><p>Asking for your camera and microphone…</p></div>}
          {cam === "error" && <div className="film-msg" role="alert">
            <Icon name="alert" /><p>{camErr}</p>
            <button type="button" className="btn" onClick={() => void open()}>Try again</button></div>}
          {words.length > 0 && cam !== "error" &&
            <Teleprompter words={words} clock={clock.current} px={px} mirror={mirror} still={still} running={running} moved={moved} onToggle={toggleScript} />}
          {phase === "count" && <div className="film-count" aria-hidden="true" key={count}>{count}</div>}
          <div className="film-ctrl">
            <button ref={recBtn} type="button" className={`film-recbtn ${phase}`} disabled={cam !== "ready"} onClick={record}
              aria-label={recLabel} aria-describedby={phase === "rec" && words.length && !still ? "film-space" : undefined}>
              <i aria-hidden="true" /><span>{phase === "rec" ? "Stop" : phase === "count" ? "Cancel" : `Record take ${nextTakeNumber(takes)}`}</span>
            </button>
            {phase === "rec" && <span className="film-time num" role="timer" aria-label={`${sayTime(elapsed)} recorded`}>{formatTime(elapsed)}</span>}
            {phase === "rec" && left <= 30 && <span className="film-warn small">Stops in {Math.ceil(left)} s</span>}
          </div>
          <p id="film-space" className="sr-only">While you film, Space pauses and resumes the script.</p>
        </div>

        <div className="film-side">
          <section className="stack tight" aria-labelledby="film-script-h">
            <h3 id="film-script-h">Your script <span className="faint small">(optional)</span></h3>
            <label htmlFor="film-script" className="sr-only">Your script</label>
            <textarea id="film-script" className="textarea" rows={5} value={script} spellCheck={false} aria-describedby="film-script-hint"
              onChange={(e) => setScript(e.target.value)} placeholder="Paste what you'll say. It scrolls over the camera while you film." />
            <span className="hint" id="film-script-hint">Your subtitles get its spelling of names and brand words. You can film without one.</span>
            {mine && script.trim() !== mine.trim() &&
              <p className="small"><button type="button" className="link" onClick={() => setScript(mine)}>Use the script I wrote in Cutmind</button></p>}
          </section>

          {words.length > 0 && <fieldset className="film-prompt">
            <legend>Teleprompter</legend>
            <div className="field">
              <label htmlFor="film-wpm">Speed <span className="num faint">{wpm} words a minute</span></label>
              <input id="film-wpm" className="range" type="range" min={WPM_MIN} max={WPM_MAX} step={5} value={wpm}
                aria-valuetext={`${wpm} words a minute`} onChange={(e) => setWpm(Number(e.target.value))} />
              <span className="hint">About {formatTime(readingSeconds(words.length, wpm))} for {words.length} words.</span>
            </div>
            <div className="field">
              <label htmlFor="film-px">Text size <span className="num faint">{px} px</span></label>
              <input id="film-px" className="range" type="range" min={TEXT_MIN} max={TEXT_MAX} step={2} value={px}
                aria-valuetext={`${px} pixels`} onChange={(e) => setPx(Number(e.target.value))} />
            </div>
            <label className="check"><input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              <span>Start scrolling with the recording</span></label>
            <label className="check"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
              <span>Mirror the text<span className="hint block">For a teleprompter glass in front of the camera.</span></span></label>
            <label className="check"><input type="checkbox" checked={still} onChange={(e) => { setStill(e.target.checked); if (e.target.checked) toTop(); }} />
              <span>Keep the script still<span className="hint block">No scrolling: the whole script stays up, and you scroll it yourself.</span></span></label>
            {!still && <div className="row">
              <button type="button" className="btn sm" onClick={toggleScript} aria-keyshortcuts={phase === "rec" ? "Space" : undefined}>
                <Icon name={running ? "pause" : "play"} />{running ? "Pause script" : "Play script"}</button>
              <button type="button" className="btn ghost sm" onClick={toTop}>Back to the start</button>
            </div>}
            {!still && <p className="hint">Tap the script{phase === "rec" ? " or press Space" : ""} to pause and resume it.</p>}
          </fieldset>}

          <section className="film-takes" aria-labelledby="film-takes-h">
            <h3 id="film-takes-h" ref={takesHead} tabIndex={-1}>Your takes {takes.length > 0 &&
              <span className="faint small num">({takes.length}, {formatTime(total)})</span>}</h3>
            {!takes.length && <p className="hint">Film as many takes as you like. Retakes and fumbles are fine: your editor keeps your best take of every line.</p>}
            {takes.length > 0 && <ul className="film-list">
              {takes.map((t) => (
                <li key={t.n}>
                  <div className="film-take">
                    <Icon name="film" />
                    <span className="grow"><b>Take {t.n}</b> <span className="faint small num">{formatTime(t.duration)}</span></span>
                    <button type="button" className="btn ghost icon sm" aria-label={playing === t.n ? `Hide take ${t.n}` : `Play take ${t.n}`}
                      aria-expanded={playing === t.n} onClick={() => setPlaying(playing === t.n ? null : t.n)}>
                      <Icon name={playing === t.n ? "close" : "play"} /></button>
                    <button type="button" className="btn ghost icon sm" aria-label={`Delete take ${t.n}`} disabled={phase !== "idle"}
                      onClick={() => remove(t)}><Icon name="trash" /></button>
                  </div>
                  {playing === t.n && <video className="film-play" src={t.url} controls autoPlay playsInline aria-label={`Take ${t.n}`}
                    ref={reveal} />}
                </li>))}
            </ul>}
          </section>

          {err && <div className="alert err" role="alert"><Icon name="alert" /><span>{err}</span></div>}

          <div className="film-use">
            <button type="button" className="btn primary lg" disabled={!takes.length || phase !== "idle"} onClick={use}>
              <Icon name="wand" />Use {takes.length > 1 ? `these ${takes.length} takes` : "this take"}</button>
            <p className="hint">{script.trim() ? "Makes your reel, with your script on the subtitles." : "Makes your reel from your takes."}</p>
          </div>
        </div>
      </div>

      {confirm && <div className="film-confirm-back">
        <div className="film-confirm" role="alertdialog" aria-modal="true" aria-labelledby="film-confirm-h" aria-describedby="film-confirm-p">
          <h3 id="film-confirm-h">Close the camera?</h3>
          <p id="film-confirm-p" className="muted">{phase !== "idle" ? "The take you're filming" : `Your ${takes.length === 1 ? "take" : `${takes.length} takes`}`} will
            be thrown away. To keep {takes.length === 1 && phase === "idle" ? "it" : "them"}, press Use instead.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => { setConfirm(false); requestAnimationFrame(() => recBtn.current?.focus()); }}>Keep filming</button>
            <button type="button" className="btn danger" onClick={onClose}>Throw away and close</button>
          </div>
        </div>
      </div>}
    </div>,
    document.body,
  );
}

/** The script on a dimmed band at the top of the camera picture. It glides up line by line at the chosen speed; read words
 *  fade. "Keep the script still" (and reduced motion, by default) shows it without scrolling. Tap to pause and resume. */
function Teleprompter({ words, clock, px, mirror, still, running, moved, onToggle }: {
  words: { w: string; para: boolean }[]; clock: PrompterClock; px: number; mirror: boolean; still: boolean; running: boolean; moved: number;
  onToggle: () => void;
}) {
  const band = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const lines = useRef<PromptLine[]>([]);

  const measure = useCallback(() => {
    const spans = text.current?.querySelectorAll<HTMLElement>("span[data-i]");
    lines.current = promptLines([...(spans ?? [])].map((s) => s.offsetTop));
  }, []);
  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (text.current) ro.observe(text.current);
    return () => ro.disconnect();
  }, [measure, words, px]);

  useEffect(() => {
    const el = text.current, b = band.current;
    if (!el || !b) return;
    const flip = mirror ? " scaleX(-1)" : "";
    if (still) { el.style.transform = mirror ? "scaleX(-1)" : ""; el.querySelectorAll(".r").forEach((s) => s.classList.remove("r")); return; }
    const spans = [...el.querySelectorAll<HTMLElement>("span[data-i]")];
    let raf = 0, read = -1;
    const draw = () => {
      const pos = clock.position(performance.now());
      const y = b.clientHeight * READ_LINE - scrollOffset(pos, lines.current);
      el.style.transform = `translateY(${y.toFixed(1)}px)${flip}`;
      const i = Math.floor(pos);
      if (i !== read) { spans.forEach((s, k) => s.classList.toggle("r", k < i)); read = i; }
      if (running) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [clock, running, still, mirror, words, px, moved]);

  return (<>
    <div ref={band} className={`film-band ${still ? "still" : ""}`} tabIndex={0} role="region"
      aria-label={still ? "Your script (scroll it with the arrow keys)" : "Teleprompter. Tap to pause or resume the script."}
      onClick={() => { if (!still) onToggle(); }}>
      {!still && <i className="film-mark" aria-hidden="true" style={{ top: `${READ_LINE * 100}%` }} />}
      <div ref={text} className="film-text" style={{ fontSize: px }}>
        {words.map((x, i) => <Fragment key={i}>{x.para && <span className="pb" aria-hidden="true" />}<span data-i={i}>{x.w} </span></Fragment>)}
      </div>
    </div>
    {!still && !running && <span className="film-paused small" aria-hidden="true">
      {clock.position(performance.now()) > 0 ? "Paused · tap the script to go on" : "Tap the script to start it"}</span>}
  </>);
}
