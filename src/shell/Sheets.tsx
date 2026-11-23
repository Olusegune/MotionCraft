import { useState } from "react";
import type { GateId, MotionProject } from "../types";
import { Sheet } from "./Sheet";
import { Segmented } from "./Segmented";
import { updateSettings, useSettings } from "../lib/settings";
import { approvedGatesAffectedBy, GATE_NAME, gateLabel, gateState, stageComplete } from "../lib/project";
import { ProvidersSection } from "./ProvidersSection";
import { LlmSection } from "./LlmSection";
import { SHORTCUTS } from "../lib/shortcuts";
import { getApi, type EngineStatus } from "../lib/api";

export function ImpactSheet({ project, gate, onCancel, onConfirm }: { project: MotionProject; gate: GateId; onCancel: () => void; onConfirm: () => void }) {
  const affected = approvedGatesAffectedBy(project, gate);
  const n = project.revisions.length + 1;
  return (
    <Sheet title="Unlock approved material" onClose={onCancel}
      footer={<><button className="btn" onClick={onCancel}>Keep it approved</button><button className="btn primary" onClick={onConfirm}>Unlock and create revision {n}</button></>}>
      <p>Editing this creates <strong>revision {n}</strong>. Nothing changes until you confirm, and nothing is deleted.</p>
      <h3>Approvals that will need re-approval</h3>
      <ul className="plain">{affected.map((g) => <li key={g}>Gate {g}: {GATE_NAME[g].approves}</li>)}</ul>
      <h3>Downstream stages affected</h3>
      <p className="muted">Everything after {GATE_NAME[gate].stage}. Approved layers in the composition stay locked; unlocking a layer is a separate action.</p>
    </Sheet>
  );
}

export function GateSheet({ project, gate, onClose, onApprove }: { project: MotionProject; gate: GateId; onClose: () => void; onApprove: () => void }) {
  const st = gateState(project, gate);
  const can = st === "ready" || st === "needs-reapproval" || st === "changed";
  const ready = stageComplete(project, gate);
  return (
    <Sheet title={`Gate ${gate}: ${GATE_NAME[gate].stage}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Close</button>{can && ready && <button className="btn primary" onClick={() => { onApprove(); onClose(); }}>{GATE_NAME[gate].action}</button>}</>}>
      <p>{gateLabel(project, gate)}.</p>
      <p className="muted">This gate approves {GATE_NAME[gate].approves}. Approval is always your click, in every mode.</p>
      {!ready && <p className="why">The work this gate covers is not complete yet.</p>}
    </Sheet>
  );
}

export function SaveCopySheet({ defaultName, onClose, onSave }: { defaultName: string; onClose: () => void; onSave: (name: string) => void }) {
  const [name, setName] = useState(defaultName);
  return (
    <Sheet title="Save a copy" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim()} onClick={() => onSave(name.trim())}>Save copy</button></>}>
      <p className="muted">Copies the whole project (brief, decisions, assets and the EffectCraft composition) under a new name. The original is not changed. Projects save automatically, so File, Save only makes sure the latest edit is written.</p>
      <label className="field"><span className="field-label">Name</span><input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); }} /></label>
    </Sheet>
  );
}

export function ManualSheet({ onClose, onSettings }: { onClose: () => void; onSettings: () => void }) {
  return (
    <Sheet title="Working manually" onClose={onClose} footer={<><button className="btn" onClick={onSettings}>Open Settings</button><button className="btn primary" onClick={onClose}>Got it</button></>}>
      <p><strong>You are in Manual mode.</strong> Every page works without an AI account: write the brief, set the intent, choose the style, plan each beat, build in the Build page and EffectCraft, review and deliver. Nothing is sent anywhere.</p>
      <ul className="plain">
        <li><strong>Assisted</strong> and <strong>Agent-led</strong> need an AI language-model provider. They are not available yet; the buttons are greyed with the reason.</li>
        <li><strong>Image and video generation</strong> is separate and optional: Settings, Image and video providers. It is off until you turn it on.</li>
        <li>Approvals (gates A to D) are always your click, in every mode.</li>
      </ul>
    </Sheet>
  );
}

export function AboutSheet({ engine, onClose }: { engine: EngineStatus | null; onClose: () => void }) {
  return (
    <Sheet title="About MotionCraft" onClose={onClose} footer={<button className="btn primary" onClick={onClose}>Close</button>}>
      <dl className="facts"><dt>Version</dt><dd>0.1.0 (Phase 1 preview)</dd><dt>EffectCraft</dt><dd>{engine ? engine.detail : "Checking…"}</dd><dt>Pinned engine</dt><dd>EffectCraft 0.24.1, commit 7e2d025</dd></dl>
      <p className="muted">Fonts: Inter, Space Grotesk and IBM Plex Mono (SIL Open Font License). Icons: Lucide (ISC). Licence files are in the THIRD_PARTY_NOTICES folder.</p>
    </Sheet>
  );
}

export function SettingsSheet({ engine, onClose, onRecheck, onModels }: { engine: EngineStatus | null; onClose: () => void; onRecheck: () => void; onModels: () => void }) {
  const s = useSettings();
  const [path, setPath] = useState(s.enginePath);
  return (
    <Sheet title="Settings" onClose={onClose} wide footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="stack">
        <section><h3>Working mode</h3>
          <p><strong>Manual.</strong> Everything works without an AI account. Assisted and Agent-led need a language-model provider, which is not available yet.</p></section>
        <section><h3>Appearance</h3>
          <label className="field"><span className="field-label">UI scale ({s.uiScale}%)</span>
            <input type="range" min={90} max={250} step={5} value={s.uiScale} onChange={(e) => updateSettings({ uiScale: Number(e.target.value) })} /></label></section>
        <section><h3>Offline mode</h3>
          <Segmented label="Offline mode" value={s.offline ? "on" : "off"} onChange={(v) => updateSettings({ offline: v === "on" })} options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} />
          <p className="muted">When on, cloud providers are disabled: no model lists are refreshed and nothing is generated.</p></section>
        <section><h3>Engine</h3>
          <p>{engine ? engine.detail : "Checking…"}</p>
          <label className="field"><span className="field-label">Path to effectcraft-cli (optional)</span><input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Leave empty to search the usual install folders" /></label>
          <div className="row-actions">
            <button className="btn" onClick={async () => { const p = await (await getApi()).pickPath("engine").catch(() => null); if (p) { setPath(p); updateSettings({ enginePath: p }); onRecheck(); } }}>Browse…</button>
            <button className="btn" onClick={() => { updateSettings({ enginePath: path.trim() }); onRecheck(); }}>Save and recheck</button>
            <button className="btn quiet" onClick={() => { setPath(""); updateSettings({ enginePath: "" }); onRecheck(); }}>Find automatically</button></div>
          <p className="muted">Pinned: EffectCraft 0.24.1, commit 7e2d025.</p></section>
        <ProvidersSection onModels={onModels} />
        <LlmSection />
        <section><h3>Shortcuts</h3><ul className="plain">{SHORTCUTS.map((x) => <li key={x.id}><span className="kbd">{x.keys}</span> {x.label}</li>)}</ul></section>
      </div>
    </Sheet>
  );
}
