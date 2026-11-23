import { describe, expect, it } from "vitest";
import type { ModelEntry } from "../lib/api";
import { isCurated, rankModels, rankProviders } from "../lib/models";

const m = (provider: ModelEntry["provider"], name: string, source = "curated"): ModelEntry => ({
  provider, model: `${provider}/${name}`, name, media: "image", official: provider !== "kie" && provider !== "fal", listed: true, source,
  price: { known: false, unit: null, value: null, note: "" },
});

describe("which model is offered first", () => {
  it("curated models come before discovered ones, so a refreshed catalogue never puts a tool like an age editor on top", () => {
    const list = [m("fal", "Age Modify", "discovered"), m("fal", "AuraSR", "discovered"), m("byteplus", "Seedream 4.0"), m("kie", "Midjourney v7")];
    const ranked = rankModels(list);
    expect(ranked.map((x) => x.name)).toEqual(["Midjourney v7", "Seedream 4.0", "Age Modify", "AuraSR"]);
    expect(isCurated(ranked[0])).toBe(true);
    expect(isCurated(ranked[ranked.length - 1])).toBe(false);
    expect(list[0].name).toBe("Age Modify");                       // the input is not reordered
  });

  it("providers with a key come first; without keys the app's own order is kept", () => {
    const list = [m("byteplus", "Seedream 4.0"), m("google", "Imagen"), m("kie", "Midjourney v7"), m("fal", "Flux", "discovered")];
    expect(rankProviders(list, {})).toEqual(["byteplus", "google", "kie", "fal"]);
    expect(rankProviders(list, { kie: true, fal: true })).toEqual(["kie", "fal", "byteplus", "google"]);
    expect(rankProviders([], { kie: true })).toEqual([]);
  });
});
