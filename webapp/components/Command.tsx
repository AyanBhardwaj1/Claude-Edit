"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { EFFORT, EFFORTS, type Effort } from "@/lib/effort";
import { listAnims, listProjects } from "@/lib/store";
import { THEMES, type ThemeId } from "@/lib/theme";
import { Icon, type IconName } from "./Icons";

type Item = { id: string; label: string; hint: string; icon: IconName; run: () => void };

/** ⌘K / Ctrl+K: jump to any screen, video or animation, or switch the look, from the keyboard. */
export function Command({ go, onTheme, onSample, onEffort }: { go: (hash: string) => void; onTheme: (t: ThemeId) => void;
  onSample: () => void; onEffort?: (e: Effort) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const [docs, setDocs] = useState<Item[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); back.current = document.activeElement as HTMLElement; setOpen((o) => !o); }
    };
    const onOpen = () => { back.current = document.activeElement as HTMLElement; setOpen(true); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("cutmind:command", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("cutmind:command", onOpen); };
  }, []);

  useEffect(() => {
    if (!open) { back.current?.focus?.(); return; }
    setQ(""); setAt(0);
    setTimeout(() => input.current?.focus(), 0);
    void Promise.all([listProjects(), listAnims()]).then(([ps, as]) => setDocs([
      ...ps.map((p) => ({ id: `v:${p.id}`, label: p.title, hint: "Video", icon: "film" as IconName, run: () => go(`video/${encodeURIComponent(p.id)}`) })),
      ...as.map((a) => ({ id: `a:${a.id}`, label: a.title, hint: "Animation", icon: "wand" as IconName, run: () => go(`animate/${encodeURIComponent(a.id)}`) })),
    ]));
  }, [open, go]);

  const items = useMemo<Item[]>(() => {
    const base: Item[] = [
      { id: "new", label: "New video", hint: "Edit raw takes", icon: "plus", run: () => go("new") },
      { id: "animate", label: "Animate text", hint: "Motion Studio", icon: "wand", run: () => go("animate") },
      { id: "sample", label: "Open the sample video", hint: "Try the editor", icon: "play", run: onSample },
      { id: "home", label: "Home", hint: "Go to", icon: "home", run: () => go("") },
      { id: "videos", label: "My videos", hint: "Go to", icon: "film", run: () => go("videos") },
      { id: "script", label: "Write a script", hint: "Go to", icon: "pen", run: () => go("script") },
      { id: "style", label: "My style", hint: "Go to", icon: "spark", run: () => go("style") },
      { id: "settings", label: "Settings, keys and brand", hint: "Go to", icon: "sliders", run: () => go("settings") },
      ...THEMES.map((t) => ({ id: `t:${t.id}`, label: `${t.name} look`, hint: "Switch look", icon: "palette" as IconName, run: () => onTheme(t.id) })),
      ...(onEffort ? EFFORTS.map((e) => ({ id: `e:${e}`, label: `${EFFORT[e].label}: make videos this way by default`,
        hint: "Speed vs quality", icon: "sliders" as IconName, run: () => onEffort(e) })) : []),
    ];
    const all = [...base, ...docs];
    const n = q.trim().toLowerCase();
    return (n ? all.filter((x) => `${x.label} ${x.hint}`.toLowerCase().includes(n)) : all).slice(0, 12);
  }, [q, docs, go, onTheme, onSample, onEffort]);

  if (!open) return null;
  const run = (x?: Item) => { if (!x) return; setOpen(false); x.run(); };
  return (
    <div className="cmd-back" onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Go anywhere">
        <div className="cmd-in">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setAt(0); }} placeholder="Go to a screen, a video, an animation or a look…"
            role="combobox" aria-expanded="true" aria-controls="cmd-list" aria-activedescendant={items[at] ? `cmd-${items[at].id}` : undefined} autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              else if (e.key === "ArrowDown") { e.preventDefault(); setAt((i) => Math.min(items.length - 1, i + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); run(items[at]); }
            }} />
          <kbd>Esc</kbd>
        </div>
        <ul id="cmd-list" role="listbox" className="cmd-list">
          {items.map((x, i) => (
            <li key={x.id} id={`cmd-${x.id}`} role="option" aria-selected={i === at} className={i === at ? "on" : ""}
              onPointerEnter={() => setAt(i)} onClick={() => run(x)}>
              <Icon name={x.icon} /><span className="grow trunc">{x.label}</span><span className="faint small">{x.hint}</span>
            </li>))}
          {!items.length && <li className="faint">Nothing matches &ldquo;{q}&rdquo;.</li>}
        </ul>
      </div>
    </div>
  );
}
