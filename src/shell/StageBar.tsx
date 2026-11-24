import { useRef } from "react";
import { Clapperboard, Compass, FileText, HeartPulse, PackageCheck, PanelsTopLeft, ScanEye, type LucideIcon } from "lucide-react";
import type { GateId, MotionProject, Stage } from "../types";
import { STAGES } from "../types";
import { GATE_AFTER, gateLabel, gateState, STAGE_LABEL } from "../lib/project";
import { GateGlyph } from "./GateDiamond";

export const STAGE_ICON: Record<Stage, LucideIcon> = {
  brief: FileText, intent: HeartPulse, direction: Compass, treatment: PanelsTopLeft, build: Clapperboard, review: ScanEye, deliver: PackageCheck,
};

/** Persistent bottom bar: Brief > Intent > A > Direction > B > Treatment > C > Build > Review > D > Deliver. */
export function StageBar({ project, stage, onStage, onGate }: {
  project: MotionProject; stage: Stage; onStage: (s: Stage) => void; onGate: (g: GateId) => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[data-stop]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    items[(i + (e.key === "ArrowRight" ? 1 : -1) + items.length) % items.length]?.focus();
  };
  return (
    <nav className="stagebar" aria-label="Stages" ref={ref} onKeyDown={onKey}>
      {STAGES.map((s) => {
        const Icon = STAGE_ICON[s];
        const g = GATE_AFTER[s];
        const st = g ? gateState(project, g) : null;
        return (
          <div className="stage-cell" key={s}>
            <button data-stop data-tool={s} className={`stage${stage === s ? " current" : ""}`} aria-current={stage === s ? "page" : undefined} onClick={() => onStage(s)}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" /><span>{STAGE_LABEL[s]}</span>
            </button>
            {g && st && (
              <button data-stop className={`gate gate-${st}`} aria-label={gateLabel(project, g)} title={gateLabel(project, g)} onClick={() => onGate(g)}>
                <GateGlyph state={st} /><span className="gate-letter" aria-hidden="true">{g}</span>
              </button>
            )}
          </div>
        );
      })}
    </nav>
  );
}
