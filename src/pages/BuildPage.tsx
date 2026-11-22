import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ExternalLink, LockKeyhole, RotateCcw, TriangleAlert, Type } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { Sheet } from "../shell/Sheet";
import { getApi, type PreviewImage } from "../lib/api";
import { useSettings } from "../lib/settings";
import { approveLayer, bindingFor, isChangedSinceApproval, reconcile, unlockLayer, type EngineLayer, type EngineSnapshot } from "../lib/layers";
import { hasAnyProvider } from "../lib/project";
import type { FrameProps } from "./common";

type Preview = { state: "none" } | { state: "rendering"; since: number } | { state: "ready"; img: PreviewImage; at: number; seconds: number; stale: boolean } | { state: "error"; message: string };

export function BuildPage(f: FrameProps) {
  const { engine, project, projectPath, update, openEffectCraft, showSettings, refreshEngine } = useApp();
  const { enginePath } = useSettings();
  const connected = engine?.state === "connected";
  const [snap, setSnap] = useState<EngineSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [newText, setNewText] = useState("");
  const [editText, setEditText] = useState("");
  const [preview, setPreview] = useState<Preview>({ state: "none" });
  const [now, setNow] = useState(Date.now());
  const [guiOpen, setGuiOpen] = useState(false);
  const [unlocking, setUnlocking] = useState<EngineLayer | null>(null);
  const wasOpen = useRef(false);
  const projectRef = useRef(project);
  projectRef.current = project;

  const call = useCallback(async <T = EngineSnapshot,>(method: string, params: Record<string, unknown> = {}) =>
    (await getApi()).engine<T>(method, params, projectPath, enginePath), [projectPath, enginePath]);

  const d = project.brief.deliverables[0];
  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const locked = (projectRef.current.layerMap ?? []).filter((b) => b.lock === "approved").map((b) => b.engineLayerId);
      const s = await call<EngineSnapshot>("open", { settings: { name: "Main", width: d.width, height: d.height, frame_rate: d.fps, duration: d.durationSec }, locked });
      setSnap(s); update((p) => reconcile(p, s));
      setPreview((p) => (p.state === "ready" ? { ...p, stale: true } : p));
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

  const write = async (label: string, method: string, params: Record<string, unknown>, targets: number[] = []) => {
    setBusy(label); setErr(null);
    try {
      const r = await call<EngineSnapshot & { layer?: number }>(method, params);
      const own = r.layer !== undefined ? [r.layer, ...targets] : targets;
      setSnap(r); update((p) => reconcile(p, r, own));
      setPreview((p) => (p.state === "ready" ? { ...p, stale: true } : p));
      return r;
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    finally { setBusy(null); }
  };

  const buildPreview = async () => {
    const t0 = Date.now();
    setPreview({ state: "rendering", since: t0 }); setErr(null);
    try {
      const img = await call<PreviewImage>("preview", { times: [0], max_side: 1280 });
      setPreview({ state: "ready", img, at: Date.now(), seconds: (Date.now() - t0) / 1000, stale: false });
    } catch (e) { setPreview({ state: "error", message: String(e instanceof Error ? e.message : e) }); }
  };

  const layers = snap?.layers ?? [];
  const sel = layers.find((l) => l.id === selected) ?? null;
  const selLocked = !!sel && (bindingFor(project, sel.id)?.lock === "approved" || sel.approvedHere);

  const open = async () => { setErr(null); try { await openEffectCraft(); setGuiOpen(true); wasOpen.current = true; } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } };

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
      <div className="viewer-surround">
        {preview.state === "ready" ? <img className="preview-img" alt="Latest preview of the composition" src={`data:image/png;base64,${preview.img.png}`} />
          : <div className="viewer" style={{ aspectRatio: `${d.width} / ${d.height}` }}><div className="viewer-empty">
            <p className="strong">{preview.state === "rendering" ? "Rendering…" : preview.state === "error" ? "Preview failed" : "No preview yet"}</p>
            <p>{preview.state === "error" ? preview.message : preview.state === "rendering" ? `${((now - preview.since) / 1000).toFixed(0)} s elapsed. Targets: first preview 60 s, small edit 10 s.` : "Add a text layer, then press Build preview."}</p></div></div>}
        <p className="viewer-meta" role="status">
          {preview.state === "ready" ? <><span className="mono">{preview.img.width}×{preview.img.height}</span> Ready in {preview.seconds.toFixed(2)} s{preview.stale ? " · Out of date: the project changed since" : ""}</>
            : preview.state === "rendering" ? "Rendering…" : "No render yet."}
        </p>
      </div>
    </div>
  );

  const inspector = (
    <>
      <Fold title="Layers" defaultOpen meta={<span className="count">{layers.length}</span>}>
        {loading && <p className="muted" role="status">Opening the composition…</p>}
        {!loading && layers.length === 0 && <p className="muted">No layers yet. Add a text layer below, or open EffectCraft.</p>}
        <ul className="layers">
          {layers.map((l) => {
            const b = bindingFor(project, l.id);
            const locked = b?.lock === "approved" || l.approvedHere;
            const changed = isChangedSinceApproval(project, l);
            return (
              <li key={l.id} className={selected === l.id ? "on" : ""}>
                <button className="layer-row" aria-pressed={selected === l.id} onClick={() => { setSelected(l.id); setEditText(l.kind === "Text" ? l.name : ""); }}>
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
        <label className="field"><span className="field-label">New text layer</span><input value={newText} placeholder="Words to show" onChange={(e) => setNewText(e.target.value)} /></label>
        <button className="btn" disabled={!connected || !newText.trim() || !!busy || guiOpen} onClick={async () => { const r = await write("add text", "add_text", { text: newText.trim() }); if (r) { setNewText(""); if (r.layer !== undefined) setSelected(r.layer); } }}><Type size={16} aria-hidden="true" />Add text layer</button>
        <label className="field"><span className="field-label">Change the words of the selected layer</span>
          <input value={editText} disabled={!sel || sel.kind !== "Text" || selLocked} onChange={(e) => setEditText(e.target.value)} /></label>
        <button className="btn" disabled={!sel || sel.kind !== "Text" || selLocked || !editText.trim() || !!busy || guiOpen} onClick={() => sel && write("change text", "set_text", { layer: sel.id, text: editText.trim() }, [sel.id])}>Change text</button>
        {selLocked && <p className="why">Approved. Unlock to edit; this creates a revision.</p>}
        {!sel && <p className="why">Select a text layer to change its words.</p>}
        <p className="hint">Fonts, sizes, colours and animation are edited in EffectCraft. Native, editable text only.</p>
      </Fold>
      <Fold title="Camera">
        <p className="muted">Adds a camera layer so the composition can use 2.5D moves. Push, drift and parallax rack arrive with the primitive library (Phase 2).</p>
        <button className="btn" disabled={!connected || !!busy || guiOpen} onClick={() => write("camera", "add_camera", {})}><Camera size={16} aria-hidden="true" />Add camera</button>
      </Fold>
      <Fold title="Primitives"><p className="muted">The primitive library arrives in Phase 2 (P2-01 to P2-03).</p></Fold>
      <Fold title="Audio"><p className="muted">Waveform, sections, beats, sync mode and the restraint slider arrive in Phase 3.</p></Fold>
      <Fold title="Agent"><p className="muted">{hasAnyProvider() ? "Plan, cost and progress appear here." : "No AI provider is configured, so no agent runs. Everything here is manual."}</p></Fold>
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
    <PageFrame {...f} title="Build" intro="Preview the composition and make light edits. Detailed work opens in EffectCraft." strip main={main} inspector={inspector}
      action={{
        label: "Build preview", onClick: () => void buildPreview(),
        disabledReason: !connected ? "Needs a connected EffectCraft engine." : layers.length === 0 ? "Add a layer first." : preview.state === "rendering" ? "Rendering…" : guiOpen ? undefined : undefined,
      }} />
  );
}
