import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronsLeft, ChevronsRight, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { timecode } from "../lib/time";

export interface Marker { t: number; label: string; kind: "beat" | "note" | "section" }
export interface PlayerHandle { seek(sec: number): void; time(): number; frame(): number }

/**
 * Plays the draft preview movie and gives frame-accurate control: step one frame, jump a second, scrub, see beat marks and notes
 * on the ruler. It plays the engine's own render, so what you see is what EffectCraft draws (at half resolution).
 * Keys when the player has focus: Space play or pause, Left and Right one frame, Shift with them one second, Home and End.
 */
export const Player = forwardRef<PlayerHandle, {
  src: string | null; fps: number; duration: number; markers?: Marker[]; peaks?: number[]; aspect?: string; stale?: boolean;
  emptyText?: string; onTime?: (t: number) => void; onMarkerClick?: (m: Marker) => void;
}>(function Player({ src, fps, duration, markers = [], peaks, aspect = "16 / 9", stale, emptyText, onTime, onMarkerClick }, ref) {
  const video = useRef<HTMLVideoElement>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [len, setLen] = useState(duration);
  const frame = (s: number) => Math.round(s * fps);
  const clamp = useCallback((s: number) => Math.min(Math.max(0, s), len || duration), [len, duration]);

  const seek = useCallback((s: number) => {
    const v = video.current;
    const target = clamp(frame(s) / fps + 0.5 / fps);           // the middle of the frame, so the browser shows that frame and not the one before
    if (v) v.currentTime = target;
    setT(clamp(frame(s) / fps));
  }, [clamp, fps]);   // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({ seek, time: () => t, frame: () => frame(t) }), [seek, t]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onTime?.(t); }, [t, onTime]);
  useEffect(() => { setPlaying(false); setT(0); }, [src]);

  // follow the video while it plays
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => { const v = video.current; if (v) setT(v.currentTime); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const toggle = () => { const v = video.current; if (!v) return; if (v.paused) { if (v.ended) v.currentTime = 0; void v.play(); } else v.pause(); };
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? fps : 1;
    if (e.key === " ") { e.preventDefault(); toggle(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); video.current?.pause(); seek((frame(t) + step) / fps); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); video.current?.pause(); seek((frame(t) - step) / fps); }
    else if (e.key === "Home") { e.preventDefault(); seek(0); }
    else if (e.key === "End") { e.preventDefault(); seek(len); }
  };
  const total = len || duration || 1;

  return (
    <div className="player" role="group" aria-label="Preview player" tabIndex={0} onKeyDown={key}>
      <div className="viewer-surround">
        <div className="viewer player-screen" style={{ aspectRatio: aspect }}>
          {src ? (
            <video ref={video} src={src} preload="auto" playsInline muted={false} aria-label="Preview movie"
              onLoadedMetadata={(e) => setLen(e.currentTarget.duration || duration)} onPlay={() => setPlaying(true)}
              onPause={() => { setPlaying(false); if (video.current) setT(video.current.currentTime); }}
              onEnded={() => setPlaying(false)} onSeeked={() => video.current && setT(video.current.currentTime)} />
          ) : <div className="viewer-empty"><p className="strong">No preview movie yet</p><p>{emptyText ?? "Press Build preview to render a draft you can play and scrub."}</p></div>}
        </div>
        <p className="viewer-meta" role="status">{src ? <>Draft at half resolution{stale ? " · Out of date: the project changed since" : ""}</> : "No render yet. Targets: first preview 60 s, small edit 10 s."}</p>
      </div>
      <div className="transport" aria-label="Transport">
        <button className="icon-btn" aria-label="Go to start" disabled={!src} onClick={() => seek(0)}><SkipBack size={18} strokeWidth={1.75} /></button>
        <button className="icon-btn" aria-label="Back one frame" disabled={!src} onClick={() => { video.current?.pause(); seek((frame(t) - 1) / fps); }}><ChevronsLeft size={18} strokeWidth={1.75} /></button>
        <button className="btn" disabled={!src} onClick={toggle} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={18} strokeWidth={1.75} aria-hidden="true" /> : <Play size={18} strokeWidth={1.75} aria-hidden="true" />}{playing ? "Pause" : "Play"}</button>
        <button className="icon-btn" aria-label="Forward one frame" disabled={!src} onClick={() => { video.current?.pause(); seek((frame(t) + 1) / fps); }}><ChevronsRight size={18} strokeWidth={1.75} /></button>
        <button className="icon-btn" aria-label="Go to end" disabled={!src} onClick={() => seek(total)}><SkipForward size={18} strokeWidth={1.75} /></button>
        <span className="mono timecode" aria-live="off" aria-label="Timecode">{timecode(t, fps)} / {timecode(total, fps)}</span>
        <span className="mono muted" aria-label="Frame">frame {frame(t)}</span>
      </div>
      <Ruler total={total} t={t} fps={fps} markers={markers} peaks={peaks} disabled={!src} onSeek={seek} onMarkerClick={onMarkerClick} />
    </div>
  );
});

function Ruler({ total, t, fps, markers, peaks, disabled, onSeek, onMarkerClick }: {
  total: number; t: number; fps: number; markers: Marker[]; peaks?: number[]; disabled: boolean; onSeek: (s: number) => void; onMarkerClick?: (m: Marker) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    if (!peaks?.length) return;
    const css = getComputedStyle(document.documentElement);
    ctx.fillStyle = css.getPropertyValue("--mc-text-3").trim() || "gray";
    const bw = w / peaks.length;
    peaks.forEach((p, i) => { const bh = Math.max(1, p * (h - 2)); ctx.fillRect(i * bw, (h - bh) / 2, Math.max(1, bw - 0.5), bh); });
  }, [peaks]);
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / total) * 100))}%`;
  return (
    <div className="ruler">
      <canvas ref={ref} width={1200} height={44} className="wave" aria-hidden="true" />
      <div className="marks">{markers.map((m, i) => (
        <button key={`${m.kind}-${i}`} className={`mark ${m.kind}`} style={{ left: pct(m.t) }} aria-label={`${m.label} at ${timecode(m.t, fps)}`} title={`${m.label} · ${timecode(m.t, fps)}`}
          onClick={() => { onSeek(m.t); onMarkerClick?.(m); }} tabIndex={m.kind === "beat" ? -1 : 0} />))}</div>
      <div className="playhead" style={{ left: pct(t) }} aria-hidden="true" />
      <input type="range" className="scrub" aria-label="Scrub" min={0} max={Math.max(1, Math.round(total * fps))} step={1} value={Math.round(t * fps)} disabled={disabled}
        onChange={(e) => onSeek(Number(e.target.value) / fps)} />
    </div>
  );
}
