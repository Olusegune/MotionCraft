import type { ApprovalRecord, ControlMode, Deliverable, GateId, ModeKey, MotionProject, RevisionRecord, Stage } from "../types";
import { PINNED_COMMIT, PINNED_VERSION } from "../types";
import { getSettings } from "./settings";

export const DEFAULT_MODES: Record<ModeKey, ControlMode> = {
  intent: "assisted", style: "assisted", treatment: "assisted", sound: "assisted",
  build: "assisted", "audio-sync": "assisted", "qa-fixes": "assisted",
};
/** Which control-mode key each page carries (UI_UX 4.3). Brief and Deliver have none. */
export const STAGE_MODE: Partial<Record<Stage, ModeKey>> = {
  intent: "intent", direction: "style", treatment: "treatment", build: "build", review: "qa-fixes",
};
export const STAGE_LABEL: Record<Stage, string> = {
  brief: "Brief", intent: "Intent", direction: "Direction", treatment: "Treatment", build: "Build", review: "Review", deliver: "Deliver",
};
/** The gate that sits after a stage, if any. Build and Review loop with no gate. */
export const GATE_AFTER: Partial<Record<Stage, GateId>> = { intent: "A", direction: "B", treatment: "C", review: "D" };
export const GATE_NAME: Record<GateId, { stage: string; approves: string; action: string }> = {
  A: { stage: "Intent", approves: "the interpretation", action: "Approve intent" },
  B: { stage: "Direction", approves: "one style direction", action: "Approve direction" },
  C: { stage: "Treatment", approves: "the treatment and timing map", action: "Approve treatment" },
  D: { stage: "Review", approves: "sign-off for the final render", action: "Approve for final render" },
};
/** Material each gate covers; editing it after approval needs a revision. Downstream = later gates. */
export const GATES: GateId[] = ["A", "B", "C", "D"];

export function newId(): string {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
export const nowIso = () => new Date().toISOString();

export const DEFAULT_DELIVERABLE: Deliverable = { aspect: "16:9", width: 1920, height: 1080, fps: 30, durationSec: 15, alpha: false };

export function createProject(name: string, deliverable: Deliverable = DEFAULT_DELIVERABLE): MotionProject {
  const t = nowIso();
  return {
    id: newId(), schemaVersion: "1.0", name,
    brief: { text: "", audio: [], references: [], brandDocs: [], storyboards: [], deliverables: [deliverable] },
    intent: { tone: [], arc: [], summary: "", firedRules: [], source: "user" },
    style: { dimensions: {}, conflicts: [] }, treatment: {}, review: { comments: [] },
    controlModes: { ...DEFAULT_MODES },
    engine: { kind: "effectcraft", version: PINNED_VERSION, commit: PINNED_COMMIT, projectPath: "comp.ecproj" },
    layerMap: [], assets: [], renders: [], approvals: [], revisions: [], budget: { capUsd: 10, approvalThresholdUsd: 1 }, createdAt: t, updatedAt: t,
  };
}

export type GateState = "not-reached" | "ready" | "approved" | "changed" | "needs-reapproval";

export function latestApproval(p: MotionProject, g: GateId): ApprovalRecord | undefined {
  for (let i = p.approvals.length - 1; i >= 0; i--) if (p.approvals[i].gate === g) return p.approvals[i];
}
/** Whether the work a gate approves is complete enough to approve. */
export function stageComplete(p: MotionProject, g: GateId): boolean {
  switch (g) {
    case "A": return !!p.intent.purpose && p.intent.summary.trim().length > 0 && p.intent.arc.length > 0;
    case "B": return Object.keys(p.style.dimensions).length > 0;
    case "C": return p.intent.arc.length > 0 && p.intent.arc.every((b) => (p.treatment[b.beatId]?.plan ?? "").trim().length > 0);
    case "D": return gateState(p, "C") === "approved";
  }
}
export function gateState(p: MotionProject, g: GateId): GateState {
  const a = latestApproval(p, g);
  if (a?.state === "approved") return "approved";
  if (a?.state === "changed_by_user") return "changed";
  if (a?.state === "revoked") return "needs-reapproval";
  if (g !== "A") { const prev = GATES[GATES.indexOf(g) - 1]; if (gateState(p, prev) !== "approved" && !stageComplete(p, g)) return "not-reached"; }
  return stageComplete(p, g) ? "ready" : "not-reached";
}
export const GATE_TEXT: Record<GateState, string> = {
  "not-reached": "not reached", ready: "ready for your approval", approved: "approved",
  changed: "changed since approval, review it", "needs-reapproval": "needs re-approval",
};
export function gateLabel(p: MotionProject, g: GateId): string {
  const st = gateState(p, g); const a = latestApproval(p, g);
  const when = a && st === "approved" ? ` ${new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "";
  const note = a && st === "needs-reapproval" && a.note ? `: ${a.note}` : "";
  return `Gate ${g}, ${GATE_NAME[g].stage}: ${GATE_TEXT[st]}${when}${note}`;
}

/** Gate whose approved material a stage edits. */
export const STAGE_GATE: Partial<Record<Stage, GateId>> = { intent: "A", direction: "B", treatment: "C", review: "D" };
export function approvedGatesAffectedBy(p: MotionProject, g: GateId): GateId[] {
  return GATES.slice(GATES.indexOf(g)).filter((x) => gateState(p, x) === "approved");
}

export function approve(p: MotionProject, g: GateId): MotionProject {
  const rec: ApprovalRecord = { gate: g, target: GATE_NAME[g].approves, by: "user", at: nowIso(), state: "approved" };
  return { ...p, approvals: [...p.approvals, rec], updatedAt: nowIso() };
}
/** Edit approved material: records a revision and revokes the affected gates. Nothing is deleted. */
export function reviseApproved(p: MotionProject, g: GateId, summary: string, kind: RevisionRecord["kind"]): MotionProject {
  const affected = approvedGatesAffectedBy(p, g);
  const rev: RevisionRecord = { id: newId(), at: nowIso(), actor: "user", kind, layers: [], summary };
  const n = p.revisions.length + 1;
  const revoked: ApprovalRecord[] = affected.map((x) => ({
    gate: x, target: GATE_NAME[x].approves, by: "user", at: nowIso(), state: "revoked", note: `after revision ${n}`,
  }));
  return { ...p, revisions: [...p.revisions, rev], approvals: [...p.approvals, ...revoked], updatedAt: nowIso() };
}
export function setMode(p: MotionProject, key: ModeKey, mode: ControlMode): MotionProject {
  return { ...p, controlModes: { ...p.controlModes, [key]: mode }, updatedAt: nowIso() };
}

/** True when a language model is chosen and usable right now (Settings, Language model). Set from the engine at start and after a change. */
export const hasAnyProvider = () => getSettings().llmReady;
export function effectiveMode(p: MotionProject, key: ModeKey): ControlMode {
  return hasAnyProvider() ? p.controlModes[key] : "manual";
}
