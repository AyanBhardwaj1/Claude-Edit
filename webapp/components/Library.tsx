"use client";
import { useEffect, useMemo, useState } from "react";
import { copyProject, deleteProject, listProjects } from "@/lib/store";
import type { Project } from "@/lib/types";
import { Icon } from "./Icons";
import { VideoTile } from "./Tiles";

type Filter = "all" | "ready" | "unfinished";

export function Library({ onOpen, onNew, onSample }: { onOpen: (p: Project) => void; onNew: () => void; onSample: () => void }) {
  const [ps, setPs] = useState<Project[] | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  useEffect(() => { void listProjects().then(setPs); }, []);
  const shown = useMemo(() => (ps ?? []).filter((p) => (filter === "all" || (filter === "ready") === (p.status === "edited"))
    && p.title.toLowerCase().includes(q.trim().toLowerCase())), [ps, q, filter]);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>My videos</h1><p>Everything you&apos;ve made in this browser. Hover a video to preview it.</p></div>
        <button className="btn primary" onClick={onNew}><Icon name="plus" />New video</button>
      </div>
      {ps && ps.length > 0 && (
        <div className="toolbar">
          <label className="sr-only" htmlFor="q">Search videos</label>
          <input id="q" className="input" type="search" placeholder="Search by title…" value={q} autoComplete="off" onChange={(e) => setQ(e.target.value)} />
          <div className="seg" role="group" aria-label="Show">
            {(["all", "ready", "unfinished"] as Filter[]).map((f) => (
              <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === "all" ? "All" : f === "ready" ? "Ready" : "Not finished"}</button>))}
          </div>
        </div>
      )}
      {!ps && <div className="tiles" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="skel tile-skel" />)}</div>}
      {ps && !ps.length && (
        <div className="empty">
          <h2>No videos yet</h2>
          <p>Drop in a raw take, fumbles and all. You get a cut, subtitles, a hook title, pictures, music, a cover and a caption, then change
            anything by typing a note.</p>
          <div className="row"><button className="btn primary" onClick={onNew}><Icon name="plus" />Make your first reel</button>
            <button className="btn" onClick={onSample}><Icon name="play" />Open the sample video</button></div>
        </div>
      )}
      {ps && ps.length > 0 && !shown.length && <p className="muted">Nothing matches &ldquo;{q}&rdquo;.</p>}
      <div className="tiles">
        {shown.map((p) => <VideoTile key={p.id} p={p} onOpen={() => onOpen(p)}
          onDelete={async () => { await deleteProject(p); setPs(await listProjects()); }}
          onCopy={async () => { await copyProject(p); setPs(await listProjects()); }} />)}
      </div>
    </div>
  );
}
