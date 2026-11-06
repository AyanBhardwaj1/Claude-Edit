"use client";
import { useEffect, useRef, useState } from "react";
import type { User } from "@/lib/auth";
import { listAnims, listProjects, loadRules, readLocal } from "@/lib/store";
import { paletteOf, total, type Anim } from "@/lib/studio";
import { THEME_KEY, THEMES, type ThemeId } from "@/lib/theme";
import type { Project, Settings, StyleRule } from "@/lib/types";
import { kindOf } from "@/lib/workflow";
import { insights } from "@/lib/insights";
import { Icon } from "./Icons";
import { clock, fmtDur, keptSeconds, rawSeconds, VideoTile } from "./Tiles";

type Go = "videos" | "animate" | "script" | "style" | "settings";

function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return `${part}, ${name.split(/\s+/)[0]}`;
}

export function Dashboard({ user, settings, theme, onNew, onOpen, onGo, onSample }: { user: User; settings: Settings; theme: ThemeId;
  onSample: () => void; onNew: (files?: File[]) => void; onOpen: (p: Project) => void; onGo: (s: Go) => void }) {
  const [ps, setPs] = useState<Project[] | null>(null);
  const [rules, setRules] = useState<StyleRule[]>([]);
  const [anims, setAnims] = useState<Anim[]>([]);
  const [welcome, setWelcome] = useState(false);
  useEffect(() => { try { setWelcome(!localStorage.getItem(`cutmind.welcomed.${user.id}`)); } catch { /* storage blocked */ } }, [user.id]);
  const dismiss = () => { setWelcome(false); try { localStorage.setItem(`cutmind.welcomed.${user.id}`, "1"); } catch { /* storage blocked */ } };
  const NEWS = `cutmind.news.2026-11c.${user.id}`;      // a new key: the panel shows again for what's new
  const [news, setNews] = useState(false);
  useEffect(() => { try { setNews(!localStorage.getItem(NEWS)); } catch { /* storage blocked */ } }, [NEWS]);
  const hideNews = () => { setNews(false); try { localStorage.setItem(NEWS, "1"); } catch { /* storage blocked */ } };
  const [over, setOver] = useState(false);
  const [lookPicked, setLookPicked] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void listProjects().then(setPs);
    void listAnims().then(setAnims);
    setRules(loadRules());
    try { setLookPicked(!!localStorage.getItem(THEME_KEY)); } catch { /* storage blocked */ }
  }, [theme]);

  const ready = (ps ?? []).filter((p) => p.status === "edited" && p.versions.length);
  const versions = ready.reduce((n, p) => n + p.versions.length, 0);
  const cut = ready.reduce((s, p) => s + Math.max(0, rawSeconds(p) - keptSeconds(p)), 0);
  const key = settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;
  const steps = [
    { what: "Connect an AI editor", done: !!key, act: () => onGo("settings"), label: "Add key" },
    { what: "Choose how Cutmind listens", done: settings.transcriber === "browser" || !!settings.openaiKey, act: () => onGo("settings"), label: "Choose" },
    { what: "Pick a look for the app", done: lookPicked, act: () => onGo("settings"), label: "Pick" },
    { what: "Make your first reel", done: ready.length > 0, act: () => onNew(), label: "Start" },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const stats = ps ? insights(ps) : null;            // how your reels are doing over time (lib/insights.ts)
  // a nudge to back up: 3+ videos, and never backed up from this browser or not in a week
  const lastBackup = typeof window !== "undefined" ? readLocal("ce.lastBackup") : null;
  const needsBackup = !!ps && ps.filter((x) => !x.sample).length >= 3 &&
    (!lastBackup || Date.now() - Date.parse(lastBackup) > 7 * 864e5);
  const drop = (files: FileList | null) => {
    const fs = [...(files ?? [])].filter((f) => kindOf(f));
    if (fs.length) onNew(fs);
  };
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const themeName = THEMES.find((t) => t.id === theme)?.name;

  return (
    <div className="page">
      <div className="page-head hello">
        <div><p className="faint small">{today}</p><h1>{greeting(user.name)}</h1></div>
        <div className="row">
          <button className="btn" onClick={() => onGo("animate")}><Icon name="wand" />Animate text</button>
          <button className="btn" onClick={() => onGo("script")}><Icon name="pen" />Write a script</button>
          <button className="btn primary" onClick={() => onNew()}><Icon name="plus" />New video</button>
        </div>
      </div>

      {welcome && (
        <section className="welcome" aria-labelledby="welcome-h">
          <div className="grow">
            <h2 id="welcome-h">Welcome to Cutmind, {user.name.split(/\s+/)[0]}</h2>
            <p>Three ways to start. Everything stays in this browser, and you can add an AI key any time for the full editor.</p>
          </div>
          <div className="welcome-acts">
            <button className="w-act" onClick={() => { dismiss(); onNew(); }}><Icon name="upload" /><b>Edit a video</b><span>Raw takes in, a finished reel out</span></button>
            <button className="w-act" onClick={() => { dismiss(); onGo("animate"); }}><Icon name="wand" /><b>Animate text</b><span>No camera: type it, watch it move</span></button>
            <button className="w-act" onClick={() => { dismiss(); onSample(); }}><Icon name="play" /><b>Open the sample</b><span>A finished edit to play with</span></button>
          </div>
          <button className="btn ghost icon sm close" aria-label="Close the welcome" onClick={dismiss}>&times;</button>
        </section>
      )}
      <div className="dash">
        <div className="stack">
          <section className="panel start" aria-label="Start a reel">
            <div className={`drop-in ${over ? "over" : ""}`} role="button" tabIndex={0} aria-label="Drop takes here or choose files"
              onClick={() => input.current?.click()} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.current?.click(); } }}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); drop(e.dataTransfer.files); }}>
              <div>
                <Icon name="upload" />
                <b>Drop your raw takes here</b>
                <p className="small muted mt-6">MP4, MOV or WebM. Fumbles and retakes are fine.</p>
              </div>
              <input ref={input} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={(e) => drop(e.target.files)} />
            </div>
            <div className="side-actions">
              <h2>From take to post in one pass</h2>
              <p>Cutmind keeps your last good take of every line, cuts the pauses, adds subtitles, a hook title, pictures, zooms and music,
                then writes your caption. Change anything by typing a note.</p>
              <div className="row"><button className="btn" onClick={onSample}><Icon name="play" />Open the sample video</button></div>
              <p className="small faint">No footage yet? The sample has a drawn presenter, a computer voice and a first edit to play with.</p>
            </div>
          </section>

          <section className="stats" aria-label="Your numbers">
            <div className="stat"><b>{ps ? ready.length : "–"}</b><span>reels made</span></div>
            <div className="stat"><b>{ps ? versions : "–"}</b><span>versions from notes</span></div>
            <div className="stat"><b>{ps ? fmtDur(cut) : "–"}</b><span>of pauses and retakes cut</span></div>
            <div className="stat"><b>{rules.length}</b><span>style rules learned</span></div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Recent videos</h2>
              {ps && ps.length > 0 && <a className="btn ghost sm" href="#videos" onClick={(e) => { e.preventDefault(); onGo("videos"); }}>
                See all {ps.length}<Icon name="arrowRight" /></a>}
            </div>
            {!ps && <div className="tiles" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skel tile-skel" />)}</div>}
            {ps && !ps.length && <p className="muted">Your reels show up here. Drop a take above, or <button className="link" onClick={onSample}>open
              the sample video</button> to see an edit first.</p>}
            {ps && ps.length > 0 && <div className="tiles">{ps.slice(0, 4).map((p) => <VideoTile key={p.id} p={p} onOpen={() => onOpen(p)} />)}</div>}
          </section>
        </div>

        <div className="stack">
          {needsBackup && (
            <div className="alert info backup-nudge" role="note"><Icon name="alert" />
              <span className="grow">{lastBackup ? "Your last backup is more than a week old." : `You have ${ps!.filter((x) => !x.sample).length} videos and no backup yet.`} They
                live only in this browser: clearing its data would delete them.</span>
              <button className="btn sm" onClick={() => onGo("settings")}>Back up</button></div>
          )}
          {stats && (
            <section className="panel insights" aria-labelledby="ins-h">
              <div className="panel-head"><h2 id="ins-h">Your reels</h2><span className="small faint">{stats.videos} videos</span></div>
              <div className="ins-row">
                <svg className="spark" viewBox={`0 0 ${Math.max(1, stats.scores.length - 1) * 20} 40`} preserveAspectRatio="none" role="img"
                  aria-label={`Reel check scores, oldest to newest: ${stats.scores.map((x) => x.score).join(", ")}`}>
                  <polyline points={stats.scores.map((x, i) => `${i * 20},${40 - (x.score / 100) * 36 - 2}`).join(" ")} />
                </svg>
                <div><b className="num big-n">{stats.average}</b><span className="small muted block">average reel check</span>
                  {stats.change !== null && <span className={`small block ${stats.change >= 0 ? "say-ok" : "say-bad"}`}>
                    {stats.change >= 0 ? "▲" : "▼"} {Math.abs(stats.change)} from your earlier reels</span>}</div>
                <div><b className="num big-n">{stats.averageLength}s</b><span className="small muted block">average length</span></div>
                <div><b className="num big-n">{stats.scroll.passed}<span className="small muted"> / {stats.scroll.of}</span></b>
                  <span className="small muted block">pass the scroll test</span></div>
              </div>
              {stats.top && <p className="small ins-top"><b>Most often missing: {stats.top.title.charAt(0).toLowerCase() + stats.top.title.slice(1)}</b> ({stats.top.count} reels). {stats.top.fix}</p>}
            </section>
          )}
          {news && !welcome && (
            <section className="panel news" aria-labelledby="news-h">
              <div className="panel-head"><h2 id="news-h">New in Cutmind</h2>
                <button className="btn ghost icon sm" aria-label="Hide what's new" onClick={hideNews}>&times;</button></div>
              <ul className="setup news-list">
                <li><span className="what grow"><b>Scroll test</b> (T): the first 3 seconds with the sound off, then what a scroller got, with
                  one-click fixes and your strongest line to open with. <b>Loop test</b> (L) plays the end into the start.</span></li>
                <li><span className="what grow"><b>Before you post</b>: every check in one line at export, with <b>Fix what I can</b> and the
                  export&apos;s measured loudness (<b>Match loudness</b> brings it to about -14 LUFS).</span></li>
                <li><span className="what grow"><b>Bleep</b> strong language, <b>show the logos</b> of apps you name, play the talk at{" "}
                  <b>1.1-1.3×</b> with the pitch kept, and <b>test other hooks</b> as trial reels.</span></li>
                <li><span className="what grow"><b>YouTube chapters</b> for long wide videos: in the description and, if you like, on screen.</span></li>
                <li><span className="what grow"><b>Make a copy</b> of a video to try something different without touching it.</span>
                  <button className="btn sm" onClick={() => onGo("videos")}>My videos</button></li>
              </ul>
            </section>
          )}
          {doneCount < steps.length && (
            <section className="panel" aria-labelledby="setup-h">
              <div className="panel-head"><h2 id="setup-h">Get set up</h2><span className="small faint num">{doneCount} of {steps.length}</span></div>
              <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup">
                <i style={{ transform: `scaleX(${doneCount / steps.length})` }} /></div>
              <ul className="setup mt-10">
                {steps.map((s) => (
                  <li key={s.what} className={s.done ? "done" : ""}>
                    <span className="tick">{s.done ? <Icon name="check" /> : null}</span>
                    <span className="what grow">{s.what}</span>
                    {!s.done && <button className="btn sm" onClick={s.act}>{s.label}</button>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel" aria-labelledby="ed-h">
            <div className="panel-head"><h2 id="ed-h">Your editor</h2>
              <a className="btn ghost sm" href="#settings" onClick={(e) => { e.preventDefault(); onGo("settings"); }}>Change</a></div>
            <ul className="setup">
              <li><span className="tick"><Icon name="key" /></span><span className="grow">
                {key ? <>Edits with your <b>{settings.provider === "anthropic" ? "Anthropic" : "OpenAI"}</b> key</> : "No key: simple cuts with subtitles"}</span></li>
              <li><span className="tick"><Icon name="ear" /></span><span className="grow">
                {settings.transcriber === "openai" ? "Listens with OpenAI (fast)" : "Listens in your browser (free)"}</span></li>
              <li><span className="tick"><Icon name="palette" /></span><span className="grow">{themeName} look</span></li>
            </ul>
          </section>

          <section className="panel" aria-labelledby="anim-h2">
            <div className="panel-head"><h2 id="anim-h2">Animations</h2>
              <a className="btn ghost sm" href="#animate" onClick={(e) => { e.preventDefault(); onGo("animate"); }}>{anims.length ? "All" : "Make one"}</a></div>
            {anims.length ? <div className="anim-list">{anims.slice(0, 3).map((x) => (
              <a key={x.id} className="anim-row link-row" href={`#animate/${encodeURIComponent(x.id)}`}>
                <span className="sw" style={{ background: paletteOf(x.palette).bg }}><i style={{ background: paletteOf(x.palette).accent }} /></span>
                <span className="grow"><b className="trunc block">{x.title}</b><span className="small faint">{x.scenes.length} scenes · {clock(total(x))}</span></span>
              </a>))}</div>
              : <p className="small muted">Type a script, a launch or a few bullet points and Motion Studio animates it. No camera needed.</p>}
          </section>

          <section className="panel" aria-labelledby="style-h">
            <div className="panel-head"><h2 id="style-h">My style</h2>
              <a className="btn ghost sm" href="#style" onClick={(e) => { e.preventDefault(); onGo("style"); }}>All rules</a></div>
            {rules.length ? (
              <ul className="rules-mini">{rules.slice(-3).reverse().map((r) => <li key={r.id}>{r.text}</li>)}</ul>
            ) : <p className="small muted">When a note is a lasting preference, like &ldquo;always use big subtitles&rdquo;, your editor offers to
              remember it. Remembered rules shape every first edit.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
