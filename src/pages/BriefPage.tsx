import { useRef, useState } from "react";
import { FileText, ImagePlus, Music, PencilLine, Sparkles, Upload, LayoutGrid } from "lucide-react";
import { MediaWall, useImportMedia } from "../shell/Media";
import { useApp } from "../ctx";
import { Fold } from "../shell/Fold";
import { PageFrame } from "../shell/PageFrame";
import { Segmented } from "../shell/Segmented";
import { Field, useLocked, type FrameProps } from "./common";
import { hasAnyProvider } from "../lib/project";
import { applyLook, currentLook } from "../lib/styles";
import { StyleCard } from "../shell/StyleArt";
import { GeneratePanel } from "./GeneratePanel";
import type { Tone } from "../types";

type Tab = "brief" | "script" | "audio";
const TABS: { id: Tab; label: string; Icon: typeof FileText }[] = [
  { id: "brief", label: "Write a brief", Icon: PencilLine },
  { id: "script", label: "Import script", Icon: FileText },
  { id: "audio", label: "Start with audio", Icon: Music },
];

/** Starting points only fill the brief box with a sensible first draft. Nothing is generated or charged. */
const STARTS: { id: string; label: string; text: string }[] = [
  { id: "title", label: "Title sequence", text: "Create a short title sequence for [title]. Confident, precise typography with a striking reveal, ending on a clear hold of the name." },
  { id: "explainer", label: "Explainer", text: "Create a 45-second explainer that makes one idea clear in three steps: the problem, the idea, the result. Calm pacing, clear on-screen words, simple shapes that support the voice." },
  { id: "product", label: "Product story", text: "Create a product story that opens on the problem, shows the product solving it, and ends on a clear call to action. Clean, premium look, short lines of text timed to the music." },
];

const TONES: { id: Tone; label: string }[] = [
  { id: "playful", label: "Playful" }, { id: "elegant", label: "Elegant" }, { id: "authoritative", label: "Authoritative" }, { id: "trustworthy", label: "Trustworthy" },
  { id: "instructional", label: "Instructional" }, { id: "provocative", label: "Provocative" }, { id: "restrained", label: "Restrained" },
];

export function BriefPage(f: FrameProps) {
  const { project, update, go } = useApp();
  const imp = useImportMedia();
  const styleLocked = useLocked("B");
  const [tab, setTab] = useState<Tab>("brief");
  const [budgetText, setBudgetText] = useState(() => String(project.budget.capUsd));
  const briefBox = useRef<HTMLTextAreaElement>(null);
  const chars = project.brief.text.length;
  const d = project.brief.deliverables[0];
  const touch = (fn: (p: typeof project) => typeof project) => update((p) => ({ ...fn(p), updatedAt: new Date().toISOString() }));
  const noAi = "Needs an AI provider (Settings, Providers). You can write the intent yourself instead.";

  const start = (text: string) => {
    touch((p) => ({ ...p, brief: { ...p.brief, text: p.brief.text.trim() ? `${p.brief.text.trimEnd()}\n\n${text}` : text } }));
    setTab("brief");
    setTimeout(() => briefBox.current?.focus(), 0);
  };
  const tabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const n = TABS[(i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length];
    setTab(n.id);
    document.getElementById(`brief-tab-${n.id}`)?.focus();
  };
  const toggleTone = (t: Tone) => touch((p) => ({ ...p, intent: { ...p.intent, tone: p.intent.tone.includes(t) ? p.intent.tone.filter((x) => x !== t) : [...p.intent.tone, t] } }));
  const assets = project.assets ?? [];

  const inspector = (
    <>
      <section className="prefs" aria-labelledby="prefs-h">
        <h2 id="prefs-h">Project preferences</h2>
        <div className="pref">
          <span className="pref-label" id="vd-l">Visual direction</span>
          <div className="pref-row" role="group" aria-labelledby="vd-l">
            <button className="btn" disabled={!hasAnyProvider()} title={hasAnyProvider() ? undefined : noAi}><Sparkles size={16} aria-hidden="true" />Auto suggest</button>
            <button className="btn" onClick={() => go("direction")}><LayoutGrid size={16} aria-hidden="true" />Browse styles</button>
          </div>
          <div className="style-row" role="group" aria-label="Quick style picks">
            {["bauhaus", "cut-paper", "neon-light"].map((id) => <StyleCard key={id} id={id} compact on={currentLook(project) === id} disabled={styleLocked} onPick={() => update((p) => applyLook(p, id))} />)}
          </div>
          <button className="btn quiet link-btn" onClick={() => go("direction")}>Explore all styles →</button>
        </div>
        <div className="pref">
          <span className="pref-label">Duration</span>
          <span className="mono">{d.durationSec} seconds</span>
        </div>
        <div className="pref">
          <span className="pref-label">Aspect ratio</span>
          <Segmented label="Aspect ratio" value={d.aspect} onChange={() => undefined}
            options={(["16:9", "9:16", "1:1", "4:5", "21:9"] as const).map((a) => ({ value: a, label: a, disabled: a !== d.aspect, why: "Set when the project is created." }))} />
          <p className="hint">{d.width} × {d.height} at {d.fps} fps. Duration and size are set when the project is created.</p>
        </div>
        <div className="pref">
          <label className="pref-label" htmlFor="budget">Budget limit</label>
          <div className="pref-row">
            <span aria-hidden="true">$</span>
            <input id="budget" type="number" min={0} step={1} value={budgetText} aria-describedby="budget-h"
              onChange={(e) => { setBudgetText(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= 0) touch((p) => ({ ...p, budget: { ...p.budget, capUsd: n } })); }}
              onBlur={() => setBudgetText(String(project.budget.capUsd))} />
          </div>
          <p className="hint" id="budget-h">Most you will approve for paid generation in this project.</p>
        </div>
        <div className="pref">
          <span className="pref-label" id="tone-l">Emotional direction <span className="muted">(optional)</span></span>
          <div className="chips" role="group" aria-labelledby="tone-l">
            {TONES.map((t) => <button key={t.id} className={`chip-toggle${project.intent.tone.includes(t.id) ? " on" : ""}`} aria-pressed={project.intent.tone.includes(t.id)} onClick={() => toggleTone(t.id)}>{t.label}</button>)}
          </div>
        </div>
      </section>
      <Fold title="Media" meta={<span className="count">{assets.length}</span>}><GeneratePanel /></Fold>
      <Fold title="Audio"><p className="muted">No audio yet. Analysis, sync modes and the restraint slider are in Build, Audio (Phase 3).</p></Fold>
    </>
  );

  return (
    <PageFrame {...f} title="Brief" intro="" inspector={inspector}
      action={{
        label: "Interpret brief",
        disabledReason: hasAnyProvider() ? undefined : noAi,
        onClick: () => go("intent"),
        secondary: { label: "Start with a blank project", onClick: () => go("intent") },
      }}
      main={
        <div className="stack brief">
          <div>
            <h2 className="brief-q">What would you like to bring to life?</h2>
            <p className="brief-sub">Start with a brief, script, music track, or visual reference.</p>
          </div>

          <div className="tabs" role="tablist" aria-label="How to start">
            {TABS.map((t, i) => (
              <button key={t.id} id={`brief-tab-${t.id}`} role="tab" aria-selected={tab === t.id} aria-controls={`brief-panel-${t.id}`} tabIndex={tab === t.id ? 0 : -1}
                className={`tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)} onKeyDown={(e) => tabKey(e, i)}>
                <t.Icon size={18} strokeWidth={1.75} aria-hidden="true" />{t.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`brief-panel-${tab}`} aria-labelledby={`brief-tab-${tab}`}>
            {tab === "brief" && (
              <Field label="Brief" hint={`${chars} character${chars === 1 ? "" : "s"}. Saved automatically.`}>
                <textarea ref={briefBox} rows={9} value={project.brief.text} placeholder="Describe the piece: purpose, audience, tone, length, what must be said."
                  onChange={(e) => touch((p) => ({ ...p, brief: { ...p.brief, text: e.target.value } }))} />
              </Field>
            )}
            {tab === "script" && (
              <Field label="Script (optional)" hint="Exact words that must appear as native, editable text. Paste them here.">
                <textarea rows={9} value={project.brief.script ?? ""} placeholder="Paste a script, lyrics or on-screen copy."
                  onChange={(e) => touch((p) => ({ ...p, brief: { ...p.brief, script: e.target.value } }))} />
              </Field>
            )}
            {tab === "audio" && (
              <div className="stack">
                <p className="muted">Add a music track or narration and MotionCraft will find its beats and sections in Build, Audio. The audio is copied into the project.</p>
                <div><button className="btn" disabled={imp.busy} onClick={() => void imp.run()}><Music size={16} aria-hidden="true" />Add music or narration…</button></div>
              </div>
            )}
            {imp.error && <p className="error-text" role="alert">{imp.error}</p>}
          </div>

          <div className="attach-row" role="group" aria-label="Attachments">
            {assets.map((a) => <span key={a.id} className="file-chip" title={a.path}><FileText size={16} aria-hidden="true" /><span>{a.name}</span><span className="muted">{a.kind}</span></span>)}
            <button className="btn" disabled={imp.busy} onClick={() => void imp.run()}><ImagePlus size={16} aria-hidden="true" />Add files</button>
          </div>

          <section aria-labelledby="start-h">
            <h2 id="start-h" className="section-h">Starting point</h2>
            <div className="starts">
              {STARTS.map((s) => <button key={s.id} className="start-card" onClick={() => start(s.text)}><span className="start-name">{s.label}</span><span className="muted">Fills the brief with a first draft</span></button>)}
              <button className="start-card custom" onClick={() => { setTab("brief"); setTimeout(() => briefBox.current?.focus(), 0); }}><span className="start-name">Custom</span><span className="muted">Write your own</span></button>
            </div>
            <p className="hint">Review the direction and estimated cost before production. Nothing is generated or charged until you approve it.</p>
          </section>

          <section aria-labelledby="wall-h">
            <div className="beats-head"><h2 id="wall-h">Media wall</h2><button className="btn" disabled={imp.busy} onClick={() => void imp.run()}><Upload size={16} aria-hidden="true" />Add media…</button></div>
            <MediaWall assets={assets} empty="Add reference pictures, logos, footage or music. Everything you add here can become a moodboard reference or a storyboard frame." />
          </section>
        </div>
      } />
  );
}
