import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as RPointerEvent } from "react";
import { CircleAlert, Info, Lock, Minus, Plus } from "lucide-react";
import { Fold } from "../../shell/Fold";
import { arcAt, arcPath, arcPoints, barBox, clampPps, clampTime, fitPps, laneCount, LANE_H, packLanes, readMode, readPps, rulerTicks, snapFrame, timeAt, waveBars, writeMode, writePps, type SceneStatus } from "../../lib/timelineMath";
import { clock } from "../../lib/songmap";
import { timecode } from "../../lib/time";
import type { Beat } from "../../types";
import type { SongSection } from "./SectionsBar";

export interface TLMark { id: string; t: number; label: string; kind: "qa" | "version"; severity?: "info" | "warn" | "error" }
export type TimingChange = { tIn?: number; tOut?: number; delta?: number };
export interface TLLayer { id: number; name: string; kind: string; index: number; in: number; out: number; approved: boolean; changed?: boolean; madeBy?: string }
/** A scene on the timeline: one intent beat, with a still from the composition and a badge when it is approved or needs a look. */
export interface SceneCard { id: string; name: string; start: number; end: number; status: SceneStatus; thumb?: string }

const RULER_H = 22, SCENE_H = 78, SOUND_H = 48;

/**
 * The timeline, in two views (after FilmCrafter's "Film strip" and "Edit"):
 * - Film strip, the calm default: the scenes on the time axis over one soundtrack strip (waveform, sections, and the emotional arc as a line).
 *   Nothing to drag, nothing to squash. Click anywhere to move the playhead.
 * - Edit: the same, plus every layer as a bar. Drag a bar to move it, an edge to trim it, or use Alt and the arrows (ADR-0007, T3).
 * Keyframes, effects and properties stay in EffectCraft either way.
 */
export function TimelinePanel({ projectKey, duration, fps, playhead, onSeek, layers, sections = [], downbeats = [], arc = [], marks = [], scenes = [], selected, onSelect, editable = false, onTiming, message = null, open, onOpenChange, peaks, audioDuration }: {
  projectKey: string; duration: number; fps: number; playhead: number; onSeek: (t: number) => void; layers: TLLayer[];
  sections?: SongSection[]; downbeats?: number[]; arc?: Beat[]; marks?: TLMark[]; scenes?: SceneCard[]; selected?: number | null; onSelect?: (id: number) => void;
  /** T3: layers can be moved and trimmed when true (never an approved layer). `onTiming` is the only way a change leaves this component. */
  editable?: boolean; onTiming?: (id: number, change: TimingChange) => void;
  /** The engine's reason when a move or trim was refused, shown here where the person is looking. */
  message?: string | null;
  /** Optional: the page can hide the timeline (Ctrl and J) to give the preview the whole height. */
  open?: boolean; onOpenChange?: (open: boolean) => void;
  /** The audio's loudness, drawn as the waveform, and how long the audio is. */
  peaks?: number[]; audioDuration?: number;
}) {
  const saved = useRef(readPps(projectKey));
  const [pps, setPpsState] = useState(() => saved.current ?? 24);
  const [mode, setModeState] = useState<"strip" | "edit">(() => readMode(projectKey));
  const setMode = (m: "strip" | "edit") => { setModeState(m); writeMode(projectKey, m); };
  const edit = mode === "edit";
  const scroller = useRef<HTMLDivElement>(null);
  const setPps = (n: number, anchorPx?: number) => {
    const next = clampPps(n);
    const s = scroller.current;
    const ax = anchorPx ?? (s ? s.clientWidth / 2 : 0);
    const t = s ? (s.scrollLeft + ax) / pps : 0;
    setPpsState(next); writePps(projectKey, next);
    requestAnimationFrame(() => { if (s) s.scrollLeft = Math.max(0, t * next - ax); });
  };
  // The first time a project is opened the whole piece fits on screen, so the scenes read as a strip. Zoom is remembered after that.
  useLayoutEffect(() => {
    const w = scroller.current?.clientWidth ?? 0;
    if (saved.current === undefined && w > 0 && open !== false) setPpsState(fitPps(duration, w));
  }, [duration, open]);

  // T3: drag a bar to move it, drag an edge to trim it. The change is sent once, on release, in whole frames; nothing is written while dragging.
  type Drag = { id: number; mode: "move" | "in" | "out"; x0: number; dx: number; moved: boolean };
  const [drag, setDrag] = useState<Drag | null>(null);
  const canEdit = (l: TLLayer) => editable && !l.approved && !!onTiming;
  const startDrag = (e: RPointerEvent, l: TLLayer, m: Drag["mode"]) => {
    if (!canEdit(l) || e.button !== 0) return;
    e.stopPropagation();
    const d: Drag = { id: l.id, mode: m, x0: e.clientX, dx: 0, moved: false };
    setDrag({ ...d });
    const move = (ev: PointerEvent) => { d.dx = ev.clientX - d.x0; d.moved = d.moved || Math.abs(d.dx) > 3; setDrag({ ...d }); };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
      setDrag(null);
      if (!d.moved) { onSelect?.(l.id); return; }
      const dt = snapFrame(d.dx / pps, fps);
      if (Math.abs(dt) < 1 / fps / 2) return;
      onTiming?.(l.id, m === "move" ? { delta: dt } : m === "in" ? { tIn: snapFrame(clampTime(l.in + dt, duration), fps) } : { tOut: snapFrame(clampTime(l.out + dt, duration), fps) });
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

  // The waveform is drawn once at a fixed pixel width and stretched to the strip, so a long piece at high zoom never makes a huge canvas.
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
  const arcD = useMemo(() => arcPath(arcPts, duration, width, SOUND_H), [arcPts, duration, width]);
  const arcNow = arcAt(arcPts, playhead);

  const lanes = useMemo(() => packLanes(layers.map((l) => ({ id: l.id, start: l.in, end: l.out })), [...layers].sort((a, b) => a.index - b.index).map((l) => l.id)), [layers]);
  const nLanes = laneCount(lanes);
  const attention = scenes.filter((s) => s.status === "needs-review").length;
  const currentScene = scenes.findIndex((s) => playhead >= s.start && playhead < s.end);

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

  const hintText = `Click to move the playhead; Left and Right step one frame (Shift: one second). Ctrl and the wheel zoom. ${editable ? "In Edit, drag a layer to move it or its edges to trim it (Alt and arrows nudge). Approved layers stay put: unlock them first. Keyframes stay where they are in time; edit them in EffectCraft." : "Moving and trimming are off right now (EffectCraft has the project open, or the engine is busy)."}`;
  const label = (l: TLLayer) => `Layer ${l.name}, ${l.kind}, ${clock(l.in)} to ${clock(l.out)}${l.approved ? ", approved" : ""}${l.changed ? ", changed in EffectCraft" : ""}${l.madeBy ? `, made by ${l.madeBy}` : ""}`;
  const hasSound = !!peaks?.length || sections.length > 0 || downbeats.length > 0;

  return (
    <Fold title="Timeline" defaultOpen open={open} onOpenChange={onOpenChange}>
      <div className="timeline calm" role="group" aria-label="Timeline" tabIndex={0} onKeyDown={key}>
        <div className="tl-top">
          <div className="tl-legend" aria-hidden="true">
            <span><i className="dot wave" />Soundtrack</span>{arc.length > 0 && <span><i className="dot arc" />Emotional arc</span>}<span><i className="dot head" />Playhead</span>
          </div>
          {attention > 0 && <span className="tl-attn"><CircleAlert size={14} aria-hidden="true" />{attention} scene{attention === 1 ? "" : "s"} may need a look</span>}
          <span className="grow" />
          <span className="visually-hidden" role="status" title={hintText}>{pps} px per second · {timecode(playhead, fps)}</span>
          <span className="tl-info" tabIndex={0} role="img" aria-label={hintText} title={hintText}><Info size={16} aria-hidden="true" /></span>
          <div className="tl-zoom" role="group" aria-label="Zoom">
            <button className="icon-btn" aria-label="Zoom out" onClick={() => setPps(pps * 0.8)}><Minus size={16} strokeWidth={1.75} aria-hidden="true" /></button>
            <button className="btn quiet" aria-label="Fit the whole piece" onClick={() => { setPps(fitPps(duration, scroller.current?.clientWidth ?? 600)); if (scroller.current) scroller.current.scrollLeft = 0; }}>Fit</button>
            <button className="icon-btn" aria-label="Zoom in" onClick={() => setPps(pps * 1.25)}><Plus size={16} strokeWidth={1.75} aria-hidden="true" /></button>
          </div>
          <div className="tl-mode" role="group" aria-label="Timeline mode">
            <button aria-pressed={!edit} className={!edit ? "on" : ""} onClick={() => setMode("strip")} title="A calm view: the scenes and the soundtrack. Nothing to drag.">Film strip</button>
            <button aria-pressed={edit} className={edit ? "on" : ""} onClick={() => setMode("edit")} title="Adds every layer as a bar you can move and trim.">Edit</button>
          </div>
        </div>
        <div className="tl-scroll" ref={scroller} onWheel={onWheel}>
          <div className="tl-inner" style={{ width }} onPointerDown={(e) => { if (!(e.target as HTMLElement).closest("button")) seekAt(e.clientX, e.currentTarget); }}>
            <div className="tl-ruler" style={{ height: RULER_H }}>
              {rulerTicks(duration, pps).map((t) => <span key={t} className="tl-tick-label" style={{ left: t * pps }}>{clock(t)}</span>)}
              {marks.map((m) => (
                <button key={`${m.kind}:${m.id}`} type="button" className={`tl-mark ${m.kind}${m.severity ? ` ${m.severity}` : ""}`} style={{ left: m.t * pps }}
                  aria-label={`${m.kind === "qa" ? "QA finding" : "Saved version"} at ${clock(m.t)}: ${m.label}`} title={`${m.label} · ${clock(m.t)}`} onClick={() => onSeek(snapFrame(clampTime(m.t, duration), fps))} />
              ))}
            </div>

            {scenes.length > 0 && (
              <ul className="tl-scenes" aria-label="Scenes" style={{ height: SCENE_H }}>
                {scenes.map((s, i) => {
                  const badge = s.status === "approved" ? "Approved" : s.status === "needs-review" ? "Needs review" : null;
                  return (
                    <li key={s.id} style={{ left: s.start * pps, width: Math.max(44, (s.end - s.start) * pps - 6) }}>
                      <button type="button" className={`tl-scene${i === currentScene ? " on" : ""}`} aria-current={i === currentScene ? "true" : undefined}
                        aria-label={`Scene ${s.name}, ${clock(s.start)} to ${clock(s.end)}${badge ? `, ${badge.toLowerCase()}` : ""}`} title={`${s.name} · ${clock(s.start)} to ${clock(s.end)}`} onClick={() => onSeek(s.start)}>
                        {s.thumb && <img src={s.thumb} alt="" draggable={false} />}
                        <span className="tl-scene-label"><span className="tl-scene-name">{s.name}</span>
                          {badge && <span className={`tl-scene-badge ${s.status}`}>{s.status === "approved" ? <Lock size={11} aria-hidden="true" /> : <CircleAlert size={11} aria-hidden="true" />}{badge}</span>}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="tl-sound" style={{ height: SOUND_H }} aria-label="Audio structure">
              {!!peaks?.length && <canvas ref={wave} className="tl-wave" width={1600} height={SOUND_H} aria-hidden="true" style={{ width: Math.max(1, (audioDuration ?? duration) * pps), height: SOUND_H }} />}
              {sections.map((s, i) => <span key={i} className={`tl-sec e${Math.min(10, Math.max(1, s.energy))}`} style={{ ...barBox(s.start, s.end, pps), height: 18 }} title={`${s.label} ${s.group} · ${clock(s.start)} to ${clock(s.end)} · energy ${s.energy} of 10`}><span className="sec-name">{s.label}</span></span>)}
              {downbeats.slice(0, 2000).map((t, i) => <i key={i} className="tl-beat" style={{ left: t * pps }} aria-hidden="true" />)}
              {!hasSound && <span className="tl-empty">No audio analysed yet (Audio panel)</span>}
              {!sections.length && !!downbeats.length && <span className="tl-empty">Beats only: analyse the audio for sections</span>}
              {arc.length > 0 && (
                <div className="tl-arcwrap" aria-label="Emotional arc curve">
                  <svg className="tl-arcsvg" width={width} height={SOUND_H} aria-hidden="true">
                    <path d={`${arcD} L${width} ${SOUND_H} L0 ${SOUND_H} Z`} className="tl-arcfill" />
                    <path d={arcD} className="tl-arcline" fill="none" />
                    <circle cx={Math.min(Math.max(playhead, 0), duration) / Math.max(duration, 0.001) * width} cy={4 + (1 - arcNow) * (SOUND_H - 8)} r="5" className="tl-arcdot" />
                  </svg>
                </div>
              )}
            </div>

            {edit && (
              <div className="tl-lane tl-layers" style={{ height: Math.max(1, nLanes) * LANE_H + 8 }} aria-label="Layers">
                {layers.map((l) => {
                  const sh = shown(l); const ed = canEdit(l);
                  return (
                    <button key={l.id} type="button" className={`tl-layer${selected === l.id ? " on" : ""}${l.approved ? " approved" : ""}${ed ? " editable" : ""}${drag?.id === l.id ? " dragging" : ""}`} aria-pressed={selected === l.id}
                      aria-label={label(l)} aria-description={ed ? "Alt and Left or Right moves it, Ctrl and Alt trims its end" : undefined} title={label(l)}
                      style={{ ...barBox(sh.a, sh.b, pps), top: (lanes[l.id] ?? 0) * LANE_H + 2, height: LANE_H - 4 }} onClick={() => { if (!ed) onSelect?.(l.id); }}
                      onPointerDown={(e) => startDrag(e, l, "move")} onKeyDown={(e) => barKey(e, l)}>
                      {ed && <span className="tl-grip in" aria-hidden="true" onPointerDown={(e) => startDrag(e, l, "in")} />}
                      {l.approved && <Lock size={12} aria-hidden="true" />}<span className="sec-name">{l.name}</span>
                      {ed && <span className="tl-grip out" aria-hidden="true" onPointerDown={(e) => startDrag(e, l, "out")} />}
                    </button>
                  );
                })}
                {!layers.length && <span className="tl-empty">No layers yet. Add some in the panel on the right.</span>}
              </div>
            )}
            <div className="tl-playhead" role="slider" aria-label="Playhead" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={Math.round(playhead * 1000) / 1000} aria-valuetext={timecode(playhead, fps)} style={{ left: playhead * pps }} />
          </div>
        </div>
        {message && <p className="error-text" role="alert">{message}</p>}
        <p className="hint">{hintText}</p>
      </div>
    </Fold>
  );
}
