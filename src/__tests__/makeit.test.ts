import { describe, expect, it } from "vitest";
import { createProject } from "../lib/project";
import { fillTreatment, suggestLook } from "../lib/makeIt";
import { FAMILIES } from "../lib/styles";
import type { Beat } from "../types";

const beat = (id: string, a: number, b: number, primary: string, energy: Beat["energy"] = 3): Beat => ({ beatId: id, startSec: a, endSec: b, primary, intensity: 3, energy });

describe("Make it: a look and a plan proposed from the intent", () => {
  it("picks a real look from the tone, else from the energy of the piece", () => {
    const p = createProject("x");
    p.intent.tone = ["elegant"];
    expect(suggestLook(p)).toBe("editorial-minimal");
    p.intent.tone = [];
    p.intent.arc = [beat("a", 0, 5, "x", 5), beat("b", 5, 10, "y", 4)];
    expect(suggestLook(p)).toBe("bold-kinetic");
    p.intent.arc = [beat("a", 0, 5, "x", 1)];
    expect(suggestLook(p)).toBe("cinematic-title");
    for (const t of ["playful", "elegant", "authoritative", "trustworthy", "instructional", "provocative", "restrained"] as const) {
      p.intent.tone = [t];
      expect(FAMILIES.some((f) => f.id === suggestLook(p))).toBe(true);
    }
  });

  it("writes a plan for each scene that has none, and never overwrites one a person wrote", () => {
    const p = createProject("x");
    p.intent.arc = [beat("a", 0, 2.5, "curiosity", 2), beat("b", 2.5, 10, "awe", 5)];
    p.treatment = { b: { plan: "My own plan", motion: "" } };
    const q = fillTreatment(p);
    expect(q.treatment.a.plan).toMatch(/^curiosity \(2\.5 seconds\)/);
    expect(q.treatment.a.motion).toMatch(/slow, calm pace/);
    expect(q.treatment.b.plan).toBe("My own plan");
    expect(fillTreatment(q)).toEqual(q);                                   // running it again changes nothing
  });
});
