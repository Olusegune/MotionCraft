import { useRef, useState } from "react";
import { CircleHelp, CircleSlash, MessageSquarePlus, Trash2 } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { Player, type Marker, type PlayerHandle } from "../shell/Player";
import { gateState, newId, nowIso } from "../lib/project";
import { timecode } from "../lib/time";
import { StatusLine, type FrameProps } from "./common";
import { usePreviewMovie } from "./build/usePreview";

/** PRD tier 1 deterministic checks. None can run until their data exists, so each says Not checked and why. */
const TIER1 = ["Missing assets and fonts", "Font licence for video use", "Frame rate", "Aspect ratio", "Low-resolution media", "Safe-title violations",
  "Text collisions", "Contrast on rendered frames", "Audio drift", "Beat misalignment", "Alpha errors", "Colour space", "Unsupported effects", "Orphan layers"];

export function ReviewPage(f: FrameProps) {
  const { project, update, approveGate, engine, go } = useApp();
  const movie = usePreviewMovie();
  const player = useRef<PlayerHandle>(null);
  const [text, setText] = useState("");
  const [head, setHead] = useState(0);
  const d = project.brief.deliverables[0];
  const fps = d.fps;
  const state = gateState(project, "D");
  const add = () => {
    if (!text.trim()) return;
    const at = player.current?.frame() !== undefined ? (player.current.frame() / fps) : head;
    update((p) => ({ ...p, review: { ...p.review, comments: [...p.review.comments, { id: newId().slice(0, 8), atSec: at, text: text.trim(), at: nowIso() }].sort((a, b) => a.atSec - b.atSec) }, updatedAt: nowIso() }));
    setText("");
  };
  const reason = `Not checked: ${engine?.state === "connected" ? "this check is not built yet" : "the engine is not connected"}.`;
  const markers: Marker[] = project.review.comments.map((c) => ({ t: c.atSec, label: c.text, kind: "note" as const }));

  const main = (
    <div className="split-main">
      <Player ref={player} src={movie.url} fps={fps} duration={d.durationSec} aspect={`${d.width} / ${d.height}`} stale={movie.stale} markers={markers} onTime={setHead}
        emptyText="Build a preview on the Build page, then review it here frame by frame." />
      {!movie.hasPreview && <p className="why">No draft yet. <button className="btn quiet" onClick={() => go("build")}>Go to Build</button></p>}
      <section aria-labelledby="notes-h"><h2 id="notes-h">Notes at the playhead</h2>
        <div className="row end">
          <label className="field grow"><span className="field-label">Note at <span className="mono">{timecode(head, fps)}</span> (frame {Math.round(head * fps)})</span>
            <input value={text} placeholder="What should change at this exact frame?" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") add(); }} /></label>
          <button className="btn" onClick={add} disabled={!text.trim()}><MessageSquarePlus size={16} aria-hidden="true" />Add note</button>
        </div>
        {project.review.comments.length === 0 ? <p className="empty-note">No notes yet. Notes are pinned to a frame and stay out of every export.</p> : (
          <ul className="notes">{project.review.comments.map((c) => (
            <li key={c.id}><button className="btn quiet mono" aria-label={`Go to ${timecode(c.atSec, fps)}`} onClick={() => player.current?.seek(c.atSec)}>{timecode(c.atSec, fps)}</button><span>{c.text}</span>
              <button className="icon-btn" aria-label={`Remove note at ${timecode(c.atSec, fps)}`} onClick={() => update((p) => ({ ...p, review: { ...p.review, comments: p.review.comments.filter((x) => x.id !== c.id) } }))}><Trash2 size={18} strokeWidth={1.75} /></button></li>))}</ul>)}
      </section>
    </div>
  );
  const inspector = (
    <>
      <Fold title="Technical findings" defaultOpen meta={<span className="count">0 raised</span>}>
        <p className="muted">Deterministic checks (tier 1). Each finding shows location, evidence, severity, likely cause and a next action.</p>
        <ul className="statuses">{TIER1.map((c) => <StatusLine key={c} label={c} text={reason} tone="warn" icon={<CircleHelp size={16} aria-hidden="true" />} />)}</ul>
      </Fold>
      <Fold title="Compare"><p className="muted"><CircleSlash size={16} aria-hidden="true" /> Needs two revision snapshots. Revision snapshots cost milliseconds (P0-15); the compare view is not built yet.</p></Fold>
      <Fold title="History" meta={<span className="count">{project.revisions.length}</span>}>
        {project.revisions.length === 0 ? <p className="muted">No revisions yet.</p> : (
          <ol className="plain">{[...project.revisions].reverse().map((r) => <li key={r.id}><span className="mono">{new Date(r.at).toLocaleString()}</span> {r.summary}</li>)}</ol>)}
      </Fold>
    </>
  );
  return (
    <PageFrame {...f} title="Review" intro="Play the draft, note what to change at exact frames, and sign off when it is ready for the final render." strip main={main} inspector={inspector}
      action={{
        label: state === "approved" ? "Approved for final render" : "Approve for final render", onClick: () => approveGate("D"),
        disabledReason: state === "approved" ? "Already approved. Final render is still never automatic." : state === "not-reached" ? "Approve the treatment (Gate C) first." : undefined,
        secondary: { label: "Request changes", onClick: () => go("build") },
      }} />
  );
}
