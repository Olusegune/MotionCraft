import type { Beat, MotionProject, Tone } from "../types";

/**
 * "Make it": the Director's draft turned into a starting look and a plan for every scene, so nobody fills three pages before seeing anything.
 * Everything here only proposes. The person reviews once, and approving is theirs.
 */

const TONE_LOOK: Partial<Record<Tone, string>> = {
  playful: "bold-kinetic", elegant: "editorial-minimal", authoritative: "clean-broadcast", trustworthy: "clean-broadcast",
  instructional: "swiss", provocative: "brutalist", restrained: "editorial-minimal",
};

/** A look that fits the intent: the first tone that maps to one, else by energy (calm or lively), else a quiet editorial default. */
export function suggestLook(p: Pick<MotionProject, "intent">): string {
  for (const t of p.intent.tone) { const f = TONE_LOOK[t]; if (f) return f; }
  const arc = p.intent.arc;
  const avg = arc.length ? arc.reduce((n, b) => n + b.energy, 0) / arc.length : 3;
  return avg >= 4 ? "bold-kinetic" : avg <= 2 ? "cinematic-title" : "editorial-minimal";
}

const PACE = ["a very slow, still pace", "a slow, calm pace", "a steady pace", "a lively pace", "a fast, driving pace"];

function planFor(b: Beat): string {
  const len = Math.max(0, b.endSec - b.startSec);
  return `${b.primary || "This scene"} (${len % 1 ? len.toFixed(1) : len} seconds): one clear idea on screen, set up in the first second and held with room to breathe.`;
}

/** One plan and one motion note per scene that has none yet, written from the scene's own name, length and energy. Never overwrites what a person wrote. */
export function fillTreatment(p: MotionProject): MotionProject {
  const treatment = { ...p.treatment };
  for (const b of p.intent.arc) {
    const cur = treatment[b.beatId];
    if ((cur?.plan ?? "").trim()) continue;
    treatment[b.beatId] = { ...cur, plan: planFor(b), motion: cur?.motion?.trim() ? cur.motion : `${PACE[b.energy - 1]}, building to intensity ${b.intensity} of 5` };
  }
  return { ...p, treatment };
}
