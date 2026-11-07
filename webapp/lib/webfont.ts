// Caption fonts by Google Fonts name: the stylesheet is added once, and the promise settles when it has loaded (or
// after a few seconds offline), so the font can then be loaded before the first frame is drawn.
const loading = new Map<string, Promise<void>>();
const BUILT_IN = new Set(["Montserrat", "Arial", "Helvetica", "sans-serif", "serif", "system-ui"]);

export function loadFont(name: string): Promise<void> {
  if (typeof document === "undefined" || !name || BUILT_IN.has(name)) return Promise.resolve();
  const have = loading.get(name);
  if (have) return have;
  const p = new Promise<void>((ok) => {
    if (document.querySelector(`link[data-font="${CSS.escape(name)}"]`)) return ok();
    const add = (weights: boolean) => {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.dataset.font = name;
      l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}${weights ? ":wght@500;600;700;800;900" : ""}&display=swap`;
      l.onload = () => ok();
      // a display face with one weight (Bangers, Anton, Bebas Neue) is refused when asked for 500-900: ask for it plain
      l.onerror = () => { l.remove(); if (weights) add(false); else ok(); };
      document.head.appendChild(l);
    };
    setTimeout(ok, 4000);
    add(true);
  });
  loading.set(name, p);
  return p;
}
