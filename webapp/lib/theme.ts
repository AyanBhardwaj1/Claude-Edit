// The app's five looks. Each is a set of CSS tokens on html[data-theme] (app/globals.css); the choice is kept per
// device in localStorage and applied before first paint by the inline script in app/layout.tsx.

export type ThemeId = "studio" | "radiant" | "terminal" | "ivory" | "natural";

export const THEMES: { id: ThemeId; name: string; line: string; dark: boolean; bg: string; ink: string; accent: string; surface: string }[] = [
  { id: "studio", name: "Studio", line: "Dark graphite with a warm orange, made for long sessions.", dark: true,
    bg: "#121110", ink: "#f2efe9", accent: "#ff7a3d", surface: "#1c1b19" },
  { id: "radiant", name: "Radiant", line: "Bright white, electric blue, soft round corners.", dark: false,
    bg: "#ffffff", ink: "#0d1117", accent: "#1f5eff", surface: "#f1f4fb" },
  { id: "terminal", name: "Terminal", line: "Black and phosphor green, square, in a monospace face.", dark: true,
    bg: "#070a07", ink: "#c9f5c0", accent: "#5cf27a", surface: "#0e140e" },
  { id: "ivory", name: "Ivory", line: "Warm paper, ink-black buttons, an editorial serif.", dark: false,
    bg: "#f6f3ec", ink: "#1d1b17", accent: "#1d1b17", surface: "#efebe2" },
  { id: "natural", name: "Natural", line: "Sage and moss, calm and earthy.", dark: false,
    bg: "#e8ece3", ink: "#1b261e", accent: "#2f6a3f", surface: "#f2f4ee" },
];

export const THEME_KEY = "cutmind.theme";

export function getTheme(): ThemeId {
  if (typeof window === "undefined") return "studio";
  try {
    const t = localStorage.getItem(THEME_KEY) as ThemeId | null;
    return THEMES.some((x) => x.id === t) ? t! : "studio";
  } catch { return "studio"; }
}

export function setTheme(id: ThemeId) {
  try { localStorage.setItem(THEME_KEY, id); } catch { /* private mode: the look lasts for this page only */ }
  applyTheme(id);
  window.dispatchEvent(new Event("cutmind:prefs"));
}

export function applyTheme(id: ThemeId) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  document.documentElement.dataset.theme = t.id;
  document.documentElement.style.colorScheme = t.dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bg);
}

/** Runs inline in <head> before paint, so the page never flashes the wrong look. */
export const THEME_BOOT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var ok=${JSON.stringify(THEMES.map((t) => t.id))};
if(ok.indexOf(t)<0)t='studio';var d=document.documentElement;d.classList.add('js');d.dataset.theme=t;
d.style.colorScheme=${JSON.stringify(Object.fromEntries(THEMES.map((t) => [t.id, t.dark ? "dark" : "light"])))}[t];}catch(e){}})();`;
