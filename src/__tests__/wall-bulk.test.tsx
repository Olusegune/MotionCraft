import { describe, expect, it } from "vitest";
import { needsRights, setRights } from "../lib/rights";

const prov = { actor: "user", provider: "import", model: "file", at: "2026-11-25T00:00:00Z", licence: "Imported", costReported: false, costValue: null, costUnit: null };

describe("rights helpers used by the bulk bar", () => {
  it("setting rights on every unconfirmed import clears needsRights", () => {
    const list = [1, 2, 3].map((i) => ({ id: `a${i}`, kind: "image", path: `x${i}.png`, provenance: prov })) as never[];
    expect(list.every((a) => needsRights(a))).toBe(true);
    expect(list.map((a) => setRights(a, "mine")).some((a) => needsRights(a))).toBe(false);
  });
});
