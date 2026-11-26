import { afterEach, describe, expect, it } from "vitest";
import { updateSettings } from "../lib/settings";
import { approve, createProject, effectiveMode, gateState, reviseApproved, stageComplete, DEFAULT_MODES } from "../lib/project";
import { detectConflicts } from "../lib/styles";
import { firedRules } from "../lib/rules";
import { parseSeconds, timecode } from "../lib/time";
import type { MotionProject } from "../types";

function ready(): MotionProject {
  const p = createProject("T");
  p.intent = {
    purpose: "inform", tone: ["elegant"], summary: "Calm and clear.", firedRules: [], source: "user",
    arc: [{ beatId: "b1", startSec: 0, endSec: 5, primary: "calm", intensity: 2, energy: 2 }],
  };
  return p;
}

afterEach(() => updateSettings({ llmReady: false }));

describe("project model", () => {
  it("starts every stage in Assisted, so nothing changes by itself when a language model is added", () => {
    const p = createProject("T");
    expect(p.controlModes).toEqual(DEFAULT_MODES);
    expect(p.controlModes.build).toBe("assisted");
    expect(p.schemaVersion).toBe("1.0");
  });
  it("forces Manual while no provider is configured, keeping the stored choice", () => {
    const p = createProject("T");
    expect(effectiveMode(p, "intent")).toBe("manual");
    expect(p.controlModes.intent).toBe("assisted");
  });
  it("honours the stored mode once a language model is ready, and falls back to Manual when it is not", () => {
    const p = createProject("T");
    updateSettings({ llmReady: true });
    expect(effectiveMode(p, "intent")).toBe("assisted");
    updateSettings({ llmReady: false });
    expect(effectiveMode(p, "intent")).toBe("manual");
  });
  it("walks gate A through its states", () => {
    let p = createProject("T");
    expect(gateState(p, "A")).toBe("not-reached");
    p = ready();
    expect(stageComplete(p, "A")).toBe(true);
    expect(gateState(p, "A")).toBe("ready");
    p = approve(p, "A");
    expect(gateState(p, "A")).toBe("approved");
  });
  it("unlocking records a revision, revokes later gates and keeps history", () => {
    let p = ready();
    p.style.dimensions = { typography: { familyId: "swiss", intensity: "strong" } };
    p = approve(approve(p, "A"), "B");
    const before = p.approvals.length;
    p = reviseApproved(p, "A", "Unlocked Intent", "intent_change");
    expect(p.revisions).toHaveLength(1);
    expect(gateState(p, "A")).toBe("needs-reapproval");
    expect(gateState(p, "B")).toBe("needs-reapproval");
    expect(p.approvals.length).toBe(before + 2); // appended, nothing deleted
    expect(p.approvals.find((a) => a.state === "revoked")?.note).toBe("after revision 1");
  });
  it("gate D needs gate C approved first", () => {
    let p = ready();
    expect(gateState(p, "D")).toBe("not-reached");
    p.treatment = { b1: { plan: "Fade in the title", motion: "" } };
    p = approve(p, "C");
    expect(gateState(p, "D")).toBe("ready");
  });
});

describe("rules, styles, time", () => {
  it("fires the calm and elegant rules", () => {
    expect(firedRules(ready()).map((r) => r.id)).toEqual(["calm", "elegant"]);
  });
  it("warns when a strict grid meets an organic family", () => {
    const p = createProject("T");
    p.style.dimensions = { typography: { familyId: "swiss", intensity: "strong" }, texture: { familyId: "cut-paper", intensity: "moderate" } };
    expect(detectConflicts(p).map((c) => c.reason)).toContain("A strict grid fights hand-made, irregular placement.");
  });
  it("parses and formats time", () => {
    expect(parseSeconds("1:30")).toBe(90);
    expect(parseSeconds("12.5")).toBe(12.5);
    expect(parseSeconds("abc")).toBeNull();
    expect(parseSeconds("-1")).toBeNull();
    expect(timecode(61.5, 30)).toBe("01:01:15");
  });
});
