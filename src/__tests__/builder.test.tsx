import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { markBuilt, reconcile, type EngineSnapshot } from "../lib/layers";
import type { MotionProject } from "../types";

const PLAN = { summary: "Title over a dark background.", layers: [
  { key: "background", kind: "solid", name: "Background", role: "background", animations: [] },
  { key: "title", kind: "text", name: "Title", role: "title", text: "Launch day", size: 140, animations: [{ primitive: "entrance.fade-in", params: {} }] }] };

function fake(project: MotionProject, opts: { cloud?: boolean } = {}) {
  const log = { calls: [] as { method: string; params: Record<string, unknown> }[], spend: [] as string[], saved: [] as MotionProject[] };
  const layers: EngineSnapshot["layers"] = [];
  const snap = (): EngineSnapshot => ({ path: "x", dirty: false, activeComp: 1, comps: [], layers: [...layers] });
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save(_p: string, p: MotionProject) { log.saved.push(JSON.parse(JSON.stringify(p))); },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: true, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async startupStep() { /* unused */ },
    async uncleanSession() { return null; },
    async sessionBegin() { /* unused */ },
    async sessionEnd() { /* unused */ },
    async confirmSpend(provider: string, model: string) { log.spend.push(`${provider}/${model}`); return "tok-1"; },
    async engine(method: string, params: Record<string, unknown>) {
      log.calls.push({ method, params });
      switch (method) {
        case "llm_status": return { ready: true, reason: "", config: opts.cloud ? { provider: "openai", model: "gpt-x" } : { provider: "ollama", model: "llama" },
          providers: [{ id: "openai", label: "OpenAI", local: false }, { id: "ollama", label: "Ollama", local: true }] } as never;
        case "builder_plan": return { plan: PLAN, warnings: ["Title: one motion was dropped."], cost: { usd: 0, known: true, note: "Built on this computer." }, provider: "ollama", model: "llama" } as never;
        case "builder_execute": {
          layers.push({ id: 2, name: "Background", kind: "Solid", index: 2, parent: null, nativeLocked: false, approvedHere: false, hash: "h2" },
                      { id: 3, name: "Title", kind: "Text", index: 1, parent: null, nativeLocked: false, approvedHere: false, hash: "h3" });
          return { created: [{ key: "background", layer: 2, kind: "solid", role: "background", name: "Background", primitives: [] },
                             { key: "title", layer: 3, kind: "text", role: "title", name: "Title", primitives: ["entrance.fade-in"] }], warnings: [], cost: { usd: 0 }, ...snap() } as never;
        }
        default: return snap() as never;
      }
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

async function toBuild(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByText(name));
  await screen.findByRole("heading", { name: "Brief" });
  await user.type(screen.getByPlaceholderText(/Describe the piece/), "A launch title.");
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Build") as HTMLElement);
}

describe("Builder agent panel (P2-08)", () => {
  it("plans, shows layers, motion and a $0 cost, builds only on confirm, then binds the layers to the Builder", async () => {
    const user = userEvent.setup();
    const log = fake(createProject("Builder demo"));
    render(<App />);
    await toBuild(user, "Builder demo");
    await user.click(await screen.findByRole("button", { name: "Plan with Builder" }));
    const plan = await screen.findByLabelText("Builder plan");
    expect(plan).toHaveTextContent("Launch day");
    expect(plan).toHaveTextContent("entrance.fade-in");
    expect(plan).toHaveTextContent("$0.00");
    expect(plan).toHaveTextContent("No picture or video is generated");
    expect(plan).toHaveTextContent("one motion was dropped");
    expect(log.calls.some((c) => c.method === "builder_execute")).toBe(false);          // nothing is built yet
    const ctx = (log.calls.find((c) => c.method === "builder_plan")!.params as { context: { brief: string } }).context;
    expect(ctx.brief).toBe("A launch title.");
    expect(log.spend).toEqual([]);                                                      // a local model needs no spend token
    await user.click(within(plan).getByRole("button", { name: "Build 2 layers" }));
    await screen.findByText(/Built 2 layers/);
    const exec = log.calls.find((c) => c.method === "builder_execute")!;
    expect((exec.params as { plan: typeof PLAN }).plan.layers).toHaveLength(2);
    await waitFor(() => {
      const p = log.saved[log.saved.length - 1];
      expect(p?.layerMap?.find((b) => b.engineLayerId === 3)).toMatchObject({ role: "title", primitiveId: "entrance.fade-in", provenance: { actor: "agent:builder" }, lock: "none" });
      expect(p?.revisions.some((r) => r.actor === "agent:builder" && r.kind === "agent_edit" && r.layers.includes(3))).toBe(true);
    }, { timeout: 4000 });
  });

  it("a cloud model needs a confirmation click and a single-use token before the plan is requested", async () => {
    const user = userEvent.setup();
    const log = fake(createProject("Cloud demo"), { cloud: true });
    render(<App />);
    await toBuild(user, "Cloud demo");
    await user.click(await screen.findByRole("button", { name: "Plan with Builder" }));
    const sheet = await screen.findByRole("dialog", { name: "Confirm spending" });
    expect(sheet).toHaveTextContent("OpenAI (cloud)");
    expect(log.calls.some((c) => c.method === "builder_plan")).toBe(false);
    expect(log.spend).toEqual([]);
    await user.click(within(sheet).getByRole("button", { name: "Confirm and plan" }));
    await screen.findByLabelText("Builder plan");
    expect(log.spend).toEqual(["openai/gpt-x"]);
    expect(log.calls.find((c) => c.method === "builder_plan")!.params.spend_token).toBe("tok-1");
  });

  it("markBuilt binds layers to the Builder without approving anything", () => {
    const p0 = createProject("T");
    const snap: EngineSnapshot = { path: "x", dirty: false, activeComp: 1, comps: [], layers: [
      { id: 7, name: "Title", kind: "Text", index: 1, parent: null, nativeLocked: false, approvedHere: false, hash: "h" }] };
    const p = markBuilt(reconcile(p0, snap, [7]), [{ layer: 7, role: "title", primitives: ["entrance.rise"], name: "Title" }]);
    expect(p.layerMap![0]).toMatchObject({ engineLayerId: 7, role: "title", lock: "none", provenance: { actor: "agent:builder" } });
    expect(p.approvals).toHaveLength(0);
    expect(markBuilt(p0, [])).toBe(p0);
  });
});
