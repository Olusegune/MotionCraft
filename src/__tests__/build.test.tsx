import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import type { EngineLayer, EngineSnapshot } from "../lib/layers";
import type { MotionProject, ProjectSummary } from "../types";

/** The Layers list in the inspector. The timeline shows the same layer names as bars, so a name alone now matches twice. */
const layerList = () => within(document.querySelector("ul.layers") as HTMLElement);


function fakeApi() {
  const store = new Map<string, MotionProject>();
  let layers: EngineLayer[] = [];
  let hashSeed = 1;
  const snap = (): EngineSnapshot => ({ path: "x", dirty: false, activeComp: 1, comps: [], layers });
  const calls: string[] = [];
  let guiOpen = false;
  const api: Api = {
    async list() { return [...store.values()].map((p) => ({ id: p.id, name: p.name, path: `mem:${p.id}`, updatedAt: p.updatedAt })); },
    async create(p: MotionProject) { store.set(p.id, p); return { id: p.id, name: p.name, path: `mem:${p.id}`, updatedAt: p.updatedAt } as ProjectSummary; },
    async load(path: string) { return store.get(path.replace("mem:", ""))!; },
    async save(_path: string, p: MotionProject) { store.set(p.id, p); },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async openEffectCraft() { guiOpen = true; },
    async effectcraftWindowOpen() { return guiOpen; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false }; },
    async setKey() { /* none */ },
    async deleteKey() { /* none */ },
    async confirmSpend() { return "t"; },
    async assetDataUrl() { return "data:image/png;base64,AA=="; },
    async fileUrl() { return "asset://localhost/preview.mp4"; },
    async engine(method: string, params: Record<string, unknown>) {
      calls.push(method);
      if (guiOpen && ["add_text", "set_text", "lock", "unlock"].includes(method)) throw new Error("EffectCraft has this project open.");
      if (method === "add_text") { layers = [...layers, { id: 2 + layers.length, name: String(params.text), kind: "Text", index: 1, parent: null, nativeLocked: false, approvedHere: false, hash: `h${hashSeed++}` }]; return { layer: layers[layers.length - 1].id, ...snap() } as never; }
      if (method === "lock") { layers = layers.map((l) => ((params.layers as number[]).includes(l.id) ? { ...l, approvedHere: true } : l)); return snap() as never; }
      if (method === "preview_movie_start") return { id: "m1", kind: "preview", state: "running", detail: "rendering", output: null, frames: null, bytes: null, error: null, elapsed: 0, preset: null } as never;
      if (method === "render_poll") return { id: "m1", kind: "preview", state: "done", detail: "done", output: "previews/preview-m1.mp4", frames: 150, bytes: 1000, error: null, elapsed: 1, preset: null } as never;
      if (method === "primitives") return { primitives: [{ id: "entrance.fade-in", name: "Fade in", category: "entrance", appliesTo: ["*"], description: "d", tags: [], params: { start: { label: "Start", kind: "float", default: 0, min: 0, max: 600, choices: [], unit: "s" }, duration: { label: "Duration", kind: "float", default: 0.8, min: 0.1, max: 30, choices: [], unit: "s" } } }] } as never;
      if (method === "apply_primitive") { calls.push("applied:" + JSON.stringify(params)); return snap() as never; }
      return snap() as never;
    },
  } as unknown as Api;
  return { api, calls, setLayerHash: (id: number, h: string) => { layers = layers.map((l) => (l.id === id ? { ...l, hash: h } : l)); } };
}

async function toBuild(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
  await user.type(screen.getByLabelText("Name"), "Demo");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Build")!);
  const head = await screen.findByRole("button", { name: /^Text$/ });          // the Text panel starts closed: the inspector is kept calm
  if (head.getAttribute("aria-expanded") === "false") await user.click(head);
}

describe("Build page with the engine connected", () => {
  it("adds a text layer, builds a preview and shows it", async () => {
    const f = fakeApi();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await toBuild(user);
    expect(screen.getByRole("button", { name: "Build preview" })).toBeDisabled();
    await user.type(await screen.findByLabelText("New text layer"), "Hello");
    await user.click(screen.getByRole("button", { name: "Add text layer" }));
    await waitFor(() => expect(layerList().getByText("Hello")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Build preview" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Build preview" }));
    expect(await screen.findByLabelText("Preview movie", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(f.calls).toContain("preview_movie_start");
    expect(screen.getByRole("button", { name: "Play" })).toBeEnabled();
  });

  it("approving a layer disables its text edit with a reason and unlocking needs confirmation", async () => {
    const f = fakeApi();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await toBuild(user);
    await user.type(await screen.findByLabelText("New text layer"), "Title");
    await user.click(screen.getByRole("button", { name: "Add text layer" }));
    await user.click(await waitFor(() => layerList().getByRole("button", { name: /Title/ })));
    await user.click(screen.getByRole("button", { name: "Approve layer" }));
    expect(await screen.findAllByText(/Approved/)).not.toHaveLength(0);
    expect(screen.getByLabelText("Change the words of the selected layer")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Unlock…/ }));
    expect(await screen.findByRole("dialog", { name: "Unlock approved layer" })).toBeInTheDocument();
    const before = f.calls.filter((c) => c === "unlock").length;
    expect(before).toBe(0);
  });

  it("refuses writes and says why while EffectCraft is open", async () => {
    const f = fakeApi();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await toBuild(user);
    await user.type(await screen.findByLabelText("New text layer"), "Alpha");
    await user.click(screen.getByRole("button", { name: "Add text layer" }));
    await waitFor(() => expect(layerList().getByText("Alpha")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Open in EffectCraft" }));
    expect(await screen.findByText(/MotionCraft is read-only until you close it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add text layer" })).toBeDisabled();
  });

  it("logs a change made in EffectCraft after Refresh as a user revision", async () => {
    const f = fakeApi();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await toBuild(user);
    await user.type(await screen.findByLabelText("New text layer"), "Alpha");
    await user.click(screen.getByRole("button", { name: "Add text layer" }));
    await waitFor(() => expect(layerList().getByText("Alpha")).toBeInTheDocument());
    f.setLayerHash(2, "edited-by-hand");
    await user.click(screen.getByRole("button", { name: "Refresh from file" }));
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Review")!);
    await user.click(await screen.findByRole("button", { name: /History/ }));
    expect(await screen.findByText(/was changed in EffectCraft/)).toBeInTheDocument();
  });
});
void vi;
