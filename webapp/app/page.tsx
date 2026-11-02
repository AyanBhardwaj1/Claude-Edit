"use client";
import { useEffect, useState } from "react";
import { Editor } from "@/components/Editor";
import { NewVideo } from "@/components/NewVideo";
import { Settings } from "@/components/Settings";
import { Home, Script, StyleRules } from "@/components/Small";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "@/lib/store";
import type { Project, Settings as S } from "@/lib/types";

type Screen = "home" | "new" | "editor" | "script" | "style" | "settings";

export default function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<S>(DEFAULT_SETTINGS);
  const [project, setProject] = useState<Project | null>(null);
  const [summary, setSummary] = useState<string | undefined>();
  useEffect(() => { setSettings(loadSettings()); }, []);
  const key = settings.provider === "anthropic" ? settings.anthropicKey : settings.openaiKey;
  const nav = (s: Screen, label: string) => <button className={`nav ${screen === s ? "on" : ""}`} onClick={() => setScreen(s)}>{label}</button>;

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Claude<span>-Edit</span></div>
        {nav("home", "My videos")}
        {nav("new", "New video")}
        {nav("script", "Write a script")}
        {nav("style", "My style")}
        {nav("settings", "Settings")}
        <div className="foot"><span className={`dot ${key ? "on" : ""}`} />
          {key ? `AI editor: ${settings.provider === "anthropic" ? "Claude" : "ChatGPT"}` : "No AI editor connected"}
          <br />Your videos stay in this browser.</div>
      </aside>
      <main>
        {screen === "home" && <Home onNew={() => setScreen("new")} onOpen={(p) => { setProject(p); setSummary(undefined); setScreen("editor"); }} />}
        {screen === "new" && <NewVideo settings={settings} onSettings={() => setScreen("settings")}
          onDone={(p, s) => { setProject(p); setSummary(s); setScreen("editor"); }} />}
        {screen === "editor" && project && (project.versions.length
          ? <Editor key={project.id} project={project} settings={settings} firstSummary={summary} onBack={() => setScreen("home")} />
          : <div className="card">This video didn&apos;t finish. Delete it and start again from New video.</div>)}
        {screen === "script" && <Script settings={settings} />}
        {screen === "style" && <StyleRules />}
        {screen === "settings" && <Settings settings={settings} onSave={(s) => { saveSettings(s); setSettings(s); }} />}
      </main>
    </div>
  );
}
