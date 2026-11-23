import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { getApi, type ProviderId } from "../lib/api";
import { updateSettings, useSettings } from "../lib/settings";
import { Segmented } from "./Segmented";
import { PROVIDER_LABEL } from "./ModelsSheet";

const ORDER: { id: ProviderId; note: string }[] = [
  { id: "byteplus", note: "Official: Seedream" }, { id: "google", note: "Official: Veo, Nano Banana" }, { id: "openai", note: "Official: GPT Image" },
  { id: "kie", note: "Aggregator: many image and video models" }, { id: "fal", note: "Aggregator: many image and video models" },
];

/** Keys go straight to the operating system credential store. The page never gets them back, only whether one is set. */
export function ProvidersSection({ onModels }: { onModels: () => void }) {
  const { generative, offline } = useSettings();
  const [status, setStatus] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => { try { setStatus(await (await getApi()).keyStatus()); } catch { /* desktop only */ } }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (p: ProviderId) => {
    setMsg(null);
    try { await (await getApi()).setKey(p, drafts[p] ?? ""); setDrafts((d) => ({ ...d, [p]: "" })); setMsg(`${PROVIDER_LABEL[p]} key saved to the credential store.`); await load(); }
    catch (e) { setMsg(String(e instanceof Error ? e.message : e)); }
  };
  const remove = async (p: ProviderId) => { await (await getApi()).deleteKey(p); setMsg(`${PROVIDER_LABEL[p]} key removed.`); await load(); };

  return (
    <section><h3>Image and video providers</h3>
      <p className="muted">Generative models are off until you turn them on. Every paid call asks for your confirmation and shows its price, or says Unknown. Offline mode blocks all of them.</p>
      <div className="row-actions">
        <Segmented label="Generative models" value={generative ? "on" : "off"} onChange={(v) => updateSettings({ generative: v === "on" })} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} />
        <button className="btn" onClick={onModels}>Browse models</button>
      </div>
      {offline && <p className="why">Offline mode is on: cloud providers are disabled.</p>}
      <ul className="providers">
        {ORDER.map(({ id, note }) => (
          <li key={id}>
            <div><span className="strong">{PROVIDER_LABEL[id]}</span> <span className="badge"><KeyRound size={14} aria-hidden="true" />{status[id] ? "Key set" : "No key"}</span><br /><span className="muted">{note}</span></div>
            <input type="password" autoComplete="off" aria-label={`${PROVIDER_LABEL[id]} API key`} placeholder={status[id] ? "Replace key" : "Paste key"} value={drafts[id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [id]: e.target.value }))} />
            <button className="btn" disabled={!(drafts[id] ?? "").trim()} onClick={() => void save(id)}>Save</button>
            <button className="btn quiet" disabled={!status[id]} onClick={() => void remove(id)}>Remove</button>
          </li>
        ))}
      </ul>
      {msg && <p className="muted" role="status">{msg}</p>}
    </section>
  );
}
