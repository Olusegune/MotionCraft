import { useState } from "react";
import { Pencil, Plus, RotateCcw } from "lucide-react";
import type { MotionProject, Purpose, RuleSpec, Tone } from "../types";
import { DEFAULT_RULES, RULE_FIELDS, RULE_FIELD_LABEL, activeRules, explain, validateRule, whenText } from "../lib/rules";
import { newId } from "../lib/project";
import { Sheet } from "../shell/Sheet";

const TONES: Tone[] = ["authoritative", "trustworthy", "playful", "elegant", "instructional", "provocative", "restrained"];
const PURPOSES: Purpose[] = ["inform", "teach", "persuade", "sell", "announce", "celebrate", "entertain", "memorialize"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const blank = (): RuleSpec => ({ id: newId().slice(0, 8), label: "", enabled: true, when: {}, timing: "", easing: "", typography: "", layout: "", transitions: "" });
const toggle = <T,>(list: T[] | undefined, v: T): T[] | undefined => { const a = list ?? []; const n = a.includes(v) ? a.filter((x) => x !== v) : [...a, v]; return n.length ? n : undefined; };

/** The intent-to-parameter rule table: every rule, whether it fired and why, and editing. Edits are the user's own and replace the defaults for this project only. */
export function RuleEditor({ project, locked, onChange }: { project: MotionProject; locked: boolean; onChange: (rules: RuleSpec[] | undefined) => void }) {
  const rules = activeRules(project);
  const [draft, setDraft] = useState<{ rule: RuleSpec; isNew: boolean } | null>(null);
  const edited = project.rules !== undefined;
  const err = draft ? validateRule(draft.rule, rules) : null;
  const save = () => {
    if (!draft || err) return;
    const next = draft.isNew ? [...rules, draft.rule] : rules.map((r) => (r.id === draft.rule.id ? draft.rule : r));
    onChange(next); setDraft(null);
  };
  const setW = (patch: Partial<RuleSpec["when"]>) => setDraft((d) => d && { ...d, rule: { ...d.rule, when: { ...d.rule.when, ...patch } } });
  const num = (v: string): number | undefined => (v.trim() === "" ? undefined : Number(v));

  return (
    <div>
      <ul className="rules">
        {rules.map((r) => {
          const x = explain(r, project);
          return (
            <li key={r.id}>
              <div className="beat-top"><strong>{r.label}</strong>
                <span className="badge" role="status">{x.ok ? "Fired" : r.enabled ? "Not fired" : "Off"}</span>
                <button className="icon-btn" aria-label={`Edit rule ${r.label}`} disabled={locked} onClick={() => setDraft({ rule: structuredClone(r), isNew: false })}><Pencil size={16} strokeWidth={1.75} /></button>
              </div>
              <p className="hint">When: {whenText(r.when)}</p>
              <ul className="plain">{x.lines.map((l, i) => <li key={i} className="muted">{l}</li>)}</ul>
              {x.ok && <dl>{RULE_FIELDS.filter((f) => r[f].trim()).map((f) => <span key={f}><dt>{RULE_FIELD_LABEL[f]}</dt><dd>{r[f]}</dd></span>)}</dl>}
            </li>
          );
        })}
      </ul>
      <div className="row-actions">
        <button className="btn" disabled={locked} onClick={() => setDraft({ rule: blank(), isNew: true })}><Plus size={16} aria-hidden="true" />Add rule</button>
        <button className="btn quiet" disabled={locked || !edited} onClick={() => onChange(undefined)}><RotateCcw size={16} aria-hidden="true" />Reset to defaults</button>
      </div>
      <p className="hint">{edited ? "This project uses your edited table." : `Default rules from the PRD (${DEFAULT_RULES.length}).`} Rules fire from tone, purpose and beat energy.</p>
      {draft && (
        <Sheet title={draft.isNew ? "Add rule" : "Edit rule"} onClose={() => setDraft(null)}
          footer={<>
            {!draft.isNew && <button className="btn quiet" onClick={() => { onChange(rules.filter((r) => r.id !== draft.rule.id)); setDraft(null); }}>Delete rule</button>}
            <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button className="btn primary" disabled={!!err} onClick={save}>Save rule</button></>}>
          <div className="stack">
            <label className="field"><span className="field-label">Name</span><input value={draft.rule.label} onChange={(e) => setDraft({ ...draft, rule: { ...draft.rule, label: e.target.value } })} /></label>
            <label className="field"><span className="field-label">Active</span>
              <input type="checkbox" checked={draft.rule.enabled} onChange={(e) => setDraft({ ...draft, rule: { ...draft.rule, enabled: e.target.checked } })} /></label>
            <div className="field"><span className="field-label">Fires when the tone includes any of</span>
              <div className="chips" role="group" aria-label="Tones">{TONES.map((t) => { const on = !!draft.rule.when.tones?.includes(t);
                return <button key={t} type="button" className={`chip-toggle${on ? " on" : ""}`} aria-pressed={on} onClick={() => setW({ tones: toggle(draft.rule.when.tones, t) })}>{cap(t)}</button>; })}</div></div>
            <div className="field"><span className="field-label">and the purpose is any of</span>
              <div className="chips" role="group" aria-label="Purposes">{PURPOSES.map((t) => { const on = !!draft.rule.when.purposes?.includes(t);
                return <button key={t} type="button" className={`chip-toggle${on ? " on" : ""}`} aria-pressed={on} onClick={() => setW({ purposes: toggle(draft.rule.when.purposes, t) })}>{cap(t)}</button>; })}</div></div>
            <div className="row">
              <label className="field"><span className="field-label">Some beat has energy at least (1-5)</span>
                <input inputMode="numeric" value={draft.rule.when.energyAtLeast ?? ""} onChange={(e) => setW({ energyAtLeast: num(e.target.value) })} /></label>
              <label className="field"><span className="field-label">All beats have energy at most (1-5)</span>
                <input inputMode="numeric" value={draft.rule.when.energyAtMost ?? ""} onChange={(e) => setW({ energyAtMost: num(e.target.value) })} /></label>
            </div>
            {RULE_FIELDS.map((f) => (
              <label key={f} className="field"><span className="field-label">{RULE_FIELD_LABEL[f]}</span>
                <input value={draft.rule[f]} onChange={(e) => setDraft({ ...draft, rule: { ...draft.rule, [f]: e.target.value } })} /></label>
            ))}
            {err && <p className="error-text" role="alert">{err}</p>}
          </div>
        </Sheet>
      )}
    </div>
  );
}
