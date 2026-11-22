import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControlMode, Deliverable, GateId, MotionProject, ProjectSummary, RevisionRecord, Stage } from "./types";
import { STAGES } from "./types";
import { Ctx, type AppCtx } from "./ctx";
import { getApi, type EngineStatus } from "./lib/api";
import { useSettings } from "./lib/settings";
import { approve, createProject, GATE_AFTER, reviseApproved, setMode, STAGE_LABEL, STAGE_MODE } from "./lib/project";
import { matches } from "./lib/shortcuts";
import { Header, type SaveState } from "./shell/Header";
import { StageBar } from "./shell/StageBar";
import { Palette, type PaletteItem } from "./shell/Palette";
import { ImpactSheet, GateSheet, SettingsSheet } from "./shell/Sheets";
import { useInspectorState } from "./shell/PageFrame";
import { BriefPage } from "./pages/BriefPage";
import { IntentPage } from "./pages/IntentPage";
import { DirectionPage } from "./pages/DirectionPage";
import { TreatmentPage } from "./pages/TreatmentPage";
import { BuildPage } from "./pages/BuildPage";
import { ReviewPage } from "./pages/ReviewPage";
import { DeliverPage } from "./pages/DeliverPage";
import { ProjectsPage } from "./pages/ProjectsPage";

const AUTOSAVE_MS = 30_000; // PRD target: at most 30 s of work lost
const DEBOUNCE_MS = 1_000;

type Overlay = null | { kind: "palette" } | { kind: "settings" } | { kind: "gate"; gate: GateId } | { kind: "impact"; gate: GateId; revKind: RevisionRecord["kind"] };

export default function App() {
  const settings = useSettings();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [listing, setListing] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [project, setProject] = useState<MotionProject | null>(null);
  const pathRef = useRef<string>("");
  const dirty = useRef(false);
  const latest = useRef<MotionProject | null>(null);
  const [save, setSave] = useState<SaveState>({ kind: "saved", at: Date.now() });
  const [now, setNow] = useState(Date.now());
  const [stage, setStage] = useState<Stage>("brief");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [viewerOnly, setViewerOnly] = useState(false);
  const [inspectorOpen, toggleInspector] = useInspectorState();
  const [engine, setEngine] = useState<EngineStatus | null>(null);

  useEffect(() => { document.documentElement.style.setProperty("--mc-scale", String(settings.uiScale / 100)); }, [settings.uiScale]);

  const refreshProjects = useCallback(async () => {
    setListing(true);
    try { setProjects(await (await getApi()).list()); setListError(null); }
    catch (e) { setListError(`Could not list projects: ${e instanceof Error ? e.message : String(e)}`); }
    setListing(false);
  }, []);
  useEffect(() => { void refreshProjects(); }, [refreshProjects]);

  const refreshEngine = useCallback(() => {
    setEngine(null);
    getApi().then((a) => a.engineStatus(settings.enginePath)).then(setEngine)
      .catch((e) => setEngine({ state: "error", pinned: "0.24.1", detail: String(e) }));
  }, [settings.enginePath]);
  useEffect(() => { refreshEngine(); }, [refreshEngine]);

  const flush = useCallback(async () => {
    const p = latest.current;
    if (!p || !dirty.current) return;
    dirty.current = false;
    setSave({ kind: "saving" });
    try { await (await getApi()).save(pathRef.current, p); setSave((s) => (dirty.current ? s : { kind: "saved", at: Date.now() })); }
    catch (e) { dirty.current = true; setSave({ kind: "error", message: e instanceof Error ? e.message : String(e) }); }
  }, []);

  const debounce = useRef<number | undefined>(undefined);
  const update = useCallback((fn: (p: MotionProject) => MotionProject) => {
    setProject((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      latest.current = next; dirty.current = true;
      return next;
    });
    setSave({ kind: "dirty" });
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void flush(), DEBOUNCE_MS);
  }, [flush]);

  useEffect(() => {
    const t = window.setInterval(() => { setNow(Date.now()); void flush(); }, AUTOSAVE_MS / 6);
    return () => window.clearInterval(t);
  }, [flush]);
  useEffect(() => { // also save when the window is hidden or closed
    const onHide = () => { if (document.visibilityState === "hidden") void flush(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", () => void flush());
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [flush]);

  const open = async (s: ProjectSummary) => {
    try {
      const p = await (await getApi()).load(s.path);
      pathRef.current = s.path; latest.current = p; dirty.current = false; setProject(p); setStage("brief"); setSave({ kind: "saved", at: Date.now() });
    } catch (e) { setListError(`Could not open ${s.name}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const create = async (name: string, d: Deliverable) => {
    const p = createProject(name, d);
    const s = await (await getApi()).create(p);
    pathRef.current = s.path; latest.current = p; dirty.current = false; setProject(p); setStage("brief"); setSave({ kind: "saved", at: Date.now() });
  };
  const home = async () => { await flush(); setProject(null); latest.current = null; setViewerOnly(false); void refreshProjects(); };

  const ctx: AppCtx | null = useMemo(() => !project ? null : ({
    project, projectPath: pathRef.current, stage, engine, update, go: setStage, refreshEngine,
    approveGate: (g) => update((p) => approve(p, g)),
    unlockGate: (gate, revKind) => setOverlay({ kind: "impact", gate, revKind }),
    openEffectCraft: async () => { await (await getApi()).openEffectCraft(pathRef.current, settings.enginePath); },
    showSettings: () => setOverlay({ kind: "settings" }),
    showGate: (g) => setOverlay({ kind: "gate", gate: g }),
  }), [project, stage, engine, update, refreshEngine, settings.enginePath]);

  const palette: PaletteItem[] = useMemo(() => {
    const items: PaletteItem[] = [];
    if (project) {
      STAGES.forEach((s) => items.push({ id: `go-${s}`, label: `Go to ${STAGE_LABEL[s]}`, hint: "Page", run: () => setStage(s) }));
      items.push({ id: "viewer-only", label: "Toggle viewer-only mode", run: () => setViewerOnly((v) => !v) });
      items.push({ id: "projects", label: "Back to projects", run: () => void home() });
    }
    items.push({ id: "settings", label: "Open settings", run: () => setOverlay({ kind: "settings" }) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matches(e, "palette")) { e.preventDefault(); setOverlay((o) => (o?.kind === "palette" ? null : { kind: "palette" })); }
      else if (matches(e, "settings")) { e.preventDefault(); setOverlay({ kind: "settings" }); }
      else if (project && matches(e, "viewer-only")) { e.preventDefault(); setViewerOnly((v) => !v); }
      else if (project && matches(e, "inspector")) { e.preventDefault(); toggleInspector(); }
      else if (e.key === "Escape" && viewerOnly && !overlay) setViewerOnly(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, viewerOnly, overlay, toggleInspector]);

  const frame = { viewerOnly, inspectorOpen, onToggleInspector: toggleInspector };
  const key = STAGE_MODE[stage];
  const setStageMode = (m: ControlMode) => { if (key) update((p) => setMode(p, key, m)); };

  return (
    <div className="app">
      <Header project={project} stage={stage} save={save} now={now} engine={engine} onSetMode={setStageMode} onHome={() => void home()}
        onPalette={() => setOverlay({ kind: "palette" })} onSettings={() => setOverlay({ kind: "settings" })} onEngine={() => setOverlay({ kind: "settings" })} />
      {!project || !ctx ? (
        <ProjectsPage projects={projects} loading={listing} error={listError} onOpen={(p) => void open(p)} onCreate={create} />
      ) : (
        <Ctx.Provider value={ctx}>
          <div className="page" key={stage}>
            {stage === "brief" && <BriefPage {...frame} />}
            {stage === "intent" && <IntentPage {...frame} />}
            {stage === "direction" && <DirectionPage {...frame} />}
            {stage === "treatment" && <TreatmentPage {...frame} />}
            {stage === "build" && <BuildPage {...frame} />}
            {stage === "review" && <ReviewPage {...frame} />}
            {stage === "deliver" && <DeliverPage {...frame} />}
          </div>
          {viewerOnly && <button className="btn viewer-exit" onClick={() => setViewerOnly(false)}>Exit viewer-only (Esc)</button>}
          <StageBar project={project} stage={stage} onStage={setStage} onGate={(g) => { const s = Object.entries(GATE_AFTER).find(([, v]) => v === g)?.[0] as Stage | undefined; if (s) setStage(s); setOverlay({ kind: "gate", gate: g }); }} />
        </Ctx.Provider>
      )}
      {overlay?.kind === "palette" && <Palette items={palette} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "settings" && <SettingsSheet engine={engine} onClose={() => setOverlay(null)} onRecheck={refreshEngine} />}
      {overlay?.kind === "gate" && project && <GateSheet project={project} gate={overlay.gate} onClose={() => setOverlay(null)} onApprove={() => update((p) => approve(p, (overlay as { gate: GateId }).gate))} />}
      {overlay?.kind === "impact" && project && (
        <ImpactSheet project={project} gate={overlay.gate} onCancel={() => setOverlay(null)}
          onConfirm={() => { update((p) => reviseApproved(p, overlay.gate, `Unlocked ${STAGE_LABEL[Object.entries(GATE_AFTER).find(([, v]) => v === overlay.gate)![0] as Stage]} for editing`, overlay.revKind)); setOverlay(null); }} />
      )}
      <span className="visually-hidden" role="status" aria-live="polite">{project ? `${STAGE_LABEL[stage]} page` : "Projects"}</span>
    </div>
  );
}
