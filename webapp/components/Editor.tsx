"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { postText } from "@/lib/edit";
import { Player } from "@/lib/player";
import { loadRules, saveProject, saveRules } from "@/lib/store";
import type { Edit, Project, Settings } from "@/lib/types";
import { addToLibrary, applyUserNote, mediaUrls, saveManual } from "@/lib/workflow";
import { Drawer } from "./Drawer";

type Msg = { who: "you" | "ed"; text: string; rule?: string };

const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

export function Editor({ project, settings, firstSummary, onBack }: { project: Project; settings: Settings; firstSummary?: string;
  onBack: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const [p, setP] = useState(project);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => (firstSummary ? [{ who: "ed", text: firstSummary }] :
    project.versions.map((v) => ({ who: "ed" as const, text: `Version ${v.n}: ${v.summary}` }))));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [exp, setExp] = useState<{ pct: number; video?: string; ext?: string; cover?: string } | null>(null);
  const [err, setErr] = useState("");
  const version = p.versions.find((v) => v.n === p.current) ?? p.versions[p.versions.length - 1];

  const mount = useCallback(async (edit: Edit) => {
    player.current?.dispose();
    const urls = await mediaUrls(p);
    const pl = new Player(canvas.current!, p, edit, urls);
    pl.onTime = setT;
    pl.onEnd = () => setPlaying(false);
    await pl.load();
    player.current = pl;
    setDur(pl.tl.duration); setT(0); setPlaying(false);
  }, [p]);

  useEffect(() => { if (version) void mount(version.edit); return () => player.current?.dispose(); }, [version, mount]);

  async function toggle() {
    const pl = player.current;
    if (!pl) return;
    if (playing) { pl.pause(); setPlaying(false); } else { setPlaying(true); await pl.play(); }
  }

  async function send() {
    const text = note.trim();
    if (!text) return;
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

  async function exportVideo() {
    const pl = player.current;
    if (!pl) return;
    setExp({ pct: 0 }); setPlaying(true);
    try {
      const { blob, ext } = await pl.record((pct) => setExp((x) => ({ ...x!, pct })));
      const cover = await pl.cover();
      setExp({ pct: 100, video: URL.createObjectURL(blob), ext, cover: URL.createObjectURL(cover) });
    } catch (e) { setErr(String(e)); setExp(null); }
    setPlaying(false);
  }

  const post = version ? postText(p, version.edit) : "";
  const e = version?.edit;
  const pics = e?.broll.filter((b) => b.treatment !== "text-pop").length ?? 0, cards = e ? e.broll.length - pics : 0;
  const song = e?.music.asset ? p.library.find((a) => a.key === e.music.asset) : undefined;
  const base = p.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80) + ` - Version ${p.current}`;

  return (
    <div>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className="ghost small" onClick={onBack}>← My videos</button>
        <h1 className="grow" style={{ margin: 0 }}>{p.title}</h1>
        <button onClick={() => setDrawer(!drawer)}>{drawer ? "Close the editor" : "Edit it myself"}</button>
        <button className="primary" onClick={exportVideo} disabled={!!exp && exp.pct < 100}>Export</button>
      </div>
      <div className="editor">
        <div>
          <div className="phone"><canvas ref={canvas} /></div>
          <input type="range" className="scrub" min={0} max={dur || 1} step={0.01} value={t}
            onChange={(ev) => { const v = +ev.target.value; setT(v); void player.current?.seek(v); }} />
          <div className="row">
            <button onClick={toggle} disabled={!!exp && exp.pct < 100}>{playing ? "Pause" : "Play"}</button>
            <span className="small muted">{fmt(t)} / {fmt(dur)}</span>
          </div>
          <div className="versions">
            {p.versions.map((v) => (
              <button key={v.n} title={v.note} className={`small ${v.n === p.current ? "primary" : ""}`}
                onClick={async () => { p.current = v.n; await saveProject(p); setP({ ...p }); }}>Version {v.n}</button>
            ))}
          </div>
        </div>
        <div>
          {exp && (
            <div className="card" style={{ marginBottom: 14 }}>
              {exp.pct < 100 ? (<><b>Making the video</b><div className="bar"><div style={{ width: `${exp.pct}%` }} /></div>
                <p className="small muted">It plays through once in real time to record. Keep this tab open and in front.</p></>) : (
                <>
                  <b>Ready to post</b>
                  <div className="row" style={{ margin: "10px 0" }}>
                    <a className="btn primary" href={exp.video} download={`${base}.${exp.ext}`}>Download video (.{exp.ext})</a>
                    <a className="btn" href={exp.cover} download={`${base} cover.jpg`}>Download cover</a>
                    <a className="btn" href={URL.createObjectURL(new Blob([post], { type: "text/plain" }))} download={`${base} caption.txt`}>Caption .txt</a>
                    <button onClick={() => navigator.clipboard.writeText(post)}>Copy caption</button>
                  </div>
                  {exp.ext === "webm" && <p className="small muted">Your browser recorded WebM. For Instagram, export from Chrome, Edge or Safari
                    to get MP4, or convert the file.</p>}
                  <button className="small ghost" onClick={() => setExp(null)}>Close</button>
                </>)}
            </div>
          )}
          <div className="card">
            <h2>What I did</h2>
            {e && <ul className="check">
              <li>✓ Kept your best takes · {fmt(dur)} long</li>
              <li>{e.captions.enabled ? "✓ Added subtitles" : "· Subtitles off"}</li>
              <li>{song ? `✓ Added music: ${song.name}` : "· No music (add a song to your video's files)"}</li>
              <li>{pics + cards ? `✓ ${pics} picture${pics === 1 ? "" : "s"} and ${cards} text card${cards === 1 ? "" : "s"}` : "· No pictures yet"}</li>
              <li>{e.zooms.length ? `✓ ${e.zooms.length} zooms` : "· No zooms"}</li>
              <li>{e.post.caption ? "✓ Wrote your post caption" : "· No post caption yet"}</li>
            </ul>}
          </div>
          <div className="card" style={{ marginTop: 14 }}>
            <h2>Notes for your editor</h2>
            <div className="chat">
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.who === "you" ? "you" : "ed"}`}>
                  {m.text}
                  {m.rule && (
                    <div style={{ marginTop: 8 }}>
                      <div className="small muted">Remember this for next time? &quot;{m.rule}&quot;</div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <button className="small" onClick={() => { addRule(m.rule!); setMsgs((x) => x.map((y, k) => (k === i ? { ...y, rule: undefined, text: y.text + "\nSaved to My style." } : y))); }}>Yes, remember it</button>
                        <button className="small ghost" onClick={() => setMsgs((x) => x.map((y, k) => (k === i ? { ...y, rule: undefined } : y)))}>No, just this video</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="msg ed muted">{busy}</div>}
            </div>
            {err && <div className="err">{err}</div>}
            <div className="row" style={{ marginTop: 10 }}>
              <textarea className="grow" rows={2} value={note} placeholder='Tell your editor what to change, e.g. "music too loud at the start"'
                onChange={(ev) => setNote(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); void send(); } }} style={{ width: "auto" }} />
              <button className="primary" onClick={send} disabled={!!busy || !note.trim()}>Send</button>
            </div>
            <div className="row small muted" style={{ marginTop: 8 }}>
              Add files the editor can use:
              <input type="file" multiple accept="audio/*,image/*,video/*" style={{ width: "auto", padding: 4 }}
                onChange={async (ev) => { if (!ev.target.files) return; const n = await addToLibrary(p, [...ev.target.files]); await saveProject(p); setP({ ...p });
                  setMsgs((m) => [...m, { who: "ed", text: `Added ${n.join(", ")}. Tell me where to use ${n.length > 1 ? "them" : "it"}.` }]); }} />
            </div>
          </div>
          {drawer && version && (
            <div className="card" style={{ marginTop: 14 }}>
              <Drawer project={p} edit={version.edit} onApply={async (edit, what) => { await saveManual(p, edit, what); setP({ ...p }); setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: ${what}` }]); }} />
            </div>
          )}
          <div className="card" style={{ marginTop: 14 }}>
            <h2>Post caption</h2>
            <p style={{ whiteSpace: "pre-wrap" }} className="small">{post || "No caption yet."}</p>
            {post && <button className="small" onClick={() => navigator.clipboard.writeText(post)}>Copy</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
