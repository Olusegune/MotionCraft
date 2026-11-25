import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Dimension, Intensity } from "../types";
import { useApp } from "../ctx";
import { PageFrame } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { Segmented } from "../shell/Segmented";
import { applyLook, CATEGORY_LABEL, currentLook, DIMENSIONS, detectConflicts, FAMILIES, familyLabel, samePair, type FamilyCategory } from "../lib/styles";
import { StyleCard } from "../shell/StyleArt";
import { gateState } from "../lib/project";
import { LockBar, useLocked, type FrameProps } from "./common";
import { MediaWall, useImportMedia } from "../shell/Media";
import { Proposals } from "./Proposals";
import { ImagePlus } from "lucide-react";

const INTENSITIES: Intensity[] = ["subtle", "moderate", "strong"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DirectionPage(f: FrameProps) {
  const { project, update, approveGate } = useApp();
  const imp = useImportMedia();
  const locked = useLocked("B");
  const images = (project.assets ?? []).filter((a) => a.kind === "image");
  const mood = project.style.moodboard ?? [];
  const toggleMood = (id: string) => update((p) => ({ ...p, style: { ...p.style, moodboard: mood.includes(id) ? mood.filter((x) => x !== id) : [...mood, id] }, updatedAt: new Date().toISOString() }));
  const conflicts = detectConflicts(project);
  const open = conflicts.filter((c) => !c.overridden);
  const chosen = Object.keys(project.style.dimensions).length;
  const state = gateState(project, "B");
  const [cat, setCat] = useState<FamilyCategory | "all">("all");
  const shown = cat === "all" ? FAMILIES : FAMILIES.filter((f) => f.category === cat);

  const setDim = (d: Dimension, v: { familyId: string; intensity: Intensity } | null) =>
    update((p) => {
      const dims = { ...p.style.dimensions };
      if (v) dims[d] = v; else delete dims[d];
      return { ...p, style: { ...p.style, dimensions: dims }, updatedAt: new Date().toISOString() };
    });
  const override = (a: string, b: string, reason: string, on: boolean) =>
    update((p) => ({ ...p, style: { ...p.style, conflicts: [...p.style.conflicts.filter((c) => !samePair(c, a, b)), { a, b, reason, overridden: on }] } }));

  const main = (
    <div className="stack">
      <LockBar gate="B" kind="style_change" />
      <section aria-labelledby="mood-h">
        <div className="beats-head"><h2 id="mood-h">Moodboard</h2><button className="btn" disabled={imp.busy || locked} onClick={() => void imp.run()}><ImagePlus size={16} aria-hidden="true" />Add pictures…</button></div>
        <p className="muted">Pick the pictures that show the feeling you want. They become references for the style, as principles, never as work to copy.</p>
        <MediaWall assets={images} selected={mood} onPick={locked ? undefined : (a) => toggleMood(a.id)} empty="No pictures yet. Add reference images, then click the ones that belong on the moodboard." />
        {imp.error && <p className="error-text" role="alert">{imp.error}</p>}
      </section>
      <Proposals />
      <section aria-labelledby="looks-h">
        <h2 id="looks-h">Style presets</h2>
        <p className="muted">Pick one to use that family for everything, then fine-tune any dimension below. Nothing is chosen until you click one.</p>
        <div className="chips" role="group" aria-label="Filter presets">
          {(["all", "core", "medium", "movement", "technique"] as const).map((k) => (
            <button key={k} type="button" className={`chip${cat === k ? " on" : ""}`} aria-pressed={cat === k} onClick={() => setCat(k)}>
              {k === "all" ? `All (${FAMILIES.length})` : `${CATEGORY_LABEL[k]} (${FAMILIES.filter((f) => f.category === k).length})`}</button>))}
        </div>
        <div className="style-grid" role="group" aria-labelledby="looks-h">
          {shown.map((fam) => <StyleCard key={fam.id} id={fam.id} on={currentLook(project) === fam.id} disabled={locked} onPick={() => update((p) => applyLook(p, fam.id))} />)}
        </div>
      </section>
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
                  {(Object.keys(CATEGORY_LABEL) as FamilyCategory[]).map((k) => <optgroup key={k} label={CATEGORY_LABEL[k]}>{FAMILIES.filter((x) => x.category === k).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>)}
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
