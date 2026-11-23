import { useEffect, useState } from "react";
import { Film, FolderArchive, Layers, Play, Square, Trash2 } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Sheet } from "../shell/Sheet";
import { Player } from "../shell/Player";
import { getApi } from "../lib/api";
import { openComposition } from "../lib/openComposition";
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
  const [unfinished, setUnfinished] = useState<RenderJob[]>([]);
  const [resumeFor, setResumeFor] = useState<RenderJob | null>(null);
  const [discardFor, setDiscardFor] = useState<RenderJob | null>(null);
  const [busy, setBusy] = useState(false);
  const d = project.brief.deliverables[0];
  const signed = gateState(project, "D") === "approved";
  const connected = engine?.state === "connected";
  const running = job?.state === "running";
  const renders = project.renders ?? [];

  const reason = !signed ? "Approve for final render in Review first (Gate D)." : !connected ? "Needs a connected EffectCraft engine." : running ? "A render is running." : undefined;

  const hasAudio = (project.assets ?? []).some((a) => a.kind === "audio");
  const refreshUnfinished = async () => {
    try {
      const api = await openComposition(project, projectPath, enginePath);
      setUnfinished((await api.engine<{ jobs: RenderJob[] }>("render_jobs", {}, projectPath, enginePath)).jobs);
    } catch { setUnfinished([]); }
  };
  // Renders left unfinished (cancelled, the engine died, the app was closed) are found on disk, so they survive a restart.
  useEffect(() => { if (connected) void refreshUnfinished(); }, [connected, job?.state]);   // eslint-disable-line react-hooks/exhaustive-deps

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

  // After the project is reopened the last finished H.264 render is shown again.
  const lastH264 = [...renders].reverse().find((r) => r.preset === "h264");
  useEffect(() => {
    if (playUrl || !lastH264) return;
    let live = true;
    getApi().then((a) => a.fileUrl(projectPath, lastH264.rel)).then((u) => { if (live) setPlayUrl(u); }).catch(() => undefined);
    return () => { live = false; };
  }, [lastH264?.rel, projectPath]);   // eslint-disable-line react-hooks/exhaustive-deps

  const render = async () => {
    setErr(null);
    try {
      const api = await openComposition(project, projectPath, enginePath);
      const token = await api.confirmSpend("local-render" as never, preset);   // only reachable from the confirm click below
      setJob(await api.engine<RenderJob>("render_start", { preset, name: project.name, spend_token: token, has_audio: hasAudio }, projectPath, enginePath));
      setSheet(false);
    } catch (e) { setSheet(false); setErr(String(e instanceof Error ? e.message : e)); }
  };

  const cancelRender = async () => {
    if (!job) return;
    try { setJob(await (await getApi()).engine<RenderJob>("render_cancel", { job: job.id }, projectPath, enginePath)); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); }
  };
  const resume = async () => {
    const target = resumeFor; if (!target) return;
    setBusy(true); setErr(null);
    try {
      const api = await openComposition(project, projectPath, enginePath);
      const token = await api.confirmSpend("local-render" as never, target.preset ?? "h264");   // only reachable from the confirm click in the sheet
      setJob(await api.engine<RenderJob>("render_resume", { job: target.id, spend_token: token }, projectPath, enginePath));
      setResumeFor(null);
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); setResumeFor(null); }
    setBusy(false);
  };
  const discard = async () => {
    const target = discardFor; if (!target) return;
    setBusy(true); setErr(null);
    try {
      await (await openComposition(project, projectPath, enginePath)).engine("render_discard", { job: target.id }, projectPath, enginePath);
      setDiscardFor(null);
      if (job?.id === target.id) setJob(null);
      await refreshUnfinished();
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); setDiscardFor(null); }
    setBusy(false);
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
    <div className="studio">
      <Player fill aspectLabel={d.aspect} src={playUrl} fps={d.fps} duration={d.durationSec} aspect={`${d.width} / ${d.height}`}
        emptyText="No final render yet. Render the video below and it appears here, ready to play." />
      <div className="deliver-dock">
      {err && <p className="error-text" role="alert">{err}</p>}
      {note && <p className="muted" role="status">{note}</p>}
      <ul className="outputs out-row">{OUTPUTS.map((o) => {
        const done = o.preset ? renders.filter((r) => r.preset === o.preset) : [];
        return (
          <li key={o.title} className="output-card"><o.icon size={20} strokeWidth={1.75} aria-hidden="true" />
            <div><h2>{o.title}</h2><p className="strong">{o.detail}</p><p className="muted">{o.note}</p>
              {done.map((r) => <p key={r.id} className="mono muted">{r.rel} · {r.frames ?? "?"} frames · {kb(r.bytes)}</p>)}</div>
            <div className="out-foot"><span className="pill">{o.preset ? (done.length ? `${done.length} rendered` : "Not rendered") : "Ready to export"}</span>
              {o.preset
                ? <button className="btn" disabled={!!reason} aria-label={o.preset === "h264" ? "Render H.264" : "Render with alpha"} title={reason} onClick={() => { setPreset(o.preset!); setSheet(true); }}><Play size={16} aria-hidden="true" />Render</button>
                : <button className="btn" aria-label="Export package" onClick={() => void exportProject()}><FolderArchive size={16} aria-hidden="true" />Export</button>}</div></li>);
      })}</ul>
      {job && (
        <div className="job" role="status">
          <span className="strong">{job.state === "running" ? "Rendering…" : job.state === "done" ? "Render finished" : job.state === "interrupted" ? "Render interrupted" : "Render failed"}</span>
          <span className="muted"> {Math.round(job.elapsed)} s · {job.detail}</span>
          {job.parts && job.framesTotal ? <div><progress aria-label="Render progress" value={job.framesDone ?? 0} max={job.framesTotal} /> <span className="muted">{job.parts.done} of {job.parts.total} parts finished</span></div> : null}
          {job.state === "running" && <div className="row-actions"><button className="btn" onClick={() => void cancelRender()}><Square size={16} aria-hidden="true" />Cancel render</button>
            <span className="muted">{job.resumable ? "Cancelling keeps the finished parts, so you can resume." : ""}</span></div>}
          {job.state === "running" && job.resumable === true && <p className="hint">If this is interrupted, you can resume it: only the missing part is rendered again.</p>}
          {job.reason ? <p className="why">{job.reason}</p> : null}
          {job.error && <p className="error-text">{job.error}</p>}
          {job.state === "interrupted" && job.resumable && <div className="row-actions">
            <button className="btn primary" onClick={() => setResumeFor(job)}><Play size={16} aria-hidden="true" />Resume render</button>
            <button className="btn quiet" onClick={() => setDiscardFor(job)}><Trash2 size={16} aria-hidden="true" />Discard</button></div>}
          {job.state === "done" && <p className="mono">{job.output} · {job.frames} frames · {kb(job.bytes)}</p>}
        </div>
      )}
      </div>
      {resumeFor && (
        <Sheet title="Resume render" onClose={() => setResumeFor(null)}
          footer={<><button className="btn" onClick={() => setResumeFor(null)}>Cancel</button><button className="btn primary" disabled={busy || !connected} onClick={() => void resume()}>Confirm and resume</button></>}>
          <p>{resumeFor.parts ? `${resumeFor.parts.done} of ${resumeFor.parts.total} parts are already finished (${resumeFor.framesDone} of ${resumeFor.framesTotal} frames). Only the rest is rendered.` : "Continue this render."}</p>
          <dl className="facts"><dt>Output</dt><dd>{resumeFor.preset === "prores4444" ? "ProRes 4444 with alpha" : "H.264 video"}</dd>
            <dt>Cost</dt><dd>None from a provider. It renders on this computer.</dd></dl>
          <p className="muted">Nothing is rendered until you confirm. This confirmation works once.</p>
        </Sheet>
      )}
      {discardFor && (
        <Sheet title="Discard this render" onClose={() => setDiscardFor(null)}
          footer={<><button className="btn" onClick={() => setDiscardFor(null)}>Keep it</button><button className="btn primary" disabled={busy} onClick={() => void discard()}>Discard the finished parts</button></>}>
          <p>This deletes the finished parts of this unfinished render{discardFor.parts ? ` (${discardFor.parts.done} of ${discardFor.parts.total})` : ""}. Nothing else is touched: not the project, not other renders.</p>
        </Sheet>
      )}
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
  const inspector = (
    <>
      <div className="scene-head">
        <h2 className="scene-title">Ready to deliver</h2>
        <dl className="facts deliver-facts">
          <dt>Size</dt><dd>{d.width} × {d.height}</dd>
          <dt>Frame rate</dt><dd>{d.fps} fps</dd>
          <dt>Length</dt><dd>{d.durationSec} s</dd>
          <dt>Sign-off</dt><dd>{signed ? "Approved in Review" : "Not given yet"}</dd>
          <dt>Cost</dt><dd>None from a provider; renders on this computer</dd>
        </dl>
      </div>
      {unfinished.filter((u) => u.id !== job?.id && u.state !== "running").length > 0 && (
        <section aria-labelledby="unfinished-h"><h2 id="unfinished-h">Unfinished renders</h2>
          <ul className="plain">{unfinished.filter((u) => u.id !== job?.id && u.state !== "running").map((u) => (
            <li key={u.id}>
              <p><span className="strong">{u.preset === "prores4444" ? "ProRes 4444" : "H.264"}</span> · {u.parts ? `${u.parts.done} of ${u.parts.total} parts finished (${u.framesDone} of ${u.framesTotal} frames)` : "interrupted"}</p>
              {u.error && <p className="muted">{u.error}</p>}
              {u.changed && <p className="why">The project changed since this render started, so the finished parts no longer match it. Discard it and render again.</p>}
              <div className="row-actions">
                <button className="btn" disabled={!!u.changed || !connected || running} aria-label={`Resume the ${u.preset} render`} onClick={() => setResumeFor(u)}><Play size={16} aria-hidden="true" />Resume</button>
                <button className="btn quiet" aria-label={`Discard the ${u.preset} render`} onClick={() => setDiscardFor(u)}><Trash2 size={16} aria-hidden="true" />Discard</button>
              </div>
            </li>))}</ul></section>
      )}
      <section aria-labelledby="queue-h"><h2 id="queue-h">Render queue</h2>{running ? <p className="muted">One render running.</p> : <p className="empty-note">Nothing queued. Nothing renders without your confirmation.</p>}</section>
    </>
  );
  return (
    <PageFrame {...f} compactHead title="Deliver" intro="Three different outputs. Only what the connected engine supports is offered." main={main} inspector={inspector}
      action={{ label: "Render final…", onClick: () => setSheet(true), secondary: { label: "Export selected", onClick: () => void exportProject() } }} />
  );
}
