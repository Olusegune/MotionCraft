import { FolderOpen, History, ImageIcon, Settings2, Wand2, type LucideIcon } from "lucide-react";
import type { Stage } from "../types";

/** The slim rail down the left of an open project (after the mockup): quick doors to the places people go most. The stage bar stays the main way through the work. */
export function SideRail({ stage, onHome, onStage, onSettings }: { stage: Stage; onHome: () => void; onStage: (s: Stage) => void; onSettings: () => void }) {
  const items: { id: string; label: string; aria: string; Icon: LucideIcon; on: () => void; current: boolean }[] = [
    { id: "project", label: "Project", aria: "Project list", Icon: FolderOpen, on: onHome, current: false },
    { id: "media", label: "Media", aria: "Open the media wall", Icon: ImageIcon, on: () => onStage("brief"), current: false },
    { id: "direction", label: "Direction", aria: "Direction styles", Icon: Wand2, on: () => onStage("direction"), current: stage === "direction" },
    { id: "versions", label: "Versions", aria: "Versions and history", Icon: History, on: () => onStage("review"), current: false },
    { id: "settings", label: "Settings", aria: "Settings", Icon: Settings2, on: onSettings, current: false },
  ];
  return (
    <nav className="side-rail" aria-label="Quick access">
      {items.map(({ id, label, aria, Icon, on, current }) => (
        <button key={id} className={`rail-item${current ? " on" : ""}`} aria-label={aria} aria-current={current ? "page" : undefined} onClick={on}>
          <Icon size={24} strokeWidth={1.6} aria-hidden="true" /><span aria-hidden="true">{label}</span>
        </button>
      ))}
    </nav>
  );
}
