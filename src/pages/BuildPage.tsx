import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Camera, ExternalLink, LockKeyhole, RotateCcw, TriangleAlert } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { Sheet } from "../shell/Sheet";
import { Player, type Marker, type PlayerHandle } from "../shell/Player";
import { getApi } from "../lib/api";
import { useSettings } from "../lib/settings";
import { approveLayer, bindingFor, logTiming, isChangedSinceApproval, markBuilt, reconcile, unlockLayer, type EngineLayer, type EngineSnapshot } from "../lib/layers";
import { AddLayerPanel, AudioPanel, PrimitivesPanel, type AudioInfo, type Write } from "./build/Panels";
import { usePreviewMovie } from "./build/usePreview";
import { BuilderPanel } from "./build/BuilderPanel";
import { ScenePictures } from "./build/ScenePictures";
import { getQaPins, subscribeQaPins } from "../lib/qaPins";
import { beatAt, clampDock, readDock, sceneStatus, writeDock } from "../lib/timelineMath";
import { TimelinePanel, type SceneCard, type TLLayer, type TLMark, type TimingChange } from "./build/TimelinePanel";
import type { SongSection } from "./build/SectionsBar";
import type { FrameProps } from "./common";

export function BuildPage(f: FrameProps) {
  const { engine, project, projectPath, update, openEffectCraft, showSettings, refreshEngine, go } = useApp();
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
  const [tlOpen, setTlOpen] = useState(true);
  // The divider between the preview and the timeline: drag it, or use Up and Down on it. Double-click puts it back. Remembered per project.
  const studioEl = useRef<HTMLDivElement>(null);
  const dockEl = useRef<HTMLDivElement>(null);
  const [dockH, setDockH] = useState<number | null>(() => readDock(project.id));
  const setDock = (h: number | null) => {
    const n = h === null ? null : clampDock(h, studioEl.current?.clientHeight ?? 0);
    setDockH(n); writeDock(project.id, n);
  };
  const dockNow = () => dockH ?? dockEl.current?.getBoundingClientRect().height ?? 0;
  const startDividerDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const y0 = e.clientY, h0 = dockNow();
    const move = (ev: PointerEvent) => setDock(h0 + (y0 - ev.clientY));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  const dividerKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 96 : 24;
    if (e.key === "ArrowUp") { e.preventDefault(); setDock(dockNow() + step); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setDock(dockNow() - step); }
    else if (e.key === "Home" || e.key === "Enter") { e.preventDefault(); setDock(null); }
  };
  useEffect(() => {      // Ctrl and J hide or show the timeline, giving the preview the whole height
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "j" || e.key === "J")) { e.preventDefault(); setTlOpen((v) => !v); } };
    window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k);
  }, []);
  const player = useRef<PlayerHandle>(null);
  const [spans, setSpans] = useState<{ id: number; in: number; out: number }[] | null>(null);
  const [structure, setStructure] = useState<{ sections: SongSection[]; downbeats: number[] } | null>(null);
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

  const errRef = useRef<string | null>(null);
  const write: Write = async (label, method, params, targets = []) => {
    setBusy(label); setErr(null); errRef.current = null;
    try {
      const r = await call<EngineSnapshot & { layer?: number; created?: { layer: number }[] }>(method, params);
      // Some writes (markers) answer with a short note, not the composition. The composition is unchanged, so keep what is shown.
      if (!Array.isArray(r.layers)) return r;
      const own = [...(r.layer !== undefined ? [r.layer] : []), ...targets, ...(r.created ?? []).map((c) => c.layer)];
      setSnap(r); update((p) => reconcile(p, r, own));
      return r;
    } catch (e) { const m = String(e instanceof Error ? e.message : e); errRef.current = m; setErr(m); return undefined; }
    finally { setBusy(null); }
  };

  const layers = snap?.layers ?? [];
  // The timeline reads every layer's in and out in one engine call whenever the composition changes. Read-only.
  useEffect(() => {
    if (!connected || !snap) { setSpans(null); return; }
    let live = true;
    call<{ layers: { id: number; in: number; out: number }[] }>("timeline_read").then((r) => { if (live) setSpans(r.layers); }).catch(() => { if (live) setSpans(null); });
    return () => { live = false; };
  }, [snap, connected, call]);
  const tlLayers: TLLayer[] = layers.map((l) => {
    const sp = spans?.find((x) => x.id === l.id);
    const b = bindingFor(project, l.id);
    return { id: l.id, name: l.name, kind: l.kind, index: l.index, in: sp?.in ?? 0, out: sp?.out ?? d.durationSec, approved: b?.lock === "approved" || l.approvedHere,
      changed: isChangedSinceApproval(project, l), madeBy: b?.provenance.actor === "agent:builder" ? "Builder" : b?.provenance.actor === "agent:qa" ? "QA" : undefined };
  });
  const qaPins = useSyncExternalStore(subscribeQaPins, getQaPins);
  const marks: TLMark[] = useMemo(() => [
    ...qaPins.map((p) => ({ id: p.id, t: p.t, label: p.label, kind: "qa" as const, severity: p.severity })),
    ...project.revisions.filter((r) => r.snapshot).map((r) => ({ id: r.id, t: Math.min(d.durationSec, Math.min(...(r.layers.length ? r.layers.map((id) => spans?.find((x) => x.id === id)?.in ?? 0) : [0]))), label: r.summary, kind: "version" as const })),
  ], [qaPins, project.revisions, spans, d.durationSec]);
  /** Timeline move or trim (ADR-0007, T3). The engine refuses approved layers and clamps to the composition; each change is one revision with saved versions. */
  const [tlErr, setTlErr] = useState<string | null>(null);
  const retime = async (id: number, c: TimingChange) => {
    setTlErr(null);
    const l = layers.find((x) => x.id === id);
    const params = { layer: id, ...(c.delta !== undefined ? { delta: c.delta } : {}), ...(c.tIn !== undefined ? { t_in: c.tIn } : {}), ...(c.tOut !== undefined ? { t_out: c.tOut } : {}) };
    const r = (await write(`Retiming ${l?.name ?? "layer"}`, "layer_timing", params, [id])) as (EngineSnapshot & { versions?: { before?: string | null; after?: string | null } }) | undefined;
    if (!r) { setTlErr(errRef.current); return; }
    const n = (x: number) => Math.round(x * 100) / 100;
    const what = c.delta !== undefined ? `Moved ${l?.name ?? "layer"} by ${c.delta > 0 ? "+" : ""}${n(c.delta)} s` : `Trimmed ${l?.name ?? "layer"} ${c.tIn !== undefined ? "start" : "end"} to ${n(c.tIn ?? c.tOut ?? 0)} s`;
    update((p) => logTiming(p, id, what, r.versions));
  };
  // Scenes: the intent beats as cards, each with a still from the composition at its middle (small engine calls, a few milliseconds each).
  const beats = project.intent.arc;
  const beatKey = beats.map((b) => `${b.beatId}:${b.startSec}-${b.endSec}`).join("|");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!connected || !snap || !beats.length) { setThumbs({}); return; }
    let live = true;
    (async () => {
      const next: Record<string, string> = {};
      for (const b of beats.slice(0, 16)) {
        const t = Math.min(Math.max(0, (b.startSec + b.endSec) / 2), Math.max(0, d.durationSec - 1 / d.fps));
        try { const r = await call<{ png: string }>("preview", { times: [Math.round(t * 1000) / 1000], max_side: 320 }); if (r?.png) next[b.beatId] = `data:image/png;base64,${r.png}`; } catch { break; }
        if (!live) return;
      }
      if (live) setThumbs(next);
    })();
    return () => { live = false; };
  }, [snap, connected, beatKey, call, d.durationSec, d.fps]);   // eslint-disable-line react-hooks/exhaustive-deps
  const scenes: SceneCard[] = beats.map((b) => ({
    id: b.beatId, name: b.primary || "Beat", start: b.startSec, end: b.endSec, thumb: thumbs[b.beatId],
    status: sceneStatus(b.startSec, b.endSec, tlLayers.map((l) => ({ in: l.in, approved: l.approved, changed: l.changed, background: bindingFor(project, l.id)?.role === "background" })), qaPins),
  }));
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
    <div className="studio" ref={studioEl}>
      {guiOpen && <div className="lockbar" role="status"><ExternalLink size={18} aria-hidden="true" /><span>EffectCraft has this project open. MotionCraft is read-only until you close it, then it reloads and logs what you changed.</span></div>}
      {err && <p className="error-text" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {err}</p>}
      {movie.status.state === "error" && <p className="error-text" role="alert"><TriangleAlert size={16} aria-hidden="true" /> {movie.status.message}</p>}
      <Player ref={player} fill aspectLabel={d.aspect} src={movie.url} fps={d.fps} duration={d.durationSec} aspect={`${d.width} / ${d.height}`} stale={movie.stale} markers={markers} peaks={audio?.peaks}
        onTime={setPlayhead} emptyText={movie.status.state === "rendering" ? `Rendering… ${Math.round((now - movie.status.since) / 1000)} s elapsed.` : layers.length ? "Press Build preview to render a draft you can play and scrub." : "Add a layer, then press Build preview."} />
      {tlOpen && <div className="studio-divider" role="separator" aria-orientation="horizontal" aria-label="Resize preview and timeline" tabIndex={0}
        aria-valuenow={Math.round(dockNow())} aria-valuemin={120} title="Drag to resize. Up and Down arrows on it also work; double-click to reset."
        onPointerDown={startDividerDrag} onKeyDown={dividerKey} onDoubleClick={() => setDock(null)}><span aria-hidden="true" /></div>}
      <div className="timeline-dock" ref={dockEl} style={tlOpen && dockH !== null ? { height: dockH, maxHeight: "none" } : undefined}>
      <TimelinePanel open={tlOpen} onOpenChange={setTlOpen} projectKey={project.id} duration={d.durationSec} fps={d.fps} playhead={playhead} onSeek={(t) => player.current?.seek(t)} layers={tlLayers}
        sections={structure?.sections} downbeats={structure?.downbeats} peaks={audio?.peaks} audioDuration={audio?.duration} arc={project.intent.arc} marks={marks} scenes={scenes} selected={selected} onSelect={setSelected} editable={!writesOff} onTiming={retime} message={tlErr} />
      </div>
    </div>
  );

  const sceneIdx = beatAt(beats, playhead);
  const scene = sceneIdx >= 0 ? beats[sceneIdx] : null;
  const previewReason = !connected ? "Needs a connected EffectCraft engine." : layers.length === 0 ? "Add a layer first." : movie.status.state === "rendering" ? "Rendering a draft…" : guiOpen ? "Close EffectCraft first so the draft shows your latest changes." : undefined;
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  useEffect(() => { setHeaderSlot(document.getElementById("header-actions")); }, []);
  const headerButtons = headerSlot && createPortal(
    <>
      <button className="btn" onClick={() => go("review")} title="Look at the changes and saved versions, and leave notes">Review changes</button>
      <button className="btn primary" disabled={!!previewReason} title={previewReason} onClick={() => void movie.start()}>{movie.status.state === "rendering" ? "Rendering…" : "Build preview"}</button>
    </>, headerSlot);
  const inspector = (
    <>
      <div className="scene-head">
        <h2 className="scene-title">{scene ? <>Scene {String(sceneIdx + 1).padStart(2, "0")} · {scene.primary || "Beat"}</> : "Composition"}</h2>
        {scene && (
          <label className="field dir-summary"><span className="field-label">Direction summary</span>
            <input value={project.treatment[scene.beatId]?.plan ?? ""} placeholder="Say in a few words how this scene should feel"
              onChange={(e) => update((p) => ({ ...p, treatment: { ...p.treatment, [scene.beatId]: { ...(p.treatment[scene.beatId] ?? { plan: "", motion: "" }), plan: e.target.value } }, updatedAt: new Date().toISOString() }))} />
          </label>
        )}
      </div>
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
      <Fold title="Add to the scene" defaultOpen={false}>
        <Fold title="Text" defaultOpen={false}>
          <TextPanel write={write} disabled={writesOff} sel={sel} locked={selLocked} onAdded={(id) => id !== undefined && setSelected(id)} />
        </Fold>
        <AddLayerPanel write={write} disabled={writesOff} onAdded={(id) => id !== undefined && setSelected(id)} />
        <Fold title="Camera">
          <p className="muted">Adds a camera layer. A camera only affects layers that are 3D; turn that on in EffectCraft.</p>
          <button className="btn" disabled={writesOff} onClick={() => write("camera", "add_camera", {})}><Camera size={16} aria-hidden="true" />Add camera</button>
        </Fold>
      </Fold>
      <PrimitivesPanel write={write} selected={sel} locked={selLocked} playhead={playhead} disabled={writesOff} onApplied={() => undefined} />
      <AudioPanel write={write} disabled={writesOff} info={audio} onInfo={setAudio} onStructure={setStructure} />
      <ScenePictures write={write} disabled={writesOff} />
      <BuilderPanel write={write} disabled={writesOff} onBuilt={(created, versions) => update((p) => markBuilt(p, created, versions))} />
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
    <>
      {headerButtons}
      <PageFrame {...f} compactHead title="Build" intro="Build the composition, play a draft, and refine in EffectCraft." strip={!beats.length} main={main} inspector={inspector} />
    </>
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
