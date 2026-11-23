/** When to look for EffectCraft again after the window regains focus. */
export const RECHECK_MIN_MS = 30_000;

/**
 * Only when EffectCraft was not found (it may have been installed since), and not more than once every 30 seconds.
 * A version mismatch or an error does not change by itself, and re-checking it on every focus made a loop: each check ran
 * effectcraft-cli, which opened a console window, which took the focus, which triggered the next check.
 */
export function shouldRecheckOnFocus(state: string | undefined, lastCheckAt: number, now: number): boolean {
  return state === "missing" && now - lastCheckAt >= RECHECK_MIN_MS;
}
