import type { SongSection } from "../pages/build/SectionsBar";

export interface LyricLine { text: string; start: number; end: number; section?: string }
export interface MarkerItem { time: number; comment: string }

/** The composition markers for a song, the same comments the engine accepts (beat, section, lyric): the engine checks them again. */
export function markerItems(o: { beats?: number[]; sections?: SongSection[]; lyrics?: LyricLine[] }): MarkerItem[] {
  const items: MarkerItem[] = (o.beats ?? []).map((t) => ({ time: Math.round(t * 1000) / 1000, comment: "motioncraft:beat" }));
  for (const s of o.sections ?? []) items.push({ time: s.start, comment: `motioncraft:section:${s.label}` + (s.group && s.group.length <= 3 ? ` ${s.group}` : "") });
  for (const l of o.lyrics ?? []) items.push({ time: l.start, comment: "motioncraft:lyric:" + l.text.slice(0, 50) });
  return items.sort((a, b) => a.time - b.time || a.comment.localeCompare(b.comment)).slice(0, 3000);
}

export const clock = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
