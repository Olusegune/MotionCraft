import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import type { MotionProject } from "../types";

function fakeApi() {
  const store = new Map<string, MotionProject>();
  const imported: string[] = [];
  const api = {
    async list() { return []; },
    async create(p: MotionProject) { store.set(p.id, p); return { id: p.id, name: p.name, path: `mem:${p.id}`, updatedAt: p.updatedAt }; },
    async load(path: string) { return store.get(path.replace("mem:", ""))!; },
    async save(_p: string, p: MotionProject) { store.set(p.id, p); },
    async engineStatus() { return { state: "missing", pinned: "0.24.1", detail: "none" }; },
    async openEffectCraft() { /* unused */ },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false }; },
    async engine() { return { models: [], status: {} }; },
    async assetDataUrl() { return "data:image/png;base64,iVBORw0KGgo="; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async pickMedia() { return ["C:\\pics\\lake.png", "C:\\pics\\kite.png"]; },
    async importAsset(_path: string, source: string) {
      imported.push(source);
      const name = source.split("\\").pop()!.replace(".png", "");
      return { kind: "image" as const, path: `assets/images/imp-1234-${name}.png`, name };
    },
  } as unknown as Api;
  return { api, imported };
}

async function newProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
  await user.type(screen.getByLabelText("Name"), "Visual");
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("heading", { name: "Brief" });
}
const go = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === name)!);
};

describe("media wall, moodboard and storyboard", () => {
  it("adds pictures to the media wall from disk", async () => {
    const f = fakeApi();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    expect(screen.getByText(/Add reference pictures, logos, footage or music/)).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Add media…" })[0]);
    const wall = await screen.findByRole("list", { name: "Media" });
    await waitFor(() => expect(within(wall).getAllByRole("listitem")).toHaveLength(2));
    expect(f.imported).toEqual(["C:\\pics\\lake.png", "C:\\pics\\kite.png"]);
    expect(within(wall).getByText("lake")).toBeInTheDocument();
  });

  it("moodboard: clicking a picture toggles it as a reference", async () => {
    const f = fakeApi();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    await user.click(screen.getAllByRole("button", { name: "Add media…" })[0]);
    await screen.findByRole("list", { name: "Media" });
    await go(user, "Direction");
    const pic = await screen.findByRole("button", { name: /lake/ });
    expect(pic).toHaveAttribute("aria-pressed", "false");
    await user.click(pic);
    expect(screen.getByRole("button", { name: /lake/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("storyboard: a beat takes a frame from the wall and shows it", async () => {
    const f = fakeApi();
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    await user.click(screen.getAllByRole("button", { name: "Add media…" })[0]);
    await screen.findByRole("list", { name: "Media" });
    await go(user, "Intent");
    await user.click(await screen.findByRole("button", { name: "Add beat" }));
    await user.type(screen.getByLabelText("Primary emotion"), "calm");
    await go(user, "Treatment");
    const select = await screen.findByLabelText("Frame for beat 1");
    await user.selectOptions(select, "kite");
    const slot = within(screen.getByRole("button", { name: "Show frame for beat 1" })).getByRole("img");
    expect(slot).toHaveAttribute("alt", "kite");
  });
});
