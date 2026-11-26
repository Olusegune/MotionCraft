import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { BACKDROP_COLOURS } from "../pages/build/Backdrop";

function fake() {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const p = createProject("Back demo");
  const provenance = { actor: "user", provider: "import", model: "file", at: "2026-11-25T00:00:00Z", licence: "Imported", costReported: false, costValue: null, costUnit: null };
  p.assets = [{ id: "a1", kind: "image", path: "assets/images/sky.png", name: "Sky", provenance }, { id: "a2", kind: "video", path: "assets/video/g.mp4", name: "Green clip", screen: "green", provenance }] as never;
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
      if (method === "primitives") return { primitives: [] } as never;
      return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
    },
  };
  setApiForTests(api as unknown as Api);
  return calls;
}

describe("background behind green screen clips", () => {
  it("offers plain colours as numbers, never colour codes", () => {
    expect(BACKDROP_COLOURS.length).toBeGreaterThanOrEqual(5);
    for (const c of BACKDROP_COLOURS) expect(c.rgb.every((x) => x >= 0 && x <= 1)).toBe(true);
  });

  it("sets a colour, then a picture (never a screen clip), then takes it away", async () => {
    const user = userEvent.setup();
    const calls = fake();
    render(<App />);
    await user.click(await screen.findByText("Back demo"));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Build") as HTMLElement);
    await user.click(await screen.findByText("Background behind green screen clips"));
    await user.selectOptions(screen.getByLabelText("Backdrop colour"), "white");
    await user.click(screen.getByRole("button", { name: /Set the background/ }));
    expect(await screen.findByText(/Keyed clips now show it/)).toBeInTheDocument();
    expect(calls.find((c) => c.method === "set_backdrop")!.params).toEqual({ kind: "colour", color: [1, 1, 1] });

    await user.selectOptions(screen.getByLabelText("Backdrop kind"), "picture");
    const media = screen.getByLabelText("Backdrop media") as HTMLSelectElement;
    expect(Array.from(media.options).map((o) => o.value)).toEqual(["a1"]);          // the green screen clip is not offered
    await user.click(screen.getByRole("button", { name: /Set the background/ }));
    expect(calls.filter((c) => c.method === "set_backdrop")[1].params).toEqual({ kind: "picture", rel: "assets/images/sky.png" });

    await user.selectOptions(screen.getByLabelText("Backdrop kind"), "none");
    await user.click(screen.getByRole("button", { name: /Take the background away/ }));
    expect(calls.filter((c) => c.method === "set_backdrop")[2].params).toEqual({ kind: "none" });
  });
});
