import type { MotionProject, ProjectSummary } from "../types";
import type { EngineSnapshot } from "./layers";

export interface PreviewImage { width: number; height: number; png: string }

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
  };
}

let cached: Promise<Api> | null = null;
export function getApi(): Promise<Api> {
  cached ??= isTauri() ? tauriApi() : Promise.resolve(webApi());
  return cached;
}
export function setApiForTests(api: Api) { cached = Promise.resolve(api); }
