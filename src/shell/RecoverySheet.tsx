import { Sheet } from "./Sheet";
import type { ProjectHealth } from "../lib/api";

const when = (iso?: string | null) => { const d = iso ? new Date(iso) : null; return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "an unknown time"; };

/** Shown at launch after an unclean exit, and when a project file is damaged. Nothing is deleted: a damaged file is kept beside the restored one. */
export function RecoverySheet({ kind, name, updatedAt, health, busy, error, onOpen, onRestore, onClose }: {
  kind: "unclean" | "damaged"; name: string; updatedAt?: string; health: ProjectHealth; busy: boolean; error?: string | null;
  onOpen?: () => void; onRestore: () => void; onClose: () => void;
}) {
  const damaged = health.state !== "ok";
  const canRestore = health.hasBackup;
  return (
    <Sheet title={kind === "unclean" ? "MotionCraft closed unexpectedly" : "This project is damaged"} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>{kind === "unclean" ? "Not now" : "Cancel"}</button>
        {canRestore && damaged && <button className="btn primary" disabled={busy} onClick={onRestore}>Restore the last good copy</button>}
        {kind === "unclean" && !damaged && onOpen && <button className="btn primary" disabled={busy} onClick={onOpen}>Open {name}</button>}
      </>}>
      {kind === "unclean" && <p>MotionCraft did not close properly while <strong>{name}</strong> was open. Changes are saved a second after you make them, and at least every 30 seconds, so at most the last few seconds of work can be missing.</p>}
      {kind === "unclean" && !damaged && <p className="muted">Last saved {when(updatedAt)}.</p>}
      {damaged && <p>The project file for <strong>{name}</strong> cannot be read.{canRestore ? ` The last good copy was saved ${when(health.backupUpdatedAt)}. Restoring it puts that copy back and keeps the damaged file next to it as project.damaged.json.` : " There is no good backup to restore."}</p>}
      {error && <p className="error-text" role="alert">{error}</p>}
    </Sheet>
  );
}
