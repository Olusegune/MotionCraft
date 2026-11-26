import { setQaPins } from "../../lib/qaPins";
import { useState } from "react";
import { CircleAlert, CircleCheck, CircleHelp, Info, Play, TriangleAlert, Wrench } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { getApi } from "../../lib/api";
import { useSettings } from "../../lib/settings";
import { timecode } from "../../lib/time";
import { nowIso } from "../../lib/project";
import { RIGHTS, setRights, type Rights } from "../../lib/rights";
import { parseFonts } from "../../lib/briefParse";
import { bindingFor, logQaFix, reconcile, relinkAsset, type EngineSnapshot, type Versions } from "../../lib/layers";

export interface QaFinding {
  id: string; check: string; tier: 1; severity: "info" | "warn" | "error"; at?: { timeSec?: number; layerId?: number };
  evidence: { detail: string; measured?: number; threshold?: number; estimated?: boolean }; cause: string; fix?: { label: string; safe: boolean; kind?: "move" | "relink"; relink?: { assetId: string; to: string } };
}
export interface QaResult { check: string; label: string; state: "passed" | "findings" | "not-checked"; reason: string; count: number; findings: QaFinding[] }
export interface QaReport { results: QaResult[]; counts: { error: number; warn: number; info: number }; checked: number; total: number }

const SEV: Record<QaFinding["severity"], { label: string; icon: typeof Info }> = { error: { label: "Error", icon: CircleAlert }, warn: { label: "Warning", icon: TriangleAlert }, info: { label: "Note", icon: Info } };

/** Tier-1 technical checks. Every check ends in one of three honest states: passed, findings, or Not checked with the reason. */
export function QaPanel({ disabledReason }: { disabledReason?: string }) {
  const { project, projectPath, update } = useApp();
  const { enginePath } = useSettings();
  const [st, setSt] = useState<{ busy: boolean; error?: string; report?: QaReport; at?: number; done?: string }>({ busy: false });
  const d = project.brief.deliverables[0];

  const facts = () => ({
    deliverable: { aspect: d.aspect, width: d.width, height: d.height, fps: d.fps, durationSec: d.durationSec, alpha: d.alpha },
    assets: (project.assets ?? []).map((a) => ({ id: a.id, kind: a.kind, path: a.path, source: a.provenance.provider, rights: a.rights ?? null, name: a.name ?? null })),
    renders: (project.renders ?? []).map((r) => ({ preset: r.preset })),
    requestedFonts: parseFonts(`${project.brief.text}\n${project.brief.script ?? ""}`),
  });
  const check = async (note?: string) => {
    const api = await getApi();
    const locked = (project.layerMap ?? []).filter((b) => b.lock === "approved").map((b) => b.engineLayerId);
    await api.engine("open", { settings: { name: "Main", width: d.width, height: d.height, frame_rate: d.fps, duration: d.durationSec }, locked }, projectPath, enginePath);
    const f = facts();
    return api.engine<QaReport>("qa_run", { facts: f, contrast: true }, projectPath, enginePath).then((report) => {
      setQaPins(report.results.flatMap((r) => r.findings).filter((x) => x.at?.timeSec !== undefined).map((x) => ({ id: x.id, t: x.at!.timeSec!, label: `${x.check}: ${x.evidence.detail}`, severity: x.severity })));
      setSt({ busy: false, report, at: Date.now(), done: note });
    });
  };
  const run = async () => {
    setSt({ busy: true });
    try { await check(); } catch (e) { setSt({ busy: false, error: String(e instanceof Error ? e.message : e) }); }
  };

  /** One-click safe fixes. The engine works the commands out itself and refuses approved layers; each fix is one revision. */
  const fix = async (f: QaFinding) => {
    if (!f.fix?.safe) return;
    setSt((s) => ({ ...s, busy: true, error: undefined, done: undefined }));
    try {
      if (f.fix.kind === "relink" && f.fix.relink) {
        const { assetId, to } = f.fix.relink;
        update((p) => logQaFix(relinkAsset(p, assetId, to), [], `Relinked an asset to ${to} (MotionCraft's record only; EffectCraft's own link is unchanged)`));
        const api = await getApi();
        const assets = (project.assets ?? []).map((a) => ({ id: a.id, kind: a.kind, path: a.id === assetId ? to : a.path }));
        const rep = await api.engine<QaReport>("qa_run", { facts: { ...facts(), assets }, contrast: false }, projectPath, enginePath);
        setSt({ busy: false, report: rep, at: Date.now(), done: `Relinked to ${to}. Only MotionCraft's record changed.` });
      } else if (f.fix.kind === "move" && f.at?.layerId !== undefined) {
        const api = await getApi();
        const layer = f.at.layerId;
        const r = await api.engine<EngineSnapshot & { applied: number; versions?: Versions }>("qa_fix", { check: f.check, layer, facts: facts() }, projectPath, enginePath);
        update((p) => logQaFix(reconcile(p, r, [layer]), [layer], f.fix!.label, r.versions));
        await check(`Done: ${f.fix.label}. One revision was added to History.`);
      }
    } catch (e) { setSt((s) => ({ ...s, busy: false, error: String(e instanceof Error ? e.message : e) })); }
  };
  const lockedLayer = (id?: number) => id !== undefined && bindingFor(project, id)?.lock === "approved";
  /** Every fix that is safe and not on an approved layer, one after another. Each is still its own revision in History. */
  const fixable = (st.report?.results ?? []).flatMap((x) => x.findings).filter((f) => f.fix?.safe && (f.fix.kind === "move" || f.fix.kind === "relink") && !lockedLayer(f.at?.layerId));
  const fixAll = async () => { for (const f of fixable) await fix(f); };

  // Warnings and notes can be accepted: the person has looked and chose to live with them. Errors cannot. Accepted findings stay listed, marked, and stop counting.
  const accepted = project.review.accepted ?? [];
  // Layer numbers change when the composition is opened again, so they are not part of what identifies a finding.
  const keyOf = (f: QaFinding) => `${f.check}|${f.evidence.detail.replace(/\blayer \d+\b/g, "layer")}`;
  const isAccepted = (f: QaFinding) => f.severity !== "error" && accepted.some((a) => a.key === keyOf(f));
  const accept = (f: QaFinding) => update((p) => ({ ...p, review: { ...p.review, accepted: [...(p.review.accepted ?? []), { key: keyOf(f), check: f.check, detail: f.evidence.detail, at: nowIso() }] }, updatedAt: nowIso() }));
  const unaccept = (f: QaFinding) => update((p) => ({ ...p, review: { ...p.review, accepted: (p.review.accepted ?? []).filter((a) => a.key !== keyOf(f)) }, updatedAt: nowIso() }));
  const acceptMany = (fs: QaFinding[]) => update((p) => ({ ...p, review: { ...p.review, accepted: [...(p.review.accepted ?? []), ...fs.filter((f) => !(p.review.accepted ?? []).some((a) => a.key === keyOf(f))).map((f) => ({ key: keyOf(f), check: f.check, detail: f.evidence.detail, at: nowIso() }))] }, updatedAt: nowIso() }));
  const setManyRights = (ids: string[], v: string) => update((p) => ({ ...p, assets: (p.assets ?? []).map((a) => (ids.includes(a.id) ? setRights(a, (v || undefined) as Rights | undefined) : a)), updatedAt: nowIso() }));
  const setAssetRights = (assetId: string, v: string) => {
    update((p) => ({ ...p, assets: (p.assets ?? []).map((a) => (a.id === assetId ? setRights(a, (v || undefined) as Rights | undefined) : a)), updatedAt: nowIso() }));
  };
  const r = st.report;
  const open = r ? r.results.flatMap((x) => x.findings).filter((f) => !isAccepted(f)) : [];
  const nAccepted = r ? r.results.flatMap((x) => x.findings).filter(isAccepted).length : 0;
  const count = (s: QaFinding["severity"]) => open.filter((f) => f.severity === s).length;
  const raised = open.length;
  return (
    <Fold title="Technical findings" defaultOpen meta={<span className="count">{r ? `${raised} raised` : "not run"}</span>}>
      <p className="muted">Automatic checks for missing files, text that is too small or off the edge, silent audio and more. Each problem says where it is and what to do. A check that could not run says so; it is never counted as a pass.</p>
      <div className="row-actions">
        <button className="btn" disabled={!!disabledReason || st.busy} onClick={() => void run()}><Play size={16} aria-hidden="true" />{st.busy ? "Checking…" : r ? "Run checks again" : "Run checks"}</button>
        {fixable.length > 1 && <button className="btn primary" disabled={st.busy || !!disabledReason} onClick={() => void fixAll()}><Wrench size={16} aria-hidden="true" />Fix all {fixable.length} safe issues</button>}
      </div>
      {disabledReason && <p className="why">{disabledReason}</p>}
      {st.error && <p className="error-text" role="alert">{st.error}</p>}
      {st.done && <p role="status">{st.done}</p>}
      {r && (
        <>
          <p role="status"><strong>{count("error")}</strong> errors, <strong>{count("warn")}</strong> warnings, <strong>{count("info")}</strong> notes{nAccepted ? ` (${nAccepted} accepted by you)` : ""}. {r.checked} of {r.total} checks ran
            {r.total - r.checked > 0 ? `; ${r.total - r.checked} could not (see below)` : ""}.</p>
          <ul className="statuses">
            {r.results.map((c) => (
              <li key={c.check} className={`status-line ${c.state === "findings" ? "warn" : c.state === "passed" ? "ok" : "warn"}`}>
                {c.state === "passed" ? <CircleCheck size={16} aria-hidden="true" /> : c.state === "findings" ? <TriangleAlert size={16} aria-hidden="true" /> : <CircleHelp size={16} aria-hidden="true" />}
                <span className="sl-label">{c.label}</span>
                <span className="sl-text">{c.state === "passed" ? "Passed" : c.state === "findings" ? `${c.findings.filter((f) => !isAccepted(f)).length} found${c.findings.some(isAccepted) ? `, ${c.findings.filter(isAccepted).length} accepted` : ""}` : `Not checked: ${c.reason}`}</span>
                {c.state === "passed" && c.reason && <span className="hint">{c.reason}</span>}
                {c.check === "rights-unconfirmed" && c.findings.length > 1 && (
                  <div className="row-actions">
                    <label className="field"><span className="visually-hidden">Rights for all {c.findings.length} files</span>
                      <select value="" onChange={(e) => { setManyRights(c.findings.map((f) => (f.evidence as { assetId?: string }).assetId).filter(Boolean) as string[], e.target.value); void run(); }}>
                        <option value="">Say the same for all {c.findings.length} files…</option>
                        {RIGHTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                      </select></label>
                  </div>
                )}
                {c.findings.filter((f) => f.severity !== "error" && !isAccepted(f)).length > 1 && c.check !== "rights-unconfirmed" && (
                  <div className="row-actions"><button className="btn quiet" onClick={() => acceptMany(c.findings.filter((f) => f.severity !== "error"))}
                    title="You have looked at these and choose to keep them. They stay listed and stop counting.">Accept all {c.findings.filter((f) => f.severity !== "error" && !isAccepted(f)).length} warnings in this check</button></div>
                )}
                {c.findings.length > 0 && (
                  <ul className="plain">
                    {c.findings.map((f) => {
                      const S = SEV[f.severity];
                      return (
                        <li key={f.id} className={isAccepted(f) ? "accepted" : undefined}>
                          <span className="badge"><S.icon size={14} aria-hidden="true" />{isAccepted(f) ? "Accepted" : S.label}</span>{" "}
                          {f.at?.timeSec !== undefined && <span className="mono">{timecode(f.at.timeSec, d.fps)} </span>}
                          {f.at?.layerId !== undefined && <span className="muted">layer {f.at.layerId} </span>}
                          <span>{f.evidence.detail}</span>
                          {f.evidence.measured !== undefined && f.evidence.threshold !== undefined && <span className="hint"> Measured {f.evidence.measured}, threshold {f.evidence.threshold}{f.evidence.estimated ? " (estimated)" : ""}.</span>}
                          <div className="hint">Likely cause: {f.cause}{f.fix ? ` Fix: ${f.fix.label}${f.fix.safe ? "" : " (not automatic)"}.` : ""}</div>
                          {f.check === "rights-unconfirmed" && (f.evidence as { assetId?: string }).assetId && (
                            <div className="row-actions">
                              <label className="field"><span className="visually-hidden">Rights for this file</span>
                                <select value="" onChange={(e) => { setAssetRights((f.evidence as { assetId?: string }).assetId!, e.target.value); void run(); }}>
                                  <option value="">Say what you may do with it…</option>
                                  {RIGHTS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                                </select></label>
                            </div>
                          )}
                          {f.severity !== "error" && f.check !== "rights-unconfirmed" && (
                            <div className="row-actions">
                              {isAccepted(f)
                                ? <button className="btn quiet" onClick={() => unaccept(f)}>Undo accept</button>
                                : <button className="btn quiet" onClick={() => accept(f)} title="You have looked at this and choose to keep it. It stays listed and stops counting.">Accept</button>}
                            </div>
                          )}
                          {f.fix?.safe && (f.fix.kind === "move" || f.fix.kind === "relink") && (
                            <div className="row-actions">
                              <button className="btn" disabled={st.busy || lockedLayer(f.at?.layerId) || !!disabledReason} onClick={() => void fix(f)}><Wrench size={16} aria-hidden="true" />{f.fix.kind === "relink" ? "Relink" : "Apply fix"}</button>
                              {lockedLayer(f.at?.layerId) && <span className="why">Approved layer: unlock it first. Fixes never touch approved layers.</span>}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {!r && !st.busy && <p className="muted">Not run yet. Press Run checks to inspect the composition and the project folder.</p>}
    </Fold>
  );
}
