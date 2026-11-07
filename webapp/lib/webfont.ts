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
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.dataset.font = name;
    l.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@500;600;700;800;900&display=swap`;
    l.onload = () => ok(); l.onerror = () => ok();
    setTimeout(ok, 4000);
    document.head.appendChild(l);
  });
  loading.set(name, p);
  return p;
}
