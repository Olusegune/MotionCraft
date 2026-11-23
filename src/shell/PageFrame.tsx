import { useState, type ReactNode } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useApp } from "../ctx";
import { timecode } from "../lib/time";
import { STAGE_LABEL } from "../lib/project";
import { Frame } from "./Media";

export interface MainAction { label: string; onClick: () => void; disabledReason?: string; secondary?: { label: string; onClick: () => void; disabledReason?: string } }

/**
 * One layout for every page: large central area, optional left rail, collapsible right inspector with the page main
 * action pinned at its bottom, shallow story strip, and the stage bar (rendered by App).
 */
export function PageFrame({ title, intro, main, inspector, rail, strip, action, viewerOnly, inspectorOpen, onToggleInspector, compactHead }: {
  /** compactHead: the studio pages have no title row; the title stays for screen readers. */
  compactHead?: boolean; title: string; intro: string; main: ReactNode; inspector?: ReactNode; rail?: ReactNode; strip?: boolean; action?: MainAction;
  viewerOnly: boolean; inspectorOpen: boolean; onToggleInspector: () => void;
}) {
  const showSide = !viewerOnly;
  return (
    <div className={`frame${viewerOnly ? " viewer-only" : ""}${compactHead ? " compact" : ""}`}>
      {showSide && rail && <aside className="rail" aria-label="Rail">{rail}</aside>}
      <section className="center" aria-labelledby="page-title">
        <div className={`page-head${compactHead ? " compact" : ""}`}>
          <div><h1 id="page-title" className={compactHead ? "visually-hidden" : undefined}>{title}</h1><p className="intro">{intro}</p></div>
          {showSide && inspector && (
            <button className="icon-btn" aria-label={inspectorOpen ? "Collapse inspector" : "Expand inspector"} aria-expanded={inspectorOpen} onClick={onToggleInspector}>
              {inspectorOpen ? <PanelRightClose size={20} strokeWidth={1.75} /> : <PanelRightOpen size={20} strokeWidth={1.75} />}
            </button>
          )}
        </div>
        <div className="main">{main}</div>
        {showSide && strip && <StoryStrip />}
      </section>
      {showSide && (inspector || action) && (
        <aside className={`inspector${inspectorOpen ? "" : " collapsed"}`} aria-label="Inspector">
          <div className="inspector-body" hidden={!inspectorOpen}>{inspector}</div>
          {action && <ActionDock action={action} />}
        </aside>
      )}
    </div>
  );
}

export function ActionDock({ action }: { action: MainAction }) {
  const { secondary } = action;
  return (
    <div className="dock">
      <button className="btn primary" disabled={!!action.disabledReason} onClick={action.onClick}>{action.label}</button>
      {action.disabledReason && <p className="why" id="why-primary">{action.disabledReason}</p>}
      {secondary && (
        <>
          <button className="btn" disabled={!!secondary.disabledReason} onClick={secondary.onClick}>{secondary.label}</button>
          {secondary.disabledReason && <p className="why">{secondary.disabledReason}</p>}
        </>
      )}
    </div>
  );
}

/** Neutral surround, artwork stays brightest. Shows the latest engine preview, never live playback. */
export function Viewer({ aspect = "16 / 9", children }: { aspect?: string; children?: ReactNode }) {
  const { engine } = useApp();
  return (
    <div className="viewer-surround">
      <div className="viewer" style={{ aspectRatio: aspect }}>
        {children ?? (
          <div className="viewer-empty">
            <p className="strong">No preview yet</p>
            <p>{engine?.state === "connected"
              ? "Preview renders come from the engine through the adapter. The adapter is wired in ticket P1-11."
              : "The engine is not connected, so there is nothing to render. Brief to Treatment still work."}</p>
          </div>
        )}
      </div>
      <p className="viewer-meta"><span className="mono">--:--:--</span> No render yet. Targets: first preview 60 s, small edit 10 s.</p>
    </div>
  );
}

export function StoryStrip() {
  const { project, stage, projectPath } = useApp();
  const fps = project.brief.deliverables[0]?.fps ?? 30;
  const beats = project.intent.arc;
  return (
    <div className="strip" role="region" aria-label="Story strip">
      <div className="strip-row">
        <span className="strip-label">Beats</span>
        {beats.length === 0 ? <span className="muted">No beats yet. Add them on the Intent page.</span> : (
          <ol className="beats">{beats.map((b) => (
            <li key={b.beatId} className="beat">
              <Frame asset={(project.assets ?? []).find((a) => a.id === project.treatment[b.beatId]?.frameAssetId)} projectPath={projectPath} className="strip-frame" />
              <span className="mono">{timecode(b.startSec, fps)}</span><span>{b.primary || "Untitled beat"}</span></li>
          ))}</ol>
        )}
      </div>
      <div className="strip-row"><span className="strip-label">Audio</span><span className="muted">No audio imported. Waveform, beats and word timings appear here after analysis (Phase 3).</span></div>
      {stage === "intent" && <div className="strip-row"><span className="strip-label">Arc</span><span className="muted">{beats.length ? `${beats.length} beat${beats.length === 1 ? "" : "s"}, energy ${beats.map((b) => b.energy).join(" → ")}` : "Appears once beats exist."}</span></div>}
      <span className="visually-hidden">{STAGE_LABEL[stage]} story strip</span>
    </div>
  );
}

export function useInspectorState(): [boolean, () => void] {
  const [open, setOpen] = useState(true);
  return [open, () => setOpen((v) => !v)];
}
