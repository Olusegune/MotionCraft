import { CircleAlert, Lock } from "lucide-react";
import type { SceneStatus } from "../../lib/timelineMath";
import { clock } from "../../lib/songmap";

export interface SceneCard { id: string; name: string; start: number; end: number; status: SceneStatus; thumb?: string }

/**
 * The intent beats as a row of scenes under the picture (after the mockup). Each card shows a still from the composition at the middle of the beat,
 * its name and time, and a badge when it is approved or needs a look. Click a card to move the playhead to its start. Read-only.
 */
export function SceneStrip({ scenes, current, onSeek }: { scenes: SceneCard[]; current: number; onSeek: (t: number) => void }) {
  if (!scenes.length) return null;
  return (
    <ul className="scene-strip" aria-label="Scenes">
      {scenes.map((s, i) => {
        const badge = s.status === "approved" ? "Approved" : s.status === "needs-review" ? "Needs review" : null;
        return (
          <li key={s.id}>
            <button type="button" className={`scene-card${i === current ? " on" : ""}`} aria-current={i === current ? "true" : undefined}
              aria-label={`Scene ${s.name}, ${clock(s.start)} to ${clock(s.end)}${badge ? `, ${badge.toLowerCase()}` : ""}`} title={`${s.name} · ${clock(s.start)} to ${clock(s.end)}`} onClick={() => onSeek(s.start)}>
              <span className="scene-thumb">{s.thumb ? <img src={s.thumb} alt="" draggable={false} /> : <span className="scene-blank" aria-hidden="true" />}</span>
              <span className="scene-meta">
                <span className="scene-name">{s.name}</span>
                {badge && <span className={`scene-badge ${s.status}`}>{s.status === "approved" ? <Lock size={12} aria-hidden="true" /> : <CircleAlert size={12} aria-hidden="true" />}{badge}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
