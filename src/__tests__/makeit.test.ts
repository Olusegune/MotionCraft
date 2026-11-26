import { describe, expect, it } from "vitest";
import { createProject } from "../lib/project";
import { fillFrames, fillTreatment, scenePictureItems, suggestLook } from "../lib/makeIt";
import { FAMILIES } from "../lib/styles";
import type { Beat } from "../types";

const beat = (id: string, a: number, b: number, primary: string, energy: Beat["energy"] = 3): Beat => ({ beatId: id, startSec: a, endSec: b, primary, intensity: 3, energy });

describe("Make it: a look and a plan proposed from the intent", () => {
  it("picks a real look from the tone, else from the energy of the piece", () => {
    const p = createProject("x");
    p.intent.tone = ["elegant"];
    expect(suggestLook(p)).toBe("editorial-minimal");
    p.intent.summary = "A restrained film about a civilization across many universes";
    p.intent.tone = ["authoritative"];
    expect(suggestLook(p)).toBe("cinematic-title");                       // what it is about beats the tone word
    p.intent.summary = "";
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
    expect(q.treatment.a.plan).toMatch(/^A 2\.5 seconds moment that feels curiosity/);
    expect(q.treatment.a.motion).toMatch(/slow, calm pace/);
    expect(q.treatment.b.plan).toBe("My own plan");
    expect(fillTreatment(q)).toEqual(q);                                   // running it again changes nothing
  });

  it("gives each scene without a picture an unused one, in order, and keeps the ones a person chose", () => {
    const p = createProject("x");
    const img = (id: string) => ({ id, kind: "image" as const, path: `assets/images/${id}.png`, provenance: { actor: "user", provider: "none", model: "none", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null } });
    p.assets = [img("i1"), img("i2"), img("i3")];
    p.intent.arc = [beat("a", 0, 2, "one"), beat("b", 2, 5, "two"), beat("c", 5, 10, "three")];
    p.treatment = { b: { plan: "", motion: "", frameAssetId: "i1" } };
    const q = fillFrames(p);
    expect(q.treatment.a.frameAssetId).toBe("i2");
    expect(q.treatment.b.frameAssetId).toBe("i1");
    expect(q.treatment.c.frameAssetId).toBe("i3");
    expect(fillFrames(q)).toBe(q);                                        // nothing left to give: unchanged
  });

  it("lists a picture and its time range for each scene that has one, at most sixteen", () => {
    const p = createProject("x");
    const img = (id: string) => ({ id, kind: "image" as const, path: `assets/images/${id}.png`, provenance: { actor: "user", provider: "none", model: "none", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null } });
    p.assets = [img("i1")];
    p.intent.arc = [beat("a", 0, 2, "one"), beat("b", 2, 5, "two")];
    p.treatment = { b: { plan: "", motion: "", frameAssetId: "i1" } };
    expect(scenePictureItems(p)).toEqual([{ rel: "assets/images/i1.png", t_in: 2, t_out: 5, name: "two" }]);
    expect(scenePictureItems(createProject("y"))).toEqual([]);
  });

  it("uses what the timed script says happens in a scene as its plan, and falls back to a general line", () => {
    const p = createProject("x");
    p.brief.text = ["| 0:00-0:02 | A tiny white point emerges from black. | BEYOND | pulse |", "| 0:02-0:05 | The point expands into a sphere. | | swell |"].join("\n");
    p.intent.arc = [beat("a", 0, 2, "curiosity"), beat("b", 2, 5, "awe"), beat("c", 5, 10, "peace")];
    const q = fillTreatment(p);
    expect(q.treatment.a.plan).toBe("A tiny white point emerges from black. On screen: BEYOND");
    expect(q.treatment.b.plan).toBe("The point expands into a sphere.");
    expect(q.treatment.c.plan).toMatch(/A 5 seconds moment that feels peace/);
  });
});
