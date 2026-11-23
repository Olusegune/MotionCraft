import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, ExternalLink, LockKeyhole, RotateCcw, TriangleAlert } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { Sheet } from "../shell/Sheet";
import { Player, type Marker } from "../shell/Player";
import { getApi } from "../lib/api";
import { useSettings } from "../lib/settings";
import { approveLayer, bindingFor, isChangedSinceApproval, markBuilt, reconcile, unlockLayer, type EngineLayer, type EngineSnapshot } from "../lib/layers";
import { AddLayerPanel, AudioPanel, PrimitivesPanel, type AudioInfo, type Write } from "./build/Panels";
import { usePreviewMovie } from "./build/usePreview";
import { BuilderPanel } from "./build/BuilderPanel";
import type { FrameProps } from "./common";

export function BuildPage(f: FrameProps) {
  const { engine, project, projectPath, update, openEffectCraft, showSettings, refreshEngine } = useApp();
  const { enginePath } = useSettings();
  const connected = engine?.state === "connected";
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [guiOpen, setGuiOpen] = useState(false);
  const [unlocking, setUnlocking] = useState<EngineLayer | null>(null);
  const [audio, setAudio] = useState<AudioInfo | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const wasOpen = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;
  const movie = usePreviewMovie();

  const call = useCallback(async <T = EngineSnapshot,>(method: string, params: Record<string, unknown> = {}) =>
    (await getApi()).engine<T>(method, params, projectPath, enginePath), [projectPath, enginePath]);

  const d = project.brief.deliverables[0];
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const locked = (projectRef.current.layerMap ?? []).filter((b) => b.lock === "approved").map((b) => b.engineLayerId);
      const s = await call<EngineSnapshot>("open", { settings: { name: "Main", width: d.width, height: d.height, frame_rate: d.fps, duration: d.durationSec }, locked });
      setSnap(s); update((p) => reconcile(p, s));
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    setLoading(false);
  }, [call, d.width, d.height, d.fps, d.durationSec, update]);

  useEffect(() => { if (connected) void load(); }, [connected, load]);
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);

  // While an EffectCraft window is open, MotionCraft does not write. When it closes, reload from the file and log what changed.
  useEffect(() => {
    if (!connected) return;
    const t = window.setInterval(async () => {
      try {
        const open = await (await getApi()).effectcraftWindowOpen();
        setGuiOpen(open);
        if (wasOpen.current && !open) void load();
        wasOpen.current = open;
      } catch { /* not in the desktop app */ }
    }, 2000);
    return () => window.clearInterval(t);
  }, [connected, load]);

  const write: Write = async (label, method, params, targets = []) => {
    setBusy(label); setErr(null);
    try {
      const r = await call<EngineSnapshot & { layer?: number; created?: { layer: number }[] }>(method, params);
      const own = [...(r.layer !== undefined ? [r.layer] : []), ...targets, ...(r.created ?? []).map((c) => c.layer)];
      setSnap(r); update((p) => reconcile(p, r, own));
      return r;
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); return undefined; }
    finally { setBusy(null); }
  };

  const layers = snap?.layers ?? [];
  const sel = layers.find((l) => l.id === selected) ?? null;
  const selLocked = !!sel && (bindingFor(project, sel.id)?.lock === "approved" || sel.approvedHere);
  const writesOff = !connected || guiOpen || !!busy;
  const open = async () => { setErr(null); try { await openEffectCraft(); setGuiOpen(true); wasOpen.current = true; } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } };

  const markers: Marker[] = useMemo(() => {
    const m: Marker[] = project.intent.arc.map((b) => ({ t: b.startSec, label: b.primary || "Beat", kind: "section" as const }));
    for (const t of audio?.beats ?? []) m.push({ t, label: "Beat", kind: "beat" });
    for (const c of project.review.comments) m.push({ t: c.atSec, label: c.text, kind: "note" });
    return m;
  }, [project.intent.arc, project.review.comments, audio]);

  const main = !connected ? (
    <div className="engine-down" role="alert">
      <p className="strong">{engine?.state === "version-mismatch" ? "EffectCraft is not the pinned version" : "EffectCraft is not connected"}</p>
      <p>{engine?.detail ?? "Checking for effectcraft-cli…"}</p>
      <p className="muted">Brief, Intent, Direction and Treatment keep working. Build needs the engine.</p>
      <div className="row-actions"><button className="btn" onClick={refreshEngine}><RotateCcw size={16} aria-hidden="true" />Reconnect</button><button className="btn" onClick={showSettings}>Locate EffectCraft</button></div>
    </div>
  ) : (
    <div className="stack">
      {guiOpen && <div className="lockbar" role="status"><ExternalLink size={18} aria-hidden="true" /><span>EffectCraft has this project open. MotionCraft is read-only until you close it, then it reloads and logs what you changed.</span></div>}
      {err && <p className="error-text" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {err}</p>}
      {movie.status.state === "error" && <p className="error-text" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {movie.status.message}</p>}
      <Player src={movie.url} fps={d.fps} duration={d.durationSec} aspect={`${d.width} / ${d.height}`} stale={movie.stale} markers={markers} peaks={audio?.peaks}
        onTime={setPlayhead} emptyText={movie.status.state === "rendering" ? `Rendering… ${Math.round((now - movie.status.since) / 1000)} s elapsed.` : layers.length ? "Press Build preview to render a draft you can play and scrub." : "Add a layer, then press Build preview."} />
    </div>
  );

  const inspector = (
    <>
      <Fold title="Layers" defaultOpen meta={<span className="count">{layers.length}</span>}>
        {loading && <p className="muted" role="status">Opening the composition…</p>}
        {!loading && layers.length === 0 && <p className="muted">No layers yet. Add some below, or open EffectCraft.</p>}
        <ul className="layers">
          {layers.map((l) => {
            const b = bindingFor(project, l.id);
            const locked = b?.lock === "approved" || l.approvedHere;
            const changed = isChangedSinceApproval(project, l);
            return (
              <li key={l.id} className={selected === l.id ? "on" : ""}>
                <button className="layer-row" aria-pressed={selected === l.id} onClick={() => setSelected(l.id)}>
                  <span className="strong">{l.name}</span><span className="muted">{l.kind}</span>
                  {locked && <span className="badge"><LockKeyhole size={14} aria-hidden="true" />Approved</span>}
                  {changed && <span className="badge warn"><TriangleAlert size={14} aria-hidden="true" />Changed in EffectCraft</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {sel && (
          <div className="row-actions">
            {selLocked
              ? <button className="btn" disabled={guiOpen} onClick={() => setUnlocking(sel)}><LockKeyhole size={16} aria-hidden="true" />Unlock…</button>
              : <button className="btn" disabled={guiOpen || !!busy} onClick={async () => { const r = await write("lock", "lock", { layers: [sel.id] }, [sel.id]); if (r) { const l = r.layers.find((x) => x.id === sel.id); if (l) update((p) => approveLayer(p, l)); } }}><LockKeyhole size={16} aria-hidden="true" />Approve layer</button>}
          </div>
        )}
        {sel && selLocked && <p className="why">Approved. Unlock to edit; this creates a revision.</p>}
        <button className="btn" onClick={open} disabled={!connected || guiOpen}><ExternalLink size={16} aria-hidden="true" />Open in EffectCraft</button>
        <button className="btn quiet" onClick={() => void load()} disabled={!connected || loading || guiOpen}><RotateCcw size={16} aria-hidden="true" />Refresh from file</button>
      </Fold>
      <Fold title="Text" defaultOpen>
        <TextPanel write={write} disabled={writesOff} sel={sel} locked={selLocked} onAdded={(id) => id !== undefined && setSelected(id)} />
      </Fold>
      <AddLayerPanel write={write} disabled={writesOff} onAdded={(id) => id !== undefined && setSelected(id)} />
      <PrimitivesPanel write={write} selected={sel} locked={selLocked} playhead={playhead} disabled={writesOff} onApplied={() => undefined} />
      <AudioPanel write={write} disabled={writesOff} info={audio} onInfo={setAudio} />
      <Fold title="Camera">
        <p className="muted">Adds a camera layer. A camera only affects layers that are 3D; turn that on in EffectCraft.</p>
        <button className="btn" disabled={writesOff} onClick={() => write("camera", "add_camera", {})}><Camera size={16} aria-hidden="true" />Add camera</button>
      </Fold>
      <BuilderPanel write={write} disabled={writesOff} onBuilt={(created) => update((p) => markBuilt(p, created))} />
      {unlocking && (
        <Sheet title="Unlock approved layer" onClose={() => setUnlocking(null)}
          footer={<><button className="btn" onClick={() => setUnlocking(null)}>Keep it approved</button>
            <button className="btn primary" onClick={async () => { const l = unlocking; setUnlocking(null); const r = await write("unlock", "unlock", { layers: [l.id], note: "unlocked in MotionCraft" }, [l.id]); if (r) update((p) => unlockLayer(p, l)); }}>Unlock and create revision</button></>}>
          <p>Unlocking <strong>{unlocking.name}</strong> creates a revision. Nothing changes until you confirm, and nothing is deleted.</p>
        </Sheet>
      )}
    </>
  );

  return (
    <PageFrame {...f} title="Build" intro="Build the composition, play a draft, and refine in EffectCraft." strip main={main} inspector={inspector}
      action={{
        label: movie.status.state === "rendering" ? "Rendering…" : "Build preview", onClick: () => void movie.start(),
        disabledReason: !connected ? "Needs a connected EffectCraft engine." : layers.length === 0 ? "Add a layer first." : movie.status.state === "rendering" ? "Rendering a draft…" : guiOpen ? "Close EffectCraft first so the draft shows your latest changes." : undefined,
      }} />
  );
}

function TextPanel({ write, disabled, sel, locked, onAdded }: { write: Write; disabled: boolean; sel: EngineLayer | null; locked: boolean; onAdded: (id?: number) => void }) {
  const [newText, setNewText] = useState("");
  const [editText, setEditText] = useState("");
  useEffect(() => { setEditText(sel?.kind === "Text" ? sel.name : ""); }, [sel?.id, sel?.kind, sel?.name]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <label className="field"><span className="field-label">New text layer</span><input value={newText} placeholder="Words to show" onChange={(e) => setNewText(e.target.value)} /></label>
      <button className="btn" disabled={disabled || !newText.trim()} onClick={async () => { const r = await write("add text", "add_text", { text: newText.trim() }); if (r) { setNewText(""); onAdded(r.layer); } }}>Add text layer</button>
      <label className="field"><span className="field-label">Change the words of the selected layer</span>
        <input value={editText} disabled={!sel || sel.kind !== "Text" || locked} onChange={(e) => setEditText(e.target.value)} /></label>
      <button className="btn" disabled={disabled || !sel || sel.kind !== "Text" || locked || !editText.trim()} onClick={() => sel && write("change text", "set_text", { layer: sel.id, text: editText.trim() }, [sel.id])}>Change text</button>
      {locked && <p className="why">Approved. Unlock to edit; this creates a revision.</p>}
      {!sel && <p className="why">Select a text layer to change its words.</p>}
      <p className="hint">Fonts, sizes and colours are edited in EffectCraft. Native, editable text only.</p>
    </>
  );
}
