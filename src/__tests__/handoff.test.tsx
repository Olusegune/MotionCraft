import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { EDITORS } from "../pages/HandOff";

function fake(replies: Record<string, unknown>[]) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const p = createProject("Hand demo");
  const api = {
    async list() { return [{ id: p.id, name: p.name, path: "mem:1", updatedAt: p.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(p)); },
    async save() { /* keep */ },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
    async fileUrl() { return "asset://x"; },
    async engine(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
      if (method === "render_jobs") return { jobs: [] } as never;
      if (method === "export_bridge") return (replies.shift() ?? {}) as never;
      return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
    },
  };
  setApiForTests(api as unknown as Api);
  return calls;
}

async function toDeliver(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Hand demo"));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Deliver") as HTMLElement);
  await screen.findByRole("heading", { name: "Work on it in another editor" });
}

describe("working in another editor", () => {
  it("offers After Effects, Resolve, Premiere, OTIO and EDL, and says plainly what each takes", () => {
    expect(EDITORS.map((e) => e.kind)).toEqual(["aep", "fcpxml", "xml", "otio", "edl"]);
    expect(EDITORS.find((e) => e.kind === "aep")!.note).toMatch(/Keylight/);
    expect(EDITORS.find((e) => e.kind === "fcpxml")!.note).toMatch(/keyed clip arrives keyed/);
  });

  it("sends a Resolve timeline and shows where the files are", async () => {
    const user = userEvent.setup();
    const calls = fake([{ ok: true, target: "DaVinci Resolve or Final Cut Pro", kind: "fcpxml", path: "exports/fcpxml-1/Main.fcpxml", files: ["Main.fcpxml", "a.mov"], warnings: [] }]);
    render(<App />);
    await toDeliver(user);
    await user.click(screen.getByRole("button", { name: /Prepare files/ }));
    expect(await screen.findByText(/Ready for DaVinci Resolve/)).toBeInTheDocument();
    expect(screen.getByText("exports/fcpxml-1/Main.fcpxml")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "export_bridge")!.params).toMatchObject({ kind: "fcpxml", allow_losses: false });
  });

  it("After Effects lists what it cannot carry, writes nothing until the person agrees, then sends", async () => {
    const user = userEvent.setup();
    const calls = fake([
      { ok: false, needs_ok: true, target: "After Effects", kind: "aep", losses: [{ category: "effects", count: 1, details: ["Main: 's.mp4' has the effect 'Screen Color Key'"] }] },
      { ok: true, target: "After Effects", kind: "aep", path: "exports/aep-1/Main.aep", files: ["Main.aep"], losses: [{ category: "effects", count: 1, details: [] }] },
    ]);
    render(<App />);
    await toDeliver(user);
    await user.selectOptions(screen.getByLabelText("Editor"), "aep");
    await user.click(screen.getByRole("button", { name: /Prepare files/ }));
    expect(await screen.findByText(/cannot carry everything. Nothing was written yet/)).toBeInTheDocument();
    expect(screen.getByText(/Screen Color Key/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "export_bridge")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Send it anyway" }));
    expect(await screen.findByText(/Ready for After Effects/)).toBeInTheDocument();
    expect(screen.getByText(/Not carried: 1 effects/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "export_bridge")[1].params).toMatchObject({ kind: "aep", allow_losses: true });
  });
});
