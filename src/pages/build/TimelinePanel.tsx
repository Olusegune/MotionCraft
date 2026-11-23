import { useEffect, useMemo, useRef, useState } from "react";
import { Lock, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Fold } from "../../shell/Fold";
import { barBox, clampPps, clampTime, fitPps, laneCount, LANE_H, packLanes, readPps, rulerTicks, snapFrame, timeAt, writePps } from "../../lib/timelineMath";
import { clock } from "../../lib/songmap";
import { timecode } from "../../lib/time";
import type { Beat } from "../../types";
import type { SongSection } from "./SectionsBar";

export interface TLLayer { id: number; name: string; kind: string; index: number; in: number; out: number; approved: boolean; changed?: boolean; madeBy?: string }

/**
 * The director's timeline (ADR-0007, stage T1): the whole piece on one strip, read-only. Audio structure, the intent arc and every layer
 * as a bar from its in point to its out point. Click anywhere to move the playhead; the player follows. Nothing here edits the
 * composition: keyframes, effects and properties stay in EffectCraft.
 */
export function TimelinePanel({ projectKey, duration, fps, playhead, onSeek, layers, sections = [], downbeats = [], arc = [], selected, onSelect }: {
  projectKey: string; duration: number; fps: number; playhead: number; onSeek: (t: number) => void; layers: TLLayer[];
  sections?: SongSection[]; downbeats?: number[]; arc?: Beat[]; selected?: number | null; onSelect?: (id: number) => void;
}) {
  const [pps, setPpsState] = useState(() => readPps(projectKey) ?? 24);
  const scroller = useRef<HTMLDivElement>(null);
  const setPps = (n: number, anchorPx?: number) => {
    const next = clampPps(n);
    const s = scroller.current;
    const ax = anchorPx ?? (s ? s.clientWidth / 2 : 0);
    const t = s ? (s.scrollLeft + ax) / pps : 0;
    setPpsState(next); writePps(projectKey, next);
    requestAnimationFrame(() => { if (s) s.scrollLeft = Math.max(0, t * next - ax); });
  };

  const lanes = useMemo(() => packLanes(layers.map((l) => ({ id: l.id, start: l.in, end: l.out })), [...layers].sort((a, b) => a.index - b.index).map((l) => l.id)), [layers]);
  const nLanes = laneCount(lanes);
  const width = Math.max(1, duration * pps);

  // keep the playhead in view when it moves out of it
  useEffect(() => {
    const s = scroller.current; if (!s) return;
    const x = playhead * pps;
    if (x < s.scrollLeft || x > s.scrollLeft + s.clientWidth - 24) s.scrollLeft = Math.max(0, x - s.clientWidth / 3);
  }, [playhead]);   // eslint-disable-line react-hooks/exhaustive-deps

  const seekAt = (clientX: number, el: HTMLElement) => onSeek(snapFrame(clampTime(timeAt(clientX - el.getBoundingClientRect().left, pps), duration), fps));
  const key = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select")) return;      // a focused bar or button keeps its own keys
    const step = e.shiftKey ? 1 : 1 / fps;
    if (e.key === "ArrowRight") { e.preventDefault(); onSeek(snapFrame(clampTime(playhead + step, duration), fps)); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(snapFrame(clampTime(playhead - step, duration), fps)); }
    else if (e.key === "Home") { e.preventDefault(); onSeek(0); }
    else if (e.key === "End") { e.preventDefault(); onSeek(duration); }
  };
  const onWheel = (e: React.WheelEvent) => { if (e.ctrlKey) { e.preventDefault(); setPps(pps * (e.deltaY < 0 ? 1.25 : 0.8), e.clientX - (scroller.current?.getBoundingClientRect().left ?? 0)); } };

  const label = (l: TLLayer) => `Layer ${l.name}, ${l.kind}, ${clock(l.in)} to ${clock(l.out)}${l.approved ? ", approved" : ""}${l.changed ? ", changed in EffectCraft" : ""}${l.madeBy ? `, made by ${l.madeBy}` : ""}`;

  return (
    <Fold title="Timeline" defaultOpen meta={<span className="count">{layers.length} layers</span>}>
      <div className="timeline" role="group" aria-label="Timeline" tabIndex={0} onKeyDown={key}>
        <div className="row-actions tl-bar-tools">
          <button className="icon-btn" aria-label="Zoom out" onClick={() => setPps(pps * 0.8)}><ZoomOut size={18} strokeWidth={1.75} /></button>
          <button className="icon-btn" aria-label="Zoom in" onClick={() => setPps(pps * 1.25)}><ZoomIn size={18} strokeWidth={1.75} /></button>
          <button className="icon-btn" aria-label="Fit the whole piece" onClick={() => { setPps(fitPps(duration, scroller.current?.clientWidth ?? 600)); if (scroller.current) scroller.current.scrollLeft = 0; }}><Maximize2 size={18} strokeWidth={1.75} /></button>
          <span className="muted" role="status">{pps} px per second · {timecode(playhead, fps)}</span>
        </div>
        <div className="tl-grid">
          <div className="tl-labels" aria-hidden="true">
            <div className="tl-lab" style={{ height: 24 }} />
            <div className="tl-lab" style={{ height: 44 }}>Audio</div>
            <div className="tl-lab" style={{ height: 28 }}>Intent</div>
            <div className="tl-lab" style={{ height: Math.max(1, nLanes) * LANE_H + 8 }}>Layers</div>
          </div>
          <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
            <div className="tl-inner" style={{ width }} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("button")) seekAt(e.clientX, e.currentTarget); }}>
              <div className="tl-ruler" style={{ height: 24 }}>
                {rulerTicks(duration, pps).map((t) => <span key={t} className="tl-tick-label" style={{ left: t * pps }}>{clock(t)}</span>)}
              </div>
              <div className="tl-lane" style={{ height: 44 }} aria-label="Audio structure">
                {sections.map((s, i) => <span key={i} className={`tl-sec e${Math.min(10, Math.max(1, s.energy))}`} style={{ ...barBox(s.start, s.end, pps), height: 40 }} title={`${s.label} ${s.group} · ${clock(s.start)} to ${clock(s.end)} · energy ${s.energy} of 10`}><span className="sec-name">{s.label}</span></span>)}
                {downbeats.slice(0, 2000).map((t, i) => <i key={i} className="tl-beat" style={{ left: t * pps }} aria-hidden="true" />)}
                {!sections.length && <span className="tl-empty">{downbeats.length ? "Beats only: analyse the audio for sections" : "No audio analysed yet (Audio panel)"}</span>}
              </div>
              <div className="tl-lane" style={{ height: 28 }} aria-label="Intent arc">
                {arc.map((b) => <span key={b.beatId} className="tl-arc" style={{ ...barBox(b.startSec, b.endSec, pps), height: 24 }} title={`${b.primary || "Beat"} · intensity ${b.intensity} · energy ${b.energy}`}><span className="sec-name">{b.primary || "Beat"}</span></span>)}
                {!arc.length && <span className="tl-empty">No intent beats yet</span>}
              </div>
              <div className="tl-lane" style={{ height: Math.max(1, nLanes) * LANE_H + 8 }} aria-label="Layers">
                {layers.map((l) => (
                  <button key={l.id} type="button" className={`tl-layer${selected === l.id ? " on" : ""}${l.approved ? " approved" : ""}`} aria-pressed={selected === l.id} aria-label={label(l)} title={label(l)}
                    style={{ ...barBox(l.in, l.out, pps), top: (lanes[l.id] ?? 0) * LANE_H + 2, height: LANE_H - 4 }} onClick={() => onSelect?.(l.id)}>
                    {l.approved && <Lock size={12} aria-hidden="true" />}<span className="sec-name">{l.name}</span>
                  </button>
                ))}
                {!layers.length && <span className="tl-empty">No layers yet</span>}
              </div>
              <div className="tl-playhead" role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(playhead * 1000) / 1000} aria-valuetext={timecode(playhead, fps)} style={{ left: playhead * pps }} />
            </div>
          </div>
        </div>
        <p className="hint">Click to move the playhead; Left and Right step one frame (Shift: one second). Ctrl and the wheel zoom. This view is read-only: open EffectCraft for keyframes and properties.</p>
      </div>
    </Fold>
  );
}
