// With server accounts, a user's preferences follow them between devices: settings (never the API keys), style rules
// and the look. Pulled once when the app opens, pushed a moment after any change. Videos stay in each browser.

import { accountMode } from "./auth";
import { loadRules, loadSettings, saveRules, saveSettings } from "./store";
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
      if (d.settings && Object.keys(d.settings).length) {
        const local = loadSettings();
        saveSettings({ ...local, ...d.settings, anthropicKey: local.anthropicKey, openaiKey: local.openaiKey });
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

export function stopSync() { live = false; window.removeEventListener(PREFS_EVENT, schedule); clearTimeout(timer); }

function schedule() {
  if (!live) return;
  clearTimeout(timer);
  timer = setTimeout(push, 800);
}

async function push() {
  const { anthropicKey: _a, openaiKey: _o, ...settings } = loadSettings();
  void _a; void _o;
  await fetch("/api/account/data", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings, style: loadRules(), theme: getTheme() }) }).catch(() => undefined);
}
