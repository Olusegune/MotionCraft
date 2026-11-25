import type { MotionProject, ProjectSummary } from "../types";
import type { EngineSnapshot } from "./layers";

export interface ProjectHealth { state: "ok" | "damaged" | "missing"; hasBackup: boolean; backupUpdatedAt?: string | null }
export interface UncleanSession { path: string; name: string; updatedAt: string; health: ProjectHealth }
export interface PreviewImage { width: number; height: number; png: string }
export type ProviderId = "byteplus" | "google" | "openai" | "kie" | "fal";
/** Credential-store accounts: the generation providers plus the two language-model-only ones. */
export type KeyAccount = ProviderId | "anthropic" | "openrouter";
export interface ModelEntry {
  provider: ProviderId; model: string; name: string; media: "image" | "video"; official: boolean; listed: boolean; source: string;
  price: { known: boolean; unit: string | null; value: number | null; note: string };
}
export interface ModelList { models: ModelEntry[]; status: Record<string, { refreshed: number | null; stale: boolean }> }
export interface GenJob {
  id: string; state: "queued" | "running" | "done" | "failed" | "cancelled"; detail: string; provider: ProviderId; model: string; kind: "image" | "video";
  estimate: { value: number | null; unit: string | null; label: "Estimate" | "Unknown" }; elapsed: number; error: string | null;
  asset: null | { path: string; kind: "image" | "video"; provenance: import("../types").AssetReference["provenance"] };
}

/** A newer signed release found by the desktop app. Notes are plain text. */
export interface UpdateInfo { version: string; current: string; notes: string | null }

export interface DropEvent { type: "enter" | "leave" | "drop"; paths: string[] }

export interface EngineStatus {
  state: "connected" | "missing" | "version-mismatch" | "error";
  found?: string; version?: string; pinned: string; detail: string;
}
export interface Api {
  list(): Promise<ProjectSummary[]>;
  create(p: MotionProject): Promise<ProjectSummary>;
  load(path: string): Promise<MotionProject>;
  save(path: string, p: MotionProject): Promise<void>;
  engineStatus(overridePath: string): Promise<EngineStatus>;
  openEffectCraft(path: string, overridePath: string): Promise<void>;
  /** Calls the Python engine helper (only a closed list of methods; the shell validates the package path). */
  engine<T = EngineSnapshot>(method: string, params: Record<string, unknown>, path: string, overridePath: string): Promise<T>;
  effectcraftWindowOpen(): Promise<boolean>;
  keyStatus(): Promise<Record<KeyAccount, boolean>>;
  setKey(provider: KeyAccount, key: string): Promise<void>;
  deleteKey(provider: KeyAccount): Promise<void>;
  /** The spend gate: call only from the click on the confirmation sheet. Returns a single-use token. */
  confirmSpend(provider: string, model: string): Promise<string>;
  assetDataUrl(path: string, rel: string): Promise<string>;
  projectsFolder(): Promise<string>;
  revealProjectsFolder(): Promise<void>;
  importProject(source: string): Promise<ProjectSummary>;
  /** The example project that ships with the app, as a folder path; null when this build has none. */
  exampleProject(): Promise<string | null>;
  duplicateProject(path: string, project: MotionProject): Promise<ProjectSummary>;
  /** Native menu clicks (File, Edit, ...) arrive here as ids. Returns an unsubscribe function. */
  onMenu(cb: (id: string) => void): Promise<() => void>;
  /** The system file/folder picker. Returns null when cancelled. */
  pickPath(kind: "folder" | "engine", startIn?: string): Promise<string | null>;
  appReady(): Promise<void>;
  startupStep(step: "ui" | "projects" | "engine"): Promise<void>;
  openDocs(): Promise<void>;
  /** Files dragged onto the window (desktop only: the browser never gives file paths). Returns the function that stops listening. */
  onFilesDropped(cb: (e: DropEvent) => void): Promise<() => void>;
  updateCheck(offline: boolean): Promise<UpdateInfo | null>;
  updateInstall(offline: boolean): Promise<void>;
  /** Crash recovery (P1-06): is the project file readable, restore the last good copy, and the "a project was open" marker. */
  projectHealth(path: string): Promise<ProjectHealth>;
  restoreBackup(path: string): Promise<void>;
  uncleanSession(): Promise<UncleanSession | null>;
  sessionBegin(path: string): Promise<void>;
  sessionEnd(): Promise<void>;
  pickMedia(): Promise<string[]>;
  /** Pulseframe's SongMap (.json): the file picker, and copying a checked one into the project (the shell validates it). */
  pickSongMap(): Promise<string | null>;
  importSongMap(path: string, source: string): Promise<{ path: string; name: string }>;
  /** A playable URL for a file under previews/, renders/ or assets/ of the project (the shell checks the path). */
  fileUrl(path: string, rel: string): Promise<string>;
  exportPackage(path: string, destParent: string): Promise<string>;
  importAsset(path: string, source: string): Promise<{ kind: "image" | "video" | "audio"; path: string; name: string }>;
}

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function tauriApi(): Promise<Api> {
  const { invoke } = await import("@tauri-apps/api/core");
  return {
    list: () => invoke("list_projects"),
    create: (p) => invoke("create_project", { project: p }),
    load: (path) => invoke("load_project", { path }),
    save: (path, p) => invoke("save_project", { path, project: p }),
    engineStatus: (overridePath) => invoke("engine_status", { overridePath }),
    openEffectCraft: (path, overridePath) => invoke("open_in_effectcraft", { path, overridePath }),
    engine: (method, params, path, overridePath) => invoke("engine_call", { method, params, overridePath, package: path }),
    effectcraftWindowOpen: () => invoke("effectcraft_window_open"),
    keyStatus: () => invoke("provider_key_status"),
    setKey: (provider, key) => invoke("set_provider_key", { provider, key }),
    deleteKey: (provider) => invoke("delete_provider_key", { provider }),
    confirmSpend: (provider, model) => invoke("confirm_spend", { provider, model }),
    assetDataUrl: (path, rel) => invoke("asset_data_url", { path, rel }),
    projectsFolder: () => invoke("projects_folder"),
    revealProjectsFolder: () => invoke("reveal_projects_folder"),
    importProject: (source) => invoke("import_project", { source }),
    exampleProject: () => invoke("example_project"),
    duplicateProject: (path, project) => invoke("duplicate_project", { path, project }),
    async onMenu(cb) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen<string>("menu", (e) => cb(e.payload));
    },
    async pickPath(kind, startIn) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open(kind === "folder"
        ? { directory: true, multiple: false, defaultPath: startIn, title: "Choose a .motioncraft project folder" }
        : { directory: false, multiple: false, defaultPath: startIn, title: "Locate effectcraft-cli", filters: [{ name: "EffectCraft CLI", extensions: ["exe", "*"] }] });
      return typeof r === "string" ? r : null;
    },
    appReady: () => invoke("app_ready"),
    startupStep: (step) => invoke("startup_step", { step }),
    openDocs: () => invoke("open_docs"),
    async onFilesDropped(cb) {
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      return getCurrentWebview().onDragDropEvent((e) => {
        const t = e.payload.type;
        if (t === "enter") cb({ type: "enter", paths: e.payload.paths });
        else if (t === "drop") cb({ type: "drop", paths: e.payload.paths });
        else if (t === "leave") cb({ type: "leave", paths: [] });
      });
    },
    updateCheck: (offline) => invoke("update_check", { offline }),
    updateInstall: (offline) => invoke("update_install", { offline }),
    projectHealth: (path) => invoke("project_health", { path }),
    restoreBackup: (path) => invoke("restore_backup", { path }),
    uncleanSession: () => invoke("unclean_session"),
    sessionBegin: (path) => invoke("session_begin", { path }),
    sessionEnd: () => invoke("session_end"),
    async pickSongMap() {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open({ multiple: false, directory: false, title: "Choose a Pulseframe SongMap", filters: [{ name: "SongMap", extensions: ["json"] }] });
      return typeof r === "string" ? r : null;
    },
    importSongMap: (path, source) => invoke("import_songmap", { path, source }),
    async pickMedia() {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open({ multiple: true, directory: false, title: "Add pictures, video or audio",
        filters: [{ name: "Pictures, video and audio", extensions: ["png", "jpg", "jpeg", "webp", "gif", "mp4", "mov", "webm", "wav", "mp3", "flac"] }] });
      return Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    },
    importAsset: (path, source) => invoke("import_asset", { path, source }),
    async fileUrl(path, rel) {
      const abs = await invoke<string>("package_file", { path, rel });
      const { convertFileSrc } = await import("@tauri-apps/api/core");
      return convertFileSrc(abs);
    },
    exportPackage: (path, destParent) => invoke("export_package", { path, destParent }),
  };
}

// Browser fallback (dev server, tests): projects live in localStorage and the engine is reported as missing.
function webApi(): Api {
  const idx = "motioncraft.web.projects";
  const readIdx = (): ProjectSummary[] => { try { return JSON.parse(localStorage.getItem(idx) ?? "[]"); } catch { return []; } };
  const summary = (p: MotionProject): ProjectSummary => ({ id: p.id, name: p.name, path: `web:${p.id}`, updatedAt: p.updatedAt });
  return {
    async list() { return readIdx().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async create(p) {
      localStorage.setItem(`motioncraft.web.${p.id}`, JSON.stringify(p));
      localStorage.setItem(idx, JSON.stringify([...readIdx().filter((x) => x.id !== p.id), summary(p)]));
      return summary(p);
    },
    async load(path) {
      const raw = localStorage.getItem(`motioncraft.web.${path.replace(/^web:/, "")}`);
      if (!raw) throw new Error("Project not found in this browser's storage.");
      return JSON.parse(raw);
    },
    async save(_path, p) {
      localStorage.setItem(`motioncraft.web.${p.id}`, JSON.stringify(p));
      localStorage.setItem(idx, JSON.stringify([...readIdx().filter((x) => x.id !== p.id), summary(p)]));
    },
    async engineStatus() {
      return { state: "missing", pinned: "0.24.1", detail: "The desktop app locates effectcraft-cli. This browser preview cannot." };
    },
    async openEffectCraft() { throw new Error("Open in EffectCraft needs the desktop app."); },
    async engine() { throw new Error("The engine runs in the desktop app. This browser preview cannot reach it."); },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async setKey() { throw new Error("Keys are stored in the operating system credential store, which needs the desktop app."); },
    async deleteKey() { /* nothing stored */ },
    async confirmSpend() { throw new Error("Spending needs the desktop app."); },
    async assetDataUrl() { throw new Error("Needs the desktop app."); },
    async projectsFolder() { return "(browser storage)"; },
    async revealProjectsFolder() { throw new Error("Needs the desktop app."); },
    async importProject() { throw new Error("Needs the desktop app."); },
    async exampleProject() { return null; },
    async duplicateProject(_path: string, p: MotionProject) {
      localStorage.setItem(`motioncraft.web.${p.id}`, JSON.stringify(p));
      localStorage.setItem(idx, JSON.stringify([...readIdx().filter((x) => x.id !== p.id), summary(p)]));
      return summary(p);
    },
    async onMenu() { return () => undefined; },
    async pickPath() { return null; },
    async appReady() { /* no splash in the browser */ },
    async startupStep() { /* no splash in the browser */ },
    async projectHealth() { return { state: "ok" as const, hasBackup: false }; },
    async restoreBackup() { throw new Error("Restoring a backup needs the desktop app."); },
    async uncleanSession() { return null; },
    async sessionBegin() { /* desktop only */ },
    async sessionEnd() { /* desktop only */ },
    async updateCheck() { return null; },
    async updateInstall() { throw new Error("Updates need the desktop app."); },
    async onFilesDropped() { return () => undefined; },
    async openDocs() { window.open("https://github.com/Olusegune/MotionCraft/tree/main/docs", "_blank", "noopener"); },
    async pickMedia() { return []; },
    async pickSongMap() { return null; },
    async importSongMap() { throw new Error("Importing a SongMap needs the desktop app."); },
    async importAsset() { throw new Error("Adding media needs the desktop app."); },
    async fileUrl() { throw new Error("Playback needs the desktop app."); },
    async exportPackage() { throw new Error("Exporting needs the desktop app."); },
  };
}

let cached: Promise<Api> | null = null;
export function getApi(): Promise<Api> {
  cached ??= isTauri() ? tauriApi() : Promise.resolve(webApi());
  return cached;
}
export function setApiForTests(api: Api) { cached = Promise.resolve(api); }
