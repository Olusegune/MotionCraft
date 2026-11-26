import { LockKeyhole } from "lucide-react";
import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import type { GateId, RevisionRecord } from "../types";
import { useApp } from "../ctx";
import { gateState, GATE_NAME } from "../lib/project";

export interface FrameProps { viewerOnly: boolean; inspectorOpen: boolean; onToggleInspector: () => void }

export function useLocked(g: GateId): boolean {
  const { project } = useApp();
  return gateState(project, g) === "approved";
}

/** Shown above approved material. Controls below it are disabled with this reason, never hidden. */
export function LockBar({ gate, kind }: { gate: GateId; kind: RevisionRecord["kind"] }) {
  const { unlockGate } = useApp();
  if (!useLocked(gate)) return null;
  return (
    <div className="lockbar" role="note">
      <LockKeyhole size={18} strokeWidth={1.75} aria-hidden="true" />
      <span>Approved at Gate {gate} ({GATE_NAME[gate].approves}), so editing is paused. Unlock to make changes; it is saved as a revision.</span>
      <button className="btn" onClick={() => unlockGate(gate, kind)}>Unlock to edit</button>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactElement<{ id?: string; "aria-describedby"?: string }>; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      {cloneElement(children, { id, "aria-describedby": hint ? `${id}-hint` : undefined })}
      {hint && <span className="hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

export function StatusLine({ label, text, tone = "neutral", icon }: { label: string; text: string; tone?: "neutral" | "ok" | "warn" | "error"; icon?: ReactNode }) {
  return <li className={`status-line ${tone}`}>{icon}<span className="sl-label">{label}</span><span className="sl-text">{text}</span></li>;
}
