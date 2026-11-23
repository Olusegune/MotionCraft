import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "../ctx";
import { Sheet } from "../shell/Sheet";
import { Frame } from "../shell/Media";
import { PROVIDER_LABEL, priceText } from "../shell/ModelsSheet";
import { getApi, type GenJob, type ModelEntry, type ModelList, type ProviderId } from "../lib/api";
import { rankModels, rankProviders } from "../lib/models";
import { useSettings } from "../lib/settings";
import { FAMILIES } from "../lib/styles";
import { nowIso } from "../lib/project";
import type { AssetReference, Dimension, Intensity } from "../types";

/** Three deliberately different starting points. They are prompts you can edit, not a house style. */
const STARTS: { family: string; title: string; look: string }[] = [
  { family: "editorial-minimal", title: "Quiet and editorial", look: "restrained editorial style frame, generous negative space, refined serif type feeling, muted palette, calm and precise" },
  { family: "bold-kinetic", title: "Bold and kinetic", look: "bold kinetic typography style frame, heavy contrasty shapes, dense layout, saturated colour, energy and motion blur" },
  { family: "cinematic-title", title: "Cinematic", look: "cinematic title sequence style frame, shallow depth of field, dramatic light and shadow, slow and atmospheric" },
];
const DIMS: Dimension[] = ["typography", "motion", "composition"];

interface Card { key: string; family: string; title: string; prompt: string; job: GenJob | null; error: string | null; asset?: AssetReference }

/** Direction proposals with stills, made by an image provider you chose. Off until generative models are enabled; one confirmation covers the three stills. */
export function Proposals() {
  const { project, projectPath, update } = useApp();
  const { generative, offline, enginePath } = useSettings();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState<ProviderId | "">("");
  const [cards, setCards] = useState<Card[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const base = (project.intent.summary || project.brief.text).trim().slice(0, 300);
  useEffect(() => {
    setCards((cur) => STARTS.map((s) => cur.find((c) => c.family === s.family) ?? { key: s.family, family: s.family, title: s.title, prompt: `${base || "A motion graphics piece"}. ${s.look}. No text, no watermark.`, job: null, error: null }));
  }, [base]);

  const load = useCallback(async () => {
    try { const api = await getApi(); setModels(((await api.engine<ModelList>("models", {}, "", enginePath)) as Partial<ModelList>).models ?? []); setKeys(await api.keyStatus()); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  }, [enginePath]);
  useEffect(() => { void load(); }, [load, generative]);

  const usable = useMemo(() => models.filter((m) => m.media === "image" && keys[m.provider]), [models, keys]);
  const providers = useMemo(() => rankProviders(usable, keys), [usable, keys]);
  const choices = useMemo(() => rankModels(usable.filter((m) => m.provider === provider)), [usable, provider]);
  useEffect(() => { if (!providers.includes(provider as ProviderId)) setProvider(providers[0] ?? ""); }, [providers, provider]);
  useEffect(() => { if (!choices.some((m) => m.model === model)) setModel(choices[0]?.model ?? ""); }, [choices, model]);
  const picked = choices.find((m) => m.model === model);
  const running = cards.some((c) => c.job && (c.job.state === "running" || c.job.state === "queued"));
  const reason = !generative ? "Generative models are off. Turn them on in Settings." : offline ? "Offline mode is on." : !picked ? "Add an image provider key in Settings." : running ? "Stills are being made." : undefined;
  const each = picked?.price.known ? picked.price.value : null;

  // poll running jobs
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(async () => {
      const api = await getApi();
      setCards((cur) => cur);
      const next = await Promise.all(cards.map(async (c) => {
        if (!c.job || (c.job.state !== "running" && c.job.state !== "queued")) return c;
        try { return { ...c, job: await api.engine<GenJob>("generate_poll", { job: c.job.id }, "", enginePath) }; } catch (e) { return { ...c, error: String(e instanceof Error ? e.message : e) }; }
      }));
      setCards(next);
    }, 2000);
    return () => window.clearInterval(t);
  }, [running, cards, enginePath]);

  // finished stills become project assets with provenance
  useEffect(() => {
    for (const c of cards) {
      if (c.job?.state === "done" && c.job.asset && !c.asset) {
        const a = c.job.asset;
        const asset: AssetReference = { id: c.job.id, kind: a.kind, path: a.path, name: c.title, provenance: a.provenance };
        setCards((cur) => cur.map((x) => (x.key === c.key ? { ...x, asset } : x)));
        update((p) => ((p.assets ?? []).some((x) => x.id === asset.id) ? p : { ...p, assets: [...(p.assets ?? []), asset], updatedAt: nowIso() }));
      }
    }
  }, [cards, update]);

  const run = async () => {
    if (!picked) return;
    setErr(null); setConfirming(false);
    const api = await getApi();
    const started = await Promise.all(cards.map(async (c) => {
      try {
        const token = await api.confirmSpend(picked.provider, picked.model);     // one per still, all from the same confirmation click
        const job = await api.engine<GenJob>("generate_start", { provider: picked.provider, model: picked.model, prompt: c.prompt, params: {}, spend_token: token, generative_enabled: generative, offline }, projectPath, enginePath);
        return { ...c, job, error: null, asset: undefined };
      } catch (e) { return { ...c, job: null, error: String(e instanceof Error ? e.message : e) }; }
    }));
    setCards(started);
  };

  const use = (c: Card) => update((p) => {
    const dims = { ...p.style.dimensions };
    for (const d of DIMS) dims[d] = { familyId: c.family, intensity: "moderate" as Intensity };
    const mood = p.style.moodboard ?? [];
    return { ...p, style: { ...p.style, dimensions: dims, moodboard: c.asset && !mood.includes(c.asset.id) ? [...mood, c.asset.id] : mood }, updatedAt: nowIso() };
  });

  const label = (id: string) => FAMILIES.find((f) => f.id === id)?.label ?? id;
  return (
    <section aria-labelledby="prop-h" className="proposals">
      <h2 id="prop-h">Direction proposals</h2>
      <p className="muted">Three contrasting starting points, each with a still from your image provider. Edit a prompt, make the stills, then use the one that is closest. This is optional: you can build a direction yourself below.</p>
      <div className="row end">
        <label className="field"><span className="field-label">Provider</span>
          <select value={provider} disabled={!providers.length} onChange={(e) => setProvider(e.target.value as ProviderId)}>
            {providers.length === 0 ? <option value="">No provider key yet</option> : providers.map((p) => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}</select></label>
        <label className="field"><span className="field-label">Image model</span>
          <select value={model} disabled={!choices.length} onChange={(e) => setModel(e.target.value)}>
            {choices.length === 0 ? <option value="">No provider key yet</option> : choices.map((m) => <option key={`${m.provider}/${m.model}`} value={m.model}>{m.name}</option>)}</select></label>
        <button className="btn" disabled={!!reason} onClick={() => setConfirming(true)}><Sparkles size={16} aria-hidden="true" />Make 3 stills…</button>
      </div>
      {reason && <p className="why">{reason}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
      <ul className="proposal-cards">
        {cards.map((c) => (
          <li key={c.key} className="proposal-card">
            <Frame asset={c.asset} projectPath={projectPath} />
            <h3>{c.title}</h3>
            <p className="hint">{label(c.family)}</p>
            <label className="field"><span className="field-label">Prompt for {c.title}</span>
              <textarea rows={3} value={c.prompt} maxLength={1000} onChange={(e) => setCards((cur) => cur.map((x) => (x.key === c.key ? { ...x, prompt: e.target.value } : x)))} /></label>
            {c.job && c.job.state !== "done" && <p className="muted" role="status">{c.job.state === "failed" ? `Failed: ${c.job.error}` : `${c.job.detail}…`}</p>}
            {c.error && <p className="error-text" role="alert">{c.error}</p>}
            <button className="btn" disabled={!c.asset} onClick={() => use(c)}>Use this direction</button>
          </li>
        ))}
      </ul>
      {confirming && picked && (
        <Sheet title="Confirm spending" onClose={() => setConfirming(false)}
          footer={<><button className="btn" onClick={() => setConfirming(false)}>Cancel</button><button className="btn primary" onClick={() => void run()}>Confirm and make 3 stills</button></>}>
          <dl className="facts"><dt>Model</dt><dd>{picked.name}</dd><dt>Provider</dt><dd>{PROVIDER_LABEL[picked.provider]} ({picked.official ? "official API" : "aggregator"})</dd>
            <dt>Price</dt><dd>{each !== null ? `Estimate $${(each * 3).toFixed(3)} for 3 (${priceText(picked)})` : "Unknown. The provider has not published a price here."}</dd><dt>Charged to</dt><dd>Your {PROVIDER_LABEL[picked.provider]} account</dd></dl>
          <p className="muted">Nothing is sent until you confirm. This one confirmation covers these three stills only.</p>
        </Sheet>
      )}
    </section>
  );
}
