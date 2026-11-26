import { createContext, useContext } from "react";
import type { GateId, MotionProject, RevisionRecord, Stage } from "./types";
import type { EngineStatus } from "./lib/api";

export interface AppCtx {
  project: MotionProject;
  projectPath: string;
  stage: Stage;
  engine: EngineStatus | null;
  /** Apply a change to material that is not covered by a gate. */
  update: (fn: (p: MotionProject) => MotionProject) => void;
  /**
   * Unlock approved material for editing. Opens the revision impact sheet; nothing changes until the user confirms.
   * Confirming records a revision and revokes the gate and every later approval. Nothing is deleted or reverted.
   */
  unlockGate: (gate: GateId, kind: RevisionRecord["kind"]) => void;
  /** Approves a gate. By default the app then moves to the page the next step is on; pass false to stay (several gates at once). */
  approveGate: (g: GateId, advance?: boolean) => void;
  go: (s: Stage) => void;
  refreshEngine: () => void;
  openEffectCraft: () => Promise<void>;
  showSettings: () => void;
  showGate: (g: GateId) => void;
}
export const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}
