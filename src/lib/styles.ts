import type { Dimension, MotionProject } from "../types";

export const DIMENSIONS: { id: Dimension; label: string }[] = [
  { id: "typography", label: "Typography" }, { id: "motion", label: "Motion" }, { id: "color", label: "Color" },
  { id: "texture", label: "Texture" }, { id: "camera", label: "Camera" }, { id: "transitions", label: "Transitions" },
  { id: "composition", label: "Composition" },
];
// The 12 v1 families named in the PRD. Tags drive conflict warnings. No family is the default identity.
export type FamilyCategory = "core" | "medium" | "movement" | "technique";
export const CATEGORY_LABEL: Record<FamilyCategory, string> = {"core": "Design languages", "medium": "Look and medium", "movement": "Movements and eras", "technique": "Techniques and genres"};
export const FAMILIES: { id: string; label: string; tags: string[]; category: FamilyCategory; prompt?: string }[] = [
  { id: "swiss", label: "Swiss / International", tags: ["grid-strict", "sparse"], category: "core" },
  { id: "editorial-minimal", label: "Editorial minimal", tags: ["sparse", "refined"], category: "core" },
  { id: "bauhaus", label: "Bauhaus / constructivist", tags: ["grid-strict", "geometric"], category: "core" },
  { id: "brutalist", label: "Brutalist", tags: ["high-density", "raw"], category: "core" },
  { id: "bold-kinetic", label: "Bold kinetic type", tags: ["high-density", "high-energy"], category: "core" },
  { id: "cinematic-title", label: "Cinematic title", tags: ["refined", "slow"], category: "core" },
  { id: "clean-broadcast", label: "Clean broadcast", tags: ["grid-strict", "polished"], category: "core" },
  { id: "cut-paper", label: "Cut-paper / handmade", tags: ["organic", "textured"], category: "core" },
  { id: "risograph", label: "Risograph / print", tags: ["organic", "textured"], category: "core" },
  { id: "retro-futurist", label: "Retro-futurist", tags: ["geometric", "high-energy"], category: "core" },
  { id: "neon-light", label: "Neon / light", tags: ["high-energy", "glow"], category: "core" },
  { id: "collage", label: "Collage", tags: ["organic", "high-density"], category: "core" },
  { id: "flat-2d", label: "Flat 2D", tags: ["geometric", "polished"], category: "medium", prompt: "flat 2D vector illustration, solid colour shapes, no gradients or shadows, clean edges" },
  { id: "vector-illustration", label: "Vector illustration", tags: ["geometric", "polished"], category: "medium", prompt: "crisp vector illustration with soft rounded shapes and a limited palette" },
  { id: "isometric", label: "Isometric", tags: ["geometric", "grid-strict"], category: "medium", prompt: "isometric illustration, 30 degree projection, clean blocks and tidy angles" },
  { id: "3d-render", label: "3D render", tags: ["polished", "glow"], category: "medium", prompt: "soft studio 3D render, glossy materials, shallow depth of field, global illumination" },
  { id: "claymation", label: "Claymation / stop-motion", tags: ["organic", "textured"], category: "medium", prompt: "claymation look, hand-sculpted clay forms, visible fingerprints, warm studio light" },
  { id: "low-poly", label: "Low poly", tags: ["geometric", "refined"], category: "medium", prompt: "low-poly 3D faceted geometry, flat-shaded triangles, simple lighting" },
  { id: "glassmorphism", label: "Glass / frosted UI", tags: ["polished", "refined"], category: "medium", prompt: "frosted glass panels over soft colour gradients, subtle blur, thin light borders" },
  { id: "hand-drawn", label: "Hand-drawn / doodle", tags: ["organic", "raw"], category: "medium", prompt: "hand-drawn doodle illustration, marker and pencil lines, imperfect, playful" },
  { id: "line-art", label: "Line art", tags: ["refined", "sparse"], category: "medium", prompt: "continuous thin line art, single weight strokes, no fills, lots of empty space" },
  { id: "pixel-art", label: "Pixel art / 8-bit", tags: ["geometric", "high-energy"], category: "medium", prompt: "pixel art, limited 16-colour palette, crisp square pixels, retro game feel" },
  { id: "watercolour", label: "Watercolour / ink wash", tags: ["organic", "textured"], category: "medium", prompt: "watercolour wash on paper, soft bleeding edges, paper grain, loose brush marks" },
  { id: "cel-animation", label: "Cel animation / cartoon", tags: ["high-energy", "polished"], category: "medium", prompt: "2D cel-shaded cartoon animation, bold black outlines, flat colour fills" },
  { id: "art-deco", label: "Art deco", tags: ["geometric", "refined"], category: "movement", prompt: "art deco, symmetrical gold line ornament, sunburst fans, deep navy and brass" },
  { id: "memphis", label: "Memphis / 80s postmodern", tags: ["high-energy", "geometric"], category: "movement", prompt: "Memphis design, squiggles, confetti shapes, clashing bright colours, playful patterns" },
  { id: "mid-century", label: "Mid-century modern", tags: ["refined", "geometric"], category: "movement", prompt: "mid-century modern graphics, boomerang and atomic shapes, muted orange, teal and mustard" },
  { id: "pop-art", label: "Pop art / halftone", tags: ["high-energy", "raw"], category: "movement", prompt: "pop art, bold black outlines, Ben-Day halftone dots, primary colours, comic energy" },
  { id: "psychedelic", label: "Psychedelic 60s", tags: ["organic", "high-energy"], category: "movement", prompt: "1960s psychedelic poster art, flowing concentric forms, vivid clashing colours" },
  { id: "vaporwave", label: "Vaporwave", tags: ["glow", "high-energy"], category: "movement", prompt: "vaporwave, pink and cyan gradients, grid floor, sunset, marble columns, nostalgic 90s" },
  { id: "y2k-chrome", label: "Y2K chrome", tags: ["polished", "glow"], category: "movement", prompt: "Y2K aesthetic, liquid chrome shapes, stars and orbs, silver and electric blue" },
  { id: "art-nouveau", label: "Art nouveau", tags: ["organic", "refined"], category: "movement", prompt: "art nouveau, flowing organic vines and flowers, ornamental borders, muted greens and golds" },
  { id: "title-sequence-60s", label: "60s title sequence (Bass-era)", tags: ["raw", "geometric"], category: "movement", prompt: "1960s film title design, torn cut-paper silhouettes, stark flat shapes, hand-lettered feel" },
  { id: "abstract-film", label: "Abstract film (Fischinger-era)", tags: ["high-energy", "geometric"], category: "movement", prompt: "early abstract film, rhythmic geometric shapes in motion, music-visualised forms on black" },
  { id: "glitch", label: "Glitch / datamosh", tags: ["raw", "high-energy"], category: "technique", prompt: "digital glitch art, RGB channel splits, scanline tears, corrupted pixel blocks" },
  { id: "vhs-analog", label: "VHS / analog video", tags: ["raw", "textured"], category: "technique", prompt: "VHS analog video look, tracking noise, scanlines, soft colour bleed, timestamp overlay" },
  { id: "blueprint", label: "Blueprint / technical drawing", tags: ["grid-strict", "sparse"], category: "technique", prompt: "technical blueprint drawing, white linework on deep blue, dimension lines, grid" },
  { id: "duotone", label: "Duotone", tags: ["polished", "sparse"], category: "technique", prompt: "bold duotone treatment, two ink colours only, strong contrast, graphic shapes" },
  { id: "liquid-gradient", label: "Liquid gradient / blur", tags: ["organic", "glow"], category: "technique", prompt: "fluid mesh gradients, soft blurred colour blobs, smooth flowing transitions" },
  { id: "data-viz", label: "Data visualisation", tags: ["grid-strict", "polished"], category: "technique", prompt: "clean data visualisation graphics, bars and lines, restrained palette, clear labels" },
  { id: "film-noir", label: "Film noir", tags: ["slow", "refined"], category: "technique", prompt: "film noir, hard side light, venetian blind shadows, deep blacks, monochrome" },
  { id: "cyberpunk", label: "Cyberpunk HUD", tags: ["glow", "high-density"], category: "technique", prompt: "cyberpunk interface graphics, neon HUD overlays, rain-slick night city, magenta and cyan" },
];
const CONFLICTS: { a: string; b: string; reason: string }[] = [
  { a: "grid-strict", b: "organic", reason: "A strict grid fights hand-made, irregular placement." },
  { a: "sparse", b: "high-density", reason: "Generous space and dense layouts pull in opposite directions." },
  { a: "slow", b: "high-energy", reason: "Slow, measured pacing clashes with high-energy motion." },
  { a: "refined", b: "raw", reason: "Refined polish and raw edges give mixed signals." },
];
/** How the family is described to an image model. Falls back to the name. */
export const familyPrompt = (id: string) => FAMILIES.find((f) => f.id === id)?.prompt ?? `${familyLabel(id).toLowerCase()} look`;
export const familyLabel = (id: string) => FAMILIES.find((f) => f.id === id)?.label ?? id;

/** A conflict is a pair; it is the same pair in either order. (The saved project lists dimensions A to Z, so the order after a reload is not the order it was made in.) */
export const samePair = (x: { a: string; b: string }, a: string, b: string): boolean => (x.a === a && x.b === b) || (x.a === b && x.b === a);

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
      const prior = p.style.conflicts.find((x) => samePair(x, a, b));
      out.push({ a, b, reason: c.reason, overridden: prior?.overridden ?? false });
    }
  }
  return out;
}

/** Use one family for every dimension at once (the "look"). Intensities already chosen are kept; conflicts cannot arise inside one family. */
export function applyLook(p: MotionProject, familyId: string): MotionProject {
  if (!FAMILIES.some((f) => f.id === familyId)) return p;
  const dims: MotionProject["style"]["dimensions"] = {};
  for (const d of DIMENSIONS) dims[d.id] = { familyId, intensity: p.style.dimensions[d.id]?.intensity ?? "moderate" };
  return { ...p, style: { ...p.style, dimensions: dims, conflicts: [] }, updatedAt: new Date().toISOString() };
}
/** The family used for all seven dimensions, or null when the dimensions differ or are not all chosen. */
export function currentLook(p: MotionProject): string | null {
  const ids = DIMENSIONS.map((d) => p.style.dimensions[d.id]?.familyId);
  return ids.every((x) => x && x === ids[0]) ? ids[0]! : null;
}
