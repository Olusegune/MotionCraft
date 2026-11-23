import type { ModelEntry, ProviderId } from "./api";

/** The models the app lists itself (curated); the rest come from a provider's catalogue after "Refresh lists" and include editors, upscalers and other tools. */
export const isCurated = (m: ModelEntry): boolean => m.source !== "discovered";

/** Curated models first, then the discovered ones A to Z. The first one becomes the default, so a catalogue of a thousand entries can never put an age editor on top. */
export function rankModels(list: ModelEntry[]): ModelEntry[] {
  return [...list].sort((a, b) => Number(isCurated(b)) - Number(isCurated(a)) || a.name.localeCompare(b.name));
}

/** Providers in the order to offer them: the ones with a key first, and among those the ones that have curated models; otherwise the order the app lists them in. */
export function rankProviders(list: ModelEntry[], keys: Record<string, boolean>): ProviderId[] {
  const seen: ProviderId[] = [];
  for (const m of list) if (!seen.includes(m.provider)) seen.push(m.provider);
  const curated = (p: ProviderId) => list.some((m) => m.provider === p && isCurated(m));
  return [...seen].sort((a, b) => Number(!!keys[b]) - Number(!!keys[a]) || Number(curated(b)) - Number(curated(a)) || seen.indexOf(a) - seen.indexOf(b));
}
