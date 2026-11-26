import { friendlyWhen } from "../../lib/when";
import { useEffect, useRef, useState } from "react";
import { GitCompare, History, RotateCcw, Save } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { Sheet } from "../../shell/Sheet";
import { getApi } from "../../lib/api";
import { openComposition } from "../../lib/openComposition";
import { useSettings } from "../../lib/settings";
import { applyRestore, bindingFor, logVersion, restoreOutcome, type EngineSnapshot } from "../../lib/layers";
import type { RevisionRecord } from "../../types";

interface DiffItem { id: number; name: string; state: "added" | "changed" | "removed" }
interface Diff { items: DiffItem[]; unchanged: number; then: { layers: number }; now: { layers: number } }
interface Shot { width: number; height: number; time: number; png: string }

const ACTOR: Record<RevisionRecord["actor"], string> = { user: "You", "agent:director": "Director", "agent:builder": "Builder", "agent:qa": "QA" };

const msg = (e: unknown) => String(e instanceof Error ? e.message : e);

/** What the saved versions of the composition say: save one, compare it with now, restore it, or undo the change that was made after it. */
export function HistoryPanel({ disabledReason }: { disabledReason?: string }) {
  const { project, projectPath, update } = useApp();
  const { enginePath } = useSettings();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ rev: RevisionRecord; which: "after" | "before" } | null>(null);
  const [restore, setRestore] = useState<{ rev: RevisionRecord; which: "after" | "before" } | null>(null);
  const revs = [...project.revisions].reverse();

  const saveNow = async () => {
    setBusy(true); setError(null); setDone(null);
    try {
      const api = await openComposition(project, projectPath, enginePath);
      const v = await api.engine<{ id: string }>("snapshot_save", {}, projectPath, enginePath);
      update((p) => logVersion(p, v.id, label || "Saved a version"));
      setLabel(""); setDone("Version saved. It is in the list below.");
    } catch (e) { setError(msg(e)); }
    setBusy(false);
  };

  return (
    <Fold title="History and versions" defaultOpen meta={<span className="count">{project.revisions.length}</span>}>
      <p className="muted">Every change the Builder or QA makes keeps a version before and after it, so you can compare it with now, go back to it, or undo it.</p>
      <div className="row end">
        <label className="field grow"><span className="field-label">Save a version now (optional name)</span>
          <input value={label} placeholder="e.g. Before client notes" onChange={(e) => setLabel(e.target.value)} /></label>
        <button className="btn" disabled={busy || !!disabledReason} onClick={() => void saveNow()}><Save size={16} aria-hidden="true" />Save version</button>
      </div>
      {disabledReason && <p className="why">{disabledReason}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
      {done && <p role="status">{done}</p>}
      {revs.length === 0 ? <p className="muted">No revisions yet.</p> : (
        <ol className="plain history">
          {revs.map((r) => (
            <li key={r.id}>
              <span className="mono">{friendlyWhen(r.at)}</span> <span className="badge">{ACTOR[r.actor]}</span> {r.summary}
              {(r.snapshot || r.before) && (
                <div className="row-actions">
                  {r.snapshot && <button className="btn quiet" disabled={!!disabledReason} aria-label={`Compare ${r.summary} with now`} onClick={() => setCompare({ rev: r, which: "after" })}><GitCompare size={16} aria-hidden="true" />Compare</button>}
                  {r.before && <button className="btn quiet" disabled={!!disabledReason} aria-label={`Undo ${r.summary}`} onClick={() => setRestore({ rev: r, which: "before" })}><RotateCcw size={16} aria-hidden="true" />Undo this change</button>}
                  {r.snapshot && <button className="btn quiet" disabled={!!disabledReason} aria-label={`Restore the version after ${r.summary}`} onClick={() => setRestore({ rev: r, which: "after" })}><History size={16} aria-hidden="true" />Restore this version</button>}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {compare && <CompareSheet rev={compare.rev} initial={compare.which} onClose={() => setCompare(null)} />}
      {restore && <RestoreSheet rev={restore.rev} which={restore.which} onClose={() => setRestore(null)} onDone={(m) => { setRestore(null); setDone(m); }} />}
    </Fold>
  );
}

function CompareSheet({ rev, initial, onClose }: { rev: RevisionRecord; initial: "after" | "before"; onClose: () => void }) {
  const { project, projectPath } = useApp();
  const { enginePath } = useSettings();
  const d = project.brief.deliverables[0];
  const [which, setWhich] = useState(initial);
  const [time, setTime] = useState(Math.min(1, d.durationSec));
  const [state, setState] = useState<{ loading: boolean; error?: string; old?: Shot; cur?: Shot; diff?: Diff }>({ loading: true });
  const opened = useRef(false);
  const id = which === "after" ? rev.snapshot : rev.before;

  useEffect(() => {
    if (!id) return;
    let live = true;
    const t = window.setTimeout(async () => {
      setState((s) => ({ ...s, loading: true, error: undefined }));
      try {
        const api = opened.current ? await getApi() : await openComposition(project, projectPath, enginePath);
        opened.current = true;
        const [old, cur, diff] = await Promise.all([
          api.engine<Shot>("snapshot_preview", { id, time, max_side: 640 }, projectPath, enginePath),
          api.engine<Shot>("snapshot_preview", { id: "current", time, max_side: 640 }, projectPath, enginePath),
          api.engine<Diff>("snapshot_diff", { id }, projectPath, enginePath),
        ]);
        if (live) setState({ loading: false, old, cur, diff });
      } catch (e) { if (live) setState({ loading: false, error: msg(e) }); }
    }, 250);
    return () => { live = false; window.clearTimeout(t); };
  }, [id, time]);   // eslint-disable-line react-hooks/exhaustive-deps

  const { old, cur, diff } = state;
  return (
    <Sheet title="Compare with now" onClose={onClose} wide footer={<button className="btn" onClick={onClose}>Close</button>}>
      <p>{rev.summary}</p>
      {rev.snapshot && rev.before && (
        <div className="chips" role="group" aria-label="Which version">
          <button className={`chip-toggle${which === "before" ? " on" : ""}`} aria-pressed={which === "before"} onClick={() => setWhich("before")}>Before this change</button>
          <button className={`chip-toggle${which === "after" ? " on" : ""}`} aria-pressed={which === "after"} onClick={() => setWhich("after")}>After this change</button>
        </div>
      )}
      <label className="field"><span className="field-label">Time: {time.toFixed(1)} s</span>
        <input type="range" min={0} max={d.durationSec} step={0.1} value={time} aria-label="Time" onChange={(e) => setTime(Number(e.target.value))} /></label>
      {state.error && <p className="error-text" role="alert">{state.error}</p>}
      {state.loading && <p className="muted" role="status">Loading the frames…</p>}
      <div className="compare">
        <figure>{old ? <img alt={`The ${which === "before" ? "version before" : "saved version"} at ${old.time} seconds`} src={`data:image/png;base64,${old.png}`} /> : <div className="viewer" />}<figcaption>Then ({which === "before" ? "before" : "after"} this change)</figcaption></figure>
        <figure>{cur ? <img alt={`The current composition at ${cur.time} seconds`} src={`data:image/png;base64,${cur.png}`} /> : <div className="viewer" />}<figcaption>Now</figcaption></figure>
      </div>
      {diff && (
        <section aria-label="Layer differences">
          <p><strong>{diff.items.length === 0 ? "Nothing differs." : `${diff.items.length} layer${diff.items.length === 1 ? "" : "s"} differ.`}</strong> {diff.unchanged} unchanged. Then: {diff.then.layers} layers. Now: {diff.now.layers}.</p>
          {diff.items.length > 0 && <ul className="plain">{diff.items.map((i) => <li key={i.id}><span className="badge">{i.state === "added" ? "Added since" : i.state === "removed" ? "Removed since" : "Changed since"}</span> {i.name}</li>)}</ul>}
        </section>
      )}
    </Sheet>
  );
}

function RestoreSheet({ rev, which, onClose, onDone }: { rev: RevisionRecord; which: "after" | "before"; onClose: () => void; onDone: (message: string) => void }) {
  const { project, projectPath, update } = useApp();
  const { enginePath } = useSettings();
  const id = which === "after" ? rev.snapshot : rev.before;
  const [diff, setDiff] = useState<Diff | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const api = await openComposition(project, projectPath, enginePath);
        const d = await api.engine<Diff>("snapshot_diff", { id }, projectPath, enginePath);
        if (live) setDiff(d);
      } catch (e) { if (live) setErr(msg(e)); }
    })();
    return () => { live = false; };
  }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const approvedHit = diff ? diff.items.filter((i) => bindingFor(project, i.id)?.lock === "approved" && i.state !== "added") : [];
  const title = which === "before" ? `Undo: ${rev.summary}` : `Restore the version after: ${rev.summary}`;

  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const api = await getApi();
      const r = await api.engine<EngineSnapshot & { before: string; restored: string }>("snapshot_restore", { id }, projectPath, enginePath);
      const { keep } = restoreOutcome(project, r);
      if (keep.length) await api.engine("lock", { layers: keep }, projectPath, enginePath);   // approvals that still match are put back
      update((p) => applyRestore(p, r, { label: title, restored: r.restored, before: r.before }));
      onDone(`Done: ${title}. The state before this was saved as a version, so you can undo it.`);
    } catch (e) { setErr(msg(e)); setBusy(false); }
  };

  return (
    <Sheet title={which === "before" ? "Undo this change" : "Restore this version"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !diff} onClick={() => void go()}>{which === "before" ? "Undo the change" : "Restore this version"}</button></>}>
      <p>{title}</p>
      {!diff && !err && <p className="muted" role="status">Looking at what would change…</p>}
      {diff && (
        <>
          <p><strong>{diff.items.length === 0 ? "Nothing would change." : `${diff.items.length} layer${diff.items.length === 1 ? "" : "s"} would change.`}</strong></p>
          {diff.items.length > 0 && <ul className="plain">{diff.items.map((i) => <li key={i.id}>{i.name}: {i.state === "added" ? "will be removed" : i.state === "removed" ? "will come back" : "will go back to how it was"}</li>)}</ul>}
          {approvedHit.length > 0 && <p className="why" role="note">Approved layers that will lose their approval: {approvedHit.map((i) => i.name).join(", ")}. Approvals only stay for layers that end up exactly as approved.</p>}
        </>
      )}
      <p className="muted">Nothing is deleted. The current state is saved first as a version, so this can be undone.</p>
      {err && <p className="error-text" role="alert">{err}</p>}
    </Sheet>
  );
}
