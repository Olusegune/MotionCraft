import { clock } from "../../lib/songmap";

export interface SongSection { start: number; end: number; label: string; group: string; energy: number; mood: string }

/** The structure of a song as one bar: each section as long as it lasts, with its name. Text and shape carry the meaning; colour only helps. */
export function SectionsBar({ sections, duration }: { sections: SongSection[]; duration: number }) {
  if (!sections.length || duration <= 0) return null;
  const summary = sections.map((s) => `${s.label} ${clock(s.start)} to ${clock(s.end)}`).join(", ");
  return (
    <div className="sections-bar" role="img" aria-label={`Song structure: ${summary}`}>
      {sections.map((s, i) => (
        <span key={i} className={`sec e${Math.min(10, Math.max(1, s.energy))}`} style={{ flexGrow: Math.max(0.5, s.end - s.start) }}
          title={`${s.label} ${s.group} · ${clock(s.start)} to ${clock(s.end)} · energy ${s.energy} of 10 (${s.mood})`}>
          <span className="sec-name">{s.label}</span><span className="sec-time">{clock(s.start)}</span>
        </span>
      ))}
    </div>
  );
}
