import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { gateState } from "../lib/project";
import { timecode } from "../lib/time";
import { LockBar, useLocked, type FrameProps } from "./common";

export function TreatmentPage(f: FrameProps) {
  const { project, update, approveGate, go } = useApp();
  const locked = useLocked("C");
  const beats = project.intent.arc;
  const fps = project.brief.deliverables[0]?.fps ?? 30;
  const state = gateState(project, "C");
  const missing = beats.filter((b) => !(project.treatment[b.beatId]?.plan ?? "").trim());
  const setT = (id: string, patch: Partial<{ plan: string; motion: string }>) =>
    update((p) => ({ ...p, treatment: { ...p.treatment, [id]: { ...(p.treatment[id] ?? { plan: "", motion: "" }), ...patch } }, updatedAt: new Date().toISOString() }));

  const main = beats.length === 0 ? (
    <div className="empty-page">
      <p className="strong">No beats to plan</p>
      <p>The treatment is built beat by beat. Add beats on the Intent page first.</p>
      <button className="btn" onClick={() => go("intent")}>Go to Intent</button>
    </div>
  ) : (
    <div className="stack">
      <LockBar gate="C" kind="manual_edit" />
      <fieldset className="grp" disabled={locked}>
        <legend className="visually-hidden">Treatment</legend>
        <ol className="beat-list">
          {beats.map((b, n) => (
            <li key={b.beatId} className="beat-card">
              <div className="beat-top">
                <span className="beat-n">Beat {n + 1}</span>
                <span className="mono">{timecode(b.startSec, fps)} to {timecode(b.endSec, fps)}</span>
                <span className="muted">{b.primary || "Untitled"} · intensity {b.intensity} · energy {b.energy}</span>
              </div>
              <label className="field"><span className="field-label">Sequence plan</span>
                <textarea rows={2} value={project.treatment[b.beatId]?.plan ?? ""} placeholder="What happens on screen in this beat?" onChange={(e) => setT(b.beatId, { plan: e.target.value })} /></label>
              <label className="field"><span className="field-label">Motion language</span>
                <textarea rows={2} value={project.treatment[b.beatId]?.motion ?? ""} placeholder="How does it move? Easing, pace, transitions." onChange={(e) => setT(b.beatId, { motion: e.target.value })} /></label>
            </li>
          ))}
        </ol>
      </fieldset>
    </div>
  );
  return (
    <PageFrame {...f} title="Treatment" intro="A plan for each beat: what appears, how it moves, and when." strip main={main}
      inspector={<Fold title="Animatic" defaultOpen><p className="muted">The animatic plays style frames over the audio. It is not an engine render. Style frames and audio arrive in Phase 2 and 3.</p></Fold>}
      action={{
        label: state === "approved" ? "Treatment approved" : "Approve treatment", onClick: () => approveGate("C"),
        disabledReason: state === "approved" ? "Already approved. Unlock to change it." : beats.length === 0 ? "Add beats on the Intent page first." : missing.length ? `Write a plan for ${missing.length} more beat${missing.length === 1 ? "" : "s"}.` : undefined,
        secondary: { label: "Preview animatic", onClick: () => undefined, disabledReason: "Needs style frames and audio (Phases 2 and 3)." },
      }} />
  );
}
