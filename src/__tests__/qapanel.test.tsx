import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import type { QaReport } from "../pages/review/QaPanel";
import type { MotionProject } from "../types";

const REPORT: QaReport = {
  counts: { error: 1, warn: 1, info: 0 }, checked: 3, total: 4,
  results: [
    { check: "missing-assets", label: "Missing assets", state: "findings", reason: "", count: 1, findings: [
      { id: "f1", check: "missing-assets", tier: 1, severity: "error", evidence: { detail: "assets/images/gone.png is not in the project folder." }, cause: "The file was moved, renamed or deleted after it was imported.", fix: { label: "Relink to assets/brand/gone.png", safe: true } }] },
    { check: "frame-rate", label: "Frame rate", state: "passed", reason: "", count: 0, findings: [] },
    { check: "safe-title", label: "Safe-title violations", state: "findings", reason: "", count: 1, findings: [
      { id: "f2", check: "safe-title", tier: 1, severity: "warn", at: { layerId: 4, timeSec: 1.5 }, evidence: { detail: "“Hello” reaches about 12 px outside the 90% safe area (estimated from its size and position).", measured: 12, threshold: 0, estimated: true }, cause: "Some screens crop the edges. Move the text inwards." }] },
    { check: "colour-space", label: "Colour space", state: "not-checked", reason: "EffectCraft does not report colour management at this version, so there is nothing to compare.", count: 0, findings: [] },
  ],
};

function fake(project: MotionProject, connected = true) {
  const log = { calls: [] as { method: string; params: Record<string, unknown> }[] };
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save() { /* keep */ },
    async engineStatus() { return connected ? { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" } : { state: "missing", pinned: "0.24.1", detail: "none" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async startupStep() { /* unused */ },
    async uncleanSession() { return null; },
    async sessionBegin() { /* unused */ },
    async sessionEnd() { /* unused */ },
    async engine(method: string, params: Record<string, unknown>) {
      log.calls.push({ method, params });
      if (method === "qa_run") return REPORT as never;
      if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
      return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

async function toReview(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByText(name));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Review") as HTMLElement);
  await screen.findByRole("heading", { name: "Review" });
}

describe("QA panel (P4-02)", () => {
  it("runs the checks and shows passed, findings with evidence and cause, and Not checked with the reason", async () => {
    const user = userEvent.setup();
    const p = createProject("QA demo");
    p.assets = [{ id: "a1", kind: "image", path: "assets/images/gone.png", provenance: { actor: "user", provider: "import", model: "", at: "t", licence: "", costReported: false, costValue: null, costUnit: null } }];
    const log = fake(p);
    render(<App />);
    await toReview(user, "QA demo");
    expect(screen.getByText(/Not run yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Run checks" }));
    await screen.findByText(/3 of 4 checks ran/);
    expect(log.calls.map((c) => c.method).filter((m) => m === "open" || m === "qa_run")).toEqual(["open", "qa_run"]);   // the composition is opened first
    const facts = (log.calls.find((c) => c.method === "qa_run")!.params as { facts: { deliverable: { fps: number }; assets: { path: string }[] } }).facts;
    expect(facts.deliverable.fps).toBe(30);
    expect(facts.assets).toEqual([{ id: "a1", kind: "image", path: "assets/images/gone.png" }]);
    const list = screen.getByText("Frame rate").closest("ul")!;
    expect(within(list).getByText("Frame rate").parentElement).toHaveTextContent("Passed");
    expect(screen.getByText("Missing assets").parentElement).toHaveTextContent("1 found");
    expect(screen.getByText(/gone.png is not in the project folder/)).toBeInTheDocument();
    expect(screen.getByText(/Likely cause: The file was moved/)).toHaveTextContent("Fix: Relink to assets/brand/gone.png");
    const safe = screen.getByText(/reaches about 12 px/).closest("li")!;
    expect(safe).toHaveTextContent("layer 4");
    expect(safe).toHaveTextContent("Measured 12, threshold 0 (estimated)");
    expect(screen.getByText("Colour space").parentElement).toHaveTextContent("Not checked: EffectCraft does not report colour management");
    expect(screen.getByText(/1 could not \(see below\)|1 could not/)).toBeInTheDocument();
  });

  it("is switched off with a reason when the engine is not connected, and runs nothing", async () => {
    const user = userEvent.setup();
    const log = fake(createProject("Offline QA"), false);
    render(<App />);
    await toReview(user, "Offline QA");
    expect(screen.getByRole("button", { name: "Run checks" })).toBeDisabled();
    expect(screen.getByText(/Needs a connected engine/)).toBeInTheDocument();
    expect(log.calls.some((c) => c.method === "qa_run")).toBe(false);
  });
});
