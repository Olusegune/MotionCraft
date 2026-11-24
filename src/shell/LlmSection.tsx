import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { getApi, type KeyAccount } from "../lib/api";
import { updateSettings, useSettings } from "../lib/settings";

type Prov = { id: string; label: string; local: boolean; base_url: string; note: string };
type Status = { config: { provider: string | null; model: string; base_url: string }; ready: boolean; reason: string; providers: Prov[] };
const KEY_OF: Record<string, KeyAccount | undefined> = { openai: "openai", anthropic: "anthropic", gemini: "google", openrouter: "openrouter" };

/** The language model behind the Director, Builder and QA. None is a normal choice: everything works in Manual mode. */
export function LlmSection() {
  const { offline } = useSettings();
  const [st, setSt] = useState<Status | null>(null);
  const [prov, setProv] = useState("");
  const [model, setModel] = useState("");
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const api = await getApi();
      const s = (await api.engine("llm_status", { offline }, "", "")) as Status;
      updateSettings({ llmReady: s.ready }); setSt(s); setProv(s.config.provider ?? ""); setModel(s.config.model); setUrl(s.config.base_url);
      setKeys(await api.keyStatus());
    } catch { setSt(null); }
  }, [offline]);
  useEffect(() => { void load(); }, [load]);

  if (!st) return <section><h3>Language model</h3><p className="muted">Available in the desktop app. Everything works in Manual mode without one.</p></section>;
  const cur = st.providers.find((p) => p.id === prov);
  const account = KEY_OF[prov];

  const save = async () => {
    setMsg(null);
    try {
      const api = await getApi();
      if (account && key.trim()) { await api.setKey(account, key); setKey(""); }
      await api.engine("llm_set", prov ? { provider: prov, model, base_url: cur?.local ? url : "" } : { provider: null }, "", "");
      setMsg(prov ? `${cur?.label} chosen.` : "No language model: Manual mode."); await load();
    } catch (e) { setMsg(String(e instanceof Error ? e.message : e)); }
  };

  return (
    <section><h3>Language model</h3>
      <p className="muted">Powers the Director, Builder and QA when you choose Together or It does it. Optional: You do it needs none. Cloud models ask for your confirmation on each call; local ones (Ollama, LM Studio, Inkling) run on this computer, free.</p>
      <label className="field"><span className="field-label">Provider</span>
        <select value={prov} onChange={(e) => { setProv(e.target.value); setUrl(st.providers.find((p) => p.id === e.target.value)?.base_url ?? ""); }}>
          <option value="">None (Manual mode)</option>
          {st.providers.map((p) => <option key={p.id} value={p.id}>{p.label}{p.local ? " (this computer)" : ""}</option>)}
        </select></label>
      {cur && <label className="field"><span className="field-label">Model</span><input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model name" /></label>}
      {cur?.local && <label className="field"><span className="field-label">Server address</span><input value={url} onChange={(e) => setUrl(e.target.value)} />{cur.note && <span className="muted">{cur.note}</span>}</label>}
      {account && <label className="field"><span className="field-label">{cur?.label} API key <span className="badge"><KeyRound size={14} aria-hidden="true" />{keys[account] ? "Key set" : "No key"}</span></span>
        <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={keys[account] ? "Replace key" : "Paste key"} /></label>}
      <div className="row-actions"><button className="btn" disabled={!!prov && !model.trim()} onClick={() => void save()}>Save</button></div>
      {st.reason && <p className="why">{st.reason}</p>}
      {msg && <p className="muted" role="status">{msg}</p>}
    </section>
  );
}
