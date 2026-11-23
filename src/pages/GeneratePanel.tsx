import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { useApp } from "../ctx";
import { Sheet } from "../shell/Sheet";
import { PROVIDER_LABEL, priceText } from "../shell/ModelsSheet";
import { getApi, type GenJob, type ModelEntry, type ModelList, type ProviderId } from "../lib/api";
import { rankModels, rankProviders } from "../lib/models";
import { useSettings } from "../lib/settings";
import { Frame } from "../shell/Media";

/** Generate pictures and video from a prompt. Off until enabled in Settings; every call goes through the spend sheet. */
export function GeneratePanel() {
  const { project, projectPath, update, showSettings } = useApp();
  const { generative, offline, enginePath } = useSettings();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [kind, setKind] = useState<"image" | "video">("image");
  const [provider, setProvider] = useState<ProviderId | "">("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [job, setJob] = useState<GenJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const savedJob = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const api = await getApi();
      setModels(((await api.engine<ModelList>("models", {}, "", enginePath)) as Partial<ModelList>).models ?? []);
      setKeys(await api.keyStatus());
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  }, [enginePath]);
  useEffect(() => { void load(); }, [load, generative]);

  const providers = useMemo(() => rankProviders(models.filter((m) => m.media === kind), keys), [models, kind, keys]);
  const choices = useMemo(() => rankModels(models.filter((m) => m.media === kind && m.provider === provider)), [models, kind, provider]);
  useEffect(() => { if (!providers.includes(provider as ProviderId)) setProvider(providers[0] ?? ""); }, [providers, provider]);
  useEffect(() => { if (!choices.some((m) => m.model === model)) setModel(choices[0]?.model ?? ""); }, [choices, model]);
  const picked = choices.find((m) => m.model === model);

  const reason = !generative ? "Generative models are off. Turn them on in Settings." : offline ? "Offline mode is on." : !provider ? "No model available."
    : !keys[provider] ? `Add your ${PROVIDER_LABEL[provider]} key in Settings.` : !prompt.trim() ? "Describe what to make." : job && (job.state === "running" || job.state === "queued") ? "A generation is running." : undefined;

  // Poll the running job; when it finishes, record the asset with its provenance.
  useEffect(() => {
    if (!job || (job.state !== "running" && job.state !== "queued")) return;
    const t = window.setInterval(async () => {
      try { setJob(await (await getApi()).engine<GenJob>("generate_poll", { job: job.id }, "", enginePath)); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    }, 2000);
    return () => window.clearInterval(t);
  }, [job, enginePath]);
  useEffect(() => {
    if (job?.state === "done" && job.asset && savedJob.current !== job.id) {
      savedJob.current = job.id;
      const a = job.asset;
      update((p) => ({ ...p, assets: [...(p.assets ?? []), { id: job.id, kind: a.kind, path: a.path, provenance: a.provenance }], updatedAt: new Date().toISOString() }));
    }
  }, [job, update]);

  const run = async () => {
    if (!picked || !provider) return;
    setErr(null);
    try {
      const api = await getApi();
      const token = await api.confirmSpend(provider, picked.model);     // only reachable from the confirm click below
      setJob(await api.engine<GenJob>("generate_start", { provider, model: picked.model, prompt: prompt.trim(), params: {}, spend_token: token, generative_enabled: generative, offline }, projectPath, enginePath));
      setConfirming(false);
    } catch (e) { setConfirming(false); setErr(String(e instanceof Error ? e.message : e)); }
  };

  return (
    <div className="stack">
      <p className="muted">Make pictures or video from a prompt. Results are saved in the project with the model, prompt, cost and licence note.</p>
      <div className="row">
        <label className="field"><span className="field-label">Type</span><select value={kind} onChange={(e) => setKind(e.target.value as "image" | "video")}><option value="image">Image</option><option value="video">Video</option></select></label>
        <label className="field"><span className="field-label">Provider</span><select value={provider} onChange={(e) => setProvider(e.target.value as ProviderId)}>{providers.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}</select></label>
      </div>
      <label className="field"><span className="field-label">Model</span><select value={model} onChange={(e) => setModel(e.target.value)}>{choices.map((m) => <option key={m.model} value={m.model}>{m.name}</option>)}</select></label>
      {picked && <p className="hint">{picked.official ? "Official API" : "Aggregator"} · {priceText(picked)}</p>}
      <label className="field"><span className="field-label">Prompt</span><textarea rows={3} value={prompt} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} placeholder="What should it show?" /></label>
      <button className="btn" disabled={!!reason} onClick={() => setConfirming(true)}><Sparkles size={16} aria-hidden="true" />Generate…</button>
      {reason && <p className="why">{reason} {!generative && <button className="btn quiet" onClick={showSettings}>Open Settings</button>}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
      {job && (
        <div className="job" role="status">
          <span className="strong">{job.state === "done" ? "Done" : job.state === "failed" ? "Failed" : job.state === "cancelled" ? "Stopped" : "Generating…"}</span>
          <span className="muted"> {PROVIDER_LABEL[job.provider]} · {Math.round(job.elapsed)} s · {job.detail}</span>
          {job.error && <p className="error-text">{job.error}</p>}
          {(job.state === "running" || job.state === "queued") && <button className="btn" onClick={async () => setJob(await (await getApi()).engine<GenJob>("generate_cancel", { job: job.id }, "", enginePath))}><X size={16} aria-hidden="true" />Stop</button>}
        </div>
      )}
      <ul className="assets" aria-label="Generated assets">
        {(project.assets ?? []).map((a) => (
          <li key={a.id}><Frame asset={a} projectPath={projectPath} ratio="1 / 1" className="thumb" />
            <div><span className="strong">{a.provenance.model}</span> <span className="muted">{PROVIDER_LABEL[a.provenance.provider]}</span>
              <p className="muted">{a.provenance.costValue !== null ? `${a.provenance.costReported ? "Reported" : "Estimate"} ${a.provenance.costValue} ${a.provenance.costUnit ?? ""}` : "Cost unknown"} · <span className="mono">{a.path}</span></p>
              <p className="hint">{a.provenance.licence}</p></div></li>
        ))}
      </ul>
      {confirming && picked && provider && (
        <Sheet title="Confirm spending" onClose={() => setConfirming(false)}
          footer={<><button className="btn" onClick={() => setConfirming(false)}>Cancel</button><button className="btn primary" onClick={() => void run()}>Confirm and generate</button></>}>
          <dl className="facts"><dt>Model</dt><dd>{picked.name}</dd><dt>Provider</dt><dd>{PROVIDER_LABEL[provider]} ({picked.official ? "official API" : "aggregator"})</dd>
            <dt>Price</dt><dd>{picked.price.known ? priceText(picked) : "Unknown. The provider has not published a price here."}</dd><dt>Charged to</dt><dd>Your {PROVIDER_LABEL[provider]} account</dd></dl>
          <p className="muted">Nothing is sent until you confirm. This confirmation works once. Stopping a job may not stop the provider billing it.</p>
        </Sheet>
      )}
    </div>
  );
}
