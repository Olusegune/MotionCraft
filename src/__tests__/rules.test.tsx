import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { createProject } from "../lib/project";
import { DEFAULT_RULES, explain, firedRules, validateRule } from "../lib/rules";
import type { MotionProject, RuleSpec } from "../types";

function withIntent(over: Partial<MotionProject["intent"]>, rules?: RuleSpec[]): MotionProject {
  const p = createProject("T");
  p.intent = { ...p.intent, ...over };
  if (rules) p.rules = rules;
  return p;
}
const beat = (energy: 1 | 2 | 3 | 4 | 5) => ({ beatId: "b", startSec: 0, endSec: 5, primary: "x", intensity: 3 as const, energy });

describe("rule table (P1-09)", () => {
  it("fires the PRD defaults as before and explains why", () => {
    const p = withIntent({ tone: ["playful"], arc: [beat(5)] });
    expect(firedRules(p).map((r) => r.id)).toEqual(["urgent", "playful"]);
    const calm = explain(DEFAULT_RULES[0], p);
    expect(calm.ok).toBe(false);
    expect(calm.lines[0]).toMatch(/^No: every beat has energy 2 or less \(highest is 5\)/);
    expect(explain(DEFAULT_RULES[3], p).lines).toEqual(["Yes: tone includes playful"]);
  });
  it("energy rules need beats, and a project's own table replaces the defaults", () => {
    expect(firedRules(withIntent({ arc: [] }))).toEqual([]);
    const own: RuleSpec = { id: "sell", label: "Selling", enabled: true, when: { purposes: ["sell"], energyAtLeast: 3 }, timing: "Fast", easing: "", typography: "", layout: "", transitions: "" };
    expect(firedRules(withIntent({ purpose: "sell", arc: [beat(3)], tone: ["elegant"] }, [own])).map((r) => r.id)).toEqual(["sell"]);
    expect(firedRules(withIntent({ purpose: "inform", arc: [beat(3)] }, [own]))).toEqual([]);
    expect(firedRules(withIntent({ purpose: "sell", arc: [beat(3)] }, [{ ...own, enabled: false }]))).toEqual([]);
  });
  it("refuses rules that would be wrong, with the reason", () => {
    const ok: RuleSpec = { ...DEFAULT_RULES[0], id: "n", label: "New", when: { tones: ["playful"] } };
    expect(validateRule(ok, DEFAULT_RULES)).toBeNull();
    expect(validateRule({ ...ok, label: " " }, [])).toMatch(/name/);
    expect(validateRule({ ...ok, label: "calm, energy 1-2" }, DEFAULT_RULES)).toMatch(/already/);
    expect(validateRule({ ...ok, when: {} }, [])).toMatch(/condition/);
    expect(validateRule({ ...ok, when: { energyAtLeast: 6 } }, [])).toMatch(/1 to 5/);
    expect(validateRule({ ...ok, when: { energyAtLeast: 4, energyAtMost: 2 } }, [])).toMatch(/cannot be above/);
    expect(validateRule({ ...ok, timing: "", easing: "", typography: "", layout: "", transitions: "" }, [])).toMatch(/Say what/);
    expect(validateRule({ ...ok, timing: "x".repeat(161) }, [])).toMatch(/too long/);
  });
});

describe("rule editor on the Intent page", () => {
  it("adds a rule, shows it fire with its reason, and resets to the defaults", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
    await user.type(screen.getByLabelText("Name"), "Rules");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Intent") as HTMLElement);
    await user.click(await screen.findByRole("button", { name: "Add rule" }));
    const dlg = await screen.findByRole("dialog", { name: "Add rule" });
    expect(within(dlg).getByRole("button", { name: "Save rule" })).toBeDisabled();
    await user.type(within(dlg).getByLabelText("Name"), "Provocative edge");
    await user.click(within(dlg).getByRole("button", { name: "Provocative" }));
    await user.type(within(dlg).getByLabelText("Timing"), "Abrupt");
    await user.click(within(dlg).getByRole("button", { name: "Save rule" }));
    expect(await screen.findByText("Provocative edge")).toBeInTheDocument();
    expect(screen.getByText(/This project uses your edited table/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit rule Provocative edge" }));
    const edit = await screen.findByRole("dialog", { name: "Edit rule" });
    await user.click(within(edit).getByRole("button", { name: "Delete rule" }));
    await waitFor(() => expect(screen.queryByText("Provocative edge")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(await screen.findByText(/Default rules from the PRD \(4\)/)).toBeInTheDocument();
  });
});
