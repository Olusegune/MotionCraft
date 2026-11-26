import { useState } from "react";
import { Send } from "lucide-react";
import { useApp } from "../ctx";
import { openComposition } from "../lib/openComposition";
import { useSettings } from "../lib/settings";

export const EDITORS: { kind: string; label: string; note: string }[] = [
  { kind: "aep", label: "After Effects (.aep)", note: "A project with the layers, text, keyframes and markers EffectCraft can write. What it cannot carry is listed before anything is written. Effects such as the green screen key are not carried: apply Keylight there." },
  { kind: "fcpxml", label: "DaVinci Resolve or Final Cut Pro (FCPXML)", note: "A timeline, plus the clips it points at, rendered by EffectCraft with their effects, so a keyed clip arrives keyed. In Resolve: File, Import, Timeline." },
  { kind: "xml", label: "Premiere Pro (XML)", note: "The same timeline for Premiere. In Premiere: File, Import." },
  { kind: "otio", label: "OpenTimelineIO", note: "For editors and pipeline tools that read OTIO, including Resolve." },
  { kind: "edl", label: "EDL (one video track)", note: "The simplest cut list. Only one video track is written." },
];

interface Loss { category: string; count: number; details: string[] }
interface Result { ok: boolean; needs_ok?: boolean; target: string; kind: string; path?: string; files?: string[]; losses?: Loss[]; warnings?: string[]; limitations?: string[] }

/** Hand the composition to another editor. Writes into this project's exports folder; nothing is sent anywhere and nothing costs money. */
export function HandOff({ disabled, reason }: { disabled: boolean; reason?: string }) {
  const { project, projectPath } = useApp();
  const { enginePath } = useSettings();
  const [kind, setKind] = useState("fcpxml");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const editor = EDITORS.find((e) => e.kind === kind)!;

  const send = async (allowLosses: boolean) => {
    setBusy(true); setErr(null);
    try {
      const api = await openComposition(project, projectPath, enginePath);
      setRes(await api.engine<Result>("export_bridge", { kind, allow_losses: allowLosses }, projectPath, enginePath));
    } catch (e) { setErr(String(e instanceof Error ? e.message : e)); setRes(null); }
    setBusy(false);
  };

  return (
    <section aria-labelledby="handoff-h" className="handoff">
      <h2 id="handoff-h">Work on it in another editor</h2>
      <label className="field"><span className="field-label">Editor</span>
        <select value={kind} onChange={(e) => { setKind(e.target.value); setRes(null); setErr(null); }}>{EDITORS.map((e) => <option key={e.kind} value={e.kind}>{e.label}</option>)}</select></label>
      <p className="muted">{editor.note}</p>
      <button className="btn" disabled={disabled || busy} title={reason} onClick={() => void send(false)}><Send size={16} aria-hidden="true" />{busy ? "Preparing…" : "Prepare files"}</button>
      {err && <p className="error-text" role="alert">{err}</p>}
      {res?.needs_ok && (
        <div role="alert" className="why">
          <p className="strong">{res.target} cannot carry everything. Nothing was written yet.</p>
          <ul>{(res.losses ?? []).map((l) => <li key={l.category}>{l.count} {l.category.replace(/_/g, " ")}: {l.details.slice(0, 3).join("; ")}</li>)}</ul>
          <button className="btn" disabled={busy} onClick={() => void send(true)}>Send it anyway</button>
        </div>
      )}
      {res?.ok && (
        <div role="status">
          <p className="strong">Ready for {res.target}.</p>
          <p className="mono muted">{res.path}</p>
          {res.files && res.files.length > 1 && <p className="muted">{res.files.length} files, with the clips the timeline points at.</p>}
          {(res.losses ?? []).length > 0 && <p className="muted">Not carried: {(res.losses ?? []).map((l) => `${l.count} ${l.category.replace(/_/g, " ")}`).join(", ")}.</p>}
          {(res.warnings ?? []).map((w) => <p key={w} className="muted">{w}</p>)}
          <p className="muted">It is inside this project, in the exports folder. Export the collected project to get it out as a folder.</p>
        </div>
      )}
    </section>
  );
}
