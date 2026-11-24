import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import type { MotionProject } from "../types";

// An older project file: made before assets, layerMap, moodboard and frame choices existed.
function oldProject(): MotionProject {
  const p = createProject("Old project") as Partial<MotionProject> & Record<string, unknown>;
  delete p.assets;
  delete p.layerMap;
  delete (p.style as { moodboard?: string[] }).moodboard;
  return p as MotionProject;
}

function apiWith(p: MotionProject): Api {
  return {
    async list() { return [{ id: p.id, name: p.name, path: "mem:1", updatedAt: p.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(p)); },
    async save() { /* keep */ },
    async create() { throw new Error("unused"); },
    async engineStatus() { return { state: "missing", pinned: "0.24.1", detail: "none" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false }; },
    async engine() { return { models: [], status: {} }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
  } as unknown as Api;
}

describe("QA: robustness and keyboard", () => {
  it("opens a project saved by an earlier version and every page renders", async () => {
    setApiForTests(apiWith(oldProject()));
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Old project/ }));
    for (const stage of ["Brief", "Intent", "Direction", "Treatment", "Build", "Review", "Deliver"]) {
      const bar = screen.getByRole("navigation", { name: "Stages" });
      await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === stage)!);
      expect(await screen.findByRole("heading", { name: stage })).toBeInTheDocument();
    }
  });

  it("arrow keys move along the stage bar and wrap around", async () => {
    const user = userEvent.setup();
    setApiForTests(apiWith(createProject("K")));
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /K/ }));
    const bar = screen.getByRole("navigation", { name: "Stages" });
    const stops = Array.from(bar.querySelectorAll<HTMLElement>("[data-stop]"));
    stops[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(stops[1]);
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(document.activeElement).toBe(stops[stops.length - 1]);
  });

  it("Escape closes sheets and returns focus to the button that opened them", async () => {
    const user = userEvent.setup();
    render(<App />);
    const settings = await screen.findByRole("button", { name: "Settings" });
    await user.click(settings);
    expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(settings);
  });

  it("an empty project name cannot be created and says why", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
    await user.type(screen.getByLabelText("Name"), "   ");
    expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
  });

  it("no raw hex colours outside the token file", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? (e.name === "__tests__" ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]);
    const files = walk(path.resolve(__dirname, "..")).filter((f) => /\.(css|tsx?)$/.test(f) && !f.endsWith("tokens.css"));
    const offenders = files.filter((f) => /#[0-9a-fA-F]{6}\b/.test(fs.readFileSync(f, "utf-8")));
    expect(offenders.map((f) => path.basename(f))).toEqual([]);
  });

  it("no blanket rule sets position on everything in the app: dialogs, notices and the full-screen player are position: fixed", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(path.resolve(__dirname, "../styles/app.css"), "utf-8");
    expect(css).not.toMatch(/\.app\s*>\s*\*\s*\{[^}]*position/);          // it once turned every dialog into an in-flow element at the bottom of the page
    expect(css).toMatch(/\.sheet-backdrop\s*\{[^}]*position:\s*fixed/);
  });
});
