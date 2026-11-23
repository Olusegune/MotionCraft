import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControlMode, Deliverable, GateId, MotionProject, ProjectSummary, RevisionRecord, Stage } from "./types";
import { STAGES } from "./types";
import { Ctx, type AppCtx } from "./ctx";
import { getApi, type EngineStatus } from "./lib/api";
import { updateSettings, useSettings } from "./lib/settings";
import { approve, createProject, GATE_AFTER, newId, nowIso, reviseApproved, setMode, STAGE_LABEL, STAGE_MODE } from "./lib/project";
import { matches } from "./lib/shortcuts";
import { Header, type SaveState } from "./shell/Header";
import { StageBar } from "./shell/StageBar";
import { Palette, type PaletteItem } from "./shell/Palette";
import { ImpactSheet, GateSheet, SettingsSheet, SaveCopySheet, ManualSheet, AboutSheet } from "./shell/Sheets";
import { ModelsSheet } from "./shell/ModelsSheet";
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

type Overlay = null | { kind: "palette" } | { kind: "settings" } | { kind: "models" } | { kind: "copy" } | { kind: "manual" } | { kind: "about" } | { kind: "gate"; gate: GateId } | { kind: "impact"; gate: GateId; revKind: RevisionRecord["kind"] };

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
  const [newOpen, setNewOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle("narrow", window.innerWidth / (settings.uiScale / 100) < 980);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, [settings.uiScale]);

  useEffect(() => { document.documentElement.style.setProperty("--mc-scale", String(settings.uiScale / 100));
    document.documentElement.style.zoom = String(settings.uiScale / 100); }, [settings.uiScale]);

  // Real start-up progress for the splash: each step is reported when it has actually finished.
  const readyOnce = useRef(false);
  useEffect(() => { getApi().then((a) => a.startupStep("ui")).catch(() => undefined); }, []);
  const refreshProjects = useCallback(async () => {
    setListing(true);
    try { setProjects(await (await getApi()).list()); setListError(null); }
    catch (e) { setListError(`Could not list projects: ${e instanceof Error ? e.message : String(e)}`); }
    setListing(false);
  }, []);
  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  useEffect(() => { if (!listing) getApi().then((a) => a.startupStep("projects")).catch(() => undefined); }, [listing]);
  useEffect(() => { if (engine) getApi().then((a) => a.startupStep("engine")).catch(() => undefined); }, [engine]);
  useEffect(() => {
    if (!listing && engine && !readyOnce.current) { readyOnce.current = true; getApi().then((a) => a.appReady()).catch(() => undefined); }
  }, [listing, engine]);

  const refreshEngine = useCallback(() => {
    setEngine(null);
    getApi().then((a) => a.engineStatus(settings.enginePath)).then(setEngine)
      .catch((e) => setEngine({ state: "error", pinned: "0.24.1", detail: String(e) }));
  }, [settings.enginePath]);
  useEffect(() => { refreshEngine(); }, [refreshEngine]);
  // The engine may be installed or started after MotionCraft: look again whenever the window regains focus while it is missing.
  useEffect(() => {
    const onFocus = () => { if (engine && engine.state !== "connected") refreshEngine(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [engine, refreshEngine]);

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
  const say = (m: string) => { setNotice(m); window.setTimeout(() => setNotice((n) => (n === m ? null : n)), 4000); };
  const openFolder = async () => {
    try {
      const api = await getApi();
      const picked = await api.pickPath("folder", await api.projectsFolder());
      if (!picked) return;
      await flush();
      await open(await api.importProject(picked));
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  };
  const saveNow = async () => {
    if (!project) { say("No project is open."); return; }
    dirty.current = true; await flush(); say("Saved.");
  };
  const saveCopy = async (name: string) => {
    if (!project) return;
    await flush();
    const copy: MotionProject = { ...project, id: newId(), name, createdAt: nowIso(), updatedAt: nowIso() };
    const s = await (await getApi()).duplicateProject(pathRef.current, copy);
    await open(s);
    say(`Saved a copy as ${name}.`);
  };

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
    items.push({ id: "models", label: "Browse image and video models", run: () => setOverlay({ kind: "models" }) });
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  // Native menu (File, Edit, Go, View, Tools, Window, Help). The handler is kept in a ref so it always sees current state.
  const menuRef = useRef<(id: string) => void>(() => undefined);
  menuRef.current = (id: string) => {
    const needProject = () => { if (!project) { say("Open or create a project first."); return false; } return true; };
    if (id.startsWith("go-")) { if (needProject()) setStage(id.slice(3) as Stage); return; }
    switch (id) {
      case "file-new": void (async () => { if (project) await home(); setNewOpen(true); })(); break;
      case "file-open": case "file-close": void home(); break;
      case "file-open-folder": void openFolder(); break;
      case "file-save": void saveNow(); break;
      case "file-save-copy": if (needProject()) setOverlay({ kind: "copy" }); break;
      case "file-reveal": getApi().then((a) => a.revealProjectsFolder()).catch((e) => say(String(e instanceof Error ? e.message : e))); break;
      case "file-settings": case "tools-engine": case "help-shortcuts": setOverlay({ kind: "settings" }); break;
      case "edit-palette": setOverlay((o) => (o?.kind === "palette" ? null : { kind: "palette" })); break;
      case "view-viewer-only": if (needProject()) setViewerOnly((v) => !v); break;
      case "view-inspector": if (needProject()) toggleInspector(); break;
      case "view-zoom-in": updateSettings({ uiScale: settings.uiScale + 10 }); break;
      case "view-zoom-out": updateSettings({ uiScale: settings.uiScale - 10 }); break;
      case "view-zoom-reset": updateSettings({ uiScale: 100 }); break;
      case "tools-models": setOverlay({ kind: "models" }); break;
      case "tools-effectcraft": if (needProject()) getApi().then((a) => a.openEffectCraft(pathRef.current, settings.enginePath)).catch((e) => say(String(e instanceof Error ? e.message : e))); break;
      case "help-docs": getApi().then((a) => a.openDocs()).catch((e) => say(String(e instanceof Error ? e.message : e))); break;
      case "help-manual": setOverlay({ kind: "manual" }); break;
      case "help-about": setOverlay({ kind: "about" }); break;
    }
  };
  useEffect(() => {
    let off: () => void = () => undefined;
    let dead = false;
    getApi().then((a) => a.onMenu((id) => menuRef.current(id))).then((f) => { if (dead) f(); else off = f; }).catch(() => undefined);
    return () => { dead = true; off(); };
  }, []);

  useEffect(() => {
    if (inTauri) return; // in the desktop app the menu accelerators do this
    const onKey = (e: KeyboardEvent) => {
      if (matches(e, "palette")) { e.preventDefault(); setOverlay((o) => (o?.kind === "palette" ? null : { kind: "palette" })); }
      else if (matches(e, "settings")) { e.preventDefault(); setOverlay({ kind: "settings" }); }
      else if (project && matches(e, "viewer-only")) { e.preventDefault(); setViewerOnly((v) => !v); }
      else if (project && matches(e, "inspector")) { e.preventDefault(); toggleInspector(); }
      else if (e.key === "Escape" && viewerOnly && !overlay) setViewerOnly(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [project, viewerOnly, overlay, toggleInspector, inTauri]);

  const frame = { viewerOnly, inspectorOpen, onToggleInspector: toggleInspector };
  const key = STAGE_MODE[stage];
  const setStageMode = (m: ControlMode) => { if (key) update((p) => setMode(p, key, m)); };

  return (
    <div className="app">
      <Header project={project} stage={stage} save={save} now={now} engine={engine} onSetMode={setStageMode} onHome={() => void home()}
        onPalette={() => setOverlay({ kind: "palette" })} onSettings={() => setOverlay({ kind: "settings" })} onEngine={() => setOverlay({ kind: "settings" })} onManual={() => setOverlay({ kind: "manual" })} />
      {notice && <div className="notice" role="status">{notice}<button className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}
      {!project || !ctx ? (
        <ProjectsPage projects={projects} loading={listing} error={listError} onOpen={(p) => void open(p)} onCreate={create} newOpen={newOpen} setNewOpen={setNewOpen} onOpenFolder={() => void openFolder()}
          onReveal={() => getApi().then((a) => a.revealProjectsFolder()).catch((e) => say(String(e instanceof Error ? e.message : e)))} />
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
      {overlay?.kind === "settings" && <SettingsSheet engine={engine} onClose={() => setOverlay(null)} onRecheck={refreshEngine} onModels={() => setOverlay({ kind: "models" })} />}
      {overlay?.kind === "models" && <ModelsSheet onClose={() => setOverlay(null)} />}
      {overlay?.kind === "copy" && project && <SaveCopySheet defaultName={`${project.name} copy`} onClose={() => setOverlay(null)} onSave={async (n) => { setOverlay(null); try { await saveCopy(n); } catch (e) { say(e instanceof Error ? e.message : String(e)); } }} />}
      {overlay?.kind === "manual" && <ManualSheet onClose={() => setOverlay(null)} onSettings={() => setOverlay({ kind: "settings" })} />}
      {overlay?.kind === "about" && <AboutSheet engine={engine} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "gate" && project && <GateSheet project={project} gate={overlay.gate} onClose={() => setOverlay(null)} onApprove={() => update((p) => approve(p, (overlay as { gate: GateId }).gate))} />}
      {overlay?.kind === "impact" && project && (
        <ImpactSheet project={project} gate={overlay.gate} onCancel={() => setOverlay(null)}
          onConfirm={() => { update((p) => reviseApproved(p, overlay.gate, `Unlocked ${STAGE_LABEL[Object.entries(GATE_AFTER).find(([, v]) => v === overlay.gate)![0] as Stage]} for editing`, overlay.revKind)); setOverlay(null); }} />
      )}
      <span className="visually-hidden" role="status" aria-live="polite">{project ? `${STAGE_LABEL[stage]} page` : "Projects"}</span>
    </div>
  );
}
