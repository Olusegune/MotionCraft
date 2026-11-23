import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { approve, createProject } from "../lib/project";
import type { MotionProject } from "../types";

function fake(project: MotionProject) {
  const log = { calls: [] as string[], exported: [] as string[] };
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save() { /* keep */ },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
    async fileUrl(_p: string, rel: string) { log.calls.push(`fileUrl:${rel}`); return "asset://final.mp4"; },
    async projectsFolder() { return "C:/p"; },
    async pickPath() { return "C:/out"; },
    async exportPackage(_p: string, dest: string) { log.exported.push(dest); return `${dest}/Demo.motioncraft`; },
    async engine(method: string) {
      log.calls.push(method);
      if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
      if (method === "render_jobs") return { jobs: [] } as never;
      return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

async function toDeliver(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Deliver demo"));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Deliver") as HTMLElement);
  await screen.findByRole("heading", { name: "Deliver" });
}

describe("the Deliver page in the studio layout", () => {
  it("shows the final video as the stage, the three outputs under it, and a short summary beside it", async () => {
    const user = userEvent.setup();
    fake(createProject("Deliver demo"));
    render(<App />);
    await toDeliver(user);
    expect(screen.getByRole("heading", { name: "Deliver" })).toHaveClass("visually-hidden");
    expect(screen.getByRole("group", { name: "Preview player" })).toHaveClass("fill");
    expect(screen.getByText(/No final render yet/)).toBeInTheDocument();
    for (const t of ["Rendered video", "Graphics with transparency", "Collected editable project"]) expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ready to deliver" })).toBeInTheDocument();
    expect(screen.getByText("Not given yet")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Render queue" })).toBeInTheDocument();
  });

  it("without the Review sign-off the render buttons are off and say why, and export still works", async () => {
    const user = userEvent.setup();
    const log = fake(createProject("Deliver demo"));
    render(<App />);
    await toDeliver(user);
    const h264 = screen.getByRole("button", { name: "Render H.264" });
    expect(h264).toBeDisabled();
    expect(h264).toHaveAttribute("title", expect.stringMatching(/Gate D/));
    expect(screen.getByRole("button", { name: "Render with alpha" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Export package" }));
    expect(await screen.findByText(/Collected project saved to C:\/out\/Demo\.motioncraft/)).toBeInTheDocument();
    expect(log.exported).toEqual(["C:/out"]);
  });

  it("with the sign-off, a card's Render button opens the confirmation with that output chosen, and nothing renders yet", async () => {
    const user = userEvent.setup();
    const log = fake(approve(createProject("Deliver demo"), "D"));
    render(<App />);
    await toDeliver(user);
    await user.click(screen.getByRole("button", { name: "Render with alpha" }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("combobox")).toHaveValue("prores4444");
    expect(within(sheet).getByText(/Nothing is rendered until you confirm/)).toBeInTheDocument();
    expect(log.calls.includes("render_start")).toBe(false);
  });

  it("the last finished H.264 render is shown again when the project is reopened", async () => {
    const user = userEvent.setup();
    const p = approve(createProject("Deliver demo"), "D");
    p.renders = [{ id: "r1", preset: "h264", rel: "renders/final.mp4", frames: 450, bytes: 2_000_000, at: "2026-11-23T20:00:00Z" }];
    const log = fake(p);
    render(<App />);
    await toDeliver(user);
    await screen.findByLabelText("Preview movie");
    expect(log.calls).toContain("fileUrl:renders/final.mp4");
    expect(screen.queryByText(/No final render yet/)).toBeNull();
  });
});
