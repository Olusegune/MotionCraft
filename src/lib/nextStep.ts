import type { MotionProject, Stage } from "../types";
import { gateState } from "./project";

/** The one thing worth doing next, from the project's own state. Pure, so the order of the golden path is tested, not guessed. */
export interface NextStep { text: string; stage: Stage; label: string }

export function nextStep(p: MotionProject): NextStep | null {
  if (!p.brief.text.trim() && !(p.brief.script ?? "").trim()) return { text: "Write or paste your brief", stage: "brief", label: "Open Brief" };
  if (gateState(p, "A") !== "approved" && p.intent.arc.length > 0) return { text: "Check the scenes, say what the piece is for, then approve the intent", stage: "intent", label: "Open Intent" };
  if (gateState(p, "A") !== "approved") return { text: "Press Make it to draft the plan, or fill in the intent yourself", stage: "brief", label: "Open Brief" };
  if (gateState(p, "B") !== "approved") return { text: "Approve the look on the Direction page", stage: "direction", label: "Open Direction" };
  if (gateState(p, "C") !== "approved") return { text: "Check each scene's plan and picture, then approve the treatment", stage: "treatment", label: "Open Treatment" };
  if (!(p.layerMap ?? []).length) return { text: "Plan the layers with the Builder and build them", stage: "build", label: "Open Build" };
  if (gateState(p, "D") !== "approved") return { text: "Review the draft, run the checks and sign off", stage: "review", label: "Open Review" };
  if (!(p.renders ?? []).length) return { text: "Render the final video", stage: "deliver", label: "Open Deliver" };
  return null;
}
