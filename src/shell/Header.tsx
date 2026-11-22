import { Bot, Check, Command, Loader2, Search, Settings2, TriangleAlert } from "lucide-react";
import type { ControlMode, MotionProject, Stage } from "../types";
import { effectiveMode, hasAnyProvider, STAGE_MODE } from "../lib/project";
import { BrandMark } from "./BrandMark";
import { Segmented } from "./Segmented";
import type { EngineStatus } from "../lib/api";

export type SaveState = { kind: "saved"; at: number } | { kind: "saving" } | { kind: "dirty" } | { kind: "error"; message: string };

export function saveText(s: SaveState, now: number): string {
  switch (s.kind) {
    case "saving": return "Saving…";
    case "dirty": return "Unsaved changes";
    case "error": return `Save failed: ${s.message}`;
    case "saved": {
      const sec = Math.max(0, Math.round((now - s.at) / 1000));
      return sec < 5 ? "Saved just now" : sec < 90 ? `Saved ${sec} s ago` : `Saved ${Math.round(sec / 60)} min ago`;
    }
  }
}

export function Header({ project, stage, save, now, engine, onSetMode, onHome, onPalette, onSettings, onEngine }: {
  project: MotionProject | null; stage: Stage; save: SaveState; now: number; engine: EngineStatus | null;
  onSetMode: (m: ControlMode) => void; onHome: () => void; onPalette: () => void; onSettings: () => void; onEngine: () => void;
}) {
  const key = STAGE_MODE[stage];
  const why = "Needs an AI provider. Add one in Settings, Providers. Nothing else is blocked.";
  return (
    <header className="header">
      <button className="brand" onClick={onHome} aria-label="MotionCraft, back to projects"><BrandMark size={26} /><span>MotionCraft</span></button>
      {project && (
        <>
          <span className="sep" aria-hidden="true" />
          <span className="proj-name" title={project.name}>{project.name}</span>
          <span className={`status save-${save.kind}`} role="status">
            {save.kind === "saving" ? <Loader2 size={16} className="spin" aria-hidden="true" /> : save.kind === "error" ? <TriangleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
            {saveText(save, now)}
          </span>
        </>
      )}
      <span className="grow" />
      {project && key && (
        <div className="mode-wrap">
          <Bot size={16} aria-hidden="true" />
          <Segmented label="Stage mode" value={effectiveMode(project, key)} onChange={onSetMode}
            options={[
              { value: "manual", label: "Manual" },
              { value: "assisted", label: "Assisted", disabled: !hasAnyProvider(), why },
              { value: "agent-led", label: "Agent-led", disabled: !hasAnyProvider(), why },
            ]} />
          {!hasAnyProvider() && <span className="why">No AI provider</span>}
        </div>
      )}
      {project && <EngineChip engine={engine} onClick={onEngine} />}
      <button className="btn quiet" onClick={onPalette} aria-label="Command search"><Search size={18} strokeWidth={1.75} /><span className="kbd"><Command size={12} aria-hidden="true" />K</span></button>
      <button className="icon-btn" onClick={onSettings} aria-label="Settings"><Settings2 size={20} strokeWidth={1.75} /></button>
    </header>
  );
}

export function EngineChip({ engine, onClick }: { engine: EngineStatus | null; onClick: () => void }) {
  const text = !engine ? "Engine: checking…" : engine.state === "connected" ? `EffectCraft ${engine.version}` :
    engine.state === "version-mismatch" ? `EffectCraft ${engine.version} (pin ${engine.pinned})` : "EffectCraft not found";
  const bad = engine && engine.state !== "connected";
  return (
    <button className={`chip${bad ? " warn" : ""}`} onClick={onClick} aria-label={`Engine status: ${text}`}>
      {bad ? <TriangleAlert size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}{text}
    </button>
  );
}
