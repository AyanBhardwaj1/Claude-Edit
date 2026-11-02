"use client";
import { useEffect } from "react";

/** Adds .in to every [data-reveal] as it scrolls into view (once). Without script, nothing is hidden (site.css keys on html.js). */
export function Reveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLElement>("[data-reveal]")];
    if (!("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    els.forEach((e) => io.observe(e));
    const late = new MutationObserver(() => document.querySelectorAll<HTMLElement>("[data-reveal]:not(.in)").forEach((e) => io.observe(e)));
    late.observe(document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); late.disconnect(); };
  }, []);
  return null;
}
