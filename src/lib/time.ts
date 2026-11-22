export function timecode(sec: number, fps = 30): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60), r = Math.floor(s % 60), f = Math.floor((s - Math.floor(s)) * fps);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}
export function parseSeconds(v: string): number | null {
  const t = v.trim(); if (!t) return null;
  if (t.includes(":")) {
    const parts = t.split(":").map(Number); if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  const n = Number(t); return Number.isFinite(n) && n >= 0 ? n : null;
}
