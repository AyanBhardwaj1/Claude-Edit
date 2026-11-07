"use client";
import { announce } from "@/lib/assistant";
import { Timeline } from "./Timeline";
import type { Look } from "@/lib/look";
import { aiReady } from "@/lib/ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { postText } from "@/lib/edit";
import { FORMATS } from "@/lib/compositor";
import { findClips, makeClip, type Clip } from "@/lib/clips";
import { hookIdeas, hookOf, withHook } from "@/lib/hooks";
import { reelCheck, type Check } from "@/lib/score";
import { newAnim } from "@/lib/studio";
import { captionWords } from "@/lib/text";
import { recapOf } from "@/lib/studioAi";
import { saveAnim } from "@/lib/store";
import { Player } from "@/lib/player";
import { srt } from "@/lib/translate";
import { waveform } from "@/lib/wave";
import { applyBrand, brandOf, hasBrand } from "@/lib/brand";
import { applyTemplate, brandTemplate, templateOf, TEMPLATES } from "@/lib/templates";
import { loadRules, saveProject, saveRules } from "@/lib/store";
import type { Asset, Edit, Format, Project, Settings } from "@/lib/types";
import { addToLibrary, applyUserNote, mediaUrls, needsWaitScan, saveManual, scanWaits } from "@/lib/workflow";
import { waitSavings, WAIT_SPEED } from "@/lib/screenrec";
import { Drawer } from "./Drawer";
import dynamic from "next/dynamic";
// the composer (synth, mixer, loudness) only loads when someone opens Make music
const MusicMaker = dynamic(() => import("./MusicMaker").then((m) => m.MusicMaker), {
  ssr: false, loading: () => <p className="muted" role="status">Opening the composer…</p> });
import { Icon } from "./Icons";
import { RecordScreen } from "./ScreenRecorder";
import { clock } from "./Tiles";
import { changeItems, type Change } from "@/lib/changes";
import { attention, spotsNote, zoomsFor, type Attention } from "@/lib/attention";
import { openWith, strongestLine, type Line } from "@/lib/coldopen";
import { swears } from "@/lib/bleep";
import { buildTimeline } from "@/lib/timeline";
import { fixWhatICan } from "@/lib/autofix";
import { integratedLufs, samplePeakDb } from "@/lib/loudness";

/** The export's integrated loudness and peak, decoded in the browser; null when the browser can't decode it. */
async function measureLoudness(blob: Blob): Promise<{ lufs: number; peak: number } | null> {
  try {
    const ctx = new OfflineAudioContext(2, 48000, 48000);
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const ch = Array.from({ length: Math.min(2, buf.numberOfChannels) }, (_, i) => buf.getChannelData(i));
    return { lufs: integratedLufs(ch, buf.sampleRate), peak: samplePeakDb(ch) };
  } catch { return null; }
}
import { namedNotShown, type Name } from "@/lib/names";
import { chapterMarks, chapterText, chapterTitles, type Chapter } from "@/lib/chapters";
import { findPicture, webKey } from "@/lib/images";
import { maskWord } from "@/lib/text";
import { crutches } from "@/lib/crutch";
import { repeats } from "@/lib/fit";
import { cutWarmUp, LOOP_HEAD, LOOP_TAIL, loopCheck, SCROLL_SECONDS, scrollTest, type ScrollLine } from "@/lib/scrolltest";
import { clearPosition, PLATFORM_NAMES, subtitlesCovered, ZONES, type Platform } from "@/lib/safezones";
import { Shortcuts } from "./Shortcuts";
import { VoiceNote } from "./VoiceNote";
import { anchorSpoken, momentsText, noteTimes, pinToPlayhead } from "@/lib/moments";
import { declineLearned, learnFromExport } from "@/lib/learn";

type Msg = { who: "you" | "ed"; text: string; rule?: string; changes?: Change[]; learned?: boolean; v?: number };

export function Editor({ project, settings, firstSummary, onBack, onOpenProject, onOpenAnim, onSaveLook }: { project: Project; settings: Settings; firstSummary?: string;
  onBack: () => void; onOpenProject?: (p: Project, summary: string) => void; onOpenAnim?: (id: string) => void; onSaveLook?: (l: Look) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const player = useRef<Player | null>(null);
  const mounts = useRef(0);
  const chat = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(project);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => (firstSummary ? [{ who: "ed", text: firstSummary }] :
    project.versions.map((v, i) => {
      const base = v.from !== undefined ? project.versions.find((x) => x.n === v.from) : i > 0 ? project.versions[i - 1] : undefined;
      return { who: "ed" as const, text: `Version ${v.n}: ${v.summary}`, v: v.n, changes: base ? changeItems(project, base.edit, v.edit) : undefined };
    })));
  const [note, setNote] = useState("");
  useEffect(() => {                                   // the note box grows with what's in it (up to its max height)
    const el = document.getElementById("note") as HTMLTextAreaElement | null;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(160, Math.max(44, el.scrollHeight))}px`;
  }, [note]);
  const [busy, setBusy] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [timeline, setTimeline] = useState(false);   // the timeline editor under the header (components/Timeline.tsx)
  const tlDraft = useRef<Edit | null>(null);           // its unsaved changes, previewed in the player
  const [exp, setExp] = useState<{ pct: number; video?: string; ext?: string; cover?: string; caption?: string; label?: string; srt?: string;
    lufs?: number; peak?: number } | null>(null);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [keys, setKeys] = useState(false);
  const [appUi, setAppUi] = useState<Platform | null>(null);   // draw Reels / TikTok / Shorts UI over the preview
  // the scroll test (the first 3 seconds, sound off) and the loop test (the end running back into the start), then
  // what a viewer got from them
  const [scroll, setScroll] = useState<{ lines: ScrollLine[]; passed: number; loop: ScrollLine; cold: Line | null } | null>(null);
  const [shownTest, setShownTest] = useState<"scroll" | "loop" | null>(null);
  const run = useRef<null | { kind: "scroll" } | { kind: "loop"; phase: "tail" | "head" }>(null);
  const [running, setRunning] = useState<"scroll" | "loop" | null>(null);
  const endRun = (pl: Player | null, show: boolean) => {
    const r = run.current;
    if (!r) return;
    run.current = null; setRunning(null);
    if (pl) { pl.pause(); pl.muted = false; }
    setPlaying(false);
    if (show) setShownTest(r.kind);
  };
  async function startRun(kind: "scroll" | "loop") {
    const pl = player.current; if (!pl || exportingRef.current) return;
    const was = run.current?.kind;
    endRun(pl, false);
    if (was === kind) return;                                   // the button again stops it
    pl.pause(); setShownTest(null);
    const me = kind === "scroll" ? { kind } as const : { kind, phase: "tail" as "tail" | "head" };
    run.current = me; setRunning(kind);
    pl.muted = kind === "scroll";
    const from = kind === "scroll" ? 0 : Math.max(0, pl.tl.duration - LOOP_TAIL);
    await pl.seek(from);
    if (run.current !== me) return;              // stopped while it was getting ready
    setT(from); setPlaying(true); await pl.play(from);
    if (run.current !== me) pl.pause();
  }
  const lastBlob = useRef<Blob | null>(null);
  const [clips, setClips] = useState<Clip[] | null>(null);
  const [clipBusy, setClipBusy] = useState("");
  const [hooks, setHooks] = useState<string[] | null>(null);
  const [hookBusy, setHookBusy] = useState(false);
  const [hookDraft, setHookDraft] = useState("");
  const [names, setNames] = useState<Name[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);         // YouTube chapters for a long, wide video (lib/chapters.ts)
  const [chBusy, setChBusy] = useState(false);           // apps and brands said but never shown (lib/names.ts)
  const [logoBusy, setLogoBusy] = useState<string | null>(null);
  const [swore, setSwore] = useState<{ id: string; w: string; at: number }[]>([]);   // swear words said (lib/bleep.ts)
  const [recapBusy, setRecapBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [wave, setWave] = useState<number[] | null>(null);
  const [check, setCheck] = useState<{ score: number; checks: Check[] } | null>(null);
  const [attn, setAttn] = useState<Attention | null>(null);
  const [track, setTrack] = useState<{ segs: [number, number][]; layers: { s: number; e: number; text: boolean; label: string }[]; zooms: [number, number][] } | null>(null);
  const [all, setAll] = useState<{ f: Format; url: string; ext: string }[] | null>(null);
  // the same reel with other hook titles, for a platform's trial reels (Instagram tests a reel on non-followers)
  const [variants, setVariants] = useState<{ hook: string; url: string; ext: string }[] | null>(null);
  const [alts, setAlts] = useState<string[] | null>(null);
  // true for a whole export, Export all's version reloads between formats included: nothing may start playback then
  const [exporting, setExporting] = useState(false);
  const exportingRef = useRef(false);
  const expPct = useRef(0);                            // how far the export got (the assistant says done or stopped)
  // a change that reloads the preview (a finished wait scan) waits for the export: reloading mid-export would stop it
  const afterExport = useRef(false);
  const busyExport = (on: boolean) => {
    if (!on && exportingRef.current) announce(expPct.current >= 99 ? "Exported" : "Stopped", 100);   // the assistant's status ends too
    if (on) expPct.current = 0;
    exportingRef.current = on; setExporting(on);
    if (!on && afterExport.current) { afterExport.current = false; setP({ ...latest.current }); }
  };
  // export files are whole videos in memory: free the ones no longer shown
  const shownUrls = useRef<string[]>([]);
  useEffect(() => {
    const now = [exp?.video, exp?.cover, exp?.caption, exp?.srt, ...(all ?? []).map((x) => x.url), ...(variants ?? []).map((x) => x.url)]
      .filter((u): u is string => !!u);
    for (const u of shownUrls.current) if (!now.includes(u)) URL.revokeObjectURL(u);
    shownUrls.current = now;
  }, [exp, all, variants]);
  useEffect(() => () => { for (const u of shownUrls.current) URL.revokeObjectURL(u); }, []);
  const [maker, setMaker] = useState(false);
  const [wpm, setWpm] = useState<number | null>(null);
  const version = p.versions.find((v) => v.n === p.current) ?? p.versions[p.versions.length - 1];
  // a finished export belongs to the version it was made from: another version on screen means export again
  useEffect(() => { setExp((x) => (x && x.pct >= 100 ? null : x)); setAll(null); lastBlob.current = null; }, [version?.n]);
  const latest = useRef(p);
  latest.current = p;

  // "Speed through waits" for uploaded screen recordings: once a screen recording is in the library, its waits are looked
  // for in the background (lib/screenrec.ts findWaits), one clip at a time, without holding anything else up
  const [scan, setScan] = useState<{ key: string; name: string; pct: number } | null>(null);
  const [scanTick, setScanTick] = useState(0);
  const [scanSay, setScanSay] = useState("");
  const scanCtl = useRef<AbortController | null>(null);
  const scanSkip = useRef(new Set<string>());
  useEffect(() => {
    if (scanCtl.current) return;
    const a = p.library.find((x) => needsWaitScan(x) && !scanSkip.current.has(x.key));
    if (!a) return;
    const ctl = new AbortController();
    scanCtl.current = ctl;
    setScan({ key: a.key, name: a.name, pct: 0 });
    setScanSay(`Looking for waits in ${a.name}.`);
    let shown = 0;
    void scanWaits(a, (f) => { const pct = Math.round(f * 100); if (pct !== shown) { shown = pct; setScan({ key: a.key, name: a.name, pct }); } }, ctl.signal)
      .then(async (found) => {
        if (found === null || ctl.signal.aborted) return;
        const cur = latest.current;
        await saveProject(cur);
        const w = waitSavings(a);
        setScanSay(w.count ? `Found ${w.count} wait${w.count === 1 ? "" : "s"} in ${a.name}.` : `No waits in ${a.name}.`);
        if (w.count) setMsgs((m) => [...m, { who: "ed", text: `I found ${w.count === 1 ? "a wait" : `${w.count} waits`} in ${a.name} where nothing on screen ` +
          `moves (${Math.round(w.seconds)} s). ${w.count === 1 ? "It plays" : "They play"} ${WAIT_SPEED}× faster, which saves ${Math.round(w.saves)} s. ` +
          `Switch it off in Edit it myself, Pictures.` }]);
        if (exportingRef.current) afterExport.current = true;   // the preview follows the new plan once the export is done
        else setP({ ...cur });                  // the preview follows the new plan
      })
      .finally(() => { if (scanCtl.current === ctl) scanCtl.current = null; setScan(null); setScanTick((n) => n + 1); });
  }, [p, scanTick]);
  useEffect(() => () => { scanCtl.current?.abort(); }, []);
  const stopScan = () => { if (scan) scanSkip.current.add(scan.key); scanCtl.current?.abort(); setScanSay("Stopped looking for waits."); };
  const findWaitsFor = (key: string) => { scanSkip.current.delete(key); setScanTick((n) => n + 1); };

  const mount = useCallback(async (edit: Edit, keep?: { word?: string; t: number }) => {
    const gen = ++mounts.current;
    player.current?.dispose();
    await applyBrand(settings.brand);
    const urls = await mediaUrls(p);
    // left the editor, or a newer version/shape/style started loading meanwhile
    if (!canvas.current || gen !== mounts.current) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
    player.current?.dispose();
    const pl = new Player(canvas.current, p, edit, urls);
    run.current = null; setRunning(null);
    pl.onTime = (x) => {
      setT(x);
      const r = run.current;
      if (r && (r.kind === "scroll" ? x >= SCROLL_SECONDS : r.phase === "head" && x >= LOOP_HEAD)) endRun(pl, true);
    };
    pl.onEnd = () => {
      const r = run.current;
      if (r?.kind === "loop" && r.phase === "tail") {                 // as the app replays it
        r.phase = "head"; void pl.play(0).then(() => { if (run.current !== r) pl.pause(); }); return;
      }
      endRun(pl, true); setPlaying(false);
    };
    player.current = pl;
    await pl.load();
    if (!canvas.current || gen !== mounts.current) return;
    canvas.current!.dataset.cuts = pl.scene.cuts.map((c) => c.toFixed(3)).join(",");   // for tests and tools
    setCheck(reelCheck(p, edit, pl.tl));
    setAttn(attention(pl.tl, edit));
    setNames(namedNotShown(pl.tl, edit));
    // titles carry over by sentence (an AI-named chapter keeps its name after a new version or a note)
    // titles carry over by sentence: saved with the edit, or named earlier in this session
    setChapters((prev) => chapterMarks(pl.tl).map((m) => ({ ...m,
      title: edit.chapters?.find((c) => c.from === m.from)?.title ?? prev.find((c) => c.from === m.from)?.title ?? m.title })));
    setSwore(swears(pl.tl).map((w) => ({ id: w.id, w: w.w.trim(), at: w.os })));
    setScroll({ ...scrollTest(pl.tl, edit), loop: loopCheck(pl.tl), cold: strongestLine(pl.tl) }); setShownTest(null);
    void waveform(p, pl.tl).then((w) => { if (gen === mounts.current) setWave(w); });
    setTrack({ segs: pl.tl.segments.map((x) => [x.outStart, x.outEnd]), zooms: pl.scene.zooms.map((z) => [z.s, z.e]),
      layers: pl.scene.layers.map((L) => ({ s: L.start, e: L.end, text: L.b.treatment === "text-pop", label: L.b.text ?? L.b.card?.text ?? p.library.find((x) => x.key === L.b.asset)?.name ?? "Picture" })) });
    setDur(pl.tl.duration); setT(0); setPlaying(false);
    if (keep) {                                            // the same moment in the other version: on the same word
      const w = keep.word ? pl.tl.byId.get(keep.word) : undefined;
      const at = Math.max(0, Math.min(pl.tl.duration, w ? w.os + 0.01 : keep.t));
      setT(at); await pl.seek(at);
    }
    setWpm(pl.tl.duration > 3 ? (pl.tl.words.length / pl.tl.duration) * 60 : null);
  }, [p, settings.brand]);

  // Compare: the version before this one, played from the same moment (C or the Compare button)
  // the version this one was made from (a note on version 1 after viewing it makes version 4 "from" 1), else the one before
  const baseOf = (v?: { n: number; from?: number }) => {
    if (!v) return null;
    if (v.from !== undefined && p.versions.some((x) => x.n === v.from)) return v.from;
    const ns = p.versions.map((x) => x.n), i = ns.indexOf(v.n); return i > 0 ? ns[i - 1] : null;
  };
  const prevN = baseOf(version);
  const [cmp, setCmp] = useState(false);
  const shown = cmp && prevN !== null ? p.versions.find((v) => v.n === prevN) ?? version : version;
  const here = () => { const pl = player.current; if (!pl) return undefined;
    const w = pl.tl.words.find((x) => x.os <= pl.t && pl.t <= x.oe + 0.3) ?? pl.tl.words.find((x) => x.os >= pl.t);
    return { word: w?.id, t: pl.t }; };
  const keepAt = useRef<{ word?: string; t: number } | undefined>(undefined);
  const flipCompare = () => {
    if (prevN === null) return;
    if (tlDraft.current) { setToast("Save or discard your timeline changes first"); return; }
    keepAt.current = here(); setCmp((c) => !c);
  };
  useEffect(() => { setCmp(false); }, [version?.n]);
  useEffect(() => { if (shown) { const k = keepAt.current; keepAt.current = undefined;
    void mount(!cmp && tlDraft.current ? tlDraft.current : shown.edit, k ?? (tlDraft.current ? { t: player.current?.t ?? 0 } : undefined)); }   // the timeline's draft stays in view
    return () => player.current?.dispose(); }, [shown, mount]);
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
      if (el.closest("input, textarea, select, [contenteditable]") || (!!exp && exp.pct < 100) || exportingRef.current) return;
      if (keys || el.closest("dialog") || document.querySelector("dialog[open]")) return;   // a dialog is in front
      if (el.closest(".tl-panel")) return;                  // the timeline has its own keys (S, Delete, arrows, undo)
      if ((ev.key === " " || ev.key === "Enter") && el.closest("button, a, [role=button], summary")) return;   // pressing a button
      const pl = player.current; if (!pl) return;
      const mod = ev.metaKey || ev.ctrlKey;
      if (ev.key === "?" && !mod) { ev.preventDefault(); setKeys(true); return; }
      if ((ev.key === "c" || ev.key === "C") && !mod && !ev.altKey && prevN !== null) { ev.preventDefault(); flipCompare(); return; }
      if ((ev.key === "t" || ev.key === "T" || ev.key === "l" || ev.key === "L") && !mod && !ev.altKey && !cmp) {
        ev.preventDefault(); void startRun(ev.key.toLowerCase() === "t" ? "scroll" : "loop"); return;
      }
      if ((ev.key === "n" || ev.key === "N") && !mod && !ev.altKey) { ev.preventDefault(); document.getElementById("note")?.focus(); return; }
      if (ev.key === "/" && !mod && !ev.altKey) {          // find in what you said: Edit it myself → Cut → Find
        ev.preventDefault();
        const focus = () => {
          if (!document.getElementById("find-w")) document.getElementById("tab-Cut")?.click();
          requestAnimationFrame(() => document.getElementById("find-w")?.focus());
        };
        if (!document.getElementById("tab-Cut")) {
          [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Edit it myself")?.click();
          setTimeout(focus, 50);
        } else focus();
        return;
      }
      if ((ev.key === "m" || ev.key === "M") && !mod && !ev.altKey) {     // say a note: start, and M again to stop
        const mic = document.querySelector<HTMLButtonElement>(".voice-btn");
        if (mic && !mic.disabled) { ev.preventDefault(); mic.click(); }
        return;
      }
      // previous / next cut: check each join ("[" is AltGr+8 or Option+5 on many keyboards: only a plain Cmd/Ctrl rules it out)
      if ((ev.key === "[" || ev.key === "]") && !ev.metaKey && (!ev.ctrlKey || ev.altKey)) {
        ev.preventDefault();
        // land just before each cut, so playing from there shows the join; compare landings, not cuts
        const lands = pl.tl.segments.slice(1).map((x) => Math.max(0, x.outStart - 0.5));
        const to = ev.key === "]" ? lands.find((c) => c > pl.t + 0.05) : [...lands].reverse().find((c) => c < pl.t - 0.05);
        const v = to === undefined ? (ev.key === "]" ? dur : 0) : to;
        setT(v); void pl.seek(v); return;
      }
      if ((ev.key === "Home" || ev.key === "End") && !mod) { ev.preventDefault(); const v = ev.key === "Home" ? 0 : dur; setT(v); void pl.seek(v); return; }
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
    if (run.current) { endRun(pl, false); return; }
    if (playing) { pl.pause(); setPlaying(false); } else { setPlaying(true); await pl.play(); }
  }

  // Notes sent while the editor is still working wait their turn and are applied in order, each its own version.
  const queue = useRef<{ text: string; where?: string }[]>([]);
  const working = useRef(false);
  const [waiting, setWaiting] = useState(0);
  async function send(given?: string) {
    const typed = (given ?? note).trim();
    if (!typed) return;
    // a typed "cut this" / "logo here" means what's on screen: the playhead's time goes with it (chips are sent as they are)
    const text = given === undefined && player.current ? pinToPlayhead(typed, player.current.t, dur) : typed;
    if ((exp && exp.pct < 100) || exportingRef.current) { setToast("Wait for the export to finish: a new version now would stop it"); return; }
    const hasKey = aiReady(settings);
    setMsgs((m) => [...m, { who: "you", text }]);
    if (given === undefined) setNote("");
    if (!hasKey) { setMsgs((m) => [...m, { who: "ed", text: "I can't change the video from a note without an AI editor. Add your key in Settings, or use \"Edit it myself\"." }]); return; }
    // the words its times point at, found now on the version being watched: an earlier queued note may move them
    const pl0 = player.current, v0 = latest.current.versions.find((v) => v.n === latest.current.current);
    queue.current.push({ text, where: pl0 && v0 && noteTimes(text).length ? momentsText(pl0.tl, v0.edit, text) : undefined });
    if (working.current) { setWaiting(queue.current.length); setToast("Got it: I'll do that right after this note"); return; }
    working.current = true; setErr("");
    while (queue.current.length) {
      const next = queue.current.shift()!;
      setWaiting(queue.current.length);
      const ok = await applyOne(next.text, next.where);
      if (!ok && queue.current.length) {
        setMsgs((m) => [...m, { who: "ed", text: `I stopped there, so ${queue.current.length === 1 ? "your next note wasn't" : `your next ${queue.current.length} notes weren't`} applied. Send ${queue.current.length === 1 ? "it" : "them"} again when you're ready.` }]);
        queue.current = [];
      }
    }
    setWaiting(0); working.current = false; setBusy("");
  }

  async function applyOne(text: string, where?: string): Promise<boolean> {
    setBusy("Working on your note…");
    const p = latest.current;               // not the render this queue started in: renames, chips, version picks since
    try {
      const before = (p.versions.find((v) => v.n === p.current) ?? p.versions[p.versions.length - 1]).edit;
      const r = await applyUserNote(p, settings, loadRules(), text, (m) => setBusy(m), where);
      const after = p.versions.find((v) => v.n === p.current)!.edit;
      setP({ ...p });
      const always = /\b(always|from now on|every (video|time)|remember|next time|never again)\b/i.test(text);
      if (r.styleRule && always) addRule(r.styleRule);
      setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: ${r.summary}` + (r.styleRule && always ? " I'll remember that for next time." : ""),
        rule: r.styleRule && !always ? r.styleRule : undefined, changes: changeItems(p, before, after), v: p.current }]);
      return true;
    } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); return false; }
  }

  /** Back to an earlier version; the newer one stays in the versions list (nothing is deleted). */
  function undoTo(n: number) {
    const from = p.current;
    p.current = n;
    void saveProject(p).then(() => { setP({ ...p }); setToast(`Back to version ${n}. Version ${from} is still in your versions.`); });
  }

  /** Put the player on a word of the version on screen (a change's place), or say it isn't in this version. */
  function jumpTo(word: string) {
    const pl = player.current, w = pl?.tl.byId.get(word);
    if (!pl || !w) { setToast("That moment isn't in the version on screen"); return; }
    const at = Math.max(0, w.os - 0.3);
    setT(at); void pl.seek(at);
  }

  /** After an export: a change the user has now made in two videos, offered as a style rule (lib/learn.ts). */
  function offerLearned() {
    const rule = learnFromExport(p, loadRules());
    if (rule) setMsgs((m) => [...m, { who: "ed", learned: true, rule,
      text: "You made this same change before exporting two different videos." }]);
  }

  function addRule(text: string) {
    const rules = loadRules();
    if (!rules.some((r) => r.text.toLowerCase() === text.toLowerCase())) saveRules([...rules, { id: Math.random().toString(36).slice(2), text, at: new Date().toISOString() }]);
  }

  async function exportAll() {
    if (!version) return;
    endRun(player.current, false);              // a scroll or loop test still running would stop the recording
    if (tlDraft.current) { setToast("Save or discard your timeline changes first: the export would have them"); return; }
    busyExport(true);
    const keep = p.format ?? "9:16";
    const out: { f: Format; url: string; ext: string }[] = [];
    setAll(null); setPlaying(true);
    try {
      for (const [i, f] of (Object.keys(FORMATS) as Format[]).entries()) {
        p.format = f;
        await mount(version.edit);
        const pl = player.current; if (!pl) break;
        setExp({ pct: 0, label: `${FORMATS[f].name} (${i + 1} of 4)` });
        const { blob, ext } = await pl.record((pct) => { setExp((x) => ({ ...x!, pct })); expPct.current = pct; announce("Exporting", pct); });
        out.push({ f, url: URL.createObjectURL(blob), ext });
      }
    } catch (e) { setErr(String(e)); }
    p.format = keep;
    await mount(version.edit);
    setExp(null); setAll(out); setPlaying(false); busyExport(false);
    if (out.length) offerLearned();
  }

  async function exportVariants(texts: string[]) {
    if (!version) return;
    endRun(player.current, false);
    if (tlDraft.current) { setToast("Save or discard your timeline changes first: the export would have them"); return; }
    busyExport(true);
    const out: { hook: string; url: string; ext: string }[] = [];
    setAll(null); setVariants(null); setPlaying(true);
    try {
      for (const [i, text] of texts.entries()) {
        await mount(withHook(version.edit, text, buildTimeline(p.words, version.edit, p.sources.map((x) => x.duration))));
        const pl = player.current; if (!pl) break;
        setExp({ pct: 0, label: `Hook ${String.fromCharCode(66 + i)} (${i + 1} of ${texts.length})` });
        const { blob, ext } = await pl.record((pct) => { setExp((x) => ({ ...x!, pct })); expPct.current = pct; announce("Exporting", pct); });
        out.push({ hook: text, url: URL.createObjectURL(blob), ext });
      }
    } catch (e) { setErr(String(e)); }
    await mount(version.edit);
    setExp(null); setVariants(out); setAlts(null); setPlaying(false); busyExport(false);
  }

  async function exportVideo() {
    const pl = player.current;
    if (!pl) return;
    endRun(pl, false);                          // a scroll or loop test still running would stop the recording
    if (tlDraft.current) { setToast("Save or discard your timeline changes first: the export would have them"); return; }
    busyExport(true);
    setExp({ pct: 0 }); setPlaying(true);
    try {
      const { blob, ext } = await pl.record((pct) => { setExp((x) => ({ ...x!, pct })); expPct.current = pct; announce("Exporting", pct); });
      lastBlob.current = blob;
      const cover = await pl.cover();
      setExp({ pct: 100, video: URL.createObjectURL(blob), ext, cover: URL.createObjectURL(cover),
        caption: URL.createObjectURL(new Blob([post], { type: "text/plain" })),
        srt: version ? URL.createObjectURL(new Blob([srt(p, version.edit, pl.tl)], { type: "application/x-subrip" })) : undefined });
      offerLearned();
      // how loud the file came out (the apps play everything near -14 LUFS): measured on the export itself
      void measureLoudness(blob).then((m) => { if (m) setExp((x) => (x && x.video ? { ...x, ...m } : x)); });
    } catch (e) { setErr(String(e)); setExp(null); }
    setPlaying(false); busyExport(false);
  }

  /** A composed bed becomes the video's music the way a picked song does: a new version with music.asset set. */
  async function useMusic(a: Asset) {
    if (!version) return;
    await saveManual(p, { ...version.edit, music: { ...version.edit.music, asset: a.key, startAt: null } }, `original music: ${a.name}`);
    setP({ ...p }); setMaker(false);
    setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: I put ${a.name} under your voice. It's original and royalty-free, written for this video, and its last chord lands as the video ends.` }]);
  }

  /** The exported video as a file the system share sheet takes (phones: straight to Instagram, TikTok, Messages). */
  const shareFile = (name: string): File | null => {
    const b = lastBlob.current;
    if (!b || typeof navigator === "undefined" || !navigator.canShare) return null;
    const f = new File([b], name, { type: b.type || (name.endsWith(".mp4") ? "video/mp4" : "video/webm") });
    try { return navigator.canShare({ files: [f] }) ? f : null; } catch { return null; }
  };
  const share = async (name: string) => {
    const f = shareFile(name);
    if (!f) return;
    try { await navigator.clipboard.writeText(post); setToast("Caption copied: paste it into your post"); } catch { /* sharing still works */ }
    try { await navigator.share({ files: [f], title: p.title }); }
    catch (e) { if ((e as Error).name !== "AbortError") setToast("Couldn't open sharing: download the video instead"); }
  };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setToast("Caption copied"); } catch { setToast("Couldn't copy: select the text instead"); } };
  const post = version ? postText(p, version.edit) : "";
  /** The one-click fix for a scroll test finding, when there is one. */
  const scrollFix = (l: ScrollLine): { label: string; edit: Edit; what: string; said: string } | null => {
    const ed = version?.edit, pl = player.current;
    if (!ed || !pl) return null;
    if (l.id === "open") {
      const w = cutWarmUp(p.words, ed);
      return w && { label: `Cut “${w.cut}”`, edit: w.edit, what: `cut the warm-up “${w.cut}”`, said: `it now opens on the point, without “${w.cut}”.` };
    }
    if (l.id === "moves") {
      const z = zoomsFor(pl.tl, ed, { from: 0.4, to: SCROLL_SECONDS, cause: "still", risk: 1, text: "", fix: "" });
      return z && { label: "Add a zoom there", edit: z, what: "a zoom in the first seconds (scroll test)", said: "a zoom now moves the picture in the first seconds." };
    }
    if (l.id === "read" && !ed.captions.enabled) {
      const on = { ...ed, captions: { ...ed.captions, enabled: true } };
      return { label: "Turn subtitles on", edit: on, what: "subtitles on", said: "subtitles are on, so it reads with the sound off." };
    }
    return null;
  };
  const e = version?.edit;
  const motionCards = e?.broll.filter((b) => b.treatment === "motion").length ?? 0;
  const pics = e?.broll.filter((b) => b.treatment !== "text-pop" && b.treatment !== "motion").length ?? 0, cards = e ? e.broll.length - pics - motionCards : 0;
  const song = e?.music.asset ? p.library.find((a) => a.key === e.music.asset) : undefined;
  const fmt: Format = p.format ?? "9:16";
  const shape = FORMATS[fmt];
  const base = p.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 80) + ` - Version ${p.current}` + (fmt === "9:16" ? "" : ` (${shape.name.toLowerCase()} ${fmt.replace(":", "x")})`);
  const reshape = async (f: Format) => { if (f === fmt || recording) return; p.format = f; await saveProject(p); setExp(null); setP({ ...p }); };
  const recording = exporting || (!!exp && exp.pct < 100);
  const did: [boolean, string][] = e ? [
    [true, `Kept your best takes · ${clock(dur)} long`],
    [e.captions.enabled, e.captions.enabled ? "Added subtitles" : "Subtitles off"],
    [!!song, song ? `Added music: ${song.name}` : "No music (add a song or make one below)"],
    [pics + cards > 0, pics + cards ? `${pics} picture${pics === 1 ? "" : "s"} and ${cards} text card${cards === 1 ? "" : "s"}` : "No pictures yet"],
    [e.zooms.length > 0, e.zooms.length ? `${e.zooms.length} zoom${e.zooms.length === 1 ? "" : "s"}` : "No zooms"],
    ...(motionCards ? [[true, `${motionCards} animated card${motionCards === 1 ? "" : "s"}`] as [boolean, string]] : []),
    [!!e.post.caption, e.post.caption ? "Wrote your post caption" : "No post caption yet"],
  ] : [];

  return (
    <div className="page">
      <div className="ed-head">
        <button className="btn ghost sm" onClick={onBack}><Icon name="arrowLeft" />My videos</button>
        {renaming ? (
          <input className="input grow title-input" aria-label="Video name" autoFocus defaultValue={p.title} maxLength={80}
            onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); if (ev.key === "Escape") setRenaming(false); }}
            onBlur={async (ev) => { const v = ev.target.value.trim(); setRenaming(false); if (v && v !== p.title) { p.title = v; await saveProject(p); setP({ ...p }); } }} />
        ) : <h1 className="grow trunc"><button className="title-btn" title="Rename" onClick={() => setRenaming(true)}>{p.title}</button></h1>}
        <button className="btn ghost" disabled={recapBusy || !player.current} onClick={async () => {
          const pl = player.current; if (!pl) return;
          setRecapBusy(true); setErr("");
          try {
            const said = captionWords(pl.tl.words, version?.edit.corrections ?? []).map((w) => w.text).join(" ");   // numbers as digits
            const plan = await recapOf(settings, said, p.title);
            const anim = newAnim(said, plan.scenes, { title: `${p.title}: recap`.slice(0, 60), palette: plan.palette ?? "midnight", font: plan.font ?? "grotesk", format: p.format ?? "9:16" });
            await saveAnim(anim);
            onOpenAnim?.(anim.id);
          } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
          setRecapBusy(false);
        }}>{recapBusy ? <><span className="spin" />Animating…</> : <><Icon name="wand" />Animated recap</>}</button>
        <button className="btn" aria-pressed={timeline} disabled={!version || recording || cmp} onClick={() => setTimeline(!timeline)}><Icon name="film" />Timeline</button>
        <button className="btn" aria-pressed={drawer} onClick={() => setDrawer(!drawer)}><Icon name="scissors" />{drawer ? "Close the editor" : "Edit it myself"}</button>
        <button className="btn primary" onClick={exportVideo} disabled={recording || cmp} title={cmp ? "Go back to the current version to export it" : undefined}><Icon name="download" />Export</button>
      </div>

      {p.sample && <div className="alert info sample-note"><Icon name="spark" /><span>This is the sample: a drawn presenter and a computer voice, not a
        real person. Play it, open &ldquo;Edit it myself&rdquo;, change its shape and export it. Notes need an AI key in Settings.</span></div>}
      {timeline && version && !recording && (
        <Timeline project={p} edit={version.edit} t={t}
          onSeek={(v) => { setT(v); void player.current?.seek(v); }}
          onPreview={(draft) => { tlDraft.current = draft; if (!exportingRef.current) void mount(draft ?? version.edit, { t: player.current?.t ?? t }); }}
          onSave={async (edit, what) => { await saveManual(p, edit, what); setP({ ...p }); setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: ${what}` }]); }}
          onClose={() => { tlDraft.current = null; setTimeline(false); }} />
      )}
      <div className={`ed-grid ${shape.w > shape.h ? "wide" : ""}`}>
        <div className="preview">
          <div className={`phone ${shape.w >= shape.h ? "flat" : ""} ${cmp ? "comparing" : ""}`}>{cmp && <span className="cmp-badge" role="status">Version {prevN}, before this change</span>}<div className="cv-wrap"><canvas ref={canvas} style={{ aspectRatio: `${shape.w} / ${shape.h}` }}
            aria-label={`Preview of ${p.title}, version ${shown?.n ?? p.current}, ${shape.name.toLowerCase()} ${fmt}`} role="img" />
            {appUi && fmt === "9:16" && <div className="ui-zones" aria-hidden="true">{ZONES[appUi].map((z) => (
              <i key={z.what} style={{ left: `${z.x0 * 100}%`, top: `${z.y0 * 100}%`, width: `${(z.x1 - z.x0) * 100}%`, height: `${(z.y1 - z.y0) * 100}%` }}><span>{z.what}</span></i>))}</div>}
            </div></div>
          <div className="transport">
            <button className="play" onClick={toggle} disabled={recording} aria-label={playing ? "Pause" : "Play"}><Icon name={playing ? "pause" : "play"} /></button>
            <input type="range" className="scrub" min={0} max={dur || 1} step={0.01} value={t} aria-label="Position"
              onChange={(ev) => { const v = +ev.target.value; setT(v); void player.current?.seek(v); }} />
            <span className="time">{clock(t)} / {clock(dur)}</span>
            {prevN !== null && <button className="btn ghost sm cmp-btn" aria-pressed={cmp} onClick={flipCompare} disabled={recording}
              title={cmp ? `Back to version ${version?.n} (C)` : `Play version ${prevN} from this moment (C)`}
              aria-label={`Compare with version ${prevN}, the one before`}>Compare</button>}
            <button className="btn ghost icon sm keys-btn" onClick={() => setKeys(true)} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)"
              aria-haspopup="dialog"><kbd aria-hidden="true">?</kbd></button>
          </div>
          {fmt === "9:16" && (
            <div className="ui-pick small">
              <span className="muted" id="ui-pick-l">Show the app&apos;s buttons</span>
              <div className="seg sm" role="group" aria-labelledby="ui-pick-l">
                {([null, "reels", "tiktok", "shorts"] as (Platform | null)[]).map((pl) => (
                  <button key={pl ?? "off"} type="button" aria-pressed={appUi === pl} onClick={() => setAppUi(pl)}>{pl ? PLATFORM_NAMES[pl] : "Off"}</button>))}
              </div>
              {version && appUi && subtitlesCovered(version.edit).includes(appUi) && (
                <p className="say-bad">{PLATFORM_NAMES[appUi]} covers part of your subtitles.{" "}
                  {clearPosition(version.edit) !== null
                    ? <button type="button" className="btn sm" disabled={recording} onClick={async () => {
                        const pos = clearPosition(version.edit)!; const before = version.edit;
                        const fixed = { ...before, captions: { ...before.captions, position: pos } };
                        await saveManual(p, fixed, "subtitles raised clear of the app buttons"); setP({ ...p });
                        setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: I raised the subtitles so Reels, TikTok and Shorts don't cover them.`,
                          changes: changeItems(p, before, fixed) }]);
                      }}><Icon name="wand" />Raise them</button>
                    : <>Make them smaller (Edit it myself → Subtitles → Size).</>}</p>)}
            </div>)}
          {scroll && dur > 0 && (
            <div className="scroll-test">
              <div className="row wrap">
                <button type="button" className="btn ghost sm" disabled={recording || cmp} onClick={() => void startRun("scroll")}>
                  <Icon name={running === "scroll" ? "pause" : "play"} />{running === "scroll" ? "Stop the scroll test" : `Scroll test: first ${SCROLL_SECONDS} s, sound off`}</button>
                <button type="button" className="btn ghost sm" disabled={recording || cmp} onClick={() => void startRun("loop")}>
                  <Icon name={running === "loop" ? "pause" : "play"} />{running === "loop" ? "Stop the loop test" : "Loop test: the end into the start"}</button>
              </div>
              {shownTest === "scroll" && (
                <div className="scroll-res" role="status">
                  <p><b>{scroll.passed === 4 ? "They'd stop scrolling." : scroll.passed >= 2 ? "Some would stop." : "Most would scroll past."}</b>{" "}
                    <span className="muted">{scroll.passed} of 4 for the first {SCROLL_SECONDS} seconds with the sound off, the way most people see it.</span></p>
                  <ul className="checks" aria-label="Scroll test results">
                    {scroll.lines.filter((l) => !l.ok).concat(scroll.lines.filter((l) => l.ok)).map((l) => (
                      <li key={l.id} className={l.ok ? "ok" : "bad"}><Icon name={l.ok ? "check" : "alert"} />
                        <span className="grow">{l.text}{!l.ok && l.fix && <span className="small block fix">{l.fix}</span>}
                          {!l.ok && (() => { const f = scrollFix(l); return f && (
                            <button type="button" className="btn sm" disabled={recording} onClick={async () => {
                              const before = version!.edit;
                              await saveManual(p, f.edit, f.what); setP({ ...p });
                              setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: ${f.said}`, changes: changeItems(p, before, f.edit) }]);
                            }}><Icon name="wand" />{f.label}</button>); })()}</span></li>))}
                  </ul>
                  {scroll.cold && version && (
                    <div className="cold-open">
                      <p className="small"><b>Your strongest line</b> is “{scroll.cold.text}” at {clock(scroll.cold.at)}: {scroll.cold.why.join(", ")}.
                        {" "}Opening on it is the classic fix for a slow start; the rest plays in order after it.</p>
                      <button type="button" className="btn sm" disabled={recording} onClick={async () => {
                        const line = scroll.cold!, before = version.edit, fixed = openWith(p.words, before, line);
                        await saveManual(p, fixed, `open with “${line.text}”`); setP({ ...p });
                        setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: it now opens with “${line.text}”, then plays the rest in order.`,
                          changes: changeItems(p, before, fixed) }]);
                      }}><Icon name="wand" />Open with it</button>
                    </div>)}
                </div>)}
              {shownTest === "loop" && (
                <div className="scroll-res" role="status">
                  <p><b>{scroll.loop.ok ? "A clean loop." : "The loop has a seam."}</b>{" "}
                    <span className="muted">Reels replay on their own: every second watch counts.</span></p>
                  <ul className="checks" aria-label="Loop test result">
                    <li className={scroll.loop.ok ? "ok" : "bad"}><Icon name={scroll.loop.ok ? "check" : "alert"} />
                      <span className="grow">{scroll.loop.text}{!scroll.loop.ok && scroll.loop.fix && <span className="small block fix">{scroll.loop.fix}</span>}</span></li>
                  </ul>
                </div>)}
            </div>)}
          {track && dur > 0 && (
            <div className="track" aria-hidden="true" onPointerDown={(ev) => {
              const r = ev.currentTarget.getBoundingClientRect(); const v = Math.max(0, Math.min(dur, ((ev.clientX - r.left) / r.width) * dur));
              setT(v); void player.current?.seek(v); }}>
              <div className="lane">{track.segs.map(([a, b], i) => <i key={i} className={`seg ${i % 2 ? "alt" : ""}`} style={{ left: `${(100 * a) / dur}%`, width: `${(100 * (b - a)) / dur}%` }} />)}</div>
              <div className="lane">{track.layers.map((L, i) => <i key={i} className={`lay ${L.text ? "txt" : ""}`} title={L.label}
                style={{ left: `${(100 * L.s) / dur}%`, width: `${Math.max(0.8, (100 * (L.e - L.s)) / dur)}%` }}><span>{L.label}</span></i>)}</div>
              {wave && <svg className="wave" viewBox={`0 0 ${wave.length} 20`} preserveAspectRatio="none" aria-hidden="true">
                <path d={wave.map((v, i) => `M${i + 0.5} ${10 - v * 9}V${10 + v * 9}`).join("")} /></svg>}
              {attn && <div className="lane attn">{attn.risk.map((r, i) => r > 0.15 &&
                <i key={i} style={{ left: `${(100 * i * attn.step) / dur}%`, width: `${(100 * attn.step) / dur}%`, opacity: Math.min(1, 0.25 + r) }}
                  className={r >= 0.55 ? "hi" : "lo"} />)}</div>}
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
          {variants && (
            <section className="panel" aria-live="polite">
              <div className="panel-head"><h2>Hook versions are ready</h2><button className="btn ghost icon sm" aria-label="Close" onClick={() => setVariants(null)}>&times;</button></div>
              <p className="small muted">Post your main version as usual and these as trial reels: the one that holds people longest is your hook.</p>
              <div className="row">{variants.map((x, i) => <a key={x.url} className="btn" href={x.url}
                download={`${p.title.replace(/[\\/:*?"<>|]+/g, "").slice(0, 50)} - hook ${String.fromCharCode(66 + i)}.${x.ext}`}>
                <Icon name="download" />Hook {String.fromCharCode(66 + i)}: {x.hook}</a>)}</div>
            </section>
          )}
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
                    {shareFile(`${base}.${exp.ext ?? "mp4"}`) && <button className="btn" onClick={() => void share(`${base}.${exp.ext ?? "mp4"}`)}>
                      <Icon name="share" />Share…</button>}
                    <a className="btn" href={exp.cover} download={`${base} cover.jpg`}>Download cover</a>
                    <a className="btn" href={exp.caption} download={`${base} caption.txt`}>Caption .txt</a>
                    {exp.srt && <a className="btn" href={exp.srt} download={`${base}${version?.edit.translation ? ` ${version.edit.translation.lang}` : ""}.srt`}>Subtitles .srt</a>}
                    <button className="btn ghost" onClick={() => copy(post)}><Icon name="copy" />Copy caption</button>
                  </div>
                  {version && (() => {
                    // everything the editor checks, in one place, at the moment of posting
                    const bleeped = new Set(version.edit.bleeps ?? []);
                    const covered = fmt === "9:16" ? subtitlesCovered(version.edit) : [];
                    const items: [boolean, string][] = [
                      ...(check ? [[check.score >= 80, `Reel check ${check.score}/100`] as [boolean, string]] : []),
                      ...(scroll ? [[scroll.passed === 4, `Scroll test ${scroll.passed} of 4`] as [boolean, string],
                        [scroll.loop.ok, scroll.loop.ok ? "Loops cleanly" : "The loop has a seam"] as [boolean, string]] : []),
                      ...(fmt === "9:16" ? [[!covered.length, covered.length ? `Subtitles under ${covered.map((x) => PLATFORM_NAMES[x]).join(", ")}'s caption` : "Subtitles clear of the app buttons"] as [boolean, string]] : []),
                      ...(exp.lufs !== undefined ? [[exp.lufs >= -16 && exp.lufs <= -12 && (exp.peak ?? -9) <= -0.5,
                        exp.lufs < -16 ? `Quiet: ${exp.lufs.toFixed(1)} LUFS (the apps turn it up, noise and all)`
                          : exp.lufs > -12 ? `Loud: ${exp.lufs.toFixed(1)} LUFS (the apps turn it down)`
                          : (exp.peak ?? -9) > -0.5 ? `Peaks at ${exp.peak!.toFixed(1)} dB: it may crackle` : `Loudness ${exp.lufs.toFixed(1)} LUFS`] as [boolean, string]] : []),
                      ...(names.length ? [[false, `${names.length} name${names.length > 1 ? "s" : ""} said, not shown`] as [boolean, string]] : []),
                      ...(swore.length ? [[swore.every((x) => bleeped.has(x.id)), swore.every((x) => bleeped.has(x.id)) ? "Strong language bleeped" : `${swore.length} strong word${swore.length > 1 ? "s" : ""}, not bleeped`] as [boolean, string]] : []),
                    ];
                    const habit = crutches(p, version.edit.keep).reduce((n, c) => n + c.hits.length, 0);
                    if (habit >= 2) items.push([false, `${habit} words said out of habit (Edit it myself → Cut)`]);
                    const again = repeats(p, version.edit).length;
                    if (again) items.push([false, `${again === 1 ? "A line plays" : `${again} lines play`} twice (Edit it myself → Cut)`]);
                    const todo = items.filter(([ok]) => !ok).length;
                    // the fixes that don't change what is said or shown (lib/autofix.ts); bleeps, logos, the cold open stay yours
                    const fix = todo ? fixWhatICan(p, version.edit, fmt === "9:16") : null;
                    return (
                      <div className="before-post">
                        <p className="small"><b>Before you post</b> <span className="muted">{todo ? `${todo} thing${todo > 1 ? "s" : ""} to look at (beside the video)` : "everything checks out"}</span></p>
                        <ul>{items.map(([ok, text]) => <li key={text} className={ok ? "ok" : "bad"}><Icon name={ok ? "check" : "alert"} />{text}</li>)}</ul>
                        {exp.lufs !== undefined && (exp.lufs < -16 || exp.lufs > -12) && <button type="button" className="btn sm mt-8" disabled={recording || cmp} onClick={async () => {
                          // the measured export says how far off it is: the gain moves the next one to about -14 LUFS
                          const before = version.edit, step = Math.round((-14 - exp.lufs!) * 10) / 10;
                          const fixed = { ...before, loudness: Math.max(-12, Math.min(12, Math.round(((before.loudness ?? 0) + step) * 10) / 10)) };
                          await saveManual(p, fixed, "loudness matched"); setP({ ...p }); setExp(null);
                          setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: ${step > 0 ? "louder" : "quieter"} by ${Math.abs(step).toFixed(1)} dB, for about -14 LUFS. Export again to check it.`,
                            changes: changeItems(p, before, fixed) }]);
                        }}><Icon name="wand" />Match loudness</button>}{" "}
                        {fix && <button type="button" className="btn sm mt-8" disabled={recording || cmp} onClick={async () => {
                          const before = version.edit;
                          await saveManual(p, fix.edit, "fix what I can"); setP({ ...p }); setExp(null);
                          setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: ${fix.done.join("; ")}. Export again when you're happy with it.`,
                            changes: changeItems(p, before, fix.edit) }]);
                        }}><Icon name="wand" />Fix what I can</button>}
                      </div>);
                  })()}
                  <div className="row"><button className="btn ghost sm" onClick={() => { setExp(null); void exportAll(); }}>Also make every shape (4 files, about {Math.ceil(4 * dur / 60)} min)</button>
                    <button className="btn ghost sm" aria-expanded={alts !== null} disabled={cmp} onClick={() => setAlts(alts ? null : [hooks?.[0] ?? "", hooks?.[1] ?? ""])}>Test other hooks (trial reels)</button></div>
                  {alts && (
                    <form className="stack tight" onSubmit={(ev) => { ev.preventDefault(); const t = alts.map((x) => x.trim()).filter(Boolean); if (t.length) { setExp(null); void exportVariants(t); } }}>
                      <p className="small muted">The same reel with another hook title, one file each{hookOf(version?.edit ?? ({ broll: [] } as unknown as Edit)) ? <> (yours now: &ldquo;{hookOf(version!.edit)}&rdquo;)</> : null}.</p>
                      {alts.map((x, i) => (
                        <label key={i}><span className="small muted block">Hook {String.fromCharCode(66 + i)}</span>
                          <input className="input" value={x} maxLength={60} placeholder={i ? "Another angle" : "e.g. I film a week of videos in one hour"}
                            onChange={(ev) => setAlts(alts.map((y, k) => (k === i ? ev.target.value : y)))} /></label>))}
                      <div className="row"><button className="btn sm primary" type="submit" disabled={!alts.some((x) => x.trim())}>
                        Export {alts.filter((x) => x.trim()).length || ""} hook version{alts.filter((x) => x.trim()).length === 1 ? "" : "s"} (about {Math.max(1, Math.ceil(alts.filter((x) => x.trim()).length * dur / 60))} min)</button></div>
                    </form>)}
                  {version && version.edit.broll.some((b) => p.library.find((x) => x.key === b.asset)?.ai) &&
                    <p className="alert info small"><Icon name="alert" /><span>This video has AI-made pictures. Switch on the platform&apos;s AI label when you post it.</span></p>}
                  {exp.ext === "webm" && <p className="small muted">Your browser recorded WebM. For Instagram, export from Chrome, Edge or Safari
                    to get MP4, or convert the file.</p>}
                </div>)}
            </section>
          )}

          {maker && version && <MusicMaker project={p} length={dur} wordsPerMinute={wpm} onUse={useMusic} onClose={() => setMaker(false)} />}

          <section className="panel" aria-labelledby="did-h">
            <div className="panel-head"><h2 id="did-h">What I did</h2><span className="badge good"><span className="dot" />Version {p.current}</span></div>
            <ul className="did">
              {did.map(([on, text]) => <li key={text} className={on ? "" : "off"}><Icon name={on ? "check" : "dot"} />{text}</li>)}
            </ul>
          </section>

          {check && (
            <section className="panel" aria-labelledby="check-h">
              <div className="panel-head"><h2 id="check-h">Reel check</h2></div>
              <div className="check-wrap">
                <div className={`ring ${check.score >= 80 ? "good" : check.score >= 60 ? "mid" : "low"}`} role="img" aria-label={`Score ${check.score} out of 100`}>
                  <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="52" className="bg" />
                    <circle cx="60" cy="60" r="52" className="fg" strokeDasharray={`${(check.score / 100) * 326.7} 326.7`} /></svg>
                  <b className="num">{check.score}</b>
                </div>
                <ul className="checks" aria-label="Reel check results">
                  {check.checks.filter((c) => !c.ok).concat(check.checks.filter((c) => c.ok)).map((c) => (
                    <li key={c.id} className={c.ok ? "ok" : c.warn ? "warn" : "bad"}>
                      <Icon name={c.ok ? "check" : "alert"} />
                      <span className="grow"><b>{c.title}</b><span className="small muted block">{c.detail}</span>
                        {!c.ok && c.fix && <span className="small block fix">{c.fix}</span>}</span>
                    </li>))}
                </ul>
              </div>
              {attn && attn.spots.length > 0 && (
                <div className="drift">
                  <h3 className="small">Where viewers may drift</h3>
                  <ul>{attn.spots.map((sp) => (
                    <li key={sp.from}><button type="button" className="linkish" onClick={() => { const v = Math.max(0, sp.from - 0.5); setT(v); void player.current?.seek(v); }}>
                      <span className="num">{clock(sp.from)}–{clock(sp.to)}</span> · {sp.text}</button>
                      <span className="small muted block">{sp.fix}</span>
                      {sp.cause === "still" && version && player.current && (
                        <button type="button" className="btn sm mt-8" disabled={!!busy || recording || cmp} onClick={async () => {
                          const fixed = zoomsFor(player.current!.tl, version.edit, sp);
                          if (!fixed) { setToast("No words there to zoom on"); return; }
                          const before = version.edit;
                          await saveManual(p, fixed, `zooms at ${clock(sp.from)}–${clock(sp.to)} (attention map)`); setP({ ...p });
                          setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: I added zooms at ${clock(sp.from)}–${clock(sp.to)} so the picture keeps changing.`,
                            changes: changeItems(p, before, fixed) }]);
                        }}><Icon name="wand" />Add zooms there</button>)}</li>))}</ul>
                  {aiReady(settings) &&
                    <button type="button" className="btn sm" disabled={recording || cmp} onClick={() => void send(spotsNote(attn.spots))}><Icon name="wand" />Ask your editor to fix these</button>}
                  <p className="small faint">The red marks under the timeline. A guide from what is on screen and said, not a forecast.</p>
                </div>)}
            </section>
          )}

          {version && fmt === "16:9" && chapterText(chapters, dur) && (() => {
            const text = chapterText(chapters, dur);
            const inPost = version.edit.post.caption.includes(text);
            return (
              <section className="panel" aria-labelledby="ch-h">
                <div className="panel-head"><h2 id="ch-h">YouTube chapters</h2>
                  {aiReady(settings) &&
                    <button className="btn sm" disabled={chBusy || recording} onClick={async () => {
                      setChBusy(true); setErr("");
                      try {
                        const pl = player.current;
                        if (pl) { const named = await chapterTitles(settings, pl.tl, chapters); if (player.current === pl) setChapters(named); }
                      }
                      catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
                      setChBusy(false); }}>{chBusy ? <><span className="spin" />Naming…</> : <><Icon name="spark" />Name them</>}</button>}</div>
                <p className="small muted">In the description, these become chapters people can jump to.</p>
                <pre className="chapters">{text}</pre>
                <div className="row">
                  <button type="button" className="btn sm" onClick={() => copy(text)}><Icon name="copy" />Copy</button>
                  <button type="button" className="btn sm" disabled={inPost || recording || cmp} onClick={async () => {
                    const before = version.edit;
                    const caption = before.post.caption.replace(/\n*Chapters\n(?:\d+:\d\d(?::\d\d)? .*\n?)+/g, "").trimEnd();
                    const fixed = { ...before, chapters: chapters.map((c) => ({ from: c.from, title: c.title })),
                      post: { ...before.post, caption: `${caption}${caption ? "\n\n" : ""}Chapters\n${text}` } };
                    await saveManual(p, fixed, "YouTube chapters in the post"); setP({ ...p });
                    setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: the post caption lists ${chapters.length} chapters.` }]);
                  }}>{inPost ? "In the post" : "Add to the post"}</button>
                  <button type="button" className="btn sm" aria-pressed={!!version.edit.chapterPills} disabled={recording || cmp} onClick={async () => {
                    const before = version.edit, on = !before.chapterPills;
                    const fixed = { ...before, chapterPills: on || undefined, chapters: chapters.map((c) => ({ from: c.from, title: c.title })) };
                    await saveManual(p, fixed, on ? "chapter titles on screen" : "no chapter titles on screen"); setP({ ...p });
                    setMsgs((m) => [...m, { who: "ed", v: p.current, text: on ? `Version ${p.current}: each chapter's title shows at the top as it starts.`
                      : `Version ${p.current}: no chapter titles on screen.` }]);
                  }}>{version.edit.chapterPills ? "On screen" : "Show on screen"}</button>
                </div>
              </section>);
          })()}
          {version && names.length > 0 && (
            <section className="panel" aria-labelledby="names-h">
              <div className="panel-head"><h2 id="names-h">Names you say</h2></div>
              <p className="small muted">You name {names.length === 1 ? "this" : "these"} but never show {names.length === 1 ? "it" : "them"}. A logo on the name helps people remember it.</p>
              <ul className="name-list">{names.map((n) => (
                <li key={n.from}>
                  <button type="button" className="chip" onClick={() => { const v = Math.max(0, n.at - 0.6); setT(v); void player.current?.seek(v); }}
                    title={`Play from where you say ${n.text}`}>{clock(n.at)} {n.text}</button>
                  <button type="button" className="btn sm" disabled={!!logoBusy || recording || cmp} onClick={async () => {
                    setLogoBusy(n.from);
                    try {
                      const have = p.library.find((a) => a.key === webKey(p.id, n.text) || a.key === `web:${n.text}`);
                      const hit = have ? null : await findPicture(n.text, "logo", webKey(p.id, n.text)).catch(() => null);
                      const asset = have ?? hit?.asset;
                      if (!asset) { setToast(`No open-licence logo found for ${n.text}: add your own picture with “Add a song, picture or clip”`); return; }
                      if (!p.library.some((a) => a.key === asset.key)) p.library.push(asset);
                      const before = version.edit;
                      const fixed = { ...before, broll: [...before.broll, { id: `name-${Date.now().toString(36)}`, anchor: { from: n.from, to: n.to }, treatment: "card-above-head" as const, asset: asset.key }] };
                      await saveManual(p, fixed, `the ${n.text} logo`); setP({ ...p });
                      setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: the ${n.text} logo shows when you say it (${asset.credit?.creator ?? "credited"}, ${asset.credit?.license ?? "open licence"}).`,
                        changes: changeItems(p, before, fixed) }]);
                    } finally { setLogoBusy(null); }
                  }}>{logoBusy === n.from ? <><span className="spin" />Finding it…</> : "Show its logo"}</button>
                </li>))}</ul>
            </section>)}
          {version && swore.length > 0 && (() => {
            const on = new Set(version.edit.bleeps ?? []);
            const all = swore.every((x) => on.has(x.id));
            const list = [...new Set(swore.map((x) => maskWord(x.w).replace(/[^\p{L}*]/gu, "").toLowerCase()))].slice(0, 4).join(", ");
            return (
              <section className="panel" aria-labelledby="bleep-h">
                <div className="panel-head"><h2 id="bleep-h">Strong language</h2>
                  <button className="btn sm" disabled={recording || cmp} onClick={async () => {
                    const before = version.edit;
                    const fixed = { ...before, bleeps: all ? [] : [...new Set([...(before.bleeps ?? []), ...swore.map((x) => x.id)])] };
                    await saveManual(p, fixed, all ? "bleeps removed" : `bleeped ${swore.length} word${swore.length > 1 ? "s" : ""}`); setP({ ...p });
                    setMsgs((m) => [...m, { who: "ed", v: p.current, text: all ? `Version ${p.current}: no bleeps; every word plays as said.`
                      : `Version ${p.current}: ${swore.length} word${swore.length > 1 ? "s are" : " is"} bleeped: a tone over the voice, and the subtitles show ${list}.`,
                      changes: changeItems(p, before, fixed) }]);
                  }}>{all ? "Unbleep" : "Bleep them"}</button></div>
                <p className="small muted">{swore.length} strong word{swore.length > 1 ? "s" : ""} ({list}){" "}
                  {all ? "bleeped." : "said. Platforms limit ads on strong language, and many brands won’t sponsor it."}
                  {version.edit.translation ? " Translated subtitles show their own words: check them in Edit it myself → Subtitles." : ""}</p>
                <div className="chips mt-8">{swore.slice(0, 8).map((x) => (
                  <button key={x.id + x.at} type="button" className="chip" onClick={() => { const v = Math.max(0, x.at - 0.6); setT(v); void player.current?.seek(v); }}>
                    {clock(x.at)} {on.has(x.id) ? maskWord(x.w) : x.w}</button>))}</div>
              </section>);
          })()}
          {version && p.words.length > 0 && (
            <section className="panel" aria-labelledby="hook-h" id="hook-panel">
              <div className="panel-head"><h2 id="hook-h">Hook title</h2>
                <button className="btn sm" disabled={hookBusy || !aiReady(settings)} onClick={async () => {
                  setHookBusy(true); setErr("");
                  try { const pl = player.current; if (pl) setHooks(await hookIdeas(settings, pl.tl, hookOf(version.edit))); }
                  catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
                  setHookBusy(false); }}>{hookBusy ? <><span className="spin" />Thinking…</> : <><Icon name="spark" />Try 5 hooks</>}</button></div>
              {hookOf(version.edit) ? <p className="hook-now">&ldquo;{hookOf(version.edit)}&rdquo;</p> : (
                <form className="row mt-8" style={{ alignItems: "flex-end" }} onSubmit={async (ev) => {
                  ev.preventDefault();
                  const text = hookDraft.trim(); if (!text || recording) return;
                  const before = version.edit, fixed = withHook(before, text, player.current?.tl);
                  if (fixed.broll.length === before.broll.length) return;
                  await saveManual(p, fixed, "a hook title"); setP({ ...p }); setHookDraft("");
                  setMsgs((m) => [...m, { who: "ed", v: p.current, text: `Version ${p.current}: “${text}” is on screen from the first word.`, changes: changeItems(p, before, fixed) }]);
                }}>
                  <label className="grow"><span className="small muted block">No hook title yet: it&apos;s the first thing people read.</span>
                    <input className="input" id="hook-input" value={hookDraft} maxLength={60} placeholder="e.g. The habit that doubled my posting"
                      onChange={(ev) => setHookDraft(ev.target.value)} /></label>
                  <button className="btn sm" type="submit" disabled={!hookDraft.trim() || recording || cmp}>Add</button>
                </form>)}
              {hooks && <div className="chips mt-8" role="group" aria-label="Hook ideas">{hooks.map((h) => (
                <button key={h} className="chip" disabled={recording || cmp} onClick={async () => { await saveManual(p, withHook(version.edit, h, player.current?.tl), "a new hook title"); setP({ ...p });
                  setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: the hook now says "${h}".` }]); setHooks(null); }}>{h}</button>))}</div>}
            </section>
          )}

          {!p.parent && (p.words.length > 120 || clips) && (
            <section className="panel" aria-labelledby="clips-h">
              <div className="panel-head"><h2 id="clips-h">Short clips from this video</h2>
                {!clips && <button className="btn sm" disabled={!!clipBusy || !aiReady(settings)}
                  onClick={async () => { setClipBusy("Reading the whole video…"); setErr("");
                    try { setClips(await findClips(settings, p)); } catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
                    setClipBusy(""); }}>{clipBusy ? <><span className="spin" />{clipBusy}</> : <><Icon name="scissors" />Find the best clips</>}</button>}</div>
              {!clips && <p className="small muted">Your AI editor reads the whole video and picks the moments that stand on their own as 20 to 75 second reels.
                Each one becomes its own edited video.{!aiReady(settings) && " Needs an AI key in Settings."}</p>}
              {clips && !clips.length && <p className="small muted">No moment stood on its own. Longer videos with clear points work best.</p>}
              {clips && clips.length > 0 && <div className="stack tight">{clips.map((c) => (
                <div key={c.from} className="clip-row">
                  <span className="score num" aria-label={`Score ${c.score} of 10`}>{c.score}</span>
                  <span className="grow"><b>{c.title}</b><span className="small faint block">{clock(c.seconds)} · hook: &ldquo;{c.hook}&rdquo;</span>
                    {c.why && <span className="small muted block">{c.why}</span>}</span>
                  <button className="btn sm primary" disabled={!!clipBusy} onClick={async () => {
                    setClipBusy(`Editing "${c.title}"…`); setErr("");
                    try { const r = await makeClip(settings, p, c, loadRules(), (m) => setClipBusy(m)); onOpenProject?.(r.project, r.summary); }
                    catch (e) { setErr((e as { userMessage?: string }).userMessage ?? String(e)); }
                    setClipBusy(""); }}>Make this clip</button>
                </div>))}
                {clipBusy && <p className="small muted" aria-live="polite"><span className="spin" /> {clipBusy}</p>}</div>}
            </section>
          )}

          <section className="panel" aria-labelledby="notes-h">
            <div className="panel-head"><h2 id="notes-h">Notes for your editor</h2></div>
            <div className="chat" ref={chat} aria-live="polite">
              {msgs.map((m, i) => (
                <div key={i} className={`msg ${m.who}`}>
                  <span className="who-said">{m.who === "you" ? "You" : "Your editor"}</span>
                  <span>{m.text}</span>
                  {m.v !== undefined && m.v === p.current && prevN !== null && !busy && (
                    <button type="button" className="btn ghost sm undo-btn" onClick={() => undoTo(prevN)}>
                      <Icon name="undo" />Undo this</button>)}
                  {m.changes && (m.changes.length
                    ? <ul className="changes small" aria-label={`What changed in this version, measured`}>{m.changes.map((c, k) => <li key={k}>{c.at
                      ? <button type="button" className="linkish" onClick={() => jumpTo(c.at!)} title="Show me where">{c.text}</button>
                      : c.text}</li>)}</ul>
                    : <p className="changes small warn">Nothing in the video changed. Try saying it another way, or use Edit it myself.</p>)}
                  {m.rule && (
                    <div className="ask">
                      <div className="small">Remember this for next time? &ldquo;{m.rule}&rdquo;</div>
                      <div className="row mt-8">
                        <button className="btn sm primary" onClick={() => { addRule(m.rule!); setMsgs((x) => x.map((y, k) => (k === i ? { ...y, rule: undefined, text: y.text + "\nSaved to My style." } : y))); }}>Yes, remember it</button>
                        <button className="btn sm ghost" onClick={() => { if (m.learned && m.rule) declineLearned(m.rule); setMsgs((x) => x.map((y, k) => (k === i ? { ...y, rule: undefined } : y))); }}>No, just this video</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {busy && <div className="msg ed busy"><span className="spin" aria-hidden="true" />{busy}{waiting > 0 && <span className="small faint">{` · ${waiting} more note${waiting === 1 ? "" : "s"} waiting`}</span>}</div>}
            </div>
            {err && <div className="alert err mt-12" role="alert"><Icon name="alert" /><span>{err}</span></div>}
            <div className="composer">
              <label className="sr-only" htmlFor="note">Note for your editor</label>
              <textarea id="note" rows={1} value={note} placeholder="What should change?" aria-describedby="note-hint"
                autoComplete="off" onChange={(ev) => setNote(ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); void send(); } }} />
              <VoiceNote settings={settings} disabled={recording}
                onText={(t) => { const said = anchorSpoken(t, player.current?.t ?? 0);
                  setNote((n) => (n.trim() ? `${n.trim()} ${said}` : said)); document.getElementById("note")?.focus(); }} />
              {dur > 0 && <button type="button" className="btn ghost sm at-btn" title="Add where the player is to your note"
                aria-label={`Add the time ${clock(t)} to your note`}
                onClick={() => { setNote((n) => `At ${clock(t)}, ${n.replace(/^at \d+:\d\d,\s*/i, "")}`);
                  document.getElementById("note")?.focus(); }}><span className="num">At {clock(t)}</span></button>}
              <button className="btn primary" onClick={() => void send()} disabled={!note.trim() || recording}><Icon name="send" />{busy ? "Queue" : "Send"}</button>
            </div>
            <p className="hint note-hint" id="note-hint">For example: &ldquo;music too loud at the start&rdquo;, &ldquo;at 0:12 zoom in&rdquo; (the At button adds where the player is), &ldquo;show the Spotify logo when I say
              Spotify&rdquo;, &ldquo;cut the part about my cat&rdquo;. Enter sends, Shift+Enter starts a new line.</p>
            <div className="attach-row">
              <label className="attach">
                <Icon name="paperclip" />Add a song, picture or clip your editor can use
                <input type="file" multiple accept="audio/*,image/*,video/*" disabled={recording}
                  onChange={async (ev) => { if (!ev.target.files?.length) return; const n = await addToLibrary(p, [...ev.target.files]); await saveProject(p); setP({ ...p });
                    ev.target.value = "";
                    setMsgs((m) => [...m, { who: "ed", text: `Added ${n.join(", ")}. Tell me where to use ${n.length > 1 ? "them" : "it"}.` }]); }} />
              </label>
              <button className="attach-btn" aria-expanded={maker} aria-controls="make-music" disabled={!version || !dur} onClick={() => setMaker(true)}><Icon name="music" />No song? Make music</button>
              <RecordScreen onAdd={async (f) => { const n = await addToLibrary(p, [f]); await saveProject(p);
                if (exportingRef.current) afterExport.current = true; else setP({ ...p });   // mid-export: shown once it's done
                setMsgs((m) => [...m, { who: "ed", text: `Added ${n.join(", ")} as a screen recording. Tell me where to show it, for example "show my screen recording when I talk about the app", or place it yourself in Edit it myself, Pictures.` }]); }} />
            </div>
            {scan && <p className="small faint wait-scan"><span className="spin" aria-hidden="true" />Looking for waits in {scan.name.slice(0, 40)}
              <span className="num"> {scan.pct}%</span>
              <button type="button" className="btn ghost sm" onClick={stopScan} aria-label={`Stop looking for waits in ${scan.name}`}>Stop</button></p>}
            <p className="sr-only" aria-live="polite">{scanSay}</p>
          </section>

          {drawer && version && (
            <section className="panel" aria-label="Edit it myself">
              <Drawer project={p} edit={version.edit} settings={settings} onMakeMusic={() => setMaker(true)} onWords={() => setP({ ...p })}
                scan={scan} onFindWaits={findWaitsFor} onStopScan={stopScan}
                onClip={() => { setP({ ...p }); void saveProject(p); }} onSaveLook={onSaveLook && ((l) => { onSaveLook(l); setToast("Saved as your look: new videos start with it"); })}
                onFrames={async () => {
                  // the moments come from the version the player shows, so each frame is the word it's labelled with
                  const pl = player.current; if (!pl || recording || exportingRef.current || (exp && exp.pct < 100)) return null;
                  endRun(pl, false); setPlaying(false);           // drawing frames stops playback and any scroll or loop test
                  const ws = pl.tl.words.filter((w) => w.w.trim() && w.os > 0.8);
                  const n = Math.min(6, ws.length);
                  const pick = Array.from({ length: n }, (_, k) => ws[Math.floor((k + 0.5) * ws.length / n)]);
                  const urls = await pl.frames(pick.map((w) => (w.os + w.oe) / 2));
                  return pick.map((w, k) => ({ id: w.id, url: urls[k], at: w.os, word: w.w }));
                }} onApply={async (edit, what) => { await saveManual(p, edit, what); setP({ ...p }); setMsgs((m) => [...m, { who: "ed", text: `Version ${p.current}: ${what}` }]); }} />
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
      <Shortcuts open={keys} onClose={() => setKeys(false)} />
    </div>
  );
}
