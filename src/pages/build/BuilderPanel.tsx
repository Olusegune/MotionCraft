import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useApp } from "../../ctx";
import { Fold } from "../../shell/Fold";
import { Sheet } from "../../shell/Sheet";
import { getApi } from "../../lib/api";
import { useSettings } from "../../lib/settings";
import { hasAnyProvider } from "../../lib/project";
import { firedRules } from "../../lib/rules";
import type { Write } from "./Panels";
import type { Versions } from "../../lib/layers";

export interface PlanLayer { key: string; kind: "text" | "solid" | "shape"; name: string; role: string; text?: string; size?: number; shape?: string; color?: number[]; animations: { primitive: string; params: Record<string, unknown> }[] }
export interface BuilderPlan { summary: string; layers: PlanLayer[] }
export interface Created { key: string; layer: number; kind: string; role: string; name: string; primitives: string[] }
type PlanResult = { plan: BuilderPlan; warnings: string[]; cost: { usd: number; known: boolean; note: string }; provider: string; model: string };
type LlmStatus = { ready: boolean; reason: string; config: { provider: string | null; model: string }; providers: { id: string; label: string; local: boolean }[] };

/** The Builder agent: plan the layers and motion from the approved intent, show them with their cost, build only when you confirm. */
export function BuilderPanel({ write, disabled, onBuilt, afterBuild }: { write: Write; disabled: boolean; onBuilt: (created: Created[], versions?: Versions) => void; afterBuild?: () => Promise<number> }) {
  const { project } = useApp();
  const { offline, enginePath } = useSettings();
  const [st, setSt] = useState<{ busy: boolean; error?: string; result?: PlanResult; ask?: { provider: string; model: string; label: string }; built?: { n: number; warnings: string[] } }>({ busy: false });
  const d = project.brief.deliverables[0];
  const hasMaterial = !!(project.brief.text.trim() || project.brief.script?.trim() || project.intent.summary.trim());
  const reason = !hasAnyProvider() ? "Needs a language model (Settings, Language model). You can add layers yourself below." : disabled ? "Needs a connected engine and no EffectCraft window open." : !hasMaterial ? "Write a brief or an intent first." : undefined;

  const plan = async (confirmed: boolean) => {
    setSt({ busy: true });
    try {
      const api = await getApi();
      const s = await api.engine<LlmStatus>("llm_status", { offline }, "", enginePath);
      const { provider, model } = s.config;
      const info = s.providers.find((p) => p.id === provider);
      if (!s.ready || !provider || !info) { setSt({ busy: false, error: s.reason || "Choose a language model in Settings first." }); return; }
      if (!info.local && !confirmed) { setSt({ busy: false, ask: { provider, model, label: info.label } }); return; }
      const params: Record<string, unknown> = {
        provider, model, offline,
        context: { intent: project.intent, firedRules: firedRules(project), brief: project.brief.text, script: project.brief.script ?? "",
                   deliverable: { width: d.width, height: d.height, fps: d.fps, durationSec: d.durationSec } },
      };
      if (!info.local) params.spend_token = await api.confirmSpend(provider, model);   // only reachable from the confirm click
      setSt({ busy: false, result: await api.engine<PlanResult>("builder_plan", params, "", enginePath) });
    } catch (e) { setSt({ busy: false, error: String(e instanceof Error ? e.message : e) }); }
  };

  const build = async () => {
    const r = st.result; if (!r) return;
    setSt((s) => ({ ...s, busy: true, error: undefined }));
    const res = await write("build plan", "builder_execute", { plan: r.plan }) as unknown as { created?: Created[]; warnings?: string[]; versions?: Versions } | undefined;
    if (res?.created) {
      onBuilt(res.created, res.versions);
      const pics = afterBuild ? await afterBuild() : 0;       // the scenes' pictures go in with the layers: one action
      setSt({ busy: false, built: { n: res.created.length, warnings: [...(res.warnings ?? []), ...(pics ? [`${pics} scene picture${pics === 1 ? "" : "s"} placed behind the scenes.`] : [])] } });
    }
    else setSt((s) => ({ ...s, busy: false, error: "The build did not finish. See the message above; layers made before the problem are kept." }));
  };

  // "Make it" on the Brief page asks for the plan to start as soon as Build opens. The spending confirmation still comes first.
  useEffect(() => {
    let go = false;
    try { go = sessionStorage.getItem("mc.autoplan") === "1"; sessionStorage.removeItem("mc.autoplan"); } catch { /* no storage */ }
    if (go && !reason) void plan(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const r = st.result;
  return (
    <Fold title="Builder" defaultOpen meta={<span className="count">{r ? `${r.plan.layers.length} planned` : "agent"}</span>}>
      <p className="muted">Plans layers and motion from your intent and the rules that fired. Nothing is built until you confirm the plan.</p>
      <div className="row-actions">
        <button className="btn" disabled={!!reason || st.busy} onClick={() => void plan(false)}><Sparkles size={16} aria-hidden="true" />{st.busy && !r ? "Planning…" : "Plan with Builder"}</button>
      </div>
      {reason && <p className="why">{reason}</p>}
      {st.error && <p className="error-text" role="alert">{st.error}</p>}
      {r && (
        <div aria-label="Builder plan">
          {r.plan.summary && <p>{r.plan.summary}</p>}
          <ol className="layers">
            {r.plan.layers.map((l) => (
              <li key={l.key}><span className="strong">{l.name}</span> <span className="muted">{l.kind}{l.text ? `: “${l.text.length > 60 ? l.text.slice(0, 60) + "…" : l.text}”` : ""}</span>
                {l.animations.length > 0 && <div className="hint">{l.animations.map((a) => a.primitive).join(", ")}</div>}</li>
            ))}
          </ol>
          <dl className="facts"><dt>Models</dt><dd>None. No picture or video is generated.</dd><dt>Cost</dt><dd>{r.cost.known ? `$${r.cost.usd.toFixed(2)}` : "Unknown"}. {r.cost.note}</dd><dt>Planned by</dt><dd>{r.model}</dd></dl>
          {r.warnings.length > 0 && <ul className="plain" role="status">{r.warnings.map((w, i) => <li key={i} className="why">{w}</li>)}</ul>}
          <div className="row-actions">
            <button className="btn primary" disabled={!!reason || st.busy} onClick={() => void build()}>{st.busy ? "Building…" : `Build ${r.plan.layers.length} layers`}</button>
            <button className="btn quiet" disabled={st.busy} onClick={() => setSt({ busy: false })}>Discard plan</button>
          </div>
        </div>
      )}
      {st.built && (
        <div role="status"><p>Built {st.built.n} layers. They are normal layers: edit them here or in EffectCraft, and approve the ones you like.</p>
          {st.built.warnings.length > 0 && <ul className="plain">{st.built.warnings.map((w, i) => <li key={i} className="why">{w}</li>)}</ul>}</div>
      )}
      {st.ask && (
        <Sheet title="Confirm spending" onClose={() => setSt({ busy: false })}
          footer={<><button className="btn" onClick={() => setSt({ busy: false })}>Cancel</button><button className="btn primary" onClick={() => void plan(true)}>Confirm and plan</button></>}>
          <dl className="facts"><dt>Model</dt><dd>{st.ask.model}</dd><dt>Provider</dt><dd>{st.ask.label} (cloud)</dd><dt>Price</dt><dd>Unknown. It depends on the model and the length of your brief.</dd><dt>Charged to</dt><dd>Your {st.ask.label} account</dd></dl>
          <p className="muted">Your brief, script and intent are sent to {st.ask.label} to write the plan. Nothing is sent until you confirm. This confirmation works once. Building the plan afterwards is free.</p>
        </Sheet>
      )}
    </Fold>
  );
}
