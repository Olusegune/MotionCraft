import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard } from "lucide-react";
import { useApp } from "../ctx";
import { Sheet } from "../shell/Sheet";
import { PROVIDER_LABEL, priceText } from "../shell/ModelsSheet";
import { Frame } from "../shell/Media";
import { capBlock, recordSpend } from "../lib/spend";
import { getApi, type GenJob, type ModelEntry, type ModelList } from "../lib/api";
import { useSettings } from "../lib/settings";
import { CAMERA_MOVES, defaultAnimate, fitToModel, modelParams, videoAspect, videoLimits, videoPrompt, type AnimateSettings } from "../lib/videoPrompt";
import type { Beat } from "../types";

/** Models that can start from a picture and whose key is set, official ones first. */
export function animateChoices(models: ModelEntry[], keys: Record<string, boolean>): ModelEntry[] {
  return models.filter((m) => m.media === "video" && m.imageInput && m.listed !== false && keys[m.provider])
    .sort((a, b) => Number(b.official) - Number(a.official) || Number(/fast|lite/i.test(b.model)) - Number(/fast|lite/i.test(a.model)) || a.name.localeCompare(b.name));
}

/**
 * "Animate": turn a scene's picture into a real video clip with a video model. The person sees and edits the camera, the acting, the emotion, the sound and the
 * whole prompt, chooses the model, sees the price (or that there is none published), and confirms. The clip becomes the scene's frame; the still is kept.
 */
export function AnimateScene({ beat, disabled }: { beat: Beat; disabled?: boolean }) {
  const { project, projectPath, update } = useApp();
  const { generative, offline, enginePath } = useSettings();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [s, setS] = useState<AnimateSettings>(() => defaultAnimate(project, beat));
  const [modelKey, setModelKey] = useState("");
  const [handWritten, setHandWritten] = useState(false);
  const [job, setJob] = useState<GenJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const saved = useRef<string | null>(null);

  const t = project.treatment[beat.beatId];
  // The still to animate: the one remembered from an earlier clip, otherwise the scene's picture.
  const still = (project.assets ?? []).find((a) => a.kind === "image" && a.id === (t?.stillAssetId ?? t?.frameAssetId));
  const clip = (project.assets ?? []).find((a) => a.kind === "video" && a.id === t?.frameAssetId);

  const load = useCallback(async () => {
    try {
      const api = await getApi();
      let list = (await api.engine<ModelList>("models", {}, "", enginePath)) as Partial<ModelList>;
      const k = await api.keyStatus();
      setKeys(k);
      // Google's built-in video names are a guess. Ask Google which ones this key can start (free), once, before offering any.
      if (k.google && !offline && (list.status?.google?.refreshed ?? null) === null) {
        try { await api.engine("models_refresh", { offline }, "", enginePath); list = (await api.engine<ModelList>("models", {}, "", enginePath)) as Partial<ModelList>; }
        catch { /* the built-in list stays; a wrong name answers 404 and costs nothing */ }
      }
      setModels(list.models ?? []);
    } catch { /* nothing to offer: the button explains */ }
  }, [enginePath, offline]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const [find, setFind] = useState("");
  const allChoices = useMemo(() => animateChoices(models, keys), [models, keys]);
  const choices = useMemo(() => { const q = find.trim().toLowerCase(); return q ? allChoices.filter((m) => `${m.name} ${m.model} ${m.provider}`.toLowerCase().includes(q)) : allChoices; }, [allChoices, find]);
  const picked = choices.find((m) => `${m.provider}/${m.model}` === modelKey) ?? choices.find((m) => `${m.provider}/${m.model}` === s.model) ?? choices[0];
  const limits = picked ? videoLimits(picked.model) : { durations: [8], resolutions: ["720p" as const] };
  const eff = picked ? fitToModel(s, picked.model) : s;
  const prompt = videoPrompt(project, beat, eff);
  const each = picked?.price.known ? picked.price.value : null;
  const running = !!job && (job.state === "running" || job.state === "queued");
  const reason = disabled ? "Unlock the treatment first." : !generative ? "Turn on image and video providers in Settings." : offline ? "Offline mode is on."
    : !still ? "This scene needs a picture first." : undefined;
  const confirmBlock = !picked ? "Add a video provider key in Settings (Google's Veo can start from a picture)." : capBlock(project, each) ?? undefined;
  const set = (patch: Partial<AnimateSettings>) => setS((x) => ({ ...x, ...patch }));

  useEffect(() => {
    if (!running || !job) return;
    const timer = window.setInterval(async () => { try { setJob(await (await getApi()).engine<GenJob>("generate_poll", { job: job.id }, "", enginePath)); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } }, 4000);
    return () => window.clearInterval(timer);
  }, [running, job, enginePath]);

  useEffect(() => {
    if (job?.state !== "done" || !job.asset || saved.current === job.id || !still) return;
    saved.current = job.id;
    const a = job.asset;
    update((p) => ({
      ...p, assets: [...(p.assets ?? []), { id: job.id, kind: "video", path: a.path, name: `${beat.primary} (clip)`, provenance: a.provenance }],
      treatment: { ...p.treatment, [beat.beatId]: { ...(p.treatment[beat.beatId] ?? { plan: "", motion: "" }), frameAssetId: job.id, stillAssetId: still.id, frameLoop: false, animate: { ...eff, model: modelKey || `${picked?.provider}/${picked?.model}` } } },
      updatedAt: new Date().toISOString(),
    }));
    setOpen(false);
  }, [job, update, beat, still, eff, modelKey, picked]);

  const run = async () => {
    if (!picked || !still) return;
    setErr(null);
    try {
      const api = await getApi();
      const token = await api.confirmSpend(picked.provider, picked.model);      // only reachable from the confirm click
      const params: Record<string, string | number | boolean> = { image: still.path, ...modelParams(picked.provider, picked.model, eff, videoAspect(project.brief.deliverables[0].aspect)) };
      setJob(await api.engine<GenJob>("generate_start", { provider: picked.provider, model: picked.model, prompt, params, spend_token: token, generative_enabled: generative, offline }, projectPath, enginePath));
      update((p) => recordSpend({ ...p, treatment: { ...p.treatment, [beat.beatId]: { ...(p.treatment[beat.beatId] ?? { plan: "", motion: "" }), animate: { ...eff, model: `${picked.provider}/${picked.model}` } } } },
        { provider: picked.provider, model: picked.model, what: "clip", usd: each }));
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };

  return (
    <div className="animate-scene">
      <button className="btn" disabled={!!reason || running} title={reason} onClick={() => { setS(defaultAnimate(project, beat)); setModelKey(""); setErr(null); setHandWritten(!!defaultAnimate(project, beat).prompt); setOpen(true); }}>
        <Clapperboard size={16} aria-hidden="true" />{running ? "Making the clip…" : clip ? "Animate again…" : "Animate…"}</button>
      {running && <p className="muted" role="status">The model is making the clip ({job?.detail}). This usually takes a few minutes.</p>}
      {open && (
        <Sheet title={`Animate: ${beat.primary}`} wide onClose={() => setOpen(false)}
          footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" disabled={!!confirmBlock || running} title={confirmBlock} onClick={() => { setOpen(false); void run(); }}>Confirm and make the clip</button></>}>
          <div className="animate-grid">
            <div>{still && <Frame asset={still} projectPath={projectPath} ratio="21 / 9" />}<p className="muted">The clip starts from this picture. The picture itself is kept.</p></div>
            <div className="stack">
              {allChoices.length > 8 && <label className="field"><span className="field-label">Find a model ({allChoices.length} can start from a picture)</span>
                <input value={find} placeholder="Type part of a name: veo, kling, seedance…" onChange={(e) => setFind(e.target.value)} /></label>}
              <label className="field"><span className="field-label">Video model</span>
                <select value={modelKey || (picked ? `${picked.provider}/${picked.model}` : "")} disabled={!choices.length} onChange={(e) => setModelKey(e.target.value)}>
                  {choices.length === 0 ? <option value="">No model with a key can start from a picture</option>
                    : choices.map((m) => <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>{m.name} ({PROVIDER_LABEL[m.provider]}{m.official ? ", official" : ""})</option>)}
                </select></label>
              <label className="field"><span className="field-label">Camera</span>
                <select value={s.camera} onChange={(e) => set({ camera: e.target.value })}>{CAMERA_MOVES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
              <label className="field"><span className="field-label">Performance: what the people do, and how</span>
                <textarea rows={3} value={s.performance} onChange={(e) => set({ performance: e.target.value })} /></label>
              <label className="field"><span className="field-label">Emotion</span>
                <input value={s.emotion} onChange={(e) => set({ emotion: e.target.value })} /></label>
              <label className="field"><span className="field-label">A line someone in the scene says (optional)</span>
                <input value={s.spoken} placeholder="Leave empty for no dialogue" onChange={(e) => set({ spoken: e.target.value })} /></label>
              <label className="check"><input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: e.target.checked })} /> Ask for sound that belongs to the scene</label>
              {s.sound && <label className="field"><span className="field-label">Sound</span><input value={s.ambience} onChange={(e) => set({ ambience: e.target.value })} /></label>}
              <div className="row-actions">
                <label className="field"><span className="field-label">Length</span>
                  <select value={eff.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>{limits.durations.map((d) => <option key={d} value={d}>{d} seconds</option>)}</select></label>
                <label className="field"><span className="field-label">Size</span>
                  <select value={eff.resolution} onChange={(e) => set({ resolution: e.target.value as AnimateSettings["resolution"] })}>{limits.resolutions.map((r) => <option key={r} value={r}>{r}{r === "1080p" ? " (8 seconds only)" : ""}</option>)}</select></label>
              </div>
              <label className="field"><span className="field-label">Keep out of the picture</span>
                <input value={s.negative} onChange={(e) => set({ negative: e.target.value })} /></label>
              <label className="field"><span className="field-label">The prompt sent to the model {handWritten ? "(written by you)" : "(built from the choices above)"}</span>
                <textarea rows={7} value={prompt} onChange={(e) => { setHandWritten(true); set({ prompt: e.target.value }); }} /></label>
              {handWritten && <button className="btn quiet" onClick={() => { setHandWritten(false); set({ prompt: undefined }); }}>Build the prompt from the choices again</button>}
              <dl className="facts">
                <dt>Price</dt><dd>{picked ? (each !== null ? `Estimate $${each.toFixed(2)} (${priceText(picked)})` : "Unknown. The provider's price is not published here: video models bill by the second, so a longer clip costs more. Check your provider's current rates.") : "—"}</dd>
                <dt>Charged to</dt><dd>{picked ? `Your ${PROVIDER_LABEL[picked.provider]} account` : "—"}</dd>
                <dt>Sent</dt><dd>This picture and the prompt, to {picked ? PROVIDER_LABEL[picked.provider] : "the model"} only.</dd>
              </dl>
              {confirmBlock && <p className="why">{confirmBlock}</p>}
              <p className="muted">Nothing is sent until you confirm, and this confirmation covers one clip. {videoAspect(project.brief.deliverables[0].aspect) !== project.brief.deliverables[0].aspect ? `The model makes ${videoAspect(project.brief.deliverables[0].aspect)}; in your ${project.brief.deliverables[0].aspect} film it is cropped to fit.` : ""}</p>
            </div>
          </div>
        </Sheet>
      )}
      {err && <p className="error-text" role="alert">{err}</p>}
      {job?.state === "failed" && <p className="error-text" role="alert">{job.error}</p>}
    </div>
  );
}
