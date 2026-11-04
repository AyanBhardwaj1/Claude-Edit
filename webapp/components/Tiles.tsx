"use client";
import { useEffect, useRef, useState } from "react";
import { getMedia } from "@/lib/store";
import type { Project } from "@/lib/types";
import { Icon } from "./Icons";

/** Seconds kept by the current version's cut (the length of the finished reel, before the gap cap). */
export function keptSeconds(p: Project): number {
  const v = p.versions.find((x) => x.n === p.current) ?? p.versions[p.versions.length - 1];
  if (!v) return 0;
  const at = new Map(p.words.map((w, i) => [w.id, i]));
  return v.edit.keep.reduce((sum, r) => {
    const a = p.words[at.get(r.from) ?? -1], b = p.words[at.get(r.to) ?? -1];
    return a && b ? sum + Math.max(0, b.e - a.s) : sum;
  }, 0);
}
export const rawSeconds = (p: Project) => p.sources.reduce((s, x) => s + (x.duration || 0), 0);

export function fmtDur(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;
export function ago(iso: string): string {
  const d = (Date.parse(iso) - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.35, "week"], [12, "month"], [Infinity, "year"]];
  let v = d;
  for (const [n, unit] of steps) { if (Math.abs(v) < n) return rtf ? rtf.format(Math.round(v), unit) : ""; v /= n; }
  return "";
}

function Thumb({ p }: { p: Project }) {
  const [url, setUrl] = useState<string | null>(null);
  const v = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let u: string | null = null, live = true;
    const key = p.sources[0]?.mediaKey;
    if (key) void getMedia(key).then((b) => { if (b && live) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => { live = false; if (u) URL.revokeObjectURL(u); };
  }, [p.sources]);
  const ready = p.status === "edited" && p.versions.length > 0;
  return (
    <div className="thumb" onMouseEnter={() => { if (v.current && !matchMedia("(prefers-reduced-motion: reduce)").matches) void v.current.play().catch(() => undefined); }}
      onMouseLeave={() => v.current?.pause()}>
      {url ? <video ref={v} src={`${url}#t=1`} muted playsInline loop preload="metadata" aria-hidden="true" tabIndex={-1} />
        : <span className="ph"><Icon name="film" /></span>}
      <span className={`badge ${ready ? "good" : ""}`}>{ready ? `Version ${p.current}` : "Not finished"}</span>
      {p.sample && <span className="badge sample">Sample</span>}
      {ready && <span className="len">{clock(keptSeconds(p))}</span>}
    </div>
  );
}

export function VideoTile({ p, onOpen, onDelete }: { p: Project; onOpen: () => void; onDelete?: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="tile-wrap">
      <button className="tile" onClick={onOpen} aria-label={`Open ${p.title}`}>
        <Thumb p={p} />
        <span>
          <span className="t trunc">{p.title}</span>
          <span className="m">{p.versions.length} version{p.versions.length === 1 ? "" : "s"} · {ago(p.updatedAt)}</span>
        </span>
      </button>
      {onDelete && <button className="btn icon sm more" aria-label={`Delete ${p.title}`} onClick={() => setAsking(true)}><Icon name="trash" /></button>}
      {asking && (
        <div className="confirm" role="alertdialog" aria-label={`Delete ${p.title}?`}>
          <b>Delete this video?</b>
          <p className="small muted">It and all its versions leave this browser for good.</p>
          <button className="btn danger sm" disabled={busy} autoFocus onClick={async () => { setBusy(true); await onDelete!(); }}>
            {busy ? "Deleting…" : "Delete"}</button>
          <button className="btn ghost sm" onClick={() => setAsking(false)}>Keep it</button>
        </div>
      )}
    </div>
  );
}
