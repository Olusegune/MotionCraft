import type { MotionProject, SpendEntry } from "../types";

/**
 * What this project has spent on paid generation, and the limit on it. Aggregators often publish no price, so a dollar cap alone cannot protect anyone:
 * every paid call is also counted, and the count has its own limit. The ledger holds what was started, with the price only when one was known.
 */

export const DEFAULT_MAX_CALLS = 25;

export interface SpendSummary { calls: number; knownUsd: number; unknownCalls: number }

export function spendSummary(p: Pick<MotionProject, "budget">): SpendSummary {
  const l = p.budget.ledger ?? [];
  return { calls: l.length, knownUsd: l.reduce((n, e) => n + (e.usd ?? 0), 0), unknownCalls: l.filter((e) => e.usd === null).length };
}

export function recordSpend(p: MotionProject, e: Omit<SpendEntry, "at">): MotionProject {
  return { ...p, budget: { ...p.budget, ledger: [...(p.budget.ledger ?? []), { ...e, at: new Date().toISOString() }] } };
}

/**
 * Why `more` more paid calls (each about `eachUsd`, or unknown) should not start, or undefined when they may.
 * Known prices count against the dollar limit; unknown prices count against the call limit.
 */
export function capBlock(p: Pick<MotionProject, "budget">, eachUsd: number | null, more = 1): string | undefined {
  const s = spendSummary(p);
  const maxCalls = p.budget.maxCalls ?? DEFAULT_MAX_CALLS;
  if (s.calls + more > maxCalls) return `This project has reached its limit of ${maxCalls} paid calls. Raise the limit in Brief, Project preferences.`;
  if (eachUsd !== null && s.knownUsd + eachUsd * more > p.budget.capUsd + 1e-9) return `That would take known spending to $${(s.knownUsd + eachUsd * more).toFixed(2)}, over your $${p.budget.capUsd} limit. Raise the limit in Brief, Project preferences.`;
  if (s.knownUsd > p.budget.capUsd + 1e-9) return `Known spending is already over your $${p.budget.capUsd} limit.`;
  return undefined;
}

export function spendLine(p: Pick<MotionProject, "budget">): string {
  const s = spendSummary(p);
  if (!s.calls) return "Nothing spent yet.";
  const money = s.knownUsd > 0 ? `$${s.knownUsd.toFixed(2)} in known prices` : "no known prices";
  return `${s.calls} paid call${s.calls === 1 ? "" : "s"} so far, ${money}${s.unknownCalls ? `, ${s.unknownCalls} with no published price` : ""}.`;
}
