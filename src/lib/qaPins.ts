/** The newest QA run's findings that have a time, shared so the Build timeline can pin them (ADR-0007, T2). Read-only; cleared with the project. */
export interface QaPin { id: string; t: number; label: string; severity: "info" | "warn" | "error" }
let pins: QaPin[] = [];
const subs = new Set<() => void>();
export const getQaPins = (): QaPin[] => pins;
export function setQaPins(next: QaPin[]): void { pins = next; subs.forEach((f) => f()); }
export function subscribeQaPins(f: () => void): () => void { subs.add(f); return () => { subs.delete(f); }; }
