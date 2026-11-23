import { useCallback, useEffect, useMemo, useState } from "react";
import { RotateCcw, Search } from "lucide-react";
import { Sheet } from "./Sheet";
import { getApi, type ModelEntry, type ModelList } from "../lib/api";
import { useSettings } from "../lib/settings";

export const PROVIDER_LABEL: Record<string, string> = { byteplus: "BytePlus", google: "Google", openai: "OpenAI", kie: "Kie.ai", fal: "fal" };

export function priceText(m: ModelEntry): string {
  return m.price.known && m.price.value !== null ? `Estimate $${m.price.value.toFixed(3)} per output` : "Price unknown";
}

/** Every image and video model the app knows, by provider. Listing a model never calls a paid API. */
export function ModelsSheet({ onClose }: { onClose: () => void }) {
  const { enginePath, offline } = useSettings();
  const [list, setList] = useState<ModelList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [media, setMedia] = useState<"all" | "image" | "video">("all");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await (await getApi()).engine<ModelList>("models", {}, "", enginePath); setList(Array.isArray(r?.models) ? r : null); setErr(null); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  }, [enginePath]);
  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setBusy(true); setNote(null);
    try {
      const r = await (await getApi()).engine<ModelList & { results: Record<string, { ok: boolean; models?: number; error?: string }> }>("models_refresh", { offline }, "", enginePath);
      setList(r);
      setNote(Object.entries(r.results).map(([p, x]) => `${PROVIDER_LABEL[p] ?? p}: ${x.ok ? `${x.models} models` : x.error}`).join(" · "));
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    setBusy(false);
  };

  const rows = useMemo(() => (list?.models ?? []).filter((m) => (media === "all" || m.media === media) &&
    `${m.name} ${m.model} ${m.provider}`.toLowerCase().includes(q.trim().toLowerCase())), [list, q, media]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const m of list?.models ?? []) c[m.provider] = (c[m.provider] ?? 0) + 1; return c; }, [list]);

  return (
    <Sheet title="Image and video models" onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <p className="muted">Every model comes from a provider you turn on in Settings. Aggregators (Kie.ai, fal) are opt-in; official providers are BytePlus, Google and OpenAI. Nothing here is called until you confirm a spend.</p>
      <div className="row end">
        <label className="field grow"><span className="field-label">Search</span><span className="search"><Search size={16} aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Model or provider" /></span></label>
        <label className="field"><span className="field-label">Type</span><select value={media} onChange={(e) => setMedia(e.target.value as "all" | "image" | "video")}><option value="all">Images and video</option><option value="image">Images</option><option value="video">Video</option></select></label>
        <button className="btn" disabled={busy || offline} onClick={() => void refresh()}><RotateCcw size={16} aria-hidden="true" />Refresh lists</button>
      </div>
      {offline && <p className="why">Offline mode is on, so lists cannot be refreshed.</p>}
      {note && <p className="muted" role="status">{note}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
      {list && <p className="muted" role="status">{rows.length} of {list.models.length} models. {Object.entries(counts).map(([p, n]) => `${PROVIDER_LABEL[p]} ${n}`).join(", ")}.</p>}
      <ul className="model-list" aria-label="Models">
        {rows.slice(0, 400).map((m) => (
          <li key={`${m.provider}/${m.model}`}>
            <span className="strong">{m.name}</span>
            <span className="badge">{PROVIDER_LABEL[m.provider]}</span>
            <span className="badge">{m.media === "image" ? "Image" : "Video"}</span>
            <span className="badge">{m.official ? "Official API" : "Aggregator"}</span>
            {!m.listed && <span className="badge warn">Not listed any more</span>}
            <span className="muted">{priceText(m)}</span>
            <span className="mono muted model-id">{m.model}</span>
          </li>
        ))}
      </ul>
      {rows.length > 400 && <p className="muted">Showing the first 400. Narrow the search to see the rest.</p>}
    </Sheet>
  );
}
