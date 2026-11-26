import { describe, expect, it } from "vitest";
import { approve, createProject } from "../lib/project";
import { nextStep } from "../lib/nextStep";

describe("the next step on the golden path", () => {
  it("walks from an empty project to done, one step at a time", () => {
    let p = createProject("x");
    expect(nextStep(p)).toMatchObject({ stage: "brief", text: expect.stringMatching(/brief/) });
    p.brief.text = "A short piece.";
    expect(nextStep(p)).toMatchObject({ stage: "brief", text: expect.stringMatching(/Make it/) });
    p.intent.arc = [{ beatId: "a", startSec: 0, endSec: 5, primary: "one", intensity: 2, energy: 2 }];
    expect(nextStep(p)).toMatchObject({ stage: "intent", text: expect.stringMatching(/approve the intent/) });   // Make it has run: do not say Make it again
    p.intent.purpose = "inform"; p.intent.summary = "One idea."; p.intent.arc = [{ beatId: "a", startSec: 0, endSec: 5, primary: "one", intensity: 2, energy: 2 }];
    p = approve(p, "A");
    expect(nextStep(p)?.stage).toBe("direction");
    p.style.dimensions = { typography: { familyId: "swiss", intensity: "moderate" } };
    p = approve(p, "B");
    expect(nextStep(p)?.stage).toBe("treatment");
    p.treatment = { a: { plan: "x", motion: "" } };
    p = approve(p, "C");
    expect(nextStep(p)?.stage).toBe("build");
    p.layerMap = [{ engineLayerId: 1, role: "other", name: "L", lock: "none", provenance: { actor: "agent:builder", at: "t", costReported: false } } as never];
    expect(nextStep(p)?.stage).toBe("review");
    p = approve(p, "D");
    expect(nextStep(p)?.stage).toBe("deliver");
    p.renders = [{ id: "r", preset: "h264", rel: "renders/a.mp4", at: "t", bytes: 1 } as never];
    expect(nextStep(p)).toBeNull();
  });
});
