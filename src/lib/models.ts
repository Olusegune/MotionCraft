import type { ModelEntry, ProviderId } from "./api";

/** The models the app lists itself (curated); the rest come from a provider's catalogue after "Refresh lists" and include editors, upscalers and other tools. */
export const isCurated = (m: ModelEntry): boolean => m.source !== "discovered";

/** Curated models first, then the discovered ones A to Z. The first one becomes the default, so a catalogue of a thousand entries can never put an age editor on top. */
export function rankModels(list: ModelEntry[]): ModelEntry[] {
  return [...list].sort((a, b) => Number(isCurated(b)) - Number(isCurated(a)) || a.name.localeCompare(b.name));
}

const QUICK = /\b(fast|lite|flash|turbo|schnell|mini)\b/i;
/** For one picture at a time: a quick, light model first (they are the cheap ones and give one image, not a grid), then the usual order. */
export function rankForStills(list: ModelEntry[]): ModelEntry[] {
  return [...list].sort((a, b) => Number(QUICK.test(b.model) || QUICK.test(b.name)) - Number(QUICK.test(a.model) || QUICK.test(a.name))
    || Number(isCurated(b)) - Number(isCurated(a)) || a.name.localeCompare(b.name));
}

/** Providers in the order to offer them: the ones with a key first, then the preferred one, then the ones that have curated models; otherwise the order the app lists them in. */
/** The provider offered first when several have a key: the owner's stated choice for paid pictures (an aggregator with many models at low prices). */
export const PREFERRED_PROVIDER: ProviderId = "kie";

export function rankProviders(list: ModelEntry[], keys: Record<string, boolean>): ProviderId[] {
  const seen: ProviderId[] = [];
  for (const m of list) if (!seen.includes(m.provider)) seen.push(m.provider);
  const curated = (p: ProviderId) => list.some((m) => m.provider === p && isCurated(m));
  return [...seen].sort((a, b) => Number(!!keys[b]) - Number(!!keys[a]) || Number(b === PREFERRED_PROVIDER && !!keys[b]) - Number(a === PREFERRED_PROVIDER && !!keys[a]) || Number(curated(b)) - Number(curated(a)) || seen.indexOf(a) - seen.indexOf(b));
}
