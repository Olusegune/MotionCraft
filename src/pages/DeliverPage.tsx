import { useEffect, useState } from "react";
import { Film, FolderArchive, Layers } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Sheet } from "../shell/Sheet";
import { Player } from "../shell/Player";
import { getApi } from "../lib/api";
import { useSettings } from "../lib/settings";
import { gateState, newId, nowIso } from "../lib/project";
import type { RenderRecord } from "../types";
import type { RenderJob } from "./build/usePreview";
import type { FrameProps } from "./common";

type Preset = "h264" | "prores4444";
const OUTPUTS: { icon: typeof Film; title: string; detail: string; note: string; preset?: Preset }[] = [
  { icon: Film, title: "Rendered video", detail: "H.264", note: "A finished video file.", preset: "h264" },
  { icon: Layers, title: "Graphics with transparency", detail: "ProRes 4444 with alpha", note: "For compositing over other footage.", preset: "prores4444" },
  { icon: FolderArchive, title: "Collected editable project", detail: ".motioncraft package", note: "The .ecproj, assets and font manifest, relative paths only." },
];
const kb = (n: number | null) => (n === null ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

export function DeliverPage(f: FrameProps) {
  const { project, projectPath, update, engine } = useApp();
  const { enginePath } = useSettings();
  const [sheet, setSheet] = useState(false);
  const [preset, setPreset] = useState<Preset>("h264");
  const [job, setJob] = useState<RenderJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const d = project.brief.deliverables[0];
  const signed = gateState(project, "D") === "approved";
  const connected = engine?.state === "connected";
  const running = job?.state === "running";
  const renders = project.renders ?? [];

  const reason = !signed ? "Approve for final render in Review first (Gate D)." : !connected ? "Needs a connected EffectCraft engine." : running ? "A render is running." : undefined;

  useEffect(() => {
    if (!job || job.state !== "running") return;
    const t = window.setInterval(async () => {
      try { setJob(await (await getApi()).engine<RenderJob>("render_poll", { job: job.id }, projectPath, enginePath)); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
    }, 1000);
    return () => window.clearInterval(t);
  }, [job, projectPath, enginePath]);

  useEffect(() => {
    if (job?.state === "done" && job.output && !renders.some((r) => r.rel === job.output)) {
      const rec: RenderRecord = { id: newId().slice(0, 8), preset: (job.preset as Preset) ?? "h264", rel: job.output, frames: job.frames, bytes: job.bytes, at: nowIso() };
      update((p) => ({ ...p, renders: [...(p.renders ?? []), rec], updatedAt: nowIso() }));
      if (rec.preset === "h264") getApi().then((a) => a.fileUrl(projectPath, rec.rel)).then(setPlayUrl).catch(() => undefined);
    }
  }, [job, renders, update, projectPath]);

  const render = async () => {
    setErr(null);
    try {
      const api = await getApi();
      const token = await api.confirmSpend("local-render" as never, preset);   // only reachable from the confirm click below
      setJob(await api.engine<RenderJob>("render_start", { preset, name: project.name, spend_token: token }, projectPath, enginePath));
      setSheet(false);
    } catch (e) { setSheet(false); setErr(String(e instanceof Error ? e.message : e)); }
  };

  const exportProject = async () => {
    setErr(null); setNote(null);
    try {
      const api = await getApi();
      const dest = await api.pickPath("folder", await api.projectsFolder());
      if (!dest) return;
      setNote(`Collected project saved to ${await api.exportPackage(projectPath, dest)}`);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };

  const main = (
    <div className="stack">
      {err && <p className="error-text" role="alert">{err}</p>}
      {note && <p className="muted" role="status">{note}</p>}
      <ul className="outputs">{OUTPUTS.map((o) => {
        const done = o.preset ? renders.filter((r) => r.preset === o.preset) : [];
        return (
          <li key={o.title} className="output-card"><o.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            <div><h2>{o.title}</h2><p className="strong">{o.detail}</p><p className="muted">{o.note}</p>
              {done.map((r) => <p key={r.id} className="mono muted">{r.rel} · {r.frames ?? "?"} frames · {kb(r.bytes)}</p>)}</div>
            <span className="pill">{o.preset ? (done.length ? `${done.length} rendered` : "Not rendered") : "Ready to export"}</span></li>);
      })}</ul>
      {job && (
        <div className="job" role="status">
          <span className="strong">{job.state === "running" ? "Rendering…" : job.state === "done" ? "Render finished" : "Render failed"}</span>
          <span className="muted"> {Math.round(job.elapsed)} s · {job.detail}</span>
          {job.error && <p className="error-text">{job.error}</p>}
          {job.state === "done" && <p className="mono">{job.output} · {job.frames} frames · {kb(job.bytes)}</p>}
        </div>
      )}
      {playUrl && <section aria-label="Rendered video"><h2>Rendered video</h2><Player src={playUrl} fps={d.fps} duration={d.durationSec} aspect={`${d.width} / ${d.height}`} /></section>}
      <section aria-labelledby="queue-h"><h2 id="queue-h">Render queue</h2>{running ? <p className="muted">One render running.</p> : <p className="empty-note">Nothing queued. Nothing renders without your confirmation.</p>}</section>
      {sheet && (
        <Sheet title="Final render" onClose={() => setSheet(false)}
          footer={<><button className="btn" onClick={() => setSheet(false)}>Cancel</button><button className="btn primary" disabled={!!reason} onClick={() => void render()}>Confirm and render</button></>}>
          <label className="field"><span className="field-label">Output</span>
            <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)}><option value="h264">H.264 video (.mp4)</option><option value="prores4444">ProRes 4444 with alpha (.mov)</option></select></label>
          <dl className="facts"><dt>Size</dt><dd>{d.width} × {d.height}, {d.fps} fps, {d.durationSec} s</dd><dt>Sign-off</dt><dd>{signed ? "Recorded in Review" : "Not given"}</dd>
            <dt>Cost</dt><dd>None from a provider. It renders on this computer with EffectCraft, at the project's own resolution, no upscaling.</dd></dl>
          {reason && <p className="why">{reason}</p>}
          <p className="muted">Nothing is rendered until you confirm. This confirmation works once.</p>
        </Sheet>
      )}
    </div>
  );
  return (
    <PageFrame {...f} title="Deliver" intro="Three different outputs. Only what the connected engine supports is offered." main={main}
      action={{ label: "Render final…", onClick: () => setSheet(true), secondary: { label: "Export selected", onClick: () => void exportProject() } }} />
  );
}
