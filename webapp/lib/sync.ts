// With server accounts, a user's preferences follow them between devices: settings (never the API keys), style rules
// and the look. Pulled once when the app opens, pushed a moment after any change. Videos stay in each browser.

import { accountMode } from "./auth";
import { onlyKeys, withoutKeys } from "./keys";
import { loadRules, loadSettings, readLocal, saveRules, saveSettings, writeLocal } from "./store";
import { getTheme, setTheme, THEMES, type ThemeId } from "./theme";
import type { Settings, StyleRule } from "./types";

export const PREFS_EVENT = "cutmind:prefs";
let timer: ReturnType<typeof setTimeout> | undefined;
let live = false;

export async function startSync(): Promise<boolean> {
  if ((await accountMode()) !== "server") return false;
  try {
    const r = await fetch("/api/account/data", { credentials: "same-origin", cache: "no-store" });
    if (r.ok) {
      const d = await r.json() as { settings?: Partial<Settings>; style?: StyleRule[]; theme?: ThemeId };
      live = false;                                         // applying the server copy must not echo straight back
      // settings changed here that never reached the server (offline, a tab closed too soon) win over its older copy
      const unsent = readLocal(DIRTY) === "1";
      if (d.settings && Object.keys(d.settings).length && !unsent) {
        const local = loadSettings();
        saveSettings({ ...local, ...withoutKeys(d.settings), ...onlyKeys(local), rememberKeys: local.rememberKeys });   // keys, and whether this computer keeps them, never come from the server
      }
      if (d.style?.length) {
        const mine = loadRules();
        const seen = new Set(mine.map((x) => x.text.toLowerCase()));
        saveRules([...mine, ...d.style.filter((x) => !seen.has(x.text.toLowerCase()))]);
      }
      if (d.theme && THEMES.some((t) => t.id === d.theme) && d.theme !== getTheme()) setTheme(d.theme);
    }
  } catch { /* offline: keep working locally, push later */ }
  live = true;
  window.addEventListener(PREFS_EVENT, schedule);
  schedule();
  return true;
}

/** Stop syncing (signing out): a change still waiting to go up is sent now, not dropped. */
export function stopSync() {
  const pending = live && timer !== undefined;
  live = false; window.removeEventListener(PREFS_EVENT, schedule); clearTimeout(timer); timer = undefined;
  if (pending) void push(true);
}

const DIRTY = "ce.sync.unsent";

function schedule() {
  if (!live) return;
  writeLocal(DIRTY, "1");                              // until a push gets through
  clearTimeout(timer);
  timer = setTimeout(push, 800);
}

async function push(leaving = false) {
  const { rememberKeys: _device, ...settings } = withoutKeys(loadSettings());   // never any provider's key (lib/keys.ts), nor
  void _device;                                                                // "remember them on this computer": per device
  timer = undefined;
  const r = await fetch("/api/account/data", { method: "PUT", credentials: "same-origin", keepalive: leaving, headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings, style: loadRules(), theme: getTheme() }) }).catch(() => null);
  if (r?.ok) writeLocal(DIRTY, "0");
}
