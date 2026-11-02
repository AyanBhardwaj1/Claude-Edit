"use client";
import { useEffect, useRef, useState } from "react";

/** A muted loop that respects reduced motion and can be paused (it runs longer than 5 seconds). */
export function LoopVideo({ src, poster, label }: { src: string; poster: string; label: string }) {
  const v = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!still) void v.current?.play().then(() => setOn(true)).catch(() => setOn(false));
  }, []);
  const toggle = () => { const el = v.current; if (!el) return; if (el.paused) { void el.play(); setOn(true); } else { el.pause(); setOn(false); } };
  return (
    <>
      <video ref={v} muted loop playsInline preload="metadata" poster={poster} width={1440} height={900} aria-label={label}>
        <source src={src} type="video/mp4" />
      </video>
      <button className="loop-btn" type="button" onClick={toggle} aria-label={on ? "Pause the video" : "Play the video"}>{on ? "Pause" : "Play"}</button>
    </>
  );
}
