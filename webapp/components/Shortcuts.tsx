"use client";
import { useEffect, useRef } from "react";

/** The editor's keyboard shortcuts, in a native modal dialog (Esc closes it, focus stays inside and returns). */
export const SHORTCUTS: [string[], string][] = [
  [["Space"], "Play or pause"],
  [["←", "→"], "Back or forward 1 second"],
  [["Shift", "← / →"], "Back or forward 5 seconds"],
  [[",", "."], "One frame back or forward"],
  [["Home", "End"], "Jump to the start or the end"],
  [["N"], "Write a note to your editor"],
  [["M"], "Say a note (M again to stop)"],
  [["C"], "Compare with the version before"],
  [["⌘ or Ctrl", "Z"], "Back to the previous version"],
  [["⌘ or Ctrl", "Shift", "Z"], "Forward to the next version"],
  [["?"], "Show these shortcuts"],
];

export function Shortcuts({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="shortcuts" aria-labelledby="keys-h" onClose={onClose}
      onClick={(ev) => { if (ev.target === ref.current) onClose(); }}>
      <div className="panel-head"><h2 id="keys-h">Keyboard shortcuts</h2>
        <button className="btn ghost icon sm" aria-label="Close the shortcuts" onClick={onClose}>&times;</button></div>
      <dl>
        {SHORTCUTS.map(([keys, what]) => (
          <div key={what} className="row-key"><dt>{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</dt><dd>{what}</dd></div>
        ))}
      </dl>
      <p className="small faint">Shortcuts pause while you type in a box.</p>
    </dialog>
  );
}
