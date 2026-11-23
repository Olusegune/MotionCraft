import { Plus, Sparkles, Trash2 } from "lucide-react";
import type { Beat, Purpose, Scale5, Tone } from "../types";
import { useApp } from "../ctx";
import { PageFrame, Viewer } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { ENERGY_ANCHORS, INTENSITY_ANCHORS } from "../lib/anchors";
import { firedRules } from "../lib/rules";
import { gateState, newId, stageComplete } from "../lib/project";
import { parseSeconds, timecode } from "../lib/time";
import { Field, LockBar, useLocked, type FrameProps } from "./common";
import { useState } from "react";
import { getApi } from "../lib/api";
import { useSettings } from "../lib/settings";
import { Sheet } from "../shell/Sheet";

const PURPOSES: Purpose[] = ["inform", "teach", "persuade", "sell", "announce", "celebrate", "entertain", "memorialize"];
const TONES: Tone[] = ["authoritative", "trustworthy", "playful", "elegant", "instructional", "provocative", "restrained"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SCALE: Scale5[] = [1, 2, 3, 4, 5];

function TimeInput({ value, onChange, label, disabled, fps }: { value: number; onChange: (n: number) => void; label: string; disabled: boolean; fps: number }) {
  const [text, setText] = useState<string | null>(null);
  const bad = text !== null && parseSeconds(text) === null;
  return (
    <input aria-label={label} className="mono narrow" disabled={disabled} aria-invalid={bad} value={text ?? timecode(value, fps)}
      onFocus={() => setText(String(value))}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const n = text === null ? null : parseSeconds(text); if (n !== null) onChange(n); setText(null); }} />
  );
}

export function IntentPage(f: FrameProps) {
  const { project, update, approveGate, projectPath } = useApp();
  const { offline, enginePath } = useSettings();
  const [dir, setDir] = useState<{ busy: boolean; error?: string; notes: string[]; ask?: { provider: string; model: string; label: string } }>({ busy: false, notes: [] });
  const locked = useLocked("A");
  const fps = project.brief.deliverables[0]?.fps ?? 30;
  const set = (fn: (i: typeof project.intent) => typeof project.intent) =>
    update((p) => { const intent = { ...fn(p.intent), source: "user" as const }; const next = { ...p, intent, updatedAt: new Date().toISOString() };
      return { ...next, intent: { ...intent, firedRules: firedRules(next).map((r) => r.id) } }; });
  const setBeat = (id: string, patch: Partial<Beat>) => set((i) => ({ ...i, arc: i.arc.map((b) => (b.beatId === id ? { ...b, ...patch } : b)) }));
  const addBeat = () => set((i) => {
    const last = i.arc[i.arc.length - 1];
    const start = last ? last.endSec : 0;
    return { ...i, arc: [...i.arc, { beatId: newId().slice(0, 8), startSec: start, endSec: start + 5, primary: "", intensity: 3, energy: 3 }] };
  });
  /** The Director drafts the intent. It only proposes: the draft fills the card, you edit it, and Gate A stays yours. */
  const draft = async (confirmed: boolean) => {
    setDir((d) => ({ ...d, busy: true, error: undefined, notes: [], ask: undefined }));
    try {
      const api = await getApi();
      const st = await api.engine<{ ready: boolean; reason: string; config: { provider: string | null; model: string }; providers: { id: string; label: string; local: boolean }[] }>("llm_status", { offline }, "", enginePath);
      const { provider, model } = st.config;
      const info = st.providers.find((p) => p.id === provider);
      if (!st.ready || !provider || !info) { setDir({ busy: false, notes: [], error: st.reason || "Choose a language model in Settings first. You can write the intent yourself instead." }); return; }
      if (!info.local && !confirmed) { setDir({ busy: false, notes: [], ask: { provider, model, label: info.label } }); return; }
      const params: Record<string, unknown> = { provider, model, brief: project.brief.text, script: project.brief.script ?? "", duration_sec: project.brief.deliverables[0]?.durationSec ?? 15, offline };
      if (!info.local) params.spend_token = await api.confirmSpend(provider, model);   // only reachable from the confirm click
      const r = await api.engine<{ intent: typeof project.intent; warnings: string[] }>("director_intent", params, projectPath, enginePath);
      update((p) => { const next = { ...p, intent: r.intent, updatedAt: new Date().toISOString() };
        return { ...next, intent: { ...r.intent, firedRules: firedRules(next).map((x) => x.id) } }; });
      setDir({ busy: false, notes: r.warnings });
    } catch (e) { setDir({ busy: false, notes: [], error: String(e instanceof Error ? e.message : e) }); }
  };
  const fired = firedRules(project);
  const complete = stageComplete(project, "A");
  const state = gateState(project, "A");
  const reason = locked ? undefined : !project.intent.purpose ? "Choose a purpose first." : !project.intent.summary.trim() ? "Write the one-sentence summary first." : project.intent.arc.length === 0 ? "Add at least one beat." : undefined;

  const main = (
    <div className="stack">
      <LockBar gate="A" kind="intent_change" />
      {!locked && (
        <div className="row-actions">
          <button className="btn" disabled={dir.busy || !project.brief.text.trim()} onClick={() => void draft(false)}><Sparkles size={16} aria-hidden="true" />{dir.busy ? "Drafting…" : "Draft with Director"}</button>
          <span className="muted">{project.brief.text.trim() ? "Replaces this card with a draft you can edit." : "Write a brief first."}</span>
        </div>
      )}
      {dir.error && <p className="error-text" role="alert">{dir.error}</p>}
      {dir.notes.length > 0 && <ul className="plain" role="status">{dir.notes.map((n, i) => <li key={i} className="why">{n}</li>)}</ul>}
      {dir.ask && (
        <Sheet title="Confirm spending" onClose={() => setDir((d) => ({ ...d, ask: undefined }))}
          footer={<><button className="btn" onClick={() => setDir((d) => ({ ...d, ask: undefined }))}>Cancel</button><button className="btn primary" onClick={() => void draft(true)}>Confirm and draft</button></>}>
          <dl className="facts"><dt>Model</dt><dd>{dir.ask.model}</dd><dt>Provider</dt><dd>{dir.ask.label} (cloud)</dd><dt>Price</dt><dd>Unknown. It depends on the model and the length of your brief.</dd><dt>Charged to</dt><dd>Your {dir.ask.label} account</dd></dl>
          <p className="muted">Your brief and script are sent to {dir.ask.label}. Nothing is sent until you confirm. This confirmation works once.</p>
        </Sheet>
      )}
      <fieldset className="grp" disabled={locked}>
        <legend className="visually-hidden">Intent</legend>
        <Field label="Summary" hint="One plain-language sentence. This is the card you approve.">
          <textarea rows={3} value={project.intent.summary} placeholder="What should people feel or do, and why?" onChange={(e) => set((i) => ({ ...i, summary: e.target.value }))} />
        </Field>
        <div className="row">
          <Field label="Purpose">
            <select value={project.intent.purpose ?? ""} onChange={(e) => set((i) => ({ ...i, purpose: (e.target.value || undefined) as Purpose | undefined }))}>
              <option value="">Choose a purpose</option>
              {PURPOSES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}
            </select>
          </Field>
          <div className="field"><span className="field-label">Tone</span>
            <div className="chips" role="group" aria-label="Tone">
              {TONES.map((t) => { const on = project.intent.tone.includes(t);
                return <button key={t} className={`chip-toggle${on ? " on" : ""}`} aria-pressed={on} onClick={() => set((i) => ({ ...i, tone: on ? i.tone.filter((x) => x !== t) : [...i.tone, t] }))}>{cap(t)}</button>; })}
            </div>
          </div>
        </div>
        <div className="beats-head"><h2>Beats</h2><button className="btn" onClick={addBeat}><Plus size={16} aria-hidden="true" />Add beat</button></div>
        {project.intent.arc.length === 0 && <p className="empty-note">No beats yet. A beat is a timed moment with an emotion, an intensity and an energy.</p>}
        <ol className="beat-list">
          {project.intent.arc.map((b, n) => (
            <li key={b.beatId} className="beat-card">
              <div className="beat-top"><span className="beat-n">Beat {n + 1}</span>
                <TimeInput label={`Beat ${n + 1} start`} value={b.startSec} fps={fps} disabled={locked} onChange={(v) => setBeat(b.beatId, { startSec: v })} />
                <span aria-hidden="true">to</span>
                <TimeInput label={`Beat ${n + 1} end`} value={b.endSec} fps={fps} disabled={locked} onChange={(v) => setBeat(b.beatId, { endSec: v })} />
                <button className="icon-btn" aria-label={`Remove beat ${n + 1}`} onClick={() => set((i) => ({ ...i, arc: i.arc.filter((x) => x.beatId !== b.beatId) }))}><Trash2 size={18} strokeWidth={1.75} /></button>
              </div>
              <div className="row">
                <Field label="Primary emotion"><input value={b.primary} placeholder="e.g. curiosity" onChange={(e) => setBeat(b.beatId, { primary: e.target.value })} /></Field>
                <Field label="Secondary (optional)"><input value={b.secondary ?? ""} onChange={(e) => setBeat(b.beatId, { secondary: e.target.value || undefined })} /></Field>
              </div>
              <div className="row">
                <Field label="Intensity" hint={INTENSITY_ANCHORS[b.intensity]}>
                  <select value={b.intensity} onChange={(e) => setBeat(b.beatId, { intensity: Number(e.target.value) as Scale5 })}>{SCALE.map((s) => <option key={s} value={s}>{s}: {INTENSITY_ANCHORS[s].split(":")[0]}</option>)}</select></Field>
                <Field label="Energy" hint={ENERGY_ANCHORS[b.energy]}>
                  <select value={b.energy} onChange={(e) => setBeat(b.beatId, { energy: Number(e.target.value) as Scale5 })}>{SCALE.map((s) => <option key={s} value={s}>{s}: {ENERGY_ANCHORS[s].split(":")[0]}</option>)}</select></Field>
              </div>
            </li>
          ))}
        </ol>
      </fieldset>
    </div>
  );

  const inspector = (
    <>
      <Fold title="Source evidence" defaultOpen>
        {project.brief.text.trim() ? <blockquote className="evidence">{project.brief.text.trim().slice(0, 600)}{project.brief.text.length > 600 ? "…" : ""}</blockquote>
          : <p className="muted">The brief is empty. Evidence from it will be quoted here.</p>}
      </Fold>
      <Fold title="Rule table" defaultOpen meta={<span className="count">{fired.length} fired</span>}>
        {fired.length === 0 ? <p className="muted">No rules fired yet. Rules fire from tone and beat energy.</p> : (
          <ul className="rules">{fired.map((r) => (
            <li key={r.id}><strong>{r.label}</strong>
              <dl><dt>Timing</dt><dd>{r.timing}</dd><dt>Easing</dt><dd>{r.easing}</dd><dt>Typography</dt><dd>{r.typography}</dd><dt>Layout</dt><dd>{r.layout}</dd><dt>Transitions</dt><dd>{r.transitions}</dd></dl></li>))}</ul>
        )}
        <p className="hint">Default rules from the PRD. Editing the table arrives in ticket P1-09.</p>
      </Fold>
    </>
  );
  return (
    <PageFrame {...f} title="Intent" intro="The interpretation everything else follows. Edit it until it is right, then approve it." strip
      main={<div className="split-main"><Viewer />{main}</div>} inspector={inspector}
      action={{ label: state === "approved" ? "Intent approved" : "Approve intent", onClick: () => approveGate("A"), disabledReason: state === "approved" ? "Already approved. Unlock to change it." : reason ?? (complete ? undefined : "Complete the card first.") }} />
  );
}
