import { useEffect, useRef, useState } from "react";
import { AudioLines, Film, ImagePlus } from "lucide-react";
import type { AssetReference } from "../types";
import { getApi } from "../lib/api";
import { useApp } from "../ctx";
import { nowIso } from "../lib/project";
import { RIGHTS, setRights, type Rights } from "../lib/rights";

const cache = new Map<string, string>();

/** A picture asset as a data URL, cached. Only pictures under assets/images; videos and audio have no thumbnail yet. */
export function useAssetUrl(projectPath: string, asset: AssetReference | undefined): string | null {
  const key = asset ? `${projectPath}|${asset.path}` : "";
  const [url, setUrl] = useState<string | null>(key ? cache.get(key) ?? null : null);
  useEffect(() => {
    if (!asset || asset.kind !== "image") { setUrl(null); return; }
    const hit = cache.get(key);
    if (hit) { setUrl(hit); return; }
    let live = true;
    getApi().then((a) => a.assetDataUrl(projectPath, asset.path)).then((u) => { cache.set(key, u); if (live) setUrl(u); }).catch(() => undefined);
    return () => { live = false; };
  }, [asset, key, projectPath]);
  return url;
}

/** The address of a video file the web view can play, or null (not a desktop app, not under the allowed folder, or no file). A video shows its own first frames as the thumbnail. */
export function useVideoUrl(projectPath: string, asset: AssetReference | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!asset || asset.kind !== "video") return;
    let live = true;
    getApi().then((a) => a.fileUrl(projectPath, asset.path)).then((u) => { if (live) setUrl(u); }).catch(() => undefined);
    return () => { live = false; };
  }, [asset, projectPath]);
  return url;
}

export const assetLabel = (a: AssetReference) => a.name ?? a.provenance.prompt?.slice(0, 40) ?? a.path.split("/").pop() ?? a.path;

export function Frame({ asset, projectPath, ratio = "16 / 9", className = "" }: { asset?: AssetReference; projectPath: string; ratio?: string; className?: string }) {
  const url = useAssetUrl(projectPath, asset);
  const vurl = useVideoUrl(projectPath, asset);
  const [vfail, setVfail] = useState(false);
  useEffect(() => setVfail(false), [vurl]);
  return (
    <div className={`frame-slot ${className}`} style={{ aspectRatio: ratio }}>
      {asset?.check?.lettering && <span className="frame-flag" title={asset.check.text ? `Lettering found: ${asset.check.text}` : "Lettering found"}>Has lettering</span>}
      {asset && url ? <img src={url} alt={assetLabel(asset)} />
        : asset && vurl && !vfail ? <video className="frame-video" src={`${vurl}#t=0.5`} muted preload="metadata" playsInline tabIndex={-1} aria-label={`${assetLabel(asset)} (video)`} onError={() => setVfail(true)} />
        : asset ? <span className="frame-kind">{asset.kind === "video" ? <Film size={22} aria-hidden="true" /> : asset.kind === "audio" ? <AudioLines size={22} aria-hidden="true" /> : "…"}<span>{assetLabel(asset)}</span></span>
          : <span className="frame-kind muted"><ImagePlus size={22} aria-hidden="true" />No picture yet</span>}
    </div>
  );
}

/** What an import did, in plain words for a toast. Pure so it can be tested. */
export function importSummary(added: number, failures: string[]): string {
  const ok = added ? `Added ${added} file${added === 1 ? "" : "s"}.` : "";
  const bad = failures.length ? ` ${failures.length} not added: ${[...new Set(failures)].slice(0, 2).join("; ")}${new Set(failures).size > 2 ? "; and more" : ""}` : "";
  return `${ok}${bad}`.trim() || "Nothing to add.";
}

/** Import pictures, video or audio from disk into the project: from the file picker, or from paths dropped on the window. The shell checks each file's real type and copies it into assets/. */
export function useImportMedia() {
  const { projectPath, update } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const importPaths = async (paths: string[]): Promise<{ added: AssetReference[]; failures: string[] }> => {
    const api = await getApi();
    const added: AssetReference[] = [];
    const failures: string[] = [];
    setBusy(true);
    for (const src of paths.slice(0, 50)) {
      try {
        const r = await api.importAsset(projectPath, src);
        added.push({ id: `imp-${Math.random().toString(16).slice(2, 10)}`, kind: r.kind, path: r.path, name: r.name,
          provenance: { actor: "user", provider: "import", model: "file", at: nowIso(), licence: "Imported by you. Make sure you have the rights to use it.", costReported: false, costValue: null, costUnit: null } });
      } catch (e) { failures.push(String(e instanceof Error ? e.message : e)); }
    }
    if (added.length) update((p) => ({ ...p, assets: [...(p.assets ?? []), ...added], updatedAt: nowIso() }));
    setBusy(false);
    setError(failures.length ? importSummary(0, failures) : null);
    return { added, failures };
  };
  const run = async (): Promise<AssetReference[]> => {
    setError(null);
    const api = await getApi();
    let picked: string[] = [];
    try { picked = await api.pickMedia(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); return []; }
    if (!picked.length) return [];
    return (await importPaths(picked)).added;
  };
  return { run, importPaths, error, busy };
}

/** Drag files from the desktop onto the window to add them to the open project. Shows a drop target while files are over the window. */
export function DropZone({ onNotice, disabled }: { onNotice: (m: string) => void; disabled?: boolean }) {
  const { importPaths } = useImportMedia();
  const [over, setOver] = useState(false);
  const ref = useRef(importPaths);
  ref.current = importPaths;
  const note = useRef(onNotice);
  note.current = onNotice;
  useEffect(() => {
    if (disabled) return;
    let off: () => void = () => undefined;
    let dead = false;
    getApi().then((a) => a.onFilesDropped((e) => {
      if (e.type === "enter") setOver(true);
      else if (e.type === "leave") setOver(false);
      else { setOver(false); void ref.current(e.paths).then((r) => note.current(importSummary(r.added.length, r.failures))); }
    })).then((f) => { if (dead) f(); else off = f; }).catch(() => undefined);
    return () => { dead = true; off(); };
  }, [disabled]);
  if (!over) return null;
  return <div className="drop-overlay" role="status" aria-live="polite"><div className="drop-card"><ImagePlus size={28} aria-hidden="true" /><strong>Drop to add to this project</strong><span className="muted">Pictures, video and audio. They are copied into the project.</span></div></div>;
}

/** All media of the project as a wall of frames. `onPick` makes each one a button. */
export function MediaWall({ assets, selected, onPick, empty }: { assets: AssetReference[]; selected?: string[]; onPick?: (a: AssetReference) => void; empty: string }) {
  const { projectPath, update } = useApp();
  if (!assets.length) return <p className="empty-note">{empty}</p>;
  const rate = (id: string, r: string) => update((p) => ({ ...p, assets: (p.assets ?? []).map((x) => (x.id === id ? setRights(x, (r || undefined) as Rights | undefined) : x)), updatedAt: nowIso() }));
  return (
    <ul className="wall" aria-label="Media">
      {assets.map((a) => (
        <li key={a.id} className={selected?.includes(a.id) ? "on" : ""}>
          {onPick
            ? <button className="wall-item" aria-pressed={selected?.includes(a.id)} onClick={() => onPick(a)}><Frame asset={a} projectPath={projectPath} /><span className="wall-label">{assetLabel(a)}</span></button>
            : <div className="wall-item"><Frame asset={a} projectPath={projectPath} /><span className="wall-label">{assetLabel(a)}</span></div>}
          {a.provenance.provider === "import" && (
            <label className="wall-rights"><span className="visually-hidden">Rights for {assetLabel(a)}</span>
              <select value={a.rights ?? ""} onChange={(e) => rate(a.id, e.target.value)}>
                <option value="">Rights: not confirmed</option>
                {RIGHTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select></label>)}
        </li>
      ))}
    </ul>
  );
}
