import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard } from "lucide-react";
import { useApp } from "../ctx";
import { Sheet } from "../shell/Sheet";
import { PROVIDER_LABEL, priceText } from "../shell/ModelsSheet";
import { Frame, assetLabel } from "../shell/Media";
import { capBlock, recordSpend } from "../lib/spend";
import { getApi, type GenJob, type ModelEntry, type ModelList } from "../lib/api";
import { useSettings } from "../lib/settings";
import { CAMERA_MOVES, defaultAnimate, fitToModel, modelParams, videoAspect, videoLimits, videoPrompt, type AnimateSettings } from "../lib/videoPrompt";
import { buildRequest, chooseAspect, durationChoices, nearestDuration, type ModelSchema } from "../lib/videoRequest";
import type { Beat } from "../types";

/** The order providers are offered in: Kie.ai first, then fal, then Google. */
export const PROVIDER_ORDER: Record<string, number> = { kie: 0, fal: 1, google: 2, byteplus: 3, openai: 4 };

/** Models that can be given a picture and whose key is set: Kie.ai first, then fal, then Google; fast models first inside each. */
export function animateChoices(models: ModelEntry[], keys: Record<string, boolean>): ModelEntry[] {
  return models.filter((m) => m.media === "video" && m.imageInput && m.listed !== false && keys[m.provider])
    .sort((a, b) => (PROVIDER_ORDER[a.provider] ?? 9) - (PROVIDER_ORDER[b.provider] ?? 9) || Number(/fast|lite|flash|turbo/i.test(b.model)) - Number(/fast|lite|flash|turbo/i.test(a.model)) || a.name.localeCompare(b.name));
}

const isSchema = (x: unknown): x is ModelSchema => !!x && typeof x === "object" && Array.isArray((x as ModelSchema).fields) && !!(x as ModelSchema).caps && typeof (x as ModelSchema).caps === "object";
let refreshedThisSession = false;

/**
 * "Animate": turn a scene's picture into a real video clip with a video model. The person chooses the model, and then sees what THAT model can do, read from the
 * provider's own published schema: its aspect ratios, lengths and sizes, whether it makes sound, and whether it takes a last frame, reference pictures, a clip
 * to follow or sound to follow. The camera, acting, emotion and the whole prompt are editable. The price is shown, or that none is published. One confirmation, one clip.
 */
export function AnimateScene({ beat, disabled }: { beat: Beat; disabled?: boolean }) {
  const { project, projectPath, update } = useApp();
  const { generative, offline, enginePath } = useSettings();
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [updating, setUpdating] = useState(false);
  const [s, setS] = useState<AnimateSettings>(() => defaultAnimate(project, beat));
  const [modelKey, setModelKey] = useState("");
  const [handWritten, setHandWritten] = useState(false);
  const [job, setJob] = useState<GenJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [schema, setSchema] = useState<ModelSchema | null>(null);
  const [schemaNote, setSchemaNote] = useState<string | null>(null);
  const [aspect, setAspect] = useState("");
  const [resolution, setResolution] = useState("");
  const [lastFrame, setLastFrame] = useState("");
  const [refImages, setRefImages] = useState<string[]>([]);
  const [refVideo, setRefVideo] = useState("");
  const [refAudio, setRefAudio] = useState("");
  const saved = useRef<string | null>(null);

  const t = project.treatment[beat.beatId];
  // The still to animate: the one remembered from an earlier clip, otherwise the scene's picture.
  const still = (project.assets ?? []).find((a) => a.kind === "image" && a.id === (t?.stillAssetId ?? t?.frameAssetId));
  const clip = (project.assets ?? []).find((a) => a.kind === "video" && a.id === t?.frameAssetId);
  const images = (project.assets ?? []).filter((a) => a.kind === "image" && a.id !== still?.id);
  const videos = (project.assets ?? []).filter((a) => a.kind === "video" && a.id !== t?.frameAssetId);
  const sounds = (project.assets ?? []).filter((a) => a.kind === "audio");
  const filmAspect = project.brief.deliverables[0].aspect;

  const load = useCallback(async () => {
    try {
      const api = await getApi();
      let list = (await api.engine<ModelList>("models", {}, "", enginePath)) as Partial<ModelList>;
      const k = await api.keyStatus();
      setKeys(k);
      // The model lists age: ask Kie.ai, fal and Google (free) for what is new once per run of the app, so the newest models are the ones offered.
      const stale = (["kie", "fal", "google"] as const).filter((p) => (p === "kie" || k[p]) && (list.status?.[p]?.refreshed == null || list.status?.[p]?.stale));
      if (!offline && stale.length && !refreshedThisSession) {
        refreshedThisSession = true;
        setUpdating(true);
        try { await api.engine("models_refresh", { offline }, "", enginePath); list = (await api.engine<ModelList>("models", {}, "", enginePath)) as Partial<ModelList>; }
        catch { /* the lists we have stay; a wrong name answers 404 and costs nothing */ }
        setUpdating(false);
      }
      setModels(list.models ?? []);
    } catch { /* nothing to offer: the button explains */ }
  }, [enginePath, offline]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  const [find, setFind] = useState("");
  const allChoices = useMemo(() => animateChoices(models, keys), [models, keys]);
  const choices = useMemo(() => { const q = find.trim().toLowerCase(); return q ? allChoices.filter((m) => `${m.name} ${m.model} ${m.provider}`.toLowerCase().includes(q)) : allChoices; }, [allChoices, find]);
  const picked = choices.find((m) => `${m.provider}/${m.model}` === modelKey) ?? choices.find((m) => `${m.provider}/${m.model}` === s.model) ?? choices[0];

  // What the chosen model can do, read from its provider's published page (cached for a week by the helper).
  useEffect(() => {
    setSchema(null); setSchemaNote(null);
    if (!open || !picked) return;
    let live = true;
    (async () => {
      try {
        const r = await (await getApi()).engine<ModelSchema>("model_schema", { provider: picked.provider, model: picked.model, offline }, "", enginePath);
        if (!live) return;
        if (isSchema(r)) {
          setSchema(r);
          setAspect(chooseAspect(r.caps.aspects, filmAspect) ?? "");
          setResolution(String(r.fields.find((f) => f.role === "resolution")?.default ?? r.caps.resolutions[0] ?? ""));
          const d = durationChoices(r.caps.durations);
          if (d.length) setS((x) => ({ ...x, duration: nearestDuration(d, x.duration) ?? x.duration }));
          setLastFrame(""); setRefImages([]); setRefVideo(""); setRefAudio("");
        } else setSchemaNote("This model's inputs could not be read, so its basic settings are used.");
      } catch (e) { if (live) setSchemaNote(`${String(e instanceof Error ? e.message : e)}`); }
    })();
    return () => { live = false; };
  }, [open, picked?.provider, picked?.model, offline, enginePath, filmAspect]);   // eslint-disable-line react-hooks/exhaustive-deps

  const legacy = !schema;
  const limits = picked ? videoLimits(picked.model) : { durations: [8], resolutions: ["720p" as const] };
  const eff = picked && legacy ? fitToModel(s, picked.model) : s;
  const prompt = videoPrompt(project, beat, eff);
  const each = picked?.price.known ? picked.price.value : null;
  const running = !!job && (job.state === "running" || job.state === "queued");
  const reason = disabled ? "Unlock the treatment first." : !generative ? "Turn on image and video providers in Settings." : offline ? "Offline mode is on."
    : !still ? "This scene needs a picture first." : undefined;
  const confirmBlock = !picked ? "Add a video provider key in Settings (Kie.ai, fal or Google)." : capBlock(project, each) ?? undefined;
  const set = (patch: Partial<AnimateSettings>) => setS((x) => ({ ...x, ...patch }));
  const caps = schema?.caps;
  const lengths = caps ? durationChoices(caps.durations) : limits.durations;

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

  const path = (id: string) => (project.assets ?? []).find((a) => a.id === id)?.path;

  const run = async () => {
    if (!picked || !still) return;
    setErr(null);
    try {
      const api = await getApi();
      const token = await api.confirmSpend(picked.provider, picked.model);      // only reachable from the confirm click
      let params: Record<string, string | number | boolean>;
      let files: Record<string, { paths: string[]; list: boolean }> | undefined;
      if (schema) {
        const req = buildRequest(schema, { firstFrame: still.path, lastFrame: path(lastFrame), refImages: refImages.map(path).filter(Boolean) as string[], refVideos: path(refVideo) ? [path(refVideo)!] : undefined,
          refAudios: path(refAudio) ? [path(refAudio)!] : undefined, aspect: aspect || undefined, resolution: resolution || undefined, duration: eff.duration, sound: eff.sound, negative: eff.negative }, filmAspect);
        params = req.params; files = req.files;
        if (picked.provider === "google") params.person_generation = "allow_adult";
      } else {
        params = { image: still.path, ...modelParams(picked.provider, picked.model, eff, videoAspect(filmAspect)) };
      }
      setJob(await api.engine<GenJob>("generate_start", { provider: picked.provider, model: picked.model, prompt, params, ...(files ? { files } : {}), spend_token: token, generative_enabled: generative, offline }, projectPath, enginePath));
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
              {updating && <p className="muted" role="status">Checking Kie.ai, fal and Google for new models…</p>}
              {allChoices.length > 8 && <label className="field"><span className="field-label">Find a model ({allChoices.length} can be given a picture)</span>
                <input value={find} placeholder="Type part of a name: seedance, kling, veo, wan…" onChange={(e) => setFind(e.target.value)} /></label>}
              <label className="field"><span className="field-label">Video model</span>
                <select value={modelKey || (picked ? `${picked.provider}/${picked.model}` : "")} disabled={!choices.length} onChange={(e) => setModelKey(e.target.value)}>
                  {choices.length === 0 ? <option value="">No model with a key can start from a picture</option>
                    : choices.map((m) => <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>{m.name} ({PROVIDER_LABEL[m.provider]}{m.official ? ", official" : ""})</option>)}
                </select></label>
              {caps && <p className="muted" role="status">This model can: {[caps.imageFirst && "start from a picture", caps.imageLast && "end on a last frame", caps.imageRefs > 0 && `use up to ${caps.imageRefs} reference pictures`, caps.videoRefs > 0 && "follow a clip (video to video)",
                caps.audioRefs > 0 && "follow sound you give it", caps.soundOut && "make its own sound"].filter(Boolean).join(", ") || "make a clip from text"}.</p>}
              {schemaNote && <p className="muted" role="status">{schemaNote}</p>}
              <label className="field"><span className="field-label">Camera</span>
                <select value={s.camera} onChange={(e) => set({ camera: e.target.value })}>{CAMERA_MOVES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
              <label className="field"><span className="field-label">Performance: what the people do, and how</span>
                <textarea rows={3} value={s.performance} onChange={(e) => set({ performance: e.target.value })} /></label>
              <label className="field"><span className="field-label">Emotion</span>
                <input value={s.emotion} onChange={(e) => set({ emotion: e.target.value })} /></label>
              <label className="field"><span className="field-label">A line someone in the scene says (optional)</span>
                <input value={s.spoken} placeholder="Leave empty for no dialogue" onChange={(e) => set({ spoken: e.target.value })} /></label>
              {(legacy || caps?.soundOut) && <label className="check"><input type="checkbox" checked={s.sound} onChange={(e) => set({ sound: e.target.checked })} /> Ask for sound that belongs to the scene</label>}
              {s.sound && (legacy || caps?.soundOut) && <label className="field"><span className="field-label">Sound</span><input value={s.ambience} onChange={(e) => set({ ambience: e.target.value })} /></label>}
              <div className="row-actions">
                {(legacy || (caps?.aspects.length ?? 0) > 0) && <label className="field"><span className="field-label">Shape</span>
                  <select value={legacy ? videoAspect(filmAspect) : aspect} disabled={legacy} onChange={(e) => setAspect(e.target.value)}>
                    {legacy ? <option>{videoAspect(filmAspect)}</option> : caps!.aspects.map((a) => <option key={String(a)} value={String(a)}>{String(a)}</option>)}</select></label>}
                {lengths.length > 0 && <label className="field"><span className="field-label">Length</span>
                  <select value={eff.duration} onChange={(e) => set({ duration: Number(e.target.value) })}>{lengths.map((d) => <option key={d} value={d}>{d} seconds</option>)}</select></label>}
                {(legacy || (caps?.resolutions.length ?? 0) > 0) && <label className="field"><span className="field-label">Size</span>
                  <select value={legacy ? eff.resolution : resolution} onChange={(e) => (legacy ? set({ resolution: e.target.value as AnimateSettings["resolution"] }) : setResolution(e.target.value))}>
                    {(legacy ? limits.resolutions : caps!.resolutions).map((r) => <option key={String(r)} value={String(r)}>{String(r)}</option>)}</select></label>}
              </div>
              {caps?.imageLast && images.length > 0 && <label className="field"><span className="field-label">Last frame (the clip ends on this picture)</span>
                <select value={lastFrame} onChange={(e) => setLastFrame(e.target.value)}><option value="">None</option>{images.map((a) => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select></label>}
              {caps && caps.imageRefs > 0 && images.length > 0 && (
                <fieldset className="grp"><legend className="field-label">Reference pictures (up to {caps.imageRefs}): people, places or styles to keep</legend>
                  {images.slice(0, 24).map((a) => <label key={a.id} className="check"><input type="checkbox" checked={refImages.includes(a.id)} disabled={!refImages.includes(a.id) && refImages.length >= caps.imageRefs}
                    onChange={(e) => setRefImages((r) => (e.target.checked ? [...r, a.id] : r.filter((x) => x !== a.id)))} /> {assetLabel(a)}</label>)}</fieldset>
              )}
              {caps && caps.videoRefs > 0 && videos.length > 0 && <label className="field"><span className="field-label">A clip to follow (video to video)</span>
                <select value={refVideo} onChange={(e) => setRefVideo(e.target.value)}><option value="">None</option>{videos.map((a) => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select></label>}
              {caps && caps.audioRefs > 0 && sounds.length > 0 && <label className="field"><span className="field-label">Sound or voice to follow</span>
                <select value={refAudio} onChange={(e) => setRefAudio(e.target.value)}><option value="">None</option>{sounds.map((a) => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}</select></label>}
              <label className="field"><span className="field-label">Keep out of the picture</span>
                <input value={s.negative} onChange={(e) => set({ negative: e.target.value })} /></label>
              <label className="field"><span className="field-label">The prompt sent to the model {handWritten ? "(written by you)" : "(built from the choices above)"}</span>
                <textarea rows={7} value={prompt} onChange={(e) => { setHandWritten(true); set({ prompt: e.target.value }); }} /></label>
              {handWritten && <button className="btn quiet" onClick={() => { setHandWritten(false); set({ prompt: undefined }); }}>Build the prompt from the choices again</button>}
              <dl className="facts">
                <dt>Price</dt><dd>{picked ? (each !== null ? `Estimate $${each.toFixed(2)} (${priceText(picked)})` : "Unknown. The provider's price is not published here: video models bill by the second, so a longer clip costs more. Check your provider's current rates.") : "—"}</dd>
                <dt>Charged to</dt><dd>{picked ? `Your ${PROVIDER_LABEL[picked.provider]} account` : "—"}</dd>
                <dt>Sent</dt><dd>{picked ? `This picture${(lastFrame || refImages.length || refVideo || refAudio) ? " and the files you chose" : ""} and the prompt, to ${PROVIDER_LABEL[picked.provider]} only${picked.provider === "kie" ? " (Kie.ai keeps uploaded files for 24 hours)" : ""}.` : "—"}</dd>
              </dl>
              {confirmBlock && <p className="why">{confirmBlock}</p>}
              <p className="muted">Nothing is sent until you confirm, and this confirmation covers one clip.</p>
            </div>
          </div>
        </Sheet>
      )}
      {err && <p className="error-text" role="alert">{err}</p>}
      {job?.state === "failed" && <p className="error-text" role="alert">{job.error}</p>}
    </div>
  );
}
