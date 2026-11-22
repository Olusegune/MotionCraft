import { useSyncExternalStore } from "react";

export interface Settings { uiScale: number; offline: boolean; enginePath: string }
const KEY = "motioncraft.settings.v1";
const DEFAULTS: Settings = { uiScale: 100, offline: false, enginePath: "" };
const listeners = new Set<() => void>();
let cache: Settings | null = null;

function read(): Settings {
  if (cache) return cache;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    cache = { ...DEFAULTS, ...raw, uiScale: Math.min(250, Math.max(90, Number(raw.uiScale) || 100)) };
  } catch { cache = { ...DEFAULTS }; }
  return cache!;
}
export function updateSettings(patch: Partial<Settings>) {
  cache = { ...read(), ...patch };
  cache.uiScale = Math.min(250, Math.max(90, Math.round(cache.uiScale)));
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage unavailable: keep in memory */ }
  listeners.forEach((l) => l());
}
export function useSettings(): Settings {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, read, read);
}
export function resetSettingsCacheForTests() { cache = null; }
