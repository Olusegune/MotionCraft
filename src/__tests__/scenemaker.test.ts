import { describe, expect, it } from "vitest";
import { createProject } from "../lib/project";
import { scenePrompt, } from "../pages/SceneMaker";
import { NO_LETTERING } from "../pages/Proposals";

describe("the prompt for one scene's picture", () => {
  it("starts with the no-lettering rule and carries the scene, its plan, the look and the mood", () => {
    const p = createProject("x");
    p.intent.summary = "A quiet civilization shaping many universes";
    p.brief.text = "Make it sleek. Use obsidian black, platinum white and a restrained cyan accent. End on a hold.";
    p.style.dimensions.composition = { familyId: "cinematic-title", intensity: "moderate" };
    const b = { beatId: "b1", startSec: 0, endSec: 2, primary: "curiosity", intensity: 2 as const, energy: 2 as const };
    p.treatment = { b1: { plan: "curiosity (2 seconds): one point of light in the dark.", motion: "" } };
    const t = scenePrompt(p, b);
    expect(t.startsWith(NO_LETTERING)).toBe(true);
    expect(t).toContain("cinematic title look");
    expect(t).toContain("Scene: curiosity");
    expect(t).toContain("one point of light in the dark");
    expect(t).not.toContain("(2 seconds)");
    expect(t).toContain("A quiet civilization");
    expect(t).toContain("Palette: Use obsidian black, platinum white and a restrained cyan accent.");
    expect(t.length).toBeLessThanOrEqual(900);
  });
});
