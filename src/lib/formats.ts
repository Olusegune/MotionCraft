import type { Deliverable } from "../types";

/** The aspect ratios MotionCraft offers, each with its size at HD (1080 on the short side). Bigger or smaller sizes are these times a scale. */
export const BASE_SIZES: { aspect: Deliverable["aspect"]; width: number; height: number }[] = [
  { aspect: "16:9", width: 1920, height: 1080 }, { aspect: "9:16", width: 1080, height: 1920 }, { aspect: "1:1", width: 1080, height: 1080 },
  { aspect: "4:5", width: 1080, height: 1350 }, { aspect: "2.39:1", width: 2048, height: 858 }, { aspect: "21:9", width: 2560, height: 1080 },
];
export const FRAME_RATES: Deliverable["fps"][] = [23.976, 24, 25, 29.97, 30, 50, 60];

/** Resolutions by name: how much bigger than HD. */
export const RESOLUTIONS: { id: string; label: string; scale: number }[] = [
  { id: "hd720", label: "HD 720p", scale: 2 / 3 }, { id: "hd1080", label: "Full HD 1080p", scale: 1 }, { id: "uhd4k", label: "UHD 4K", scale: 2 },
];

const even = (n: number) => Math.max(16, Math.round(n / 2) * 2);

/** The size of an aspect at a scale (HD is 1). 16:9 at 2 is 3840 x 2160. Always even numbers. */
export function sizeFor(aspect: Deliverable["aspect"], scale: number): { width: number; height: number } {
  const b = BASE_SIZES.find((x) => x.aspect === aspect) ?? BASE_SIZES[0];
  return { width: even(b.width * scale), height: even(b.height * scale) };
}

/** The resolution a deliverable is at, by name, or null when its size is not one of ours. */
export function resolutionOf(d: Pick<Deliverable, "aspect" | "width" | "height">): string | null {
  for (const r of RESOLUTIONS) { const s = sizeFor(d.aspect, r.scale); if (s.width === d.width && s.height === d.height) return r.id; }
  return null;
}

/** The nearest allowed frame rate (23.976 to 60), or undefined when nothing is close. */
export function nearestFps(n: number): Deliverable["fps"] | undefined {
  const best = [...FRAME_RATES].sort((a, b) => Math.abs(a - n) - Math.abs(b - n))[0];
  return Math.abs(best - n) <= 0.6 ? best : undefined;
}

export const fpsLabel = (f: number): string => (Number.isInteger(f) ? String(f) : f.toFixed(3).replace(/0+$/, ""));
