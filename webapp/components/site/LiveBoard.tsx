"use client";
import { useDeferredValue, useMemo, useState } from "react";
import { liveCut, SAMPLE_TAKE, type Mark } from "@/lib/livecut";

const NAME: Record<Mark, string> = { kept: "Kept", retake: "Retake", "false start": "False start", "meta-talk": "Meta-talk", filler: "Filler", stutter: "Stutter" };
const WHY: Record<Mark, string> = {
  kept: "The last complete take of this line. Every word stays.",
  retake: "You said this line again later. The last complete take wins, so this one goes.",
  "false start": "A short start right before a retake. It goes.",
  "meta-talk": "Talk to yourself, not to the viewer (“let me try that again”). It goes.",
  filler: "It stays, minus the ums at its edges.",
  stutter: "It stays, minus the doubled words.",
};

/** The landing page's live thing: Cutmind's real first-pass rules, run on a take the visitor types. */
export function LiveBoard() {
  const [text, setText] = useState(SAMPLE_TAKE);
  const deferred = useDeferredValue(text);
  const cut = useMemo(() => liveCut(deferred), [deferred]);
  const firstKept = Math.max(0, cut.lines.findIndex((l) => l.mark === "kept"));
  const [open, setOpen] = useState<number | null>(null);
  const at = open !== null && open < cut.lines.length ? open : firstKept;

  return (
    <>
      <div className="board-intro">
        <h2 data-reveal>Your take, cut while you watch</h2>
        <p data-reveal style={{ ["--i" as string]: 1 }}>These are Cutmind&apos;s real first-pass rules, running in this page. Type a take the way you&apos;d
          say it on camera, restarts and all.</p>
        <div className="take-input" data-reveal style={{ ["--i" as string]: 2 }}>
          <label htmlFor="take">Your take</label>
          <textarea id="take" value={text} spellCheck={false} onChange={(e) => { setText(e.target.value); setOpen(null); }} />
          <div className="row">
            <button className="plain" type="button" onClick={() => { setText(SAMPLE_TAKE); setOpen(null); }}>Put the example back</button>
            <button className="plain" type="button" onClick={() => { setText(""); setOpen(null); }}>Clear it</button>
          </div>
        </div>
      </div>
      <div className="board" data-ui aria-label="Every line of your take and what happens to it" aria-live="polite" role="group">
        {!cut.lines.length && <div className="r"><span className="txt">Type something above and the lines show up here.</span></div>}
        {cut.lines.map((l, i) => (
          <button key={i} type="button" className={`r ${i === at ? "open" : ""}`} aria-expanded={i === at} onClick={() => setOpen(i)}>
            <span className="txt">{l.words.map((w, k) => <span key={k}>{w.cut ? <s>{w.w}</s> : w.w}{" "}</span>)}</span>
            <span className="n">{l.words.length} words</span>
            <span className="n">{l.seconds.toFixed(1)} s</span>
            <span className="n">{l.mark === "kept" ? "In the reel" : l.words.every((w) => w.cut) ? "Cut" : "Trimmed"}</span>
            <span className={`st ${l.mark.replace(" ", "-")}`}>{NAME[l.mark]}</span>
            {i === at && (
              <span className="why">
                <span>{WHY[l.mark]}</span>
                <span>{l.captions.length ? <>On screen it reads:<span className="caps" style={{ marginTop: 8 }}>{l.captions.map((c, k) => <span key={k}>{c}</span>)}</span></>
                  : "Not in the reel, so no subtitles."}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="board-sum">
        <p data-reveal>Kept <b>{cut.keptWords}</b> of <b>{cut.totalWords}</b> words. <b>{cut.rawSeconds.toFixed(1)} s</b> of talking became
          a <b>{cut.keptSeconds.toFixed(1)} s</b> reel, before any AI has read a word. With your key, the AI editor then reads the whole thing, keeps your
          jokes and asides, and plans the pictures, zooms and music.</p>
      </div>
    </>
  );
}
