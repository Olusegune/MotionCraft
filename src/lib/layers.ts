import type { ApprovalRecord, LayerBinding, MotionProject, RevisionRecord } from "../types";
import { newId, nowIso } from "./project";

/** What the engine helper reports for each layer (engine/motioncraft_engine/sidecar.py). */
export interface EngineLayer {
  id: number; name: string; kind: string; index: number; parent: number | null;
  nativeLocked: boolean; approvedHere: boolean; hash: string | null;
}
export interface EngineSnapshot {
  path: string | null; dirty: boolean; activeComp: number | null;
  comps: { id: number; name: string; width: number; height: number; frameRate: number; duration: number }[];
  layers: EngineLayer[];
}

export const bindingFor = (p: MotionProject, id: number) => (p.layerMap ?? []).find((b) => b.engineLayerId === id);

/**
 * Compare the engine's layer hashes with the stored ones (AGENTS.md: drift is logged, never overwritten).
 * - a layer we have not seen is bound to its creator (`user` when `isNew` ids are given by our own write, else `user` via EffectCraft)
 * - a changed hash on a layer we did not just write records one user revision; an approved layer also gets a
 *   `changed_by_user` approval record. The new hash is stored so it is reported once, and nothing is reverted.
 * `ownWrites` are layer ids this app just changed on purpose; they take the new hash silently.
 */
export function reconcile(p: MotionProject, snap: EngineSnapshot, ownWrites: number[] = []): MotionProject {
  const compId = snap.activeComp ?? 0;
  const map: LayerBinding[] = [...(p.layerMap ?? [])];
  const revisions: RevisionRecord[] = [...p.revisions];
  const approvals: ApprovalRecord[] = [...p.approvals];
  let changed = false;

  for (const l of snap.layers) {
    if (!l.hash) continue;
    const i = map.findIndex((b) => b.engineLayerId === l.id);
    if (i < 0) {
      map.push({ engineLayerId: l.id, compId: String(compId), role: "other", provenance: { actor: "user", at: nowIso(), costReported: false },
        lock: l.approvedHere ? "approved" : "none", lastKnownHash: l.hash });
      changed = true;
      continue;
    }
    const b = map[i];
    if (b.lastKnownHash === l.hash) continue;
    if (ownWrites.includes(l.id)) {
      map[i] = { ...b, lastKnownHash: l.hash };
      changed = true;
      continue;
    }
    revisions.push({ id: newId(), at: nowIso(), actor: "user", kind: "manual_edit", layers: [l.id], summary: `${l.name} was changed in EffectCraft` });
    if (b.lock === "approved" && b.approvedHash !== l.hash) {
      approvals.push({ gate: "layer", target: `${l.id}`, by: "user", at: nowIso(), state: "changed_by_user", note: l.name });
    }
    map[i] = { ...b, lastKnownHash: l.hash };
    changed = true;
  }
  return changed ? { ...p, layerMap: map, revisions, approvals, updatedAt: nowIso() } : p;
}

/** A layer shows "Changed in EffectCraft" while its latest layer approval says so and its hash still differs from the approved one. */
export function isChangedSinceApproval(p: MotionProject, l: EngineLayer): boolean {
  const b = bindingFor(p, l.id);
  return !!b && b.lock === "approved" && !!b.approvedHash && b.approvedHash !== l.hash;
}

export function approveLayer(p: MotionProject, l: EngineLayer): MotionProject {
  const map = (p.layerMap ?? []).map((b) => (b.engineLayerId === l.id ? { ...b, lock: "approved" as const, approvedHash: l.hash ?? undefined, lastKnownHash: l.hash ?? b.lastKnownHash } : b));
  return { ...p, layerMap: map, approvals: [...p.approvals, { gate: "layer", target: `${l.id}`, by: "user", at: nowIso(), state: "approved", note: l.name }], updatedAt: nowIso() };
}

export function unlockLayer(p: MotionProject, l: EngineLayer): MotionProject {
  const map = (p.layerMap ?? []).map((b) => (b.engineLayerId === l.id ? { ...b, lock: "none" as const, approvedHash: undefined } : b));
  const rev: RevisionRecord = { id: newId(), at: nowIso(), actor: "user", kind: "unlock", layers: [l.id], summary: `Unlocked ${l.name}` };
  return { ...p, layerMap: map, revisions: [...p.revisions, rev], approvals: [...p.approvals, { gate: "layer", target: `${l.id}`, by: "user", at: nowIso(), state: "revoked", note: `unlocked ${l.name}` }], updatedAt: nowIso() };
}
