import type { MotionProject, Purpose, RuleSpec, Tone } from "../types";

export type Rule = RuleSpec;
export const RULE_FIELDS = ["timing", "easing", "typography", "layout", "transitions"] as const;
export const RULE_FIELD_LABEL: Record<(typeof RULE_FIELDS)[number], string> = { timing: "Timing", easing: "Easing", typography: "Typography", layout: "Layout", transitions: "Transitions" };

// Starting defaults from the PRD "Intent-to-parameter rules" table. A project may carry its own edited table (project.rules).
export const DEFAULT_RULES: RuleSpec[] = [
  { id: "calm", label: "Calm, energy 1-2", enabled: true, when: { energyAtMost: 2 },
    timing: "Long holds, few cuts", easing: "Long ease-out, no overshoot", typography: "Lighter weights, open tracking",
    layout: "Generous negative space", transitions: "Dissolves, slow push" },
  { id: "urgent", label: "Urgent, energy 4-5", enabled: true, when: { energyAtLeast: 4 },
    timing: "Short holds", easing: "Sharp ease-in, overshoot allowed", typography: "Heavy weights, tight leading",
    layout: "Dense, high contrast", transitions: "Hard cuts, whips" },
  { id: "elegant", label: "Elegant", enabled: true, when: { tones: ["elegant"] },
    timing: "Measured, even rhythm", easing: "Smooth S-curves, no bounce", typography: "Refined serif or light sans",
    layout: "Asymmetric grid", transitions: "Mask reveals" },
  { id: "playful", label: "Playful", enabled: true, when: { tones: ["playful"] },
    timing: "Varied, syncopated", easing: "Bounce, squash and stretch", typography: "Rounded or variable weight",
    layout: "Loose, overlapping", transitions: "Pops, scale-ins" },
];

export const activeRules = (p: MotionProject): RuleSpec[] => p.rules ?? DEFAULT_RULES;
const maxEnergy = (p: MotionProject) => Math.max(0, ...p.intent.arc.map((b) => b.energy));

/** Why a rule does or does not fire for this project, in plain words (one line per condition). */
export function explain(r: RuleSpec, p: MotionProject): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = r.enabled;
  if (!r.enabled) return { ok: false, lines: ["Switched off."] };
  const w = r.when, arc = p.intent.arc.length > 0, e = maxEnergy(p);
  const check = (pass: boolean, text: string) => { lines.push(`${pass ? "Yes" : "No"}: ${text}`); ok = ok && pass; };
  if (w.tones?.length) check(w.tones.some((t) => p.intent.tone.includes(t)), `tone includes ${w.tones.join(" or ")}`);
  if (w.purposes?.length) check(!!p.intent.purpose && w.purposes.includes(p.intent.purpose), `purpose is ${w.purposes.join(" or ")}`);
  if (w.energyAtLeast !== undefined) check(arc && e >= w.energyAtLeast, `a beat has energy ${w.energyAtLeast} or more (highest is ${arc ? e : "none yet"})`);
  if (w.energyAtMost !== undefined) check(arc && e <= w.energyAtMost, `every beat has energy ${w.energyAtMost} or less (highest is ${arc ? e : "none yet"})`);
  return { ok, lines };
}
export const fires = (r: RuleSpec, p: MotionProject) => explain(r, p).ok;
export function firedRules(p: MotionProject): RuleSpec[] { return activeRules(p).filter((r) => fires(r, p)); }

/** Null when the rule is usable, else what to fix. */
export function validateRule(r: RuleSpec, others: RuleSpec[]): string | null {
  if (!r.label.trim()) return "Give the rule a name.";
  if (others.some((o) => o.id !== r.id && o.label.trim().toLowerCase() === r.label.trim().toLowerCase())) return "Another rule already has that name.";
  const w = r.when;
  if (!w.tones?.length && !w.purposes?.length && w.energyAtLeast === undefined && w.energyAtMost === undefined) return "Pick at least one condition, or the rule would always apply.";
  for (const n of [w.energyAtLeast, w.energyAtMost]) if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 5)) return "Energy is a whole number from 1 to 5.";
  if (w.energyAtLeast !== undefined && w.energyAtMost !== undefined && w.energyAtLeast > w.energyAtMost) return "Energy 'at least' cannot be above 'at most'.";
  if (RULE_FIELDS.every((f) => !r[f].trim())) return "Say what the rule does to timing, easing, typography, layout or transitions.";
  for (const f of RULE_FIELDS) if (r[f].length > 160) return `${RULE_FIELD_LABEL[f]} is too long (160 characters).`;
  return null;
}

/** Plain summary of a rule's conditions for the list. */
export function whenText(w: RuleSpec["when"]): string {
  const parts: string[] = [];
  if (w.tones?.length) parts.push(`tone ${w.tones.join(" or ")}`);
  if (w.purposes?.length) parts.push(`purpose ${w.purposes.join(" or ")}`);
  if (w.energyAtLeast !== undefined) parts.push(`energy ≥ ${w.energyAtLeast}`);
  if (w.energyAtMost !== undefined) parts.push(`energy ≤ ${w.energyAtMost}`);
  return parts.join(", ") || "no condition";
}
export type { Tone, Purpose };
