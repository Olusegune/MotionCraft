import { Upload } from "lucide-react";
import { useApp } from "../ctx";
import { Fold } from "../shell/Fold";
import { PageFrame } from "../shell/PageFrame";
import { Field, type FrameProps } from "./common";
import { hasAnyProvider } from "../lib/project";
import { GeneratePanel } from "./GeneratePanel";

const ATTACHMENTS = ["Script", "Music or narration audio", "Reference images", "Brand documents (PDF)", "Storyboard images"];

export function BriefPage(f: FrameProps) {
  const { project, update, go } = useApp();
  const words = project.brief.text.trim() ? project.brief.text.trim().split(/\s+/).length : 0;
  const inspector = (
    <>
      <Fold title="Attachments" defaultOpen meta={<span className="count">0</span>}>
        <p className="muted">Attach what the agent and you will work from. Files are copied into the project package with relative paths.</p>
        <ul className="plain">
          {ATTACHMENTS.map((a) => <li key={a}><button className="btn" disabled><Upload size={16} aria-hidden="true" />{a}</button></li>)}
        </ul>
        <p className="why">Importing files arrives in ticket P1-07. Until then, paste the script into the box on the left.</p>
      </Fold>
      <Fold title="Media" meta={<span className="count">{project.assets?.length ?? 0}</span>}><GeneratePanel /></Fold>
      <Fold title="Audio"><p className="muted">No audio yet. Analysis, sync modes and the restraint slider are in Build, Audio (Phase 3).</p></Fold>
    </>
  );
  return (
    <PageFrame {...f} title="Brief" intro="What the piece is, who it is for, and anything that must appear. Write it in your own words."
      inspector={inspector}
      action={{
        label: "Interpret brief",
        disabledReason: hasAnyProvider() ? undefined : "Needs an AI provider (Settings, Providers). You can write the intent yourself instead.",
        onClick: () => go("intent"),
        secondary: { label: "Continue to Intent", onClick: () => go("intent") },
      }}
      main={
        <div className="stack">
          <Field label="Brief" hint={`${words} word${words === 1 ? "" : "s"}. Saved automatically.`}>
            <textarea rows={9} value={project.brief.text} placeholder="Describe the piece: purpose, audience, tone, length, what must be said."
              onChange={(e) => update((p) => ({ ...p, brief: { ...p.brief, text: e.target.value }, updatedAt: new Date().toISOString() }))} />
          </Field>
          <Field label="Script (optional)" hint="Exact words that must appear as native, editable text.">
            <textarea rows={7} value={project.brief.script ?? ""} placeholder="Paste a script, lyrics or on-screen copy."
              onChange={(e) => update((p) => ({ ...p, brief: { ...p.brief, script: e.target.value }, updatedAt: new Date().toISOString() }))} />
          </Field>
        </div>
      } />
  );
}
