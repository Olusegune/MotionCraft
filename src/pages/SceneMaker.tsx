import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "../ctx";
import { Sheet } from "../shell/Sheet";
import { PROVIDER_LABEL, priceText } from "../shell/ModelsSheet";
import { capBlock, recordSpend } from "../lib/spend";
import { getApi, type GenJob, type ModelEntry, type ModelList } from "../lib/api";
import { rankModels, rankProviders } from "../lib/models";
import { useSettings } from "../lib/settings";
import { familyLabel } from "../lib/styles";
import { NO_LETTERING } from "./Proposals";
import type { Beat, MotionProject } from "../types";

/** The prompt for one scene's picture, from what the project already says about it: the look, the scene's own plan and the intent. Never asks for words. */
export function scenePrompt(p: MotionProject, b: Beat): string {
  const fam = p.style.dimensions.composition?.familyId ?? p.style.dimensions.typography?.familyId;
  const look = fam ? `${familyLabel(fam).toLowerCase()} look` : "restrained, precise look";
  const plan = (p.treatment[b.beatId]?.plan ?? "").replace(/\(\d+(\.\d+)? seconds\):/, ":").trim();
  const mood = (p.intent.summary || p.brief.text).trim().slice(0, 220);
  return `${NO_LETTERING} ${look}, 16:9 film still with generous negative space. Scene: ${b.primary}. ${plan} Mood: ${mood}`.slice(0, 900);
}

/** One button on a scene card: make a picture for that scene with the best image model that has a key. One confirmation, one picture, then it is the scene's frame. */
export function MakePicture({ beat, disabled }: { beat: Beat; disabled?: boolean }) {
  const { project, projectPath, update } = useApp();
  const { generative, offline, enginePath } = useSettings();
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [confirming, setConfirming] = useState(false);
  const [job, setJob] = useState<GenJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const saved = useRef<string | null>(null);

  const load = useCallback(async () => {
    try { const api = await getApi(); setModels(((await api.engine<ModelList>("models", {}, "", enginePath)) as Partial<ModelList>).models ?? []); setKeys(await api.keyStatus()); }
    catch { /* no models to offer: the button explains */ }
  }, [enginePath]);
  useEffect(() => { void load(); }, [load, generative]);

  const usable = useMemo(() => models.filter((m) => m.media === "image" && keys[m.provider]), [models, keys]);
  const provider = useMemo(() => rankProviders(usable, keys)[0], [usable, keys]);
  const picked = useMemo(() => rankModels(usable.filter((m) => m.provider === provider))[0], [usable, provider]);
  const each = picked?.price.known ? picked.price.value : null;
  const running = !!job && (job.state === "running" || job.state === "queued");
  const prompt = useMemo(() => scenePrompt(project, beat), [project, beat]);
  const reason = disabled ? "Unlock the treatment first." : !generative ? "Turn on image providers in Settings." : offline ? "Offline mode is on." : !picked ? "Add an image provider key in Settings." : capBlock(project, each) ?? (running ? "Making the picture…" : undefined);

  useEffect(() => {
    if (!running || !job) return;
    const t = window.setInterval(async () => { try { setJob(await (await getApi()).engine<GenJob>("generate_poll", { job: job.id }, "", enginePath)); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } }, 2000);
    return () => window.clearInterval(t);
  }, [running, job, enginePath]);
  useEffect(() => {
    if (job?.state === "done" && job.asset && saved.current !== job.id) {
      saved.current = job.id;
      const a = job.asset;
      update((p) => ({
        ...p, assets: [...(p.assets ?? []), { id: job.id, kind: a.kind, path: a.path, name: beat.primary, provenance: a.provenance }],
        treatment: { ...p.treatment, [beat.beatId]: { ...(p.treatment[beat.beatId] ?? { plan: "", motion: "" }), frameAssetId: job.id } }, updatedAt: new Date().toISOString(),
      }));
    }
  }, [job, update, beat]);

  const run = async () => {
    if (!picked) return;
    setErr(null); setConfirming(false);
    try {
      const api = await getApi();
      const token = await api.confirmSpend(picked.provider, picked.model);     // only reachable from the confirm click
      setJob(await api.engine<GenJob>("generate_start", { provider: picked.provider, model: picked.model, prompt, params: { aspect_ratio: project.brief.deliverables[0].aspect }, spend_token: token, generative_enabled: generative, offline }, projectPath, enginePath));
      update((p) => recordSpend(p, { provider: picked.provider, model: picked.model, what: "still", usd: each }));
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };

  return (
    <div className="make-picture">
      <button className="btn" disabled={!!reason} title={reason} onClick={() => setConfirming(true)}><Sparkles size={16} aria-hidden="true" />{running ? "Making…" : "Make picture"}</button>
      {err && <p className="error-text" role="alert">{err}</p>}
      {confirming && picked && (
        <Sheet title="Confirm spending" onClose={() => setConfirming(false)}
          footer={<><button className="btn" onClick={() => setConfirming(false)}>Cancel</button><button className="btn primary" onClick={() => void run()}>Confirm and make the picture</button></>}>
          <dl className="facts"><dt>Scene</dt><dd>{beat.primary}</dd><dt>Model</dt><dd>{picked.name}</dd><dt>Provider</dt><dd>{PROVIDER_LABEL[picked.provider]} ({picked.official ? "official API" : "aggregator"})</dd>
            <dt>Price</dt><dd>{each !== null ? `Estimate $${each.toFixed(3)} (${priceText(picked)})` : "Unknown. The provider has not published a price here."}</dd><dt>Charged to</dt><dd>Your {PROVIDER_LABEL[picked.provider]} account</dd></dl>
          <p className="muted">The picture is made from this scene's plan and your look, with no lettering asked for. Nothing is sent until you confirm; this covers this one picture.</p>
        </Sheet>
      )}
    </div>
  );
}
