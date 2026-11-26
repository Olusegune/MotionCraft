import { useState } from "react";
import type { UpdateInfo } from "../lib/api";

/** A newer signed release is available. Installing is always the person's click; the project is saved first. */
export function UpdateBanner({ info, onInstall, onLater }: { info: UpdateInfo; onInstall: () => Promise<void>; onLater: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="notice" role="status">
      <span>MotionCraft {info.version} is available (you have {info.current}).{err ? ` Could not update: ${err}` : ""}</span>
      <button className="btn primary" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await onInstall(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); } }}>{busy ? "Updating…" : "Install and restart"}</button>
      {!busy && <button className="icon-btn" aria-label="Later" onClick={onLater}>×</button>}
    </div>
  );
}
