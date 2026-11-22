import type { MotionProject } from "../types";

export interface Rule {
  id: string; label: string;
  when: (p: MotionProject) => boolean;
  timing: string; easing: string; typography: string; layout: string; transitions: string;
}
const maxEnergy = (p: MotionProject) => Math.max(0, ...p.intent.arc.map((b) => b.energy));

// Starting defaults from the PRD "Intent-to-parameter rules" table. User-editable rule tables are ticket P1-09.
export const DEFAULT_RULES: Rule[] = [
  { id: "calm", label: "Calm, energy 1-2",
    when: (p) => p.intent.arc.length > 0 && maxEnergy(p) <= 2,
    timing: "Long holds, few cuts", easing: "Long ease-out, no overshoot", typography: "Lighter weights, open tracking",
    layout: "Generous negative space", transitions: "Dissolves, slow push" },
  { id: "urgent", label: "Urgent, energy 4-5",
    when: (p) => maxEnergy(p) >= 4,
    timing: "Short holds", easing: "Sharp ease-in, overshoot allowed", typography: "Heavy weights, tight leading",
    layout: "Dense, high contrast", transitions: "Hard cuts, whips" },
  { id: "elegant", label: "Elegant", when: (p) => p.intent.tone.includes("elegant"),
    timing: "Measured, even rhythm", easing: "Smooth S-curves, no bounce", typography: "Refined serif or light sans",
    layout: "Asymmetric grid", transitions: "Mask reveals" },
  { id: "playful", label: "Playful", when: (p) => p.intent.tone.includes("playful"),
    timing: "Varied, syncopated", easing: "Bounce, squash and stretch", typography: "Rounded or variable weight",
    layout: "Loose, overlapping", transitions: "Pops, scale-ins" },
];
export function firedRules(p: MotionProject): Rule[] { return DEFAULT_RULES.filter((r) => r.when(p)); }
