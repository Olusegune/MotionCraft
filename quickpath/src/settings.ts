// The few settings that are not secrets: today only the spending limit. Kept in settings.json in the QuickPath folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CAP_MIN = 0.5, CAP_MAX = 100, CAP_DEFAULT = 5;

export function effectiveCap(home: string): number {
  try {
    const raw = JSON.parse(readFileSync(join(home, "settings.json"), "utf-8"));
    const v = Number(raw.capUsd);
    if (Number.isFinite(v) && v >= CAP_MIN && v <= CAP_MAX) return v;
  } catch { /* none saved: fall through */ }
  const env = Number(process.env.QUICKPATH_SPEND_CAP_USD);
  return Number.isFinite(env) && env >= CAP_MIN && env <= CAP_MAX ? env : CAP_DEFAULT;
}

/** Saves the spending limit (in dollars, between 0.50 and 100). Returns the value saved. */
export function saveCap(home: string, usd: unknown): number {
  const v = Math.round(Number(usd) * 100) / 100;
  if (!Number.isFinite(v) || v < CAP_MIN || v > CAP_MAX) throw new Error(`The limit must be between $${CAP_MIN.toFixed(2)} and $${CAP_MAX}.`);
  mkdirSync(home, { recursive: true });
  let prior: Record<string, unknown> = {};
  try { if (existsSync(join(home, "settings.json"))) prior = JSON.parse(readFileSync(join(home, "settings.json"), "utf-8")); } catch { /* start fresh */ }
  writeFileSync(join(home, "settings.json"), JSON.stringify({ ...prior, capUsd: v }, null, 2));
  return v;
}
