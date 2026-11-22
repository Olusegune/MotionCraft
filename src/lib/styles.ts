import type { Dimension, MotionProject } from "../types";

export const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: "typography", label: "Typography" }, { id: "motion", label: "Motion" }, { id: "color", label: "Color" },
  { id: "texture", label: "Texture" }, { id: "camera", label: "Camera" }, { id: "transitions", label: "Transitions" },
  { id: "composition", label: "Composition" },
];
// The 12 v1 families named in the PRD. Tags drive conflict warnings. No family is the default identity.
export const FAMILIES: { id: string; label: string; tags: string[] }[] = [
  { id: "swiss", label: "Swiss / International", tags: ["grid-strict", "sparse"] },
  { id: "editorial-minimal", label: "Editorial minimal", tags: ["sparse", "refined"] },
  { id: "bauhaus", label: "Bauhaus / constructivist", tags: ["grid-strict", "geometric"] },
  { id: "brutalist", label: "Brutalist", tags: ["high-density", "raw"] },
  { id: "bold-kinetic", label: "Bold kinetic type", tags: ["high-density", "high-energy"] },
  { id: "cinematic-title", label: "Cinematic title", tags: ["refined", "slow"] },
  { id: "clean-broadcast", label: "Clean broadcast", tags: ["grid-strict", "polished"] },
  { id: "cut-paper", label: "Cut-paper / handmade", tags: ["organic", "textured"] },
  { id: "risograph", label: "Risograph / print", tags: ["organic", "textured"] },
  { id: "retro-futurist", label: "Retro-futurist", tags: ["geometric", "high-energy"] },
  { id: "neon-light", label: "Neon / light", tags: ["high-energy", "glow"] },
  { id: "collage", label: "Collage", tags: ["organic", "high-density"] },
];
const CONFLICTS: { a: string; b: string; reason: string }[] = [
  { a: "grid-strict", b: "organic", reason: "A strict grid fights hand-made, irregular placement." },
  { a: "sparse", b: "high-density", reason: "Generous space and dense layouts pull in opposite directions." },
  { a: "slow", b: "high-energy", reason: "Slow, measured pacing clashes with high-energy motion." },
  { a: "refined", b: "raw", reason: "Refined polish and raw edges give mixed signals." },
];
export const familyLabel = (id: string) => FAMILIES.find((f) => f.id === id)?.label ?? id;

export function detectConflicts(p: MotionProject) {
  const picks = Object.entries(p.style.dimensions).map(([d, v]) => ({ d, family: FAMILIES.find((f) => f.id === v!.familyId) }));
  const out: { a: string; b: string; reason: string; overridden: boolean }[] = [];
  for (let i = 0; i < picks.length; i++) for (let j = i + 1; j < picks.length; j++) {
    const fa = picks[i].family, fb = picks[j].family;
    if (!fa || !fb || fa.id === fb.id) continue;
    for (const c of CONFLICTS) {
      const hit = (fa.tags.includes(c.a) && fb.tags.includes(c.b)) || (fa.tags.includes(c.b) && fb.tags.includes(c.a));
      if (!hit) continue;
      const a = `${picks[i].d}:${fa.id}`, b = `${picks[j].d}:${fb.id}`;
      const prior = p.style.conflicts.find((x) => x.a === a && x.b === b);
      out.push({ a, b, reason: c.reason, overridden: prior?.overridden ?? false });
    }
  }
  return out;
}
