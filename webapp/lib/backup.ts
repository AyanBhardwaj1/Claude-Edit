/** Back up and restore this account's videos: one .cutmind file (a plain ZIP) with the projects, their media,
 *  Motion Studio animations and the style rules. Everything lives in this browser, so clearing site data or
 *  switching browsers loses it: this file is the way to keep and move it. API keys are never in a backup. */
import { currentOwner, getAnim, getMedia, listAnims, listProjects, loadProject, loadRules, mediaKeys, putAnimRaw, putMedia,
  putProjectRaw, saveRules } from "./store";
import type { Anim } from "./studio";
import type { Project, StyleRule } from "./types";
import { unzip, zip } from "./zip";

type Manifest = { app: "cutmind"; version: 1; exportedAt: string; projects: Project[]; anims: Anim[]; rules: StyleRule[];
  media: { key: string; file: string; type: string }[] };

export type BackupStats = { projects: number; anims: number; media: number; rules: number; skipped: number };

export async function makeBackup(onProgress?: (msg: string) => void): Promise<{ blob: Blob; stats: BackupStats }> {
  const projects = await listProjects(), anims = await listAnims(), rules = loadRules();
  const refs = JSON.stringify([projects, anims]);
  const used = (await mediaKeys()).filter((k) => refs.includes(JSON.stringify(k)));
  const media: Manifest["media"] = [], files: { name: string; data: Blob }[] = [];
  for (const [i, key] of used.entries()) {
    const b = await getMedia(key);
    if (!b) continue;
    media.push({ key, file: `media/${i}`, type: b.type });
    files.push({ name: `media/${i}`, data: b });
  }
  const manifest: Manifest = { app: "cutmind", version: 1, exportedAt: new Date().toISOString(), projects, anims, rules, media };
  files.unshift({ name: "manifest.json", data: new Blob([JSON.stringify(manifest)], { type: "application/json" }) });
  const blob = await zip(files, (n) => onProgress?.(`Packing ${n} of ${files.length}`));
  return { blob, stats: { projects: projects.length, anims: anims.length, media: media.length, rules: rules.length, skipped: 0 } };
}

/** Put a backup back. A video already here is kept if it was changed more recently than the backup's copy. */
export async function restoreBackup(file: Blob, onProgress?: (msg: string) => void): Promise<BackupStats> {
  const files = await unzip(file);
  const mf = files.get("manifest.json");
  if (!mf) throw new Error("Not a Cutmind backup");
  const m = JSON.parse(await mf.text()) as Manifest;
  if (m.app !== "cutmind" || m.version !== 1) throw new Error("Not a Cutmind backup");
  for (const [i, x] of m.media.entries()) {
    const b = files.get(x.file);
    if (!b) continue;
    onProgress?.(`Restoring media ${i + 1} of ${m.media.length}`);
    await putMedia(x.key, new Blob([b], { type: x.type }));
  }
  let projects = 0, anims = 0, skipped = 0;
  const me = currentOwner();
  // Same id here already: ours and newer -> keep ours; ours and older -> replace. Someone else's (another account in
  // this browser, or shared from before accounts) -> never take it over: restore the backup's as a copy.
  const mine = (x?: { owner?: string }) => !!x && (me ? x.owner === me : !x.owner);
  const copyId = (id: string) => `${id}-restored-${Math.random().toString(36).slice(2, 7)}`;
  for (const p of m.projects) {
    const here = await loadProject(p.id);
    if (here && mine(here) && here.updatedAt > p.updatedAt) { skipped++; continue; }
    await putProjectRaw(here && !mine(here) ? { ...p, id: copyId(p.id) } : p); projects++;
  }
  for (const a of m.anims) {
    const here = await getAnim(a.id);
    if (here && mine(here) && here.updatedAt > a.updatedAt) { skipped++; continue; }
    await putAnimRaw(here && !mine(here) ? { ...a, id: copyId(a.id) } : a); anims++;
  }
  const have = loadRules(), known = new Set(have.map((r) => r.text.toLowerCase()));
  const fresh = m.rules.filter((r) => !known.has(r.text.toLowerCase()));
  if (fresh.length) saveRules([...have, ...fresh]);
  return { projects, anims, media: m.media.length, rules: fresh.length, skipped };
}
