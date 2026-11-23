import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api, type ProjectHealth, type UncleanSession } from "../lib/api";
import { createProject } from "../lib/project";
import type { MotionProject } from "../types";

type Opts = { unclean?: UncleanSession | null; health?: ProjectHealth; loadFails?: string };

function fake(project: MotionProject, opts: Opts = {}) {
  const log = { saves: [] as MotionProject[], begun: [] as string[], ended: 0, restored: [] as string[], loads: 0 };
  let restored = false;
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { log.loads++; if (opts.loadFails && !restored) throw new Error(opts.loadFails); return JSON.parse(JSON.stringify(project)); },
    async save(_p: string, p: MotionProject) { log.saves.push(JSON.parse(JSON.stringify(p))); },
    async create() { return { id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }; },
    async engineStatus() { return { state: "missing", pinned: "0.24.1", detail: "none" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async startupStep() { /* unused */ },
    async engine() { throw new Error("no engine in this test"); },
    async projectHealth() { return opts.health ?? { state: "ok", hasBackup: false }; },
    async restoreBackup(path: string) { log.restored.push(path); restored = true; },
    async uncleanSession() { return opts.unclean ?? null; },
    async sessionBegin(path: string) { log.begun.push(path); },
    async sessionEnd() { log.ended++; },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

describe("crash recovery (P1-06, P1-13)", () => {
  it("says nothing when the last session ended normally", async () => {
    fake(createProject("Calm"));
    render(<App />);
    await screen.findByText("Calm");
    expect(screen.queryByRole("dialog", { name: /closed unexpectedly/ })).not.toBeInTheDocument();
  });

  it("after an unclean exit it explains, shows the last save, and opens the project on request", async () => {
    const user = userEvent.setup();
    const p = createProject("Launch film");
    const log = fake(p, { unclean: { path: "mem:1", name: "Launch film", updatedAt: "2026-11-23T10:00:00.000Z", health: { state: "ok", hasBackup: true } } });
    render(<App />);
    const dlg = await screen.findByRole("dialog", { name: "MotionCraft closed unexpectedly" });
    expect(dlg).toHaveTextContent("Launch film");
    expect(dlg).toHaveTextContent("at most the last few seconds");
    expect(within(dlg).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Open Launch film" }));
    await screen.findByRole("heading", { name: "Brief" });
    expect(log.begun).toEqual(["mem:1"]);
    expect(screen.queryByRole("dialog", { name: /closed unexpectedly/ })).not.toBeInTheDocument();
  });

  it("'Not now' just closes the prompt", async () => {
    const user = userEvent.setup();
    fake(createProject("X"), { unclean: { path: "mem:1", name: "X", updatedAt: "2026-11-23T10:00:00.000Z", health: { state: "ok", hasBackup: false } } });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("a damaged project offers the last good copy, restores it and opens it", async () => {
    const user = userEvent.setup();
    const log = fake(createProject("Broken"), { loadFails: "project.json is damaged: expected value", health: { state: "damaged", hasBackup: true, backupUpdatedAt: "2026-11-23T09:00:00.000Z" } });
    render(<App />);
    await user.click(await screen.findByText("Broken"));
    const dlg = await screen.findByRole("dialog", { name: "This project is damaged" });
    expect(dlg).toHaveTextContent("project.damaged.json");
    await user.click(within(dlg).getByRole("button", { name: "Restore the last good copy" }));
    await screen.findByRole("heading", { name: "Brief" });
    expect(log.restored).toEqual(["mem:1"]);
    expect(log.begun).toEqual(["mem:1"]);
  });

  it("a damaged project with no backup says so and offers no restore", async () => {
    const user = userEvent.setup();
    fake(createProject("Lost"), { loadFails: "project.json is damaged: x", health: { state: "damaged", hasBackup: false } });
    render(<App />);
    await user.click(await screen.findByText("Lost"));
    const dlg = await screen.findByRole("dialog", { name: "This project is damaged" });
    expect(dlg).toHaveTextContent("no good backup");
    expect(within(dlg).queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
  });
});

describe("autosave timing", () => {
  it("saves an edit about a second after typing, and a gate approval at once", async () => {
    const user = userEvent.setup();
    const log = fake(createProject("Timing"));
    render(<App />);
    await user.click(await screen.findByText("Timing"));
    await screen.findByRole("heading", { name: "Brief" });
    await user.type(screen.getByPlaceholderText(/Describe the piece/), "Hello");
    await waitFor(() => expect(log.saves.some((s) => s.brief.text === "Hello")).toBe(true), { timeout: 4000 });

    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Intent") as HTMLElement);
    await user.selectOptions(await screen.findByLabelText("Purpose"), "inform");
    await user.type(screen.getByLabelText("Summary"), "Calm.");
    await user.click(screen.getByRole("button", { name: "Add beat" }));
    await user.type(screen.getByLabelText("Primary emotion"), "calm");
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve intent" })).toBeEnabled());
    await new Promise((r) => setTimeout(r, 1300));   // let the edits above be saved, so only the approval is pending
    const before = log.saves.length;
    await user.click(screen.getByRole("button", { name: "Approve intent" }));
    await waitFor(() => expect(log.saves.length).toBeGreaterThan(before), { timeout: 600 });   // far sooner than the one-second debounce
    expect(log.saves[log.saves.length - 1].approvals.length).toBeGreaterThan(0);
  });
});
