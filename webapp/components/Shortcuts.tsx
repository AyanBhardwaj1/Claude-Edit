"use client";
import { useEffect, useRef } from "react";

/** The editor's keyboard shortcuts, in a native modal dialog (Esc closes it, focus stays inside and returns). */
export const SHORTCUTS: [string[], string][] = [
  [["Space"], "Play or pause"],
  [["←", "→"], "Back or forward 1 second"],
  [["Shift", "← / →"], "Back or forward 5 seconds"],
  [[",", "."], "One frame back or forward"],
  [["Home", "End"], "Jump to the start or the end"],
  [["[", "]"], "Just before the previous or next cut"],
  [["N"], "Write a note to your editor"],
  [["/"], "Find a word in what you said"],
  [["S"], "Timeline: split the clip at the playhead"],
  [["Delete"], "Timeline: delete the selected clip, picture or zoom"],
  [["← / →"], "Timeline: move the selection (or the playhead)"],
  [["Ctrl/⌘", "Z"], "Timeline: undo (add Shift to redo)"],
  [["M"], "Say a note (M again to stop)"],
  [["C"], "Compare with the version before"],
  [["T"], "Scroll test: the first 3 seconds, sound off"],
  [["L"], "Loop test: the end running into the start"],
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
      onClick={(ev) => {                        // a click on the backdrop (outside the box), not on the box's own padding
        if (ev.target !== ref.current) return;
        const r = ref.current!.getBoundingClientRect();
        if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) onClose();
      }}>
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
