import { TriangleAlert } from "lucide-react";
import type { Dimension, Intensity } from "../types";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { Segmented } from "../shell/Segmented";
import { DIMENSIONS, detectConflicts, FAMILIES, familyLabel } from "../lib/styles";
import { gateState } from "../lib/project";
import { LockBar, useLocked, type FrameProps } from "./common";

const INTENSITIES: Intensity[] = ["subtle", "moderate", "strong"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DirectionPage(f: FrameProps) {
  const { project, update, approveGate } = useApp();
  const locked = useLocked("B");
  const conflicts = detectConflicts(project);
  const open = conflicts.filter((c) => !c.overridden);
  const chosen = Object.keys(project.style.dimensions).length;
  const state = gateState(project, "B");

  const setDim = (d: Dimension, v: { familyId: string; intensity: Intensity } | null) =>
    update((p) => {
      const dims = { ...p.style.dimensions };
      if (v) dims[d] = v; else delete dims[d];
      return { ...p, style: { ...p.style, dimensions: dims }, updatedAt: new Date().toISOString() };
    });
  const override = (a: string, b: string, reason: string, on: boolean) =>
    update((p) => ({ ...p, style: { ...p.style, conflicts: [...p.style.conflicts.filter((c) => !(c.a === a && c.b === b)), { a, b, reason, overridden: on }] } }));

  const main = (
    <div className="stack">
      <LockBar gate="B" kind="style_change" />
      <div className="proposal-empty">
        <p className="strong">Proposals</p>
        <p>The Director drafts two or three directions with stills once an AI provider is configured. You can build one yourself below; each dimension gets a style family and an intensity, never a blend percentage.</p>
      </div>
      <fieldset className="grp" disabled={locked}>
        <legend className="visually-hidden">Style system</legend>
        <h2>Style system</h2>
        <ul className="dims">
          {DIMENSIONS.map((d) => {
            const v = project.style.dimensions[d.id];
            return (
              <li key={d.id} className="dim">
                <label className="dim-label" htmlFor={`dim-${d.id}`}>{d.label}</label>
                <select id={`dim-${d.id}`} value={v?.familyId ?? ""} onChange={(e) => setDim(d.id, e.target.value ? { familyId: e.target.value, intensity: v?.intensity ?? "moderate" } : null)}>
                  <option value="">Not set</option>
                  {FAMILIES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <Segmented<Intensity> label={`${d.label} intensity`} value={v?.intensity ?? "moderate"} onChange={(i) => v && setDim(d.id, { ...v, intensity: i })}
                  options={INTENSITIES.map((i) => ({ value: i, label: cap(i), disabled: !v, why: "Pick a family first." }))} />
              </li>
            );
          })}
        </ul>
      </fieldset>
      {conflicts.length > 0 && (
        <section aria-label="Conflicts" className="conflicts">
          <h2>Conflicts</h2>
          <ul>{conflicts.map((c) => (
            <li key={`${c.a}|${c.b}`} className={c.overridden ? "overridden" : ""}>
              <TriangleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
              <span><strong>{c.overridden ? "Overridden" : "Warning"}:</strong> {familyLabel(c.a.split(":")[1])} with {familyLabel(c.b.split(":")[1])}. {c.reason}</span>
              <button className="btn" disabled={locked} onClick={() => override(c.a, c.b, c.reason, !c.overridden)}>{c.overridden ? "Restore warning" : "Override"}</button>
            </li>))}</ul>
        </section>
      )}
    </div>
  );
  const inspector = (
    <>
      <Fold title="Style system" defaultOpen meta={<span className="count">{chosen} of 7</span>}>
        <p className="muted">No style is the default identity. Nothing is chosen until you choose it.</p>
        <ul className="plain">{DIMENSIONS.filter((d) => project.style.dimensions[d.id]).map((d) => <li key={d.id}>{d.label}: {familyLabel(project.style.dimensions[d.id]!.familyId)} ({project.style.dimensions[d.id]!.intensity})</li>)}</ul>
      </Fold>
      <Fold title="References"><p className="muted">Moodboard, source notes and extracted principles. Apply principles copies ideas, never a living designer&apos;s signature work. Arrives with ticket P2-06.</p></Fold>
      <Fold title="Fonts and palette"><p className="muted">Fonts show a video-use licence status here. Nothing is substituted silently. Arrives with the style families (P2-04).</p></Fold>
    </>
  );
  return (
    <PageFrame {...f} title="Direction" intro="Choose how it should look and move, one dimension at a time." main={main} inspector={inspector}
      action={{
        label: state === "approved" ? "Direction approved" : "Approve direction", onClick: () => approveGate("B"),
        disabledReason: state === "approved" ? "Already approved. Unlock to change it." : chosen === 0 ? "Choose a style for at least one dimension." :
          open.length ? `Resolve or override ${open.length} conflict${open.length === 1 ? "" : "s"} first.` : undefined,
      }} />
  );
}
