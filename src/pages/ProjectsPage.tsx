import { friendlyWhen } from "../lib/when";
import { useEffect, useState } from "react";
import { FilePlus2 } from "lucide-react";
import type { Deliverable, MotionProject, ProjectSummary } from "../types";
import { getApi } from "../lib/api";
import { Sheet } from "../shell/Sheet";
import { BrandMark } from "../shell/BrandMark";
import { BASE_SIZES, FRAME_RATES, RESOLUTIONS, sizeFor } from "../lib/formats";

const ASPECTS = BASE_SIZES;
const FPS = FRAME_RATES;

export function ProjectsPage({ projects, loading, error, onOpen, onCreate, newOpen, setNewOpen, onOpenFolder, onReveal, onExample }: {
  projects: ProjectSummary[]; loading: boolean; error: string | null; onOpen: (p: ProjectSummary) => void; onCreate: (name: string, d: Deliverable) => Promise<void>;
  newOpen: boolean; setNewOpen: (v: boolean) => void; onOpenFolder: () => void; onReveal: () => void;
  /** Brings in the example project that ships with the app; undefined when this build has none. */
  onExample?: () => Promise<void>;
}) {
  const [exampleBusy, setExampleBusy] = useState(false);
  const sheet = newOpen;
  const setSheet = setNewOpen;
  return (
    <main className="projects" aria-labelledby="page-title">
      <div className="page-head"><div><h1 id="page-title">Projects</h1><p className="intro">Direct, build, review and deliver motion graphics. Everything works manually: no AI account is needed.</p></div>
        <div className="row-actions"><button className="btn" onClick={onOpenFolder}>Open project folder…</button><button className="btn" onClick={onReveal}>Show projects folder</button>
        <button className="btn primary" onClick={() => setSheet(true)}><FilePlus2 size={18} strokeWidth={1.75} aria-hidden="true" />New project</button></div></div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {onExample && !loading && !projects.some((p) => p.name === "Civilization I-VII") && (
        <aside className="example-card" aria-label="Example project">
          <div><strong>See a finished project</strong>
            <p className="muted">Civilization I–VII: a 90-second film made from a script, ten pictures and a score, with its checks, notes and render. Open a copy to see how every page was filled in, then change anything.</p></div>
          <button className="btn" disabled={exampleBusy} onClick={() => { setExampleBusy(true); void onExample().finally(() => setExampleBusy(false)); }}>{exampleBusy ? "Opening…" : "Open the example"}</button>
        </aside>
      )}
      {loading ? <p className="muted" role="status">Loading projects…</p> : projects.length === 0 ? (
        <div className="empty-page"><BrandMark size={48} /><p className="strong">No projects yet</p><p>A project holds your brief, your decisions and your approvals. The composition itself lives in an EffectCraft file inside it.</p>
          <ol className="first-run" aria-label="How it works">
            <li><span className="n">1</span><span><strong>Write a brief</strong> or paste a script. Say how long, what shape.</span></li>
            <li><span className="n">2</span><span><strong>Press Make it.</strong> Review the plan once.</span></li>
            <li><span className="n">3</span><span><strong>Refine and deliver.</strong> Pictures, sound, a final render.</span></li>
          </ol>
          <button className="btn primary" onClick={() => setSheet(true)}>Start your first project</button></div>
      ) : (
        <ul className="project-grid">{projects.map((p) => (
          <li key={p.path}><ProjectCard p={p} onOpen={onOpen} /></li>))}</ul>
      )}
      {sheet && <NewProject onClose={() => setSheet(false)} onCreate={async (n, d) => { await onCreate(n, d); setSheet(false); }} />}
    </main>
  );
}

/** A project as its piece: the first scene's picture (or the first picture made or added), with the length and shape underneath. */
function ProjectCard({ p, onOpen }: { p: ProjectSummary; onOpen: (p: ProjectSummary) => void }) {
  const [info, setInfo] = useState<{ poster: string | null; meta: string } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const api = await getApi();
        const proj = (await api.load(p.path)) as MotionProject;
        const d = proj.brief.deliverables[0];
        const imgs = (proj.assets ?? []).filter((a) => a.kind === "image");
        const first = proj.intent.arc.map((b) => imgs.find((a) => a.id === proj.treatment[b.beatId]?.frameAssetId)).find(Boolean) ?? imgs[0];
        let poster: string | null = null;
        if (first) { try { poster = await api.assetDataUrl(p.path, first.path); } catch { /* no picture to show */ } }
        if (live) setInfo({ poster, meta: `${d.durationSec} s · ${d.aspect}` });
      } catch { if (live) setInfo({ poster: null, meta: "" }); }
    })();
    return () => { live = false; };
  }, [p.path]);
  return (
    <button className="project-card" onClick={() => onOpen(p)}>
      <span className="poster" aria-hidden="true">{info?.poster ? <img src={info.poster} alt="" /> : <span className="poster-title" data-title={p.name} />}</span>
      <span className="strong">{p.name}</span>
      <span className="muted">{info?.meta ? `${info.meta} · ` : ""}Edited {friendlyWhen(p.updatedAt)}</span>
    </button>
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
        <label className="field"><span className="field-label">Name</span><input value={name} maxLength={80} placeholder="e.g. Spring launch teaser" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} /></label>
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
        {bad && <p className="why">{!name.trim() ? "Give the project a name to continue." : "Duration is between 1 and 3600 seconds."}</p>}
        {err && <p className="error-text" role="alert">{err}</p>}
      </div>
    </Sheet>
  );
}
