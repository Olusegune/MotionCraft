import { useState } from "react";
import { ImagePlus } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { Frame, assetLabel, useImportMedia } from "../shell/Media";
import { gateState } from "../lib/project";
import { timecode } from "../lib/time";
import { LockBar, useLocked, type FrameProps } from "./common";

/** The storyboard: one frame per beat. Frames are pictures from the media wall (imported or generated). */
export function TreatmentPage(f: FrameProps) {
  const { project, projectPath, update, approveGate, go } = useApp();
  const imp = useImportMedia();
  const locked = useLocked("C");
  const beats = project.intent.arc;
  const [sel, setSel] = useState<string | null>(null);
  const current = beats.find((b) => b.beatId === sel) ?? beats[0];
  const fps = project.brief.deliverables[0]?.fps ?? 30;
  const d = project.brief.deliverables[0];
  const ratio = `${d.width} / ${d.height}`;
  const state = gateState(project, "C");
  const images = (project.assets ?? []).filter((a) => a.kind === "image");
  const frameOf = (beatId: string) => images.find((a) => a.id === project.treatment[beatId]?.frameAssetId);
  const missing = beats.filter((b) => !(project.treatment[b.beatId]?.plan ?? "").trim());
  const setT = (id: string, patch: Partial<{ plan: string; motion: string; frameAssetId?: string }>) =>
    update((p) => ({ ...p, treatment: { ...p.treatment, [id]: { ...(p.treatment[id] ?? { plan: "", motion: "" }), ...patch } }, updatedAt: new Date().toISOString() }));

  const main = beats.length === 0 ? (
    <div className="empty-page">
      <p className="strong">No beats to plan</p>
      <p>The storyboard has one frame per beat. Add beats on the Intent page first.</p>
      <button className="btn" onClick={() => go("intent")}>Go to Intent</button>
    </div>
  ) : (
    <div className="stack">
      <div className="viewer-surround" aria-label="Selected storyboard frame">
        <Frame asset={current ? frameOf(current.beatId) : undefined} projectPath={projectPath} ratio={ratio} className="big" />
        <p className="viewer-meta">{current ? <><span className="mono">{timecode(current.startSec, fps)}</span> {current.primary || "Untitled beat"}</> : null}</p>
      </div>
      <LockBar gate="C" kind="manual_edit" />
      <fieldset className="grp" disabled={locked}>
        <legend className="visually-hidden">Storyboard</legend>
        <ol className="board">
          {beats.map((b, n) => (
            <li key={b.beatId} className={`board-card${current?.beatId === b.beatId ? " on" : ""}`}>
              <button className="frame-btn" aria-label={`Show frame for beat ${n + 1}`} aria-pressed={current?.beatId === b.beatId} onClick={() => setSel(b.beatId)}>
                <Frame asset={frameOf(b.beatId)} projectPath={projectPath} ratio={ratio} />
              </button>
              <div className="board-body">
                <div className="beat-top"><span className="beat-n">Beat {n + 1}</span><span className="mono">{timecode(b.startSec, fps)} to {timecode(b.endSec, fps)}</span>
                  <span className="muted">{b.primary || "Untitled"} · intensity {b.intensity} · energy {b.energy}</span></div>
                <label className="field"><span className="field-label">Frame for beat {n + 1}</span>
                  <select value={project.treatment[b.beatId]?.frameAssetId ?? ""} onChange={(e) => setT(b.beatId, { frameAssetId: e.target.value || undefined })}>
                    <option value="">No frame</option>
                    {images.map((a) => <option key={a.id} value={a.id}>{assetLabel(a)}</option>)}
                  </select></label>
                <label className="field"><span className="field-label">Sequence plan</span>
                  <textarea rows={2} value={project.treatment[b.beatId]?.plan ?? ""} placeholder="What happens on screen in this beat?" onChange={(e) => setT(b.beatId, { plan: e.target.value })} /></label>
                <label className="field"><span className="field-label">Motion language</span>
                  <textarea rows={2} value={project.treatment[b.beatId]?.motion ?? ""} placeholder="How does it move? Easing, pace, transitions." onChange={(e) => setT(b.beatId, { motion: e.target.value })} /></label>
              </div>
            </li>
          ))}
        </ol>
      </fieldset>
    </div>
  );
  return (
    <PageFrame {...f} title="Treatment" intro="A storyboard: one frame and one plan per beat." strip main={main}
      inspector={<>
        <Fold title="Frames" defaultOpen meta={<span className="count">{images.length}</span>}>
          <p className="muted">Frames come from your media wall. Add pictures here or in the Brief, or generate them in Settings, Image and video providers.</p>
          <button className="btn" disabled={imp.busy} onClick={() => void imp.run()}><ImagePlus size={16} aria-hidden="true" />Add pictures…</button>
          {imp.error && <p className="error-text" role="alert">{imp.error}</p>}
        </Fold>
        <Fold title="Animatic"><p className="muted">The animatic plays frames over the audio. It is not an engine render. Audio arrives in Phase 3.</p></Fold>
      </>}
      action={{
        label: state === "approved" ? "Treatment approved" : "Approve treatment", onClick: () => approveGate("C"),
        disabledReason: state === "approved" ? "Already approved. Unlock to change it." : beats.length === 0 ? "Add beats on the Intent page first." : missing.length ? `Write a plan for ${missing.length} more beat${missing.length === 1 ? "" : "s"}.` : undefined,
        secondary: { label: "Preview animatic", onClick: () => undefined, disabledReason: "Needs audio (Phase 3)." },
      }} />
  );
}
