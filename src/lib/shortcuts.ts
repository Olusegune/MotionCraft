// One registry; components never hard-code keys (UI_UX section 12).
export interface Shortcut { id: string; keys: string; label: string }
export const SHORTCUTS: Shortcut[] = [
  { id: "palette", keys: "Ctrl+K", label: "Command palette" },
  { id: "viewer-only", keys: "Ctrl+Shift+V", label: "Toggle viewer-only mode" },
  { id: "inspector", keys: "Ctrl+\\", label: "Collapse or expand inspector" },
  { id: "settings", keys: "Ctrl+,", label: "Settings" },
  { id: "esc", keys: "Escape", label: "Close sheet or leave viewer-only" },
];
export function matches(e: KeyboardEvent, id: string): boolean {
  const s = SHORTCUTS.find((x) => x.id === id); if (!s) return false;
  const parts = s.keys.split("+"); const key = parts[parts.length - 1];
  const need = { ctrl: parts.includes("Ctrl"), shift: parts.includes("Shift") };
  const ctrl = e.ctrlKey || e.metaKey;
  if (need.ctrl !== ctrl || need.shift !== e.shiftKey) return false;
  return e.key.toLowerCase() === key.toLowerCase();
}
