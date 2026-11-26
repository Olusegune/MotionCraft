import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import type { MotionProject } from "../types";

function fake(project: MotionProject) {
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save() { /* unused */ },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
    async fileUrl() { return "asset://x"; },
    async assetDataUrl() { return "data:image/png;base64,AAAA"; },
    async engine(method: string) {
      if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
      if (method === "models") return { models: [], status: {} } as never;
      return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
    },
  };
  setApiForTests(api as unknown as Api);
}

describe("each scene card on Treatment", () => {
  it("offers Make picture when the scene has none and Try another when it has one", async () => {
    const p = createProject("Scenes");
    p.intent.arc = [{ beatId: "a", startSec: 0, endSec: 2, primary: "curiosity", intensity: 2, energy: 2 }, { beatId: "b", startSec: 2, endSec: 5, primary: "awe", intensity: 3, energy: 3 }];
    p.assets = [{ id: "i1", kind: "image", path: "assets/images/i1.png", provenance: { actor: "user", provider: "none", model: "none", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null } }];
    p.treatment = { a: { plan: "one", motion: "", frameAssetId: "i1" }, b: { plan: "two", motion: "" } };
    fake(p);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("Scenes"));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Treatment") as HTMLElement);
    await screen.findByRole("heading", { name: "Treatment" });
    expect(screen.getAllByRole("button", { name: "Make picture" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Try another" })).toHaveLength(1);
  });
});
