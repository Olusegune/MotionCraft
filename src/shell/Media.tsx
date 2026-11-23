import { useEffect, useState } from "react";
import { AudioLines, Film, ImagePlus } from "lucide-react";
import type { AssetReference } from "../types";
import { getApi } from "../lib/api";
import { useApp } from "../ctx";
import { nowIso } from "../lib/project";

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

export const assetLabel = (a: AssetReference) => a.name ?? a.provenance.prompt?.slice(0, 40) ?? a.path.split("/").pop() ?? a.path;

export function Frame({ asset, projectPath, ratio = "16 / 9", className = "" }: { asset?: AssetReference; projectPath: string; ratio?: string; className?: string }) {
  const url = useAssetUrl(projectPath, asset);
  return (
    <div className={`frame-slot ${className}`} style={{ aspectRatio: ratio }}>
      {asset && url ? <img src={url} alt={assetLabel(asset)} />
        : asset ? <span className="frame-kind">{asset.kind === "video" ? <Film size={22} aria-hidden="true" /> : asset.kind === "audio" ? <AudioLines size={22} aria-hidden="true" /> : "…"}<span>{assetLabel(asset)}</span></span>
          : <span className="frame-kind muted"><ImagePlus size={22} aria-hidden="true" />No picture yet</span>}
    </div>
  );
}

/** Import pictures, video or audio from disk into the project (File picker, then the shell copies them into assets/). */
export function useImportMedia() {
  const { projectPath, update } = useApp();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (): Promise<AssetReference[]> => {
    setError(null);
    const api = await getApi();
    let picked: string[] = [];
    try { picked = await api.pickMedia(); } catch (e) { setError(String(e instanceof Error ? e.message : e)); return []; }
    if (!picked.length) return [];
    setBusy(true);
    const added: AssetReference[] = [];
    for (const src of picked) {
      try {
        const r = await api.importAsset(projectPath, src);
        added.push({ id: `imp-${Math.random().toString(16).slice(2, 10)}`, kind: r.kind, path: r.path, name: r.name,
          provenance: { actor: "user", provider: "import", model: "file", at: nowIso(), licence: "Imported by you. Make sure you have the rights to use it.", costReported: false, costValue: null, costUnit: null } });
      } catch (e) { setError(String(e instanceof Error ? e.message : e)); }
    }
    if (added.length) update((p) => ({ ...p, assets: [...(p.assets ?? []), ...added], updatedAt: nowIso() }));
    setBusy(false);
    return added;
  };
  return { run, error, busy };
}

/** All media of the project as a wall of frames. `onPick` makes each one a button. */
export function MediaWall({ assets, selected, onPick, empty }: { assets: AssetReference[]; selected?: string[]; onPick?: (a: AssetReference) => void; empty: string }) {
  const { projectPath } = useApp();
  if (!assets.length) return <p className="empty-note">{empty}</p>;
  return (
    <ul className="wall" aria-label="Media">
      {assets.map((a) => (
        <li key={a.id} className={selected?.includes(a.id) ? "on" : ""}>
          {onPick
            ? <button className="wall-item" aria-pressed={selected?.includes(a.id)} onClick={() => onPick(a)}><Frame asset={a} projectPath={projectPath} /><span className="wall-label">{assetLabel(a)}</span></button>
            : <div className="wall-item"><Frame asset={a} projectPath={projectPath} /><span className="wall-label">{assetLabel(a)}</span></div>}
        </li>
      ))}
    </ul>
  );
}
