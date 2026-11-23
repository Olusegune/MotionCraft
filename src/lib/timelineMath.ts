/**
 * The arithmetic of the director's timeline: where things sit on screen, which lane a layer takes, how the ruler is labelled.
 * No screen code, so it can be tested. Lane packing is the idea from Pulseframe's `laneMath.ts` (a0ee7ec, see docs/PORT_LEDGER.md):
 * layers that overlap in time go in different lanes, layers that never overlap share one, and the layer in front takes the first lane.
 */
export const PPS_MIN = 6;          // zoom: pixels per second
export const PPS_MAX = 400;
export const LANE_H = 24;

export const clampPps = (n: number): number => (Number.isFinite(n) ? Math.min(PPS_MAX, Math.max(PPS_MIN, Math.round(n))) : 24);
export const xFor = (t: number, pps: number): number => t * pps;
export const timeAt = (x: number, pps: number): number => (pps > 0 ? x / pps : 0);
/** Snap a time to the middle of whole frames, so the player lands on a real frame. */
export const snapFrame = (t: number, fps: number): number => (fps > 0 ? Math.round(t * fps) / fps : t);
export const clampTime = (t: number, duration: number): number => Math.min(Math.max(0, t), Math.max(0, duration));

/** A zoom that fits the whole piece in `width` pixels (never beyond the limits). */
export const fitPps = (duration: number, width: number): number => clampPps(duration > 0 ? (width - 8) / duration : 24);

export interface Box { left: number; width: number }
/** A bar for something that lasts from `a` to `b` seconds. Never thinner than 3 px, so a short layer can still be seen and clicked. */
export function barBox(a: number, b: number, pps: number): Box {
  return { left: xFor(Math.max(0, a), pps), width: Math.max(3, xFor(Math.max(0, b - a), pps)) };
}

export interface Span { id: number; start: number; end: number }
/** Lane numbers (0 = the first lane). `frontFirst` lists the ids with the layer in front first. The same input always gives the same lanes. */
export function packLanes(spans: Span[], frontFirst: number[]): Record<number, number> {
  const rank = new Map(frontFirst.map((id, i) => [id, i]));
  const lanes: Span[][] = [];
  const out: Record<number, number> = {};
  for (const s of [...spans].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9) || a.start - b.start || a.id - b.id)) {
    let lane = lanes.findIndex((l) => l.every((o) => o.end <= s.start + 1e-6 || o.start >= s.end - 1e-6));
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane].push(s);
    out[s.id] = lane;
  }
  return out;
}
export const laneCount = (lanes: Record<number, number>): number => (Object.keys(lanes).length ? Math.max(...Object.values(lanes)) + 1 : 0);

const STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
/** Seconds between labelled ruler ticks: the smallest nice step that keeps labels at least `minPx` apart. */
export function rulerStep(pps: number, minPx = 80): number {
  return STEPS.find((s) => s * pps >= minPx) ?? STEPS[STEPS.length - 1];
}
export function rulerTicks(duration: number, pps: number): number[] {
  const step = rulerStep(pps);
  const out: number[] = [];
  for (let t = 0; t <= duration + 1e-9 && out.length < 2000; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

/** Zoom is remembered for each project. Storage can be missing or blocked and what it holds may be damaged: every read is checked. */
const KEY = (project: string) => `mc-tl:${String(project).slice(0, 200)}`;
export function readPps(project: string, store: Pick<Storage, "getItem"> | null = safeStore()): number | undefined {
  try {
    const n = Number(JSON.parse(store?.getItem(KEY(project)) ?? "null")?.pps);
    return Number.isFinite(n) && n > 0 ? clampPps(n) : undefined;
  } catch { return undefined; }
}
export function writePps(project: string, pps: number, store: Pick<Storage, "setItem"> | null = safeStore()): void {
  try { store?.setItem(KEY(project), JSON.stringify({ pps: clampPps(pps) })); } catch { /* remembering is a convenience only */ }
}
/** The height of the timeline dock on Build, chosen by dragging the divider. Always at least DOCK_MIN, and the preview keeps at least PREVIEW_MIN of the page. */
export const DOCK_MIN = 120;
export const PREVIEW_MIN = 220;
export const clampDock = (h: number, total: number): number =>
  Number.isFinite(h) ? Math.round(Math.min(Math.max(DOCK_MIN, h), Math.max(DOCK_MIN, total - PREVIEW_MIN))) : DOCK_MIN;
const DOCK_KEY = (project: string) => `mc-dock:${String(project).slice(0, 200)}`;
export function readDock(project: string, store: Pick<Storage, "getItem"> | null = safeStore()): number | null {
  try {
    const n = Number(JSON.parse(store?.getItem(DOCK_KEY(project)) ?? "null")?.h);
    return Number.isFinite(n) && n > 0 ? Math.max(DOCK_MIN, Math.round(n)) : null;
  } catch { return null; }
}
export function writeDock(project: string, h: number | null, store: Pick<Storage, "setItem" | "removeItem"> | null = safeStore()): void {
  try { if (h === null) store?.removeItem(DOCK_KEY(project)); else store?.setItem(DOCK_KEY(project), JSON.stringify({ h: Math.max(DOCK_MIN, Math.round(h)) })); } catch { /* remembering is a convenience only */ }
}
function safeStore(): Storage | null { try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; } }
