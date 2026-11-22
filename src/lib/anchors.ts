import type { Scale5 } from "../types";
// Every scale point has a written anchor (PRD: no unanchored dials).
export const ENERGY_ANCHORS: Record<Scale5, string> = {
  1: "Near-still: long holds, almost no movement",
  2: "Gentle: slow drifts and soft fades",
  3: "Steady: regular, readable motion",
  4: "Driving: quick cuts and strong accents",
  5: "Frantic: constant, rapid change",
};
export const INTENSITY_ANCHORS: Record<Scale5, string> = {
  1: "Barely felt: a hint of the emotion",
  2: "Subtle: present but understated",
  3: "Clear: the emotion is plainly the point",
  4: "Strong: dominates the beat",
  5: "Overwhelming: nothing else registers",
};
