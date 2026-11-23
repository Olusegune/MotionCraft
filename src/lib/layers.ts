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

/** Layers the Builder agent just made: bind them to it (role, provenance, first motion) and log one agent revision. Approvals stay the user's. */
export interface Versions { before?: string | null; after?: string | null }

export function markBuilt(p: MotionProject, created: { layer: number; role: string; primitives: string[]; name: string }[], versions?: Versions): MotionProject {
  if (!created.length) return p;
  const ids = new Set(created.map((c) => c.layer));
  const roles = ["title", "body-text", "logo", "background", "texture", "camera", "audio-driver", "other"];
  const map = (p.layerMap ?? []).map((b) => {
    const c = created.find((x) => x.layer === b.engineLayerId);
    return c ? { ...b, role: (roles.includes(c.role) ? c.role : "other") as LayerBinding["role"], primitiveId: c.primitives[0], provenance: { ...b.provenance, actor: "agent:builder" as const } } : b;
  });
  const rev: RevisionRecord = { id: newId(), at: nowIso(), actor: "agent:builder", kind: "agent_edit", layers: [...ids], summary: `Builder made ${created.length} layers: ${created.map((c) => c.name).join(", ")}`,
    ...(versions?.after ? { snapshot: versions.after } : {}), ...(versions?.before ? { before: versions.before } : {}) };
  return { ...p, layerMap: map, revisions: [...p.revisions, rev], updatedAt: nowIso() };
}

/** A QA fix the user applied with one click: one revision, so it can be seen in History and undone by hand. Approvals are untouched. */
export function logQaFix(p: MotionProject, layers: number[], summary: string, versions?: Versions): MotionProject {
  const rev: RevisionRecord = { id: newId(), at: nowIso(), actor: "agent:qa", kind: "qa_fix", layers, summary,
    ...(versions?.after ? { snapshot: versions.after } : {}), ...(versions?.before ? { before: versions.before } : {}) };
  return { ...p, revisions: [...p.revisions, rev], updatedAt: nowIso() };
}

/** Points one imported asset at the file the QA check found. Only MotionCraft's own record changes. */
export function relinkAsset(p: MotionProject, assetId: string, to: string): MotionProject {
  if (!(p.assets ?? []).some((a) => a.id === assetId)) return p;
  return { ...p, assets: (p.assets ?? []).map((a) => (a.id === assetId ? { ...a, path: to } : a)), updatedAt: nowIso() };
}

/** The user moved or trimmed a layer on the timeline: one revision, with the saved versions around it so it can be compared and undone. */
export function logTiming(p: MotionProject, layer: number, summary: string, versions?: Versions): MotionProject {
  const rev: RevisionRecord = { id: newId(), at: nowIso(), actor: "user", kind: "manual_edit", layers: [layer], summary,
    ...(versions?.after ? { snapshot: versions.after } : {}), ...(versions?.before ? { before: versions.before } : {}) };
  return { ...p, revisions: [...p.revisions, rev], updatedAt: nowIso() };
}

/** The user saved a version of the composition by hand (Review, History). */
export function logVersion(p: MotionProject, id: string, label: string): MotionProject {
  const rev: RevisionRecord = { id: newId(), at: nowIso(), actor: "user", kind: "manual_edit", layers: [], summary: label.trim() || "Saved a version", snapshot: id };
  return { ...p, revisions: [...p.revisions, rev], updatedAt: nowIso() };
}

/**
 * After the engine restored an earlier version: which layer approvals still hold. An approval holds only if the layer is still there and
 * its content is exactly what was approved (same hash). Everything else loses its approval, with a note, and nothing is silently kept.
 */
export function restoreOutcome(p: MotionProject, snap: EngineSnapshot): { keep: number[]; revoke: number[] } {
  const keep: number[] = [], revoke: number[] = [];
  for (const b of p.layerMap ?? []) {
    if (b.lock !== "approved") continue;
    const l = snap.layers.find((x) => x.id === b.engineLayerId);
    (l && l.hash && l.hash === b.approvedHash ? keep : revoke).push(b.engineLayerId);
  }
  return { keep, revoke };
}

export function applyRestore(p: MotionProject, snap: EngineSnapshot, o: { label: string; restored: string; before: string }): MotionProject {
  const { keep, revoke } = restoreOutcome(p, snap);
  const compId = String(snap.activeComp ?? 0);
  const map: LayerBinding[] = [];
  for (const l of snap.layers) {
    if (!l.hash) continue;
    const b = (p.layerMap ?? []).find((x) => x.engineLayerId === l.id);
    if (!b) { map.push({ engineLayerId: l.id, compId, role: "other", provenance: { actor: "user", at: nowIso(), costReported: false }, lock: "none", lastKnownHash: l.hash }); continue; }
    const kept = keep.includes(l.id);
    map.push({ ...b, lastKnownHash: l.hash, lock: kept ? "approved" : "none", approvedHash: kept ? b.approvedHash : undefined });
  }
  const approvals = [...p.approvals, ...revoke.map((id) => ({ gate: "layer" as const, target: `${id}`, by: "user" as const, at: nowIso(), state: "revoked" as const, note: "restored an earlier version" }))];
  const rev: RevisionRecord = { id: newId(), at: nowIso(), actor: "user", kind: "manual_edit", layers: revoke, summary: `Restored: ${o.label}`, snapshot: o.restored, before: o.before };
  return { ...p, layerMap: map, approvals, revisions: [...p.revisions, rev], updatedAt: nowIso() };
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
