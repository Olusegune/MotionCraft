import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { Lock, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { Fold } from "../../shell/Fold";
import { arcAt, arcPath, arcPoints, barBox, clampPps, clampTime, fitPps, laneCount, LANE_H, packLanes, readPps, rulerTicks, snapFrame, timeAt, waveBars, writePps } from "../../lib/timelineMath";
import { clock } from "../../lib/songmap";
import { timecode } from "../../lib/time";
import type { Beat } from "../../types";
import type { SongSection } from "./SectionsBar";

export interface TLMark { id: string; t: number; label: string; kind: "qa" | "version"; severity?: "info" | "warn" | "error" }
export type TimingChange = { tIn?: number; tOut?: number; delta?: number };
export interface TLLayer { id: number; name: string; kind: string; index: number; in: number; out: number; approved: boolean; changed?: boolean; madeBy?: string }

/**
 * The director's timeline (ADR-0007, stage T1): the whole piece on one strip, read-only. Audio structure, the intent arc and every layer
 * as a bar from its in point to its out point. Click anywhere to move the playhead; the player follows. Nothing here edits the
 * composition: keyframes, effects and properties stay in EffectCraft.
 */
export function TimelinePanel({ projectKey, duration, fps, playhead, onSeek, layers, sections = [], downbeats = [], arc = [], marks = [], selected, onSelect, editable = false, onTiming, message = null, open, onOpenChange, peaks, audioDuration }: {
  projectKey: string; duration: number; fps: number; playhead: number; onSeek: (t: number) => void; layers: TLLayer[];
  sections?: SongSection[]; downbeats?: number[]; arc?: Beat[]; marks?: TLMark[]; selected?: number | null; onSelect?: (id: number) => void;
  /** T3: layers can be moved and trimmed when true (never an approved layer). `onTiming` is the only way a change leaves this component. */
  editable?: boolean; onTiming?: (id: number, change: TimingChange) => void;
  /** The engine's reason when a move or trim was refused, shown here where the person is looking. */
  message?: string | null;
  /** Optional: the page can hide the timeline (Ctrl and J) to give the preview the whole height. */
  open?: boolean; onOpenChange?: (open: boolean) => void;
  /** The audio's loudness, drawn behind the sections, and how long the audio is. */
  peaks?: number[]; audioDuration?: number;
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

  // T3: drag a bar to move it, drag an edge to trim it. The change is sent once, on release, in whole frames; nothing is written while dragging.
  type Drag = { id: number; mode: "move" | "in" | "out"; x0: number; dx: number; moved: boolean };
  const [drag, setDrag] = useState<Drag | null>(null);
  const canEdit = (l: TLLayer) => editable && !l.approved && !!onTiming;
  const startDrag = (e: RPointerEvent, l: TLLayer, mode: Drag["mode"]) => {
    if (!canEdit(l) || e.button !== 0) return;
    e.stopPropagation();
    const d: Drag = { id: l.id, mode, x0: e.clientX, dx: 0, moved: false };
    setDrag({ ...d });
    const move = (ev: PointerEvent) => { d.dx = ev.clientX - d.x0; d.moved = d.moved || Math.abs(d.dx) > 3; setDrag({ ...d }); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!d.moved) { onSelect?.(l.id); return; }
      const dt = snapFrame(d.dx / pps, fps);
      if (Math.abs(dt) < 1 / fps / 2) return;
      onTiming?.(l.id, mode === "move" ? { delta: dt } : mode === "in" ? { tIn: snapFrame(clampTime(l.in + dt, duration), fps) } : { tOut: snapFrame(clampTime(l.out + dt, duration), fps) });
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
  };
  const barKey = (e: React.KeyboardEvent, l: TLLayer) => {
    if (!e.altKey || !canEdit(l) || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault(); e.stopPropagation();
    const dt = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1 : 1 / fps);
    onTiming?.(l.id, e.ctrlKey ? { tOut: snapFrame(clampTime(l.out + dt, duration), fps) } : { delta: dt });
  };
  const shown = (l: TLLayer) => {      // where the bar is drawn while it is being dragged
    if (!drag || drag.id !== l.id) return { a: l.in, b: l.out };
    const dt = drag.dx / pps;
    return drag.mode === "move" ? { a: l.in + dt, b: l.out + dt } : drag.mode === "in" ? { a: Math.min(l.in + dt, l.out - 1 / fps), b: l.out } : { a: l.in, b: Math.max(l.out + dt, l.in + 1 / fps) };
  };

  // The waveform is drawn once at a fixed pixel width and stretched to the lane, so a long piece at high zoom never makes a huge canvas.
  const wave = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = wave.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    const bars = waveBars(peaks ?? [], 1600);
    if (!bars.length) return;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--mc-text-3").trim() || "gray";
    const bw = c.width / bars.length;
    bars.forEach((p, i) => { const h = Math.max(1, p * (c.height - 4)); ctx.fillRect(i * bw, (c.height - h) / 2, Math.max(1, bw - 0.4), h); });
  }, [peaks]);
  const width = Math.max(1, duration * pps);
  const arcPts = useMemo(() => arcPoints(arc, duration), [arc, duration]);
  const arcD = useMemo(() => arcPath(arcPts, duration, width, 44), [arcPts, duration, width]);
  const arcNow = arcAt(arcPts, playhead);

  const lanes = useMemo(() => packLanes(layers.map((l) => ({ id: l.id, start: l.in, end: l.out })), [...layers].sort((a, b) => a.index - b.index).map((l) => l.id)), [layers]);
  const nLanes = laneCount(lanes);

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
    <Fold title="Timeline" defaultOpen open={open} onOpenChange={onOpenChange} meta={<span className="count">{layers.length} layers</span>}>
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
            {arc.length > 0 && <div className="tl-lab" style={{ height: 44 }}>Emotional arc</div>}
            <div className="tl-lab" style={{ height: 24 }}>QA and versions</div>
            <div className="tl-lab" style={{ height: Math.max(1, nLanes) * LANE_H + 8 }}>Layers</div>
          </div>
          <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
            <div className="tl-inner" style={{ width }} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("button")) seekAt(e.clientX, e.currentTarget); }}>
              <div className="tl-ruler" style={{ height: 24 }}>
                {rulerTicks(duration, pps).map((t) => <span key={t} className="tl-tick-label" style={{ left: t * pps }}>{clock(t)}</span>)}
              </div>
              <div className="tl-lane" style={{ height: 44 }} aria-label="Audio structure">
                {!!peaks?.length && <canvas ref={wave} className="tl-wave" width={1600} height={44} aria-hidden="true" style={{ width: Math.max(1, (audioDuration ?? duration) * pps) }} />}
                {sections.map((s, i) => <span key={i} className={`tl-sec e${Math.min(10, Math.max(1, s.energy))}`} style={{ ...barBox(s.start, s.end, pps), height: 40 }} title={`${s.label} ${s.group} · ${clock(s.start)} to ${clock(s.end)} · energy ${s.energy} of 10`}><span className="sec-name">{s.label}</span></span>)}
                {downbeats.slice(0, 2000).map((t, i) => <i key={i} className="tl-beat" style={{ left: t * pps }} aria-hidden="true" />)}
                {!sections.length && <span className="tl-empty">{downbeats.length ? "Beats only: analyse the audio for sections" : "No audio analysed yet (Audio panel)"}</span>}
              </div>
              <div className="tl-lane" style={{ height: 28 }} aria-label="Intent arc">
                {arc.map((b) => <span key={b.beatId} className="tl-arc" style={{ ...barBox(b.startSec, b.endSec, pps), height: 24 }} title={`${b.primary || "Beat"} · intensity ${b.intensity} · energy ${b.energy}`}><span className="sec-name">{b.primary || "Beat"}</span></span>)}
                {!arc.length && <span className="tl-empty">No intent beats yet</span>}
              </div>
              {arc.length > 0 && (
                <div className="tl-lane" style={{ height: 44 }} aria-label="Emotional arc curve">
                  <svg className="tl-arcsvg" width={width} height={44} aria-hidden="true">
                    <path d={`${arcD} L${width} 44 L0 44 Z`} className="tl-arcfill" />
                    <path d={arcD} className="tl-arcline" fill="none" />
                    <circle cx={Math.min(Math.max(playhead, 0), duration) / Math.max(duration, 0.001) * width} cy={4 + (1 - arcNow) * 36} r="5" className="tl-arcdot" />
                  </svg>
                </div>
              )}
              <div className="tl-lane" style={{ height: 24 }} aria-label="QA findings and saved versions">
                {marks.map((m) => (
                  <button key={`${m.kind}:${m.id}`} type="button" className={`tl-mark ${m.kind}${m.severity ? ` ${m.severity}` : ""}`} style={{ left: m.t * pps }}
                    aria-label={`${m.kind === "qa" ? "QA finding" : "Saved version"} at ${clock(m.t)}: ${m.label}`} title={`${m.label} · ${clock(m.t)}`} onClick={() => onSeek(snapFrame(clampTime(m.t, duration), fps))} />
                ))}
                {!marks.length && <span className="tl-empty">No QA findings with a time, no saved versions yet</span>}
              </div>
              <div className="tl-lane" style={{ height: Math.max(1, nLanes) * LANE_H + 8 }} aria-label="Layers">
                {layers.map((l) => {
                  const sh = shown(l); const edit = canEdit(l);
                  return (
                  <button key={l.id} type="button" className={`tl-layer${selected === l.id ? " on" : ""}${l.approved ? " approved" : ""}${edit ? " editable" : ""}${drag?.id === l.id ? " dragging" : ""}`} aria-pressed={selected === l.id}
                    aria-label={label(l)} aria-description={edit ? "Alt and Left or Right moves it, Ctrl and Alt trims its end" : undefined} title={label(l)}
                    style={{ ...barBox(sh.a, sh.b, pps), top: (lanes[l.id] ?? 0) * LANE_H + 2, height: LANE_H - 4 }} onClick={() => { if (!edit) onSelect?.(l.id); }}
                    onPointerDown={(e) => startDrag(e, l, "move")} onKeyDown={(e) => barKey(e, l)}>
                    {edit && <span className="tl-grip in" aria-hidden="true" onPointerDown={(e) => startDrag(e, l, "in")} />}
                    {l.approved && <Lock size={12} aria-hidden="true" />}<span className="sec-name">{l.name}</span>
                    {edit && <span className="tl-grip out" aria-hidden="true" onPointerDown={(e) => startDrag(e, l, "out")} />}
                  </button>
                  );
                })}
                {!layers.length && <span className="tl-empty">No layers yet</span>}
              </div>
              <div className="tl-playhead" role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(playhead * 1000) / 1000} aria-valuetext={timecode(playhead, fps)} style={{ left: playhead * pps }} />
            </div>
          </div>
        </div>
        {message && <p className="error-text" role="alert">{message}</p>}
        <p className="hint">Click to move the playhead; Left and Right step one frame (Shift: one second). Ctrl and the wheel zoom. {editable ? "Drag a layer to move it or its edges to trim it (Alt and arrows nudge). Approved layers stay put: unlock them first. Keyframes stay where they are in time; edit them in EffectCraft." : "Moving and trimming are off right now (EffectCraft has the project open, or the engine is busy). Keyframes and properties are edited in EffectCraft."}</p>
      </div>
    </Fold>
  );
}
