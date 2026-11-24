import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import type { Deliverable, ProjectSummary } from "../types";
import { Sheet } from "../shell/Sheet";
import { BrandMark } from "../shell/BrandMark";
import { BASE_SIZES, FRAME_RATES, RESOLUTIONS, sizeFor } from "../lib/formats";

const ASPECTS = BASE_SIZES;
const FPS = FRAME_RATES;

export function ProjectsPage({ projects, loading, error, onOpen, onCreate, newOpen, setNewOpen, onOpenFolder, onReveal }: {
  projects: ProjectSummary[]; loading: boolean; error: string | null; onOpen: (p: ProjectSummary) => void; onCreate: (name: string, d: Deliverable) => Promise<void>;
  newOpen: boolean; setNewOpen: (v: boolean) => void; onOpenFolder: () => void; onReveal: () => void;
}) {
  const sheet = newOpen;
  const setSheet = setNewOpen;
  return (
    <main className="projects" aria-labelledby="page-title">
      <div className="page-head"><div><h1 id="page-title">Projects</h1><p className="intro">Direct, build, review and deliver motion graphics. Everything works manually: no AI account is needed.</p></div>
        <div className="row-actions"><button className="btn" onClick={onOpenFolder}>Open project folder…</button><button className="btn" onClick={onReveal}>Show projects folder</button>
        <button className="btn primary" onClick={() => setSheet(true)}><FilePlus2 size={18} strokeWidth={1.75} aria-hidden="true" />New project</button></div></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {loading ? <p className="muted" role="status">Loading projects…</p> : projects.length === 0 ? (
        <div className="empty-page"><BrandMark size={48} /><p className="strong">No projects yet</p><p>A project holds your brief, your decisions and your approvals. The composition itself lives in an EffectCraft file inside it.</p>
          <button className="btn primary" onClick={() => setSheet(true)}>New project</button></div>
      ) : (
        <ul className="project-grid">{projects.map((p) => (
          <li key={p.path}><button className="project-card" onClick={() => onOpen(p)}><img className="project-icon" src="project-icon.png" alt="" />
            <span className="strong">{p.name}</span><span className="muted">Edited {new Date(p.updatedAt).toLocaleString()}</span></button></li>))}</ul>
      )}
      {sheet && <NewProject onClose={() => setSheet(false)} onCreate={async (n, d) => { await onCreate(n, d); setSheet(false); }} />}
    </main>
  );
}

function NewProject({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string, d: Deliverable) => Promise<void> }) {
  const [name, setName] = useState("");
  const [ai, setAi] = useState(0);
  const [res, setRes] = useState("hd1080");
  const scale = RESOLUTIONS.find((r) => r.id === res)?.scale ?? 1;
  const [fps, setFps] = useState<Deliverable["fps"]>(30);
  const [dur, setDur] = useState(15);
  const [alpha, setAlpha] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bad = !name.trim() || !(dur > 0 && dur <= 3600);
  const submit = async () => {
    if (bad || busy) return;
    setBusy(true); setErr(null);
    try { const a = ASPECTS[ai]; await onCreate(name.trim(), { aspect: a.aspect, ...sizeFor(a.aspect, scale), fps, durationSec: dur, alpha }); }
    catch (e) { setErr(String(e instanceof Error ? e.message : e)); setBusy(false); }
  };
  return (
    <Sheet title="New project" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={bad || busy} onClick={submit}>Create project</button></>}>
      <div className="stack">
        <label className="field"><span className="field-label">Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} /></label>
        <div className="row">
          <label className="field"><span className="field-label">Aspect and size</span><select value={ai} onChange={(e) => setAi(Number(e.target.value))}>{ASPECTS.map((a, i) => { const z = sizeFor(a.aspect, scale); return <option key={a.aspect} value={i}>{a.aspect}  ({z.width} × {z.height})</option>; })}</select></label>
          <label className="field"><span className="field-label">Resolution</span><select value={res} onChange={(e) => setRes(e.target.value)}>{RESOLUTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          <label className="field"><span className="field-label">Frame rate</span><select value={fps} onChange={(e) => setFps(Number(e.target.value) as Deliverable["fps"])}>{FPS.map((x) => <option key={x} value={x}>{x} fps</option>)}</select></label>
        </div>
        <div className="row">
          <label className="field"><span className="field-label">Duration (seconds)</span><input type="number" min={1} max={3600} value={dur} aria-invalid={!(dur > 0 && dur <= 3600)} onChange={(e) => setDur(Number(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} /></label>
          <label className="check"><input type="checkbox" checked={alpha} onChange={(e) => setAlpha(e.target.checked)} />Needs transparency (alpha)</label>
        </div>
        <p className="muted">Colour settings follow what the connected engine supports. They are chosen when the composition is created.</p>
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Sheet>
  );
}
