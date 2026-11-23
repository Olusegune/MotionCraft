import { useEffect, useMemo, useState } from "react";
import { AudioLines, Circle, Plus, Square, Wand2 } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { assetLabel, useImportMedia } from "../../shell/Media";
import { getApi } from "../../lib/api";
import { useSettings } from "../../lib/settings";
import type { EngineLayer, EngineSnapshot } from "../../lib/layers";

export interface Prim {
  id: string; name: string; category: string; appliesTo: string[]; description: string; tags: string[];
  params: Record<string, { label: string; kind: "float" | "int" | "choice"; default: number | string; min: number | null; max: number | null; choices: string[]; unit: string }>;
}
export interface AudioInfo { duration: number; bpm: number | null; beats: number[]; downbeats: number[]; peaks: number[]; silences: number[][]; estimate: boolean }
export type Write = (label: string, method: string, params: Record<string, unknown>, targets?: number[]) => Promise<(EngineSnapshot & { layer?: number }) | undefined>;

const CATEGORY_LABEL: Record<string, string> = { entrance: "Entrances", exit: "Exits", emphasis: "Emphasis", motion: "Motion", text: "Text" };

/** More layers: shapes, solids and your own pictures, video and audio from the media wall. */
export function AddLayerPanel({ write, disabled, onAdded }: { write: Write; disabled: boolean; onAdded: (id?: number) => void }) {
  const { project } = useApp();
  const imp = useImportMedia();
  const [shape, setShape] = useState("rect");
  const [mediaId, setMediaId] = useState("");
  const media = (project.assets ?? []).filter((a) => a.kind !== "audio");
  const pick = media.find((m) => m.id === mediaId) ?? media[0];
  return (
    <Fold title="Add layers" defaultOpen>
      <div className="row-actions">
        <select aria-label="Shape" value={shape} onChange={(e) => setShape(e.target.value)}>
          {[["rect", "Rectangle"], ["rounded", "Rounded rectangle"], ["ellipse", "Ellipse"], ["star", "Star"], ["polygon", "Polygon"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button className="btn" disabled={disabled} onClick={async () => onAdded((await write("add shape", "add_shape", { kind: shape }))?.layer)}><Square size={16} aria-hidden="true" />Add shape</button>
      </div>
      <button className="btn" disabled={disabled} onClick={async () => onAdded((await write("add solid", "add_solid", { name: "Background" }))?.layer)}><Circle size={16} aria-hidden="true" />Add solid background</button>
      <label className="field"><span className="field-label">Picture or video from your media wall</span>
        <select value={pick?.id ?? ""} disabled={!media.length} onChange={(e) => setMediaId(e.target.value)}>
          {media.length === 0 ? <option value="">No media yet</option> : media.map((m) => <option key={m.id} value={m.id}>{assetLabel(m)} ({m.kind})</option>)}
        </select></label>
      <div className="row-actions">
        <button className="btn" disabled={disabled || !pick} onClick={async () => pick && onAdded((await write("add media", "add_media", { rel: pick.path }))?.layer)}><Plus size={16} aria-hidden="true" />Add as layer</button>
        <button className="btn quiet" disabled={imp.busy} onClick={() => void imp.run()}>Import more…</button>
      </div>
      {imp.error && <p className="error-text" role="alert">{imp.error}</p>}
    </Fold>
  );
}

/** Tested motion building blocks. Apply one to the selected layer at the playhead; it writes real keyframes you can refine in EffectCraft. */
export function PrimitivesPanel({ write, selected, locked, playhead, disabled, onApplied }: {
  write: Write; selected: EngineLayer | null; locked: boolean; playhead: number; disabled: boolean; onApplied: () => void;
}) {
  const { enginePath } = useSettings();
  const { projectPath } = useApp();
  const [list, setList] = useState<Prim[]>([]);
  const [id, setId] = useState("entrance.fade-in");
  const [vals, setVals] = useState<Record<string, number | string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [useHead, setUseHead] = useState(true);

  useEffect(() => {
    let live = true;
    getApi().then((a) => a.engine<{ primitives: Prim[] }>("primitives", {}, projectPath, enginePath)).then((r) => { if (live) setList(r.primitives ?? []); }).catch((e) => { if (live) setErr(String(e instanceof Error ? e.message : e)); });
    return () => { live = false; };
  }, [projectPath, enginePath]);

  const prim = list.find((p) => p.id === id);
  useEffect(() => { if (prim) setVals(Object.fromEntries(Object.entries(prim.params).map(([k, v]) => [k, v.default]))); }, [id, prim?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => { const g: Record<string, Prim[]> = {}; for (const p of list) (g[p.category] ??= []).push(p); return g; }, [list]);
  const fits = !!prim && !!selected && (prim.appliesTo.includes("*") || prim.appliesTo.includes(selected.kind));
  const reason = disabled ? "Needs a connected engine." : !selected ? "Select a layer first." : locked ? "Approved. Unlock to edit; this creates a revision." : !prim ? "Choose a motion." : !fits ? `${prim.name} works on ${prim.appliesTo.join(", ")} layers.` : undefined;

  const apply = async () => {
    if (!prim || !selected) return;
    setErr(null);
    const params = { ...vals, ...(useHead && "start" in prim.params ? { start: Math.round(playhead * 1000) / 1000 } : {}) };
    const r = await write(`apply ${prim.name}`, "apply_primitive", { layer: selected.id, primitive: prim.id, params }, [selected.id]);
    if (r) onApplied();
  };

  return (
    <Fold title="Motion" defaultOpen={false} meta={<span className="count">{list.length}</span>}>
      <p className="muted">Ready-made motion, tested on the engine. Each writes ordinary keyframes; refine them in EffectCraft.</p>
      <label className="field"><span className="field-label">Motion</span>
        <select value={id} onChange={(e) => setId(e.target.value)}>
          {Object.entries(groups).map(([cat, ps]) => <optgroup key={cat} label={CATEGORY_LABEL[cat] ?? cat}>{ps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        </select></label>
      {prim && <p className="hint">{prim.description}</p>}
      {prim && Object.entries(prim.params).map(([k, spec]) => k === "start" ? (
        <div key={k} className="field"><span className="field-label">Start</span>
          <label className="check"><input type="checkbox" checked={useHead} onChange={(e) => setUseHead(e.target.checked)} />At the playhead ({playhead.toFixed(2)} s)</label>
          {!useHead && <input type="number" min={spec.min ?? 0} max={spec.max ?? 600} step={0.1} aria-label="Start (s)" value={Number(vals[k] ?? 0)} onChange={(e) => setVals((v) => ({ ...v, [k]: Number(e.target.value) }))} />}</div>
      ) : spec.kind === "choice" ? (
        <label key={k} className="field"><span className="field-label">{spec.label}</span><select value={String(vals[k] ?? spec.default)} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value }))}>{spec.choices.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
      ) : (
        <label key={k} className="field"><span className="field-label">{spec.label}</span>
          <input type="number" min={spec.min ?? undefined} max={spec.max ?? undefined} step={spec.max !== null && spec.max <= 10 ? 0.1 : 1} value={Number(vals[k] ?? spec.default)} onChange={(e) => setVals((v) => ({ ...v, [k]: Number(e.target.value) }))} />
          <span className="hint">{spec.min} to {spec.max} {spec.unit}</span></label>
      ))}
      <button className="btn primary" disabled={!!reason} onClick={() => void apply()}><Wand2 size={16} aria-hidden="true" />Apply to selected layer</button>
      {reason && <p className="why">{reason}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </Fold>
  );
}

/** Waveform, tempo and beats of a song from your media wall, with beat markers written into the composition. */
export function AudioPanel({ write, disabled, info, onInfo }: { write: Write; disabled: boolean; info: AudioInfo | null; onInfo: (a: AudioInfo | null) => void }) {
  const { project, projectPath } = useApp();
  const { enginePath } = useSettings();
  const imp = useImportMedia();
  const tracks = (project.assets ?? []).filter((a) => a.kind === "audio");
  const [rel, setRel] = useState("");
  const [mode, setMode] = useState<"beats" | "downbeats">("beats");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const chosen = tracks.find((t) => t.path === rel) ?? tracks[0];

  const analyze = async () => {
    if (!chosen) return;
    setBusy(true); setErr(null); setMsg(null);
    try { onInfo(await (await getApi()).engine<AudioInfo>("audio_analyze", { rel: chosen.path }, projectPath, enginePath)); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); onInfo(null); }
    setBusy(false);
  };
  const times = info ? (mode === "beats" ? info.beats : info.downbeats) : [];

  return (
    <Fold title="Audio" defaultOpen={false} meta={info?.bpm ? <span className="count">{info.bpm} BPM</span> : undefined}>
      <p className="muted">Waveform, tempo and beat grid are estimates from the audio itself. WAV works directly; other formats need ffmpeg.</p>
      <label className="field"><span className="field-label">Song or narration</span>
        <select value={chosen?.path ?? ""} disabled={!tracks.length} onChange={(e) => { setRel(e.target.value); onInfo(null); }}>
          {tracks.length === 0 ? <option value="">No audio yet</option> : tracks.map((t) => <option key={t.id} value={t.path}>{assetLabel(t)}</option>)}</select></label>
      <div className="row-actions">
        <button className="btn" disabled={imp.busy} onClick={() => void imp.run()}>Import audio…</button>
        <button className="btn" disabled={!chosen || busy} onClick={() => void analyze()}><AudioLines size={16} aria-hidden="true" />Analyse</button>
      </div>
      {info && <p role="status">{info.bpm ? <><strong>{info.bpm} BPM</strong> (estimate) · {info.beats.length} beats · {info.duration.toFixed(1)} s</> : <>No steady beat found · {info.duration.toFixed(1)} s</>}{info.silences.length ? ` · ${info.silences.length} silent gaps` : ""}</p>}
      {info && info.beats.length > 0 && (
        <>
          <label className="field"><span className="field-label">Markers to write</span>
            <select value={mode} onChange={(e) => setMode(e.target.value as "beats" | "downbeats")}><option value="beats">Every beat ({info.beats.length})</option><option value="downbeats">Downbeats only ({info.downbeats.length})</option></select></label>
          <button className="btn" disabled={disabled || busy} onClick={async () => {
            setErr(null); setMsg(null);
            const r = await write("sync markers", "sync_markers", { times, replace: true });
            if (r) setMsg(`${times.length} markers written. This replaced the composition's other markers.`);
          }}>Write markers to composition</button>
        </>
      )}
      <button className="btn" disabled={disabled || !chosen || busy} onClick={async () => { if (chosen) { const r = await write("add audio", "add_media", { rel: chosen.path }); if (r) setMsg("Audio added to the composition, so renders include it."); } }}>Add audio to composition</button>
      {msg && <p className="muted" role="status">{msg}</p>}
      {err && <p className="error-text" role="alert">{err}</p>}
    </Fold>
  );
}
