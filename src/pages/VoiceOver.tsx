import { useEffect, useMemo, useState } from "react";
import { Mic } from "lucide-react";
import { useApp } from "../ctx";
import { Sheet } from "../shell/Sheet";
import { PROVIDER_LABEL } from "../shell/ModelsSheet";
import { getApi } from "../lib/api";
import { useSettings } from "../lib/settings";
import { capBlock, recordSpend } from "../lib/spend";
import { defaultVoice, voiceChoices, type VoiceModel, type VoiceSettings } from "../lib/voice";
import type { Beat } from "../types";

/** Plays a project audio file in the page (the desktop app's own file address), so a voiceover can be checked before it goes into the film. */
function useAudioUrl(projectPath: string, rel: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!rel) return;
    let live = true;
    getApi().then((a) => a.fileUrl(projectPath, rel)).then((u) => { if (live) setUrl(u); }).catch(() => undefined);
    return () => { live = false; };
  }, [projectPath, rel]);
  return url;
}

/**
 * Voiceover for one scene: the script's line (editable), a voice, and how to say it (taken from the scene's feeling and energy, editable). Made by an official provider
 * with your own key, after a confirmation. The result is a normal audio file in the project; it is placed in the composition at the scene's start with Build.
 */
export function VoiceOver({ beat, disabled }: { beat: Beat; disabled?: boolean }) {
  const { project, projectPath, update } = useApp();
  const { generative, offline, enginePath } = useSettings();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<VoiceModel[]>([]);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [s, setS] = useState<VoiceSettings>(() => defaultVoice(project, beat, []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const v = project.treatment[beat.beatId]?.voice;
  const asset = (project.assets ?? []).find((a) => a.id === v?.assetId);
  const url = useAudioUrl(projectPath, asset?.path);

  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const api = await getApi();
        const r = await api.engine<{ models: VoiceModel[] }>("speech_models", {}, "", enginePath);
        setAll(r.models ?? []); setKeys(await api.keyStatus());
        setS(defaultVoice(project, beat, voiceChoices(r.models ?? [], await api.keyStatus())));
      } catch { /* the sheet says there is nothing to offer */ }
    })();
  }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const choices = useMemo(() => voiceChoices(all, keys), [all, keys]);
  const picked = choices.find((m) => `${m.provider}/${m.model}` === s.model) ?? choices[0];
  const voice = picked?.voices.includes(s.voice) ? s.voice : picked?.voices[0] ?? "";
  const reason = disabled ? "Unlock the treatment first." : !generative ? "Turn on image and video providers in Settings." : offline ? "Offline mode is on." : undefined;
  const confirmBlock = !picked ? "Add an OpenAI or Google key in Settings: voiceover uses official providers only." : !s.text.trim() ? "Write the line to speak." : capBlock(project, null) ?? undefined;
  const set = (patch: Partial<VoiceSettings>) => setS((x) => ({ ...x, ...patch }));

  const run = async () => {
    if (!picked) return;
    setBusy(true); setErr(null); setOpen(false);
    try {
      const api = await getApi();
      const token = await api.confirmSpend(picked.provider, picked.model);            // only reachable from the confirm click
      const r = await api.engine<{ path: string; provenance: import("../types").AssetReference["provenance"] }>("speech_generate",
        { provider: picked.provider, model: picked.model, text: s.text.trim(), voice, instructions: picked.instructions ? s.delivery : "", speed: s.speed, spend_token: token, generative_enabled: generative, offline }, projectPath, enginePath);
      const id = `vo-${Math.random().toString(16).slice(2, 10)}`;
      update((p) => recordSpend({
        ...p, assets: [...(p.assets ?? []), { id, kind: "audio", path: r.path, name: `${beat.primary} (voiceover)`, use: "voiceover", provenance: r.provenance }],
        treatment: { ...p.treatment, [beat.beatId]: { ...(p.treatment[beat.beatId] ?? { plan: "", motion: "" }), voice: { ...s, model: `${picked.provider}/${picked.model}`, voice, assetId: id, placed: false } } },
        updatedAt: new Date().toISOString(),
      }, { provider: picked.provider, model: picked.model, what: "voiceover", usd: null }));
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    setBusy(false);
  };

  return (
    <div className="voice-over">
      <button className="btn" disabled={!!reason || busy} title={reason} onClick={() => { setS(defaultVoice(project, beat, [])); setErr(null); setOpen(true); }}>
        <Mic size={16} aria-hidden="true" />{busy ? "Making the voice…" : v?.assetId ? "Voiceover again…" : "Voiceover…"}</button>
      {v?.assetId && url && <audio className="vo-audio" controls src={url} aria-label={`Voiceover for ${beat.primary}`} />}
      {v?.assetId && !v.placed && <p className="muted">Made. Build puts it in the film at {beat.startSec} s.</p>}
      {open && (
        <Sheet title={`Voiceover: ${beat.primary}`} wide onClose={() => setOpen(false)}
          footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" disabled={!!confirmBlock} title={confirmBlock} onClick={() => void run()}>Confirm and make the voice</button></>}>
          <div className="stack">
            <label className="field"><span className="field-label">The line to speak (from your script's voiceover column; edit it)</span>
              <textarea rows={4} value={s.text} onChange={(e) => set({ text: e.target.value })} /></label>
            <div className="row-actions">
              <label className="field"><span className="field-label">Voice model</span>
                <select value={picked ? `${picked.provider}/${picked.model}` : ""} disabled={!choices.length} onChange={(e) => set({ model: e.target.value })}>
                  {choices.length === 0 ? <option value="">No voice model has a key</option> : choices.map((m) => <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>{m.name} ({PROVIDER_LABEL[m.provider]}, official)</option>)}</select></label>
              <label className="field"><span className="field-label">Voice</span>
                <select value={voice} disabled={!picked} onChange={(e) => set({ voice: e.target.value })}>{(picked?.voices ?? []).map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
            </div>
            {picked?.instructions
              ? <label className="field"><span className="field-label">How to say it: emotion, pace, tone (from this scene's feeling; edit it)</span><textarea rows={3} value={s.delivery} onChange={(e) => set({ delivery: e.target.value })} /></label>
              : <p className="muted">This model has no delivery instructions. Choose a steerable one to set emotion and pace.</p>}
            {picked?.provider === "openai" && <label className="field"><span className="field-label">Pace ({s.speed.toFixed(2)}×)</span>
              <input type="range" min={0.7} max={1.3} step={0.05} value={s.speed} onChange={(e) => set({ speed: Number(e.target.value) })} /></label>}
            <dl className="facts">
              <dt>Price</dt><dd>Unknown. {picked ? PROVIDER_LABEL[picked.provider] : "The provider"} bills speech by the amount of text; a short line costs a fraction of a cent to a few cents. Check your provider's current rates.</dd>
              <dt>Charged to</dt><dd>{picked ? `Your ${PROVIDER_LABEL[picked.provider]} account` : "—"}</dd>
              <dt>Sent</dt><dd>The line of text{picked?.instructions ? " and the delivery note" : ""}, to {picked ? PROVIDER_LABEL[picked.provider] : "the provider"} only.</dd>
            </dl>
            {confirmBlock && <p className="why">{confirmBlock}</p>}
            <p className="muted">Nothing is sent until you confirm. You can listen to the voice before it goes into the film, and make another if it is not right.</p>
          </div>
        </Sheet>
      )}
      {err && <p className="error-text" role="alert">{err}</p>}
    </div>
  );
}
