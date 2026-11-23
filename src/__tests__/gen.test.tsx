import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api, type GenJob, type ModelEntry, type ProviderId } from "../lib/api";
import { updateSettings } from "../lib/settings";
import type { MotionProject } from "../types";

const model = (provider: ProviderId, id: string, name: string, media: "image" | "video", price: number | null): ModelEntry => ({
  provider, model: id, name, media, official: provider !== "kie" && provider !== "fal", listed: true, source: "builtin",
  price: { known: price !== null, unit: price !== null ? "usd_per_output" : null, value: price, note: "" },
});

function fake() {
  const store = new Map<string, MotionProject>();
  const keys: Record<string, boolean> = { byteplus: false, google: false, openai: false, kie: false, fal: false };
  const log: { method: string; params: Record<string, unknown> }[] = [];
  let spendCalls = 0;
  const job: GenJob = {
    id: "j1", state: "running", detail: "submitted", provider: "byteplus", model: "seedream-4-5-251128", kind: "image", elapsed: 1,
    estimate: { value: 0.04, unit: "usd_per_output", label: "Estimate" }, error: null, asset: null,
  };
  const api = {
    async list() { return []; },
    async create(p: MotionProject) { store.set(p.id, p); return { id: p.id, name: p.name, path: `mem:${p.id}`, updatedAt: p.updatedAt }; },
    async load(path: string) { return store.get(path.replace("mem:", ""))!; },
    async save(_p: string, p: MotionProject) { store.set(p.id, p); },
    async engineStatus() { return { state: "missing", pinned: "0.24.1", detail: "none" }; },
    async openEffectCraft() { /* not used */ },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { ...keys }; },
    async setKey(p: string) { keys[p] = true; },
    async deleteKey(p: string) { keys[p] = false; },
    async confirmSpend() { spendCalls++; return "token-1"; },
    async assetDataUrl() { return "data:image/png;base64,AA=="; },
    async engine(method: string, params: Record<string, unknown>) {
      log.push({ method, params });
      if (method === "models") {
        return { models: [model("byteplus", "seedream-4-5-251128", "Seedream 4.5", "image", 0.04), model("fal", "fal-ai/flux/dev", "FLUX dev", "image", null),
          model("google", "veo-3.1-generate-preview", "Veo 3.1", "video", null)], status: {} };
      }
      if (method === "generate_start") return job;
      if (method === "generate_poll") {
        return { ...job, state: "done", asset: { path: "assets/images/gen-j1.png", kind: "image", provenance: { actor: "user", prompt: "a kite", provider: "byteplus",
          model: "seedream-4-5-251128", at: "2026-11-22", licence: "Terms apply.", costReported: false, costValue: 0.04, costUnit: "usd" } } };
      }
      throw new Error("unexpected " + method);
    },
  } as unknown as Api;
  return { api, keys, log, spend: () => spendCalls };
}

async function toBrief(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
  await user.type(screen.getByLabelText("Name"), "Gen");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("heading", { name: "Brief" });
  await user.click(screen.getByRole("button", { name: /^Media/ }));
}

describe("image and video generation", () => {
  it("is off by default and says how to turn it on", async () => {
    const f = fake();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await toBrief(user);
    await user.type(await screen.findByLabelText("Prompt"), "a kite");
    expect(screen.getByRole("button", { name: "Generate…" })).toBeDisabled();
    expect(screen.getByText(/Generative models are off/)).toBeInTheDocument();
  });

  it("without a key the button stays disabled and names the provider", async () => {
    const f = fake();
    setApiForTests(f.api);
    updateSettings({ generative: true });
    const user = userEvent.setup();
    render(<App />);
    await toBrief(user);
    await user.type(await screen.findByLabelText("Prompt"), "a kite over a lake");
    expect(screen.getByRole("button", { name: "Generate…" })).toBeDisabled();
    expect(screen.getByText(/Add your BytePlus key in Settings/)).toBeInTheDocument();
  });

  it("cancelling the confirmation sheet never asks for a spend token or starts a job", async () => {
    const f = fake();
    f.keys.byteplus = true;
    setApiForTests(f.api);
    updateSettings({ generative: true });
    const user = userEvent.setup();
    render(<App />);
    await toBrief(user);
    await user.type(await screen.findByLabelText("Prompt"), "a kite");
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate…" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Generate…" }));
    const dlg = await screen.findByRole("dialog", { name: "Confirm spending" });
    expect(within(dlg).getByText(/Estimate \$0\.040/)).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(f.spend()).toBe(0);
    expect(f.log.some((c) => c.method === "generate_start")).toBe(false);
  });

  it("confirming asks for one token, starts the job with it, and records the asset with provenance", async () => {
    const f = fake();
    f.keys.byteplus = true;
    setApiForTests(f.api);
    updateSettings({ generative: true });
    const user = userEvent.setup();
    render(<App />);
    await toBrief(user);
    await user.type(await screen.findByLabelText("Prompt"), "a kite");
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate…" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Generate…" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and generate" }));
    await waitFor(() => expect(f.log.some((c) => c.method === "generate_start")).toBe(true));
    const start = f.log.find((c) => c.method === "generate_start")!;
    expect(f.spend()).toBe(1);
    expect(start.params).toMatchObject({ provider: "byteplus", model: "seedream-4-5-251128", spend_token: "token-1", generative_enabled: true, offline: false });
    expect(Object.keys(start.params)).not.toContain("api_key"); // keys never pass through the page
    expect(await screen.findByText(/assets\/images\/gen-j1\.png/, {}, { timeout: 6000 })).toBeInTheDocument();
    expect(screen.getByText("Terms apply.")).toBeInTheDocument();
  }, 15000);

  it("offline mode blocks generation", async () => {
    const f = fake();
    f.keys.byteplus = true;
    setApiForTests(f.api);
    updateSettings({ generative: true, offline: true });
    const user = userEvent.setup();
    render(<App />);
    await toBrief(user);
    await user.type(await screen.findByLabelText("Prompt"), "a kite");
    expect(screen.getByRole("button", { name: "Generate…" })).toBeDisabled();
    expect(screen.getByText(/Offline mode is on/)).toBeInTheDocument();
  });

  it("shows models without a published price as Unknown", async () => {
    const f = fake();
    f.keys.fal = true;
    setApiForTests(f.api);
    updateSettings({ generative: true });
    const user = userEvent.setup();
    render(<App />);
    await toBrief(user);
    await user.selectOptions(await screen.findByLabelText("Provider"), "fal");
    expect(await screen.findByText(/Aggregator · Price unknown/)).toBeInTheDocument();
  });
});

describe("direction proposals", () => {
  it("make three stills after one confirmation, then use one as the direction", async () => {
    const f = fake();
    f.keys.byteplus = true;
    setApiForTests(f.api);
    updateSettings({ generative: true });
    const user = userEvent.setup();
    render(<App />);
    await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
    await user.type(screen.getByLabelText("Name"), "Props");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Direction")!);
    const make = await screen.findByRole("button", { name: "Make 3 stills…" });
    await waitFor(() => expect(make).toBeEnabled());
    await user.click(make);
    const dlg = await screen.findByRole("dialog", { name: "Confirm spending" });
    expect(within(dlg).getByText(/Estimate \$0\.120 for 3/)).toBeInTheDocument();
    expect(f.spend()).toBe(0);
    await user.click(within(dlg).getByRole("button", { name: "Confirm and make 3 stills" }));
    await waitFor(() => expect(f.log.filter((c) => c.method === "generate_start")).toHaveLength(3));
    expect(f.spend()).toBe(3);
    const prompts = f.log.filter((c) => c.method === "generate_start").map((c) => String(c.params.prompt));
    expect(new Set(prompts).size).toBe(3);                         // three different starting points
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Use this direction" })[0]).toBeEnabled(), { timeout: 8000 });
    await user.click(screen.getAllByRole("button", { name: "Use this direction" })[0]);
    expect((screen.getByLabelText("Typography") as HTMLSelectElement).value).toBe("editorial-minimal");
  }, 20000);
});
