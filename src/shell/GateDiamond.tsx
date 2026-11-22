import type { GateState } from "../lib/project";

/** Five states differ by shape and text, never colour alone (UI_UX 4.2). */
export function GateGlyph({ state, size = 20 }: { state: GateState; size?: number }) {
  const d = "M10 2 18 10 10 18 2 10Z";
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {state === "approved" ? (
        <><path d={d} fill="currentColor" /><path d="m6.6 10.2 2.3 2.3 4.5-4.7" fill="none" stroke="var(--mc-bg-app)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></>
      ) : state === "changed" ? (
        <><path d={d} fill="currentColor" /><path d="M10 6.2v5" stroke="var(--mc-bg-app)" strokeWidth="1.9" strokeLinecap="round" /><circle cx="10" cy="13.4" r="1.05" fill="var(--mc-bg-app)" /></>
      ) : state === "needs-reapproval" ? (
        <><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><path d="m5 15 10-10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>
      ) : state === "ready" ? (
        <><path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /><circle cx="10" cy="10" r="2" fill="currentColor" /></>
      ) : (
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      )}
    </svg>
  );
}
