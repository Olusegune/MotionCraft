import { SideRail } from "./shell/SideRail";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ControlMode, Deliverable, GateId, MotionProject, ProjectSummary, RevisionRecord, Stage } from "./types";
import { STAGES } from "./types";
import { Ctx, type AppCtx } from "./ctx";
import { getApi, type EngineStatus, type UpdateInfo } from "./lib/api";
import { updateSettings, useSettings } from "./lib/settings";
import { nextStep } from "./lib/nextStep";
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
import { Tour } from "./shell/Tour";
import { DropZone } from "./shell/Media";
import { UpdateBanner } from "./shell/UpdateBanner";
import { RecoverySheet } from "./shell/RecoverySheet";
import { shouldRecheckOnFocus } from "./lib/engineCheck";
import type { ProjectHealth } from "./lib/api";

const AUTOSAVE_MS = 30_000; // PRD target: at most 30 s of work lost
const DEBOUNCE_MS = 1_000;

type Overlay = null | { kind: "tour" } | { kind: "palette" } | { kind: "settings" } | { kind: "models" } | { kind: "copy" } | { kind: "manual" } | { kind: "about" } | { kind: "gate"; gate: GateId } | { kind: "impact"; gate: GateId; revKind: RevisionRecord["kind"] };

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
  const [update_, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [firstRunTour, setFirstRunTour] = useState(false);
  const [examplePath, setExamplePath] = useState<string | null>(null);
  useEffect(() => { getApi().then((a) => a.exampleProject()).then(setExamplePath).catch(() => setExamplePath(null)); }, []);
  const [recover, setRecover] = useState<null | { kind: "unclean" | "damaged"; summary: ProjectSummary; health: ProjectHealth; busy: boolean; error?: string }>(null);
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
  // Did the last session end badly (crash, kill, power loss)? The shell leaves a marker while a project is open and removes it on a normal exit.
  useEffect(() => {
    getApi().then((a) => a.uncleanSession()).then((u) => {
      if (u) setRecover({ kind: "unclean", summary: { id: "", name: u.name, path: u.path, updatedAt: u.updatedAt }, health: u.health, busy: false });
    }).catch(() => undefined);
  }, []);
  // Look for a newer signed release once at start, unless offline or switched off. Installing is always the person's click.
  const checkUpdates = useCallback(async (manual: boolean): Promise<string> => {
    if (settings.offline) return "Offline mode is on, so no check was made.";
    try {
      const info = await (await getApi()).updateCheck(settings.offline);
      setUpdateInfo(info);
      return info ? `MotionCraft ${info.version} is available.` : "You have the latest version.";
    } catch (e) { return manual ? `Could not check: ${e instanceof Error ? e.message : String(e)}` : ""; }
  }, [settings.offline]);
  useEffect(() => { if (inTauri && settings.autoUpdate && !settings.offline) void checkUpdates(false); }, [inTauri, settings.autoUpdate, settings.offline, checkUpdates]);
  const installUpdate = async () => {
    await flush();                                             // never lose work to a restart
    void (await getApi()).sessionEnd().catch(() => undefined);
    await (await getApi()).updateInstall(settings.offline);
  };
  // First run: show the tour once, on the projects page.
  useEffect(() => { if (!settings.tourSeen && !project && !listing && !firstRunTour) { setFirstRunTour(true); setOverlay({ kind: "tour" }); } }, [settings.tourSeen, project, listing, firstRunTour]);
  const closeTour = (start: boolean) => { updateSettings({ tourSeen: true }); setOverlay(null); if (start) { if (project) void home().then(() => setNewOpen(true)); else setNewOpen(true); } };

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

  const lastEngineCheck = useRef(0);
  const refreshEngine = useCallback(() => {
    lastEngineCheck.current = Date.now();
    setEngine(null);
    getApi().then((a) => a.engineStatus(settings.enginePath)).then(setEngine)
      .catch((e) => setEngine({ state: "error", pinned: "0.24.1", detail: String(e) }));
  }, [settings.enginePath]);
  useEffect(() => { refreshEngine(); }, [refreshEngine]);
  // Is a language model chosen and usable? Decides whether Assisted and Agent-led can be picked. Offline mode rules out cloud ones.
  useEffect(() => {
    getApi().then((a) => a.engine<{ ready: boolean }>("llm_status", { offline: settings.offline }, "", settings.enginePath))
      .then((s) => updateSettings({ llmReady: s.ready === true })).catch(() => updateSettings({ llmReady: false }));
  }, [settings.offline, settings.enginePath]);
  // The engine may be installed after MotionCraft started: look again when the window regains focus, only while it is missing, at most every 30 s.
  useEffect(() => {
    const onFocus = () => { if (shouldRecheckOnFocus(engine?.state, lastEngineCheck.current, Date.now())) refreshEngine(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [engine, refreshEngine]);

  // New pictures are looked at once by the language model, when it runs on this computer and is ready: lettering in a picture is flagged.
  const checking = useRef(false);
  const updateRef = useRef<(fn: (p: MotionProject) => MotionProject) => void>(() => undefined);
  useEffect(() => {
    if (!project || !settings.llmReady || checking.current) return;
    const next = (project.assets ?? []).find((a) => a.kind === "image" && !a.check);
    if (!next) return;
    checking.current = true;
    (async () => {
      let check: { lettering: boolean | null; text?: string } = { lettering: null };
      try {
        const api = await getApi();
        const st = await api.engine<{ ready: boolean; config: { provider: string | null; model: string }; providers: { id: string; local: boolean }[] }>("llm_status", { offline: settings.offline }, "", settings.enginePath);
        const { provider, model } = st.config;
        if (st.ready && provider && st.providers.find((x) => x.id === provider)?.local) {
          const r = await api.engine<{ has_text: boolean; text: string }>("picture_check", { rel: next.path, provider, model, offline: settings.offline }, pathRef.current, settings.enginePath);
          check = { lettering: r.has_text, text: r.text };
        } else { checking.current = false; return; }          // no local model: leave it unchecked, try again when there is one
      } catch { /* the model cannot see pictures, or the picture could not be read: recorded as not checked */ }
      updateRef.current((cur) => ({ ...cur, assets: (cur.assets ?? []).map((a) => (a.id === next.id ? { ...a, check } : a)) }));
      checking.current = false;
    })();
  }, [project, settings.llmReady, settings.offline, settings.enginePath]);

  const flush = useCallback(async () => {
    const p = latest.current;
    if (!p || !dirty.current) return;
    dirty.current = false;
    setSave({ kind: "saving" });
    try { await (await getApi()).save(pathRef.current, p); setSave((s) => (dirty.current ? s : { kind: "saved", at: Date.now() })); }
    catch (e) { dirty.current = true; setSave({ kind: "error", message: e instanceof Error ? e.message : String(e) }); }
  }, []);

  const debounce = useRef<number | undefined>(undefined);
  const update = useCallback((fn: (p: MotionProject) => MotionProject, saveNow = false) => {
    setProject((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      latest.current = next; dirty.current = true;
      return next;
    });
    setSave({ kind: "dirty" });
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void flush(), saveNow ? 0 : DEBOUNCE_MS);   // a gate change is saved at once
  }, [flush]);
  updateRef.current = update;

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
      const api = await getApi();
      const p = await api.load(s.path);
      pathRef.current = s.path; latest.current = p; dirty.current = false; setProject(p); setStage("brief"); setSave({ kind: "saved", at: Date.now() });
      void api.sessionBegin(s.path).catch(() => undefined);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/damaged|could not read/i.test(msg)) {   // offer the last good copy instead of just failing
        try { const h = await (await getApi()).projectHealth(s.path); if (h.state !== "ok") { setRecover({ kind: "damaged", summary: s, health: h, busy: false }); return; } } catch { /* fall through to the plain error */ }
      }
      setListError(`Could not open ${s.name}: ${msg}`);
    }
  };
  const create = async (name: string, d: Deliverable) => {
    const p = createProject(name, d);
    const s = await (await getApi()).create(p);
    pathRef.current = s.path; latest.current = p; dirty.current = false; setProject(p); setStage("brief"); setSave({ kind: "saved", at: Date.now() });
    void (await getApi()).sessionBegin(s.path).catch(() => undefined);
  };
  const home = async () => { await flush(); void (await getApi()).sessionEnd().catch(() => undefined); setProject(null); latest.current = null; setViewerOnly(false); void refreshProjects(); };
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
    // Golden path: approving on a page takes the person to the page the next step is on, and says what to do there.
    approveGate: (g, advance = true) => {
      const after = nextStep(approve(project, g));
      update((p) => approve(p, g), true);
      if (advance) { if (after) { setStage(after.stage); say(`Approved. Next: ${after.text}`); } else say("Approved. Everything is done."); }
    },
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
    items.push({ id: "tour", label: "Take the tour", run: () => setOverlay({ kind: "tour" }) });
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
      {update_ && <UpdateBanner info={update_} onInstall={installUpdate} onLater={() => setUpdateInfo(null)} />}
      {notice && <div className="notice" role="status">{notice}<button className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>×</button></div>}
      {!project || !ctx ? (
        <ProjectsPage projects={projects} loading={listing} error={listError} onExample={examplePath ? async () => { try { const api = await getApi(); await open(await api.importProject(examplePath)); } catch (e) { say(e instanceof Error ? e.message : String(e)); } } : undefined} onOpen={(p) => void open(p)} onCreate={create} newOpen={newOpen} setNewOpen={setNewOpen} onOpenFolder={() => void openFolder()}
          onReveal={() => getApi().then((a) => a.revealProjectsFolder()).catch((e) => say(String(e instanceof Error ? e.message : e)))} />
      ) : (
        <Ctx.Provider value={ctx}>
          <div className="body">
          {!viewerOnly && <SideRail stage={stage} onHome={() => void home()} onStage={setStage} onSettings={() => setOverlay({ kind: "settings" })} />}
          <div className="page" key={stage}>
            {stage === "brief" && <BriefPage {...frame} />}
            {stage === "intent" && <IntentPage {...frame} />}
            {stage === "direction" && <DirectionPage {...frame} />}
            {stage === "treatment" && <TreatmentPage {...frame} />}
            {stage === "build" && <BuildPage {...frame} />}
            {stage === "review" && <ReviewPage {...frame} />}
            {stage === "deliver" && <DeliverPage {...frame} />}
          </div>
          </div>
          <DropZone onNotice={say} />
          {viewerOnly && <button className="btn viewer-exit" onClick={() => setViewerOnly(false)}>Exit viewer-only (Esc)</button>}
          {!viewerOnly && (() => { const ns = nextStep(project); return ns ? (
            <div className="next-step" role="region" aria-label="Next step"><span className="next-label">Next</span><span>{ns.text}</span>{ns.stage !== stage && <button className="btn quiet" onClick={() => setStage(ns.stage)}>{ns.label}</button>}</div>
          ) : null; })()}
          <StageBar project={project} stage={stage} onStage={setStage} onGate={(g) => { const s = Object.entries(GATE_AFTER).find(([, v]) => v === g)?.[0] as Stage | undefined; if (s) setStage(s); setOverlay({ kind: "gate", gate: g }); }} />
        </Ctx.Provider>
      )}
      {recover && (
        <RecoverySheet kind={recover.kind} name={recover.summary.name} updatedAt={recover.summary.updatedAt} health={recover.health} busy={recover.busy} error={recover.error}
          onClose={() => setRecover(null)}
          onOpen={() => { const s = recover.summary; setRecover(null); void open(s); }}
          onRestore={async () => {
            setRecover((r) => r && { ...r, busy: true, error: undefined });
            try { const s = recover.summary; await (await getApi()).restoreBackup(s.path); setRecover(null); void refreshProjects(); await open(s); say("Restored the last good copy."); }
            catch (e) { setRecover((r) => r && { ...r, busy: false, error: e instanceof Error ? e.message : String(e) }); }
          }} />
      )}
      {overlay?.kind === "palette" && <Palette items={palette} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "settings" && <SettingsSheet engine={engine} onCheckUpdates={() => checkUpdates(true)} onClose={() => setOverlay(null)} onRecheck={refreshEngine} onModels={() => setOverlay({ kind: "models" })} />}
      {overlay?.kind === "tour" && <Tour onClose={() => closeTour(false)} onStart={() => closeTour(true)} />}
      {overlay?.kind === "models" && <ModelsSheet onClose={() => setOverlay(null)} />}
      {overlay?.kind === "copy" && project && <SaveCopySheet defaultName={`${project.name} copy`} onClose={() => setOverlay(null)} onSave={async (n) => { setOverlay(null); try { await saveCopy(n); } catch (e) { say(e instanceof Error ? e.message : String(e)); } }} />}
      {overlay?.kind === "manual" && <ManualSheet onClose={() => setOverlay(null)} onSettings={() => setOverlay({ kind: "settings" })} />}
      {overlay?.kind === "about" && <AboutSheet engine={engine} onClose={() => setOverlay(null)} />}
      {overlay?.kind === "gate" && project && <GateSheet project={project} gate={overlay.gate} onClose={() => setOverlay(null)} onApprove={() => {
        // Golden path: after a sign-off, close the sheet and take the person to the page the next step is on.
        const g = (overlay as { gate: GateId }).gate;
        const after = nextStep(approve(project, g));
        update((p) => approve(p, g), true);
        setOverlay(null);
        if (after) { setStage(after.stage); say(`Approved. Next: ${after.text}`); } else say("Approved. Everything is done.");
      }} />}
      {overlay?.kind === "impact" && project && (
        <ImpactSheet project={project} gate={overlay.gate} onCancel={() => setOverlay(null)}
          onConfirm={() => { update((p) => reviseApproved(p, overlay.gate, `Unlocked ${STAGE_LABEL[Object.entries(GATE_AFTER).find(([, v]) => v === overlay.gate)![0] as Stage]} for editing`, overlay.revKind), true); setOverlay(null); }} />
      )}
      <span className="visually-hidden" role="status" aria-live="polite">{project ? `${STAGE_LABEL[stage]} page` : "Projects"}</span>
    </div>
  );
}
