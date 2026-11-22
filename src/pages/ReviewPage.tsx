import { useState } from "react";
import { CircleHelp, CircleSlash, Trash2 } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame, Viewer } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { gateState, newId, nowIso } from "../lib/project";
import { parseSeconds, timecode } from "../lib/time";
import { StatusLine, type FrameProps } from "./common";

/** PRD tier 1 deterministic checks. None can run until the engine adapter is wired, so each says Not checked and why. */
const TIER1 = ["Missing assets and fonts", "Font licence for video use", "Frame rate", "Aspect ratio", "Low-resolution media", "Safe-title violations",
  "Text collisions", "Contrast on rendered frames", "Audio drift", "Beat misalignment", "Alpha errors", "Colour space", "Unsupported effects", "Orphan layers"];

export function ReviewPage(f: FrameProps) {
  const { project, update, approveGate, engine, go } = useApp();
  const [time, setTime] = useState("0");
  const [text, setText] = useState("");
  const fps = project.brief.deliverables[0]?.fps ?? 30;
  const sec = parseSeconds(time);
  const state = gateState(project, "D");
  const add = () => {
    if (sec === null || !text.trim()) return;
    update((p) => ({ ...p, review: { comments: [...p.review.comments, { id: newId().slice(0, 8), atSec: sec, text: text.trim(), at: nowIso() }].sort((a, b) => a.atSec - b.atSec) }, updatedAt: nowIso() }));
    setText("");
  };
  const reason = `Not checked: ${engine?.state === "connected" ? "the adapter is not wired yet (P1-11)" : "the engine is not connected"}.`;
  const main = (
    <div className="split-main"><Viewer />
      <div className="stack">
        <section aria-labelledby="notes-h"><h2 id="notes-h">Creative notes</h2>
          <div className="row end">
            <label className="field"><span className="field-label">Time (seconds or mm:ss)</span><input className="mono narrow" value={time} aria-invalid={sec === null} onChange={(e) => setTime(e.target.value)} /></label>
            <label className="field grow"><span className="field-label">Note</span><input value={text} placeholder="What should change at this moment?" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></label>
            <button className="btn" onClick={add} disabled={sec === null || !text.trim()}>Add note</button>
          </div>
          {sec === null && <p className="error-text">Enter a time like 12.5 or 0:12.</p>}
          {project.review.comments.length === 0 ? <p className="empty-note">No notes yet. Notes are pinned to a time and stay out of every export.</p> : (
            <ul className="notes">{project.review.comments.map((c) => (
              <li key={c.id}><span className="mono">{timecode(c.atSec, fps)}</span><span>{c.text}</span>
                <button className="icon-btn" aria-label={`Remove note at ${timecode(c.atSec, fps)}`} onClick={() => update((p) => ({ ...p, review: { comments: p.review.comments.filter((x) => x.id !== c.id) } }))}><Trash2 size={18} strokeWidth={1.75} /></button></li>))}</ul>)}
        </section>
      </div></div>
  );
  const inspector = (
    <>
      <Fold title="Technical findings" defaultOpen meta={<span className="count">0 raised</span>}>
        <p className="muted">Deterministic checks (tier 1). Each finding shows location, evidence, severity, likely cause and a next action.</p>
        <ul className="statuses">{TIER1.map((c) => <StatusLine key={c} label={c} text={reason} tone="warn" icon={<CircleHelp size={16} aria-hidden="true" />} />)}</ul>
      </Fold>
      <Fold title="Compare"><p className="muted"><CircleSlash size={16} aria-hidden="true" /> Needs at least two revision snapshots (P0-15 measures their size). Restore as new revision never deletes the other.</p></Fold>
      <Fold title="History" meta={<span className="count">{project.revisions.length}</span>}>
        {project.revisions.length === 0 ? <p className="muted">No revisions yet.</p> : (
          <ol className="plain">{[...project.revisions].reverse().map((r) => <li key={r.id}><span className="mono">{new Date(r.at).toLocaleString()}</span> {r.summary}</li>)}</ol>)}
      </Fold>
    </>
  );
  return (
    <PageFrame {...f} title="Review" intro="Watch it, note what to change, and sign off when it is ready for the final render." strip main={main} inspector={inspector}
      action={{
        label: state === "approved" ? "Approved for final render" : "Approve for final render", onClick: () => approveGate("D"),
        disabledReason: state === "approved" ? "Already approved. Final render is still never automatic." : state === "not-reached" ? "Approve the treatment (Gate C) first." : undefined,
        secondary: { label: "Request changes", onClick: () => go("build") },
      }} />
  );
}
