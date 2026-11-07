"use client";
import { Relay } from "@/components/Relay";
import { Assistant } from "@/components/Assistant";
import { announce } from "@/lib/assistant";
import { aiReady } from "@/lib/ai";
import { useCallback, useEffect, useRef, useState } from "react";
import { Dashboard } from "@/components/Dashboard";
import { Editor } from "@/components/Editor";
import { Icon, Mark, type IconName } from "@/components/Icons";
import { Library } from "@/components/Library";
import { NewVideo } from "@/components/NewVideo";
import { Settings } from "@/components/Settings";
import dynamic from "next/dynamic";
// Motion Studio is big and only needed on Animate: load it when opened
const Studio = dynamic(() => import("@/components/Studio").then((m) => m.Studio), {
  ssr: false, loading: () => <p className="muted" role="status">Opening Motion Studio…</p> });
import { Command } from "@/components/Command";
import { Script, StyleRules } from "@/components/Small";
import { getUser, initials, signOut, type User } from "@/lib/auth";
import { createSample } from "@/lib/demo";
import { startSync, stopSync } from "@/lib/sync";
import { DEFAULT_SETTINGS, forgetKeys, listProjects, loadProject, loadSettings, saveSettings, setOwner } from "@/lib/store";
import { applyTheme, getTheme, setTheme, THEMES, type ThemeId } from "@/lib/theme";
import type { Project, Settings as S } from "@/lib/types";

type Screen = "home" | "videos" | "new" | "editor" | "animate" | "script" | "style" | "settings";
const NAV: { s: Screen; label: string; icon: IconName }[] = [
  { s: "home", label: "Home", icon: "home" }, { s: "videos", label: "My videos", icon: "film" }, { s: "animate", label: "Animate", icon: "wand" },
  { s: "script", label: "Write a script", icon: "pen" }, { s: "style", label: "My style", icon: "spark" },
  { s: "settings", label: "Settings", icon: "sliders" },
];
const TITLES: Record<Screen, string> = { home: "Home", videos: "My videos", new: "New video", editor: "Editor", animate: "Animate", script: "Write a script",
  style: "My style", settings: "Settings" };

function parse(hash: string): { screen: Screen; id?: string } {
  const h = hash.replace(/^#/, "");
  if (h.startsWith("video/")) return { screen: "editor", id: decodeURIComponent(h.slice(6)) };
  if (h.startsWith("animate/")) return { screen: "animate", id: decodeURIComponent(h.slice(8)) };
  return { screen: (["videos", "new", "animate", "script", "style", "settings"].includes(h) ? h : "home") as Screen };
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<S>(DEFAULT_SETTINGS);
  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<string | undefined>();
  const [pending, setPending] = useState<File[]>([]);
  const [film, setFilm] = useState(false);          // "Film it here" from Write a script: New video opens the camera
  const [count, setCount] = useState<number | null>(null);
  const [theme, setThemeState] = useState<ThemeId>("studio");
  const [menu, setMenu] = useState(false);
  const [loading, setLoading] = useState("");
  const [animId, setAnimId] = useState<string | undefined>();

  const sampling = useRef(false);
  const sample = useCallback(async () => {
    if (sampling.current) return;                 // the start-up route and a hash change can both ask at once
    sampling.current = true;
    setLoading("Getting the sample video…");
    try {
      const { project: p, summary: s } = await createSample((m, pct) => { setLoading(m === "Ready" ? "" : `${m}…`); announce(m, pct ?? 0); });
      setProject(p); setSummary(s);
      history.replaceState(null, "", `#video/${encodeURIComponent(p.id)}`);
      setScreen("editor");
    } catch (e) {
      setLoading((e as { userMessage?: string }).userMessage ?? "The sample video couldn't load.");
      setTimeout(() => setLoading(""), 4000);
      history.replaceState(null, "", "#"); setScreen("home");
      sampling.current = false;
      return;
    }
    setLoading("");
    sampling.current = false;
  }, []);

  const [notice, setNotice] = useState("");
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(""), 7000); return () => clearTimeout(id); }, [notice]);
  const route = useCallback(async (hash: string) => {
    if (hash.replace(/^#/, "") === "sample") { await sample(); return; }
    const r = parse(hash);
    setAnimId(r.screen === "animate" ? r.id : undefined);
    if (r.screen === "editor" && r.id) {
      const p = await loadProject(r.id);
      if (!p) {                                       // an old link, or a video made in another browser
        history.replaceState(null, "", "#videos"); setScreen("videos");
        setNotice("That video isn't in this browser. Videos stay where they were made: move them with Settings → Your videos.");
        return;
      }
      // the saved copy wins unless the one in memory is as new: the editor works on copies, so the one held here goes
      // stale after a note or a rename, and reopening it would build the next note on an old version
      setProject((cur) => (cur?.id === p.id && cur.updatedAt >= p.updatedAt ? cur : p));
    }
    setScreen(r.screen);
    window.scrollTo({ top: 0 });
  }, [sample]);

  useEffect(() => {
    let gone = false;
    const on = () => void route(location.hash);
    void (async () => {
      const u = await getUser();
      if (gone) return;
      if (!u) { location.replace(`/login?next=${encodeURIComponent("/app" + location.hash)}`); return; }
      setOwner(u.id);
      await startSync();                                   // server accounts: bring this user's preferences to this device
      if (gone) return;
      setUser(u);
      setSettings(loadSettings());
      setThemeState(getTheme());
      applyTheme(getTheme());
      void route(location.hash);
    })();
    window.addEventListener("hashchange", on);
    return () => { gone = true; window.removeEventListener("hashchange", on); };
  }, [route]);

  useEffect(() => { if (user) void listProjects().then((ps) => setCount(ps.length)); }, [user, screen]);
  useEffect(() => { document.title = `${TITLES[screen]} · Cutmind`; }, [screen]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => { if (!(e.target as Element).closest?.(".who")) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(false); };
    document.addEventListener("pointerdown", close); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [menu]);

  const go = (s: Screen) => { location.hash = s === "home" ? "" : s; if (s === "home") void route(""); };
  const open = (p: Project, s?: string) => { setProject(p); setSummary(s); location.hash = `video/${encodeURIComponent(p.id)}`; };
  const pickTheme = (id: ThemeId) => { setTheme(id); setThemeState(id); };
  // a waiting settings change goes up first; then this account's keys leave the browser (shared computers)
  const leave = async () => { stopSync(); forgetKeys(); await signOut(); location.href = "/"; };

  if (!user) return (
    <div className="app" aria-busy="true" aria-label="Loading Cutmind">
      <aside className="side"><div className="skel boot-skel" /><div className="skel boot-skel" /><div className="skel boot-skel" /></aside>
      <main className="main"><div className="page"><div className="skel boot-head" /><div className="skel boot-body" /></div></main>
    </div>
  );
  const key = aiReady(settings);
  const here = screen === "editor" ? "videos" : screen;
  const link = (n: (typeof NAV)[number]) => (
    <a key={n.s} href={n.s === "home" ? "#" : `#${n.s}`} aria-current={here === n.s ? "page" : undefined}
      onClick={(e) => { e.preventDefault(); go(n.s); }}>
      <Icon name={n.icon} />{n.label}
      {n.s === "videos" && count !== null && <span className="count">{count}</span>}
    </a>
  );

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="side" aria-label="Main">
        <a className="brand" href="/" translate="no"><Mark />Cutmind</a>
        <button className="btn primary new" onClick={() => go("new")}><Icon name="plus" />New video</button>
        <nav className="nav">{NAV.map(link)}</nav>
        <button className="cmd-hint" onClick={() => window.dispatchEvent(new Event("cutmind:command"))}><Icon name="search" />Go anywhere<kbd>⌘K</kbd></button>
        <div className="side-foot">
          <a className="status" href="#settings" onClick={(e) => { e.preventDefault(); go("settings"); }}>
            <span className={`dot ${key ? "on" : ""}`} />{key ? "AI editor connected" : "No AI editor connected"}
          </a>
          <div className="swatches" role="group" aria-label="Look">
            {THEMES.map((t) => (
              <button key={t.id} className="swatch" style={{ background: t.bg }} aria-pressed={theme === t.id} title={t.name}
                aria-label={`${t.name} look`} onClick={() => pickTheme(t.id)}><i style={{ background: t.accent }} /></button>
            ))}
          </div>
          <div className="who">
            <button className="who-btn" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu(!menu)}>
              <span className="avatar">{initials(user.name)}</span>
              <span className="grow"><span className="name trunc">{user.name}</span>
                <span className="mail trunc">{user.email}</span></span>
              <Icon name="more" />
            </button>
            {menu && (
              <div className="menu" role="menu">
                <button role="menuitem" onClick={() => { setMenu(false); go("settings"); }}><Icon name="user" />Account and settings</button>
                <button role="menuitem" onClick={leave}><Icon name="out" />Sign out</button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <header className="topbar">
        <a className="brand" href="/" translate="no"><Mark />Cutmind</a>
        <div className="row">
          <button className="btn primary sm" onClick={() => go("new")}><Icon name="plus" />New</button>
          <a href="#settings" aria-label="Account and settings" onClick={(e) => { e.preventDefault(); go("settings"); }}>
            <span className="avatar">{initials(user.name)}</span></a>
        </div>
      </header>

      <main className="main" id="main" tabIndex={-1}>
        {screen === "home" && <Dashboard user={user} settings={settings} theme={theme} onSample={sample} onNew={(files) => { setPending(files ?? []); go("new"); }}
          onOpen={(p) => open(p)} onGo={(s) => go(s)} />}
        {screen === "videos" && <Library onOpen={(p) => open(p)} onNew={() => go("new")} onSample={sample} />}
        {screen === "new" && <NewVideo settings={settings} initial={pending} film={film} onFilmOpened={() => setFilm(false)} onSettings={() => go("settings")}
          onSaveSettings={(s) => { saveSettings(s); setSettings(s); }} onDone={(p, s) => { setPending([]); open(p, s); }} />}
        {screen === "editor" && project && (project.versions.length
          ? <Editor key={project.id} project={project} settings={settings} firstSummary={summary} onBack={() => go("videos")}
            onOpenProject={(p, s) => open(p, s)} onOpenAnim={(id) => { location.hash = `animate/${encodeURIComponent(id)}`; }}
            onSaveLook={(look) => { const s = { ...settings, look }; saveSettings(s); setSettings(s); }} />
          : <div className="page narrow"><div className="empty"><h2>This video didn&apos;t finish</h2>
              <p>Something stopped it before the first edit. Delete it from My videos and make it again from New video.</p>
              <button className="btn" onClick={() => go("videos")}><Icon name="arrowLeft" />My videos</button></div></div>)}
        {screen === "animate" && <Studio key={animId ?? "list"} settings={settings} openId={animId} onSettings={() => go("settings")} />}
        {screen === "script" && <Script settings={settings} onFilm={() => { setFilm(true); go("new"); }} />}
        {screen === "style" && <StyleRules />}
        {screen === "settings" && <Settings settings={settings} user={user} theme={theme} onTheme={pickTheme} onUser={setUser} onSignOut={leave}
          onSave={(s) => { saveSettings(s); setSettings(s); }} />}
      </main>

      <nav className="tabbar" aria-label="Main">
        {([["home", "Home", "home"], ["videos", "Videos", "film"], ["new", "New", "plus"], ["animate", "Animate", "wand"], ["script", "Script", "pen"], ["style", "Style", "spark"]] as const)
          .map(([s, label, icon]) => (
            <a key={s} href={s === "home" ? "#" : `#${s}`} aria-current={here === s ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); go(s); }}><Icon name={icon} />{label}</a>
          ))}
      </nav>
      <Assistant settings={settings} screen={TITLES[screen]} project={screen === "editor" ? project : null} onSettings={() => go("settings")} />
      <Relay />
      <Command go={(h) => { location.hash = h; if (!h) void route(""); }} onTheme={pickTheme} onSample={sample}
        onEffort={(effort) => { const s = { ...settings, effort }; saveSettings(s); setSettings(s); }} />
      {loading && <div className="toast" role="status"><span className="spin" aria-hidden="true" />{loading}</div>}
      {notice && !loading && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
