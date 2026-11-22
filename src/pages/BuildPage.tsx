import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { useApp } from "../ctx";
import { PageFrame, Viewer } from "../shell/PageFrame";
import { Fold } from "../shell/Fold";
import { hasAnyProvider } from "../lib/project";
import type { FrameProps } from "./common";

export function BuildPage(f: FrameProps) {
  const { engine, openEffectCraft, showSettings, refreshEngine, project } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const connected = engine?.state === "connected";
  const open = async () => { setErr(null); try { await openEffectCraft(); } catch (e) { setErr(String(e instanceof Error ? e.message : e)); } };

  const main = !connected ? (
    <div className="engine-down" role="alert">
      <p className="strong">{engine?.state === "version-mismatch" ? "EffectCraft is not the pinned version" : "EffectCraft is not connected"}</p>
      <p>{engine?.detail ?? "Checking for effectcraft-cli…"}</p>
      <p className="muted">Brief, Intent, Direction and Treatment keep working. Build needs the engine.</p>
      <div className="row-actions"><button className="btn" onClick={refreshEngine}>Reconnect</button><button className="btn" onClick={showSettings}>Locate EffectCraft</button></div>
    </div>
  ) : <Viewer aspect={`${project.brief.deliverables[0]?.width ?? 1920} / ${project.brief.deliverables[0]?.height ?? 1080}`} />;

  const inspector = (
    <>
      <Fold title="Layers" defaultOpen>
        <p className="muted">Read-only list from the engine with role, primitive, provenance, lock and drift. Controls on an approved layer are disabled until you unlock it. Wired in ticket P1-11.</p>
        <button className="btn" onClick={open} disabled={!connected}><ExternalLink size={16} aria-hidden="true" />Open in EffectCraft</button>
        {!connected && <p className="why">Needs a connected engine.</p>}
        {err && <p className="error-text" role="alert">{err}</p>}
      </Fold>
      <Fold title="Text"><p className="muted">Change words, font, size step, palette colour and alignment through the adapter. Everything else opens in EffectCraft.</p></Fold>
      <Fold title="Camera"><p className="muted">Pick a 2.5D move: push, drift or parallax rack, with strength and duration. No keyframes here.</p></Fold>
      <Fold title="Primitives"><p className="muted">The primitive library arrives in Phase 2 (P2-01 to P2-03).</p></Fold>
      <Fold title="Audio"><p className="muted">Waveform, sections, beats, sync mode and the restraint slider arrive in Phase 3.</p></Fold>
      <Fold title="Agent"><p className="muted">{hasAnyProvider() ? "Plan, cost and progress appear here." : "No AI provider is configured, so no agent runs. Everything stays manual."}</p></Fold>
    </>
  );
  return (
    <PageFrame {...f} title="Build" intro="Preview the composition and make light edits. Detailed work opens in EffectCraft." strip main={main} inspector={inspector}
      action={{ label: "Build preview", onClick: () => undefined, disabledReason: connected ? "Preview rendering is wired in ticket P1-11." : "Needs a connected EffectCraft engine." }} />
  );
}
