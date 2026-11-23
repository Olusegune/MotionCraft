import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import type { MotionProject } from "../types";

function fake(project: MotionProject) {
  const saved: MotionProject[] = [];
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save(_p: string, p: MotionProject) { saved.push(JSON.parse(JSON.stringify(p))); },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
    async fileUrl() { return "asset://x"; },
    async engine(method: string) {
      if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
      return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
    },
  };
  setApiForTests(api as unknown as Api);
  return saved;
}

async function toBrief(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Brief demo"));
  await screen.findByRole("heading", { name: "Brief" });
}
const demo = () => { const p = createProject("Brief demo"); return p; };

describe("the Brief page", () => {
  it("asks one question and offers three ways in as tabs that the arrow keys move between", async () => {
    const user = userEvent.setup();
    fake(demo());
    render(<App />);
    await toBrief(user);
    expect(screen.getByRole("heading", { name: "What would you like to bring to life?" })).toBeInTheDocument();
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Write a brief", "Import script", "Start with audio"]);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText(/Describe the piece/)).toBeInTheDocument();
    tabs[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByPlaceholderText(/Paste a script/)).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Add music or narration…" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  });

  it("a starting point fills an empty brief, and adds to one that already has words", async () => {
    const user = userEvent.setup();
    fake(demo());
    render(<App />);
    await toBrief(user);
    await user.click(screen.getByRole("button", { name: /Explainer/ }));
    const box = screen.getByPlaceholderText(/Describe the piece/) as HTMLTextAreaElement;
    expect(box.value).toMatch(/^Create a 45-second explainer/);
    await user.click(screen.getByRole("button", { name: /Product story/ }));
    expect(box.value).toMatch(/explainer[\s\S]*\n\nCreate a product story/);
    expect(screen.getByText(/\d+ characters/)).toBeInTheDocument();
  });

  it("preferences: tone chips toggle the intent tone, budget sets the cap, and size is shown but not editable", async () => {
    const user = userEvent.setup();
    const saved = fake(demo());
    render(<App />);
    await toBrief(user);
    const prefs = screen.getByRole("region", { name: "Project preferences" });
    const chip = within(prefs).getByRole("button", { name: "Playful" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "false");
    await user.click(within(prefs).getByRole("button", { name: "Elegant" }));
    const budget = within(prefs).getByLabelText("Budget limit") as HTMLInputElement;
    await user.clear(budget); await user.type(budget, "30");
    expect(budget.value).toBe("30");
    await new Promise((r) => setTimeout(r, 1400));       // autosave
    const last = saved[saved.length - 1];
    expect(last?.budget.capUsd).toBe(30);
    expect(last?.intent.tone).toEqual(["elegant"]);
    const sixteenNine = within(prefs).getByRole("radio", { name: "16:9" });
    expect(sixteenNine).toBeChecked();
    expect(within(prefs).getByRole("radio", { name: "9:16" })).toBeDisabled();
    expect(within(prefs).getByText("15 seconds")).toBeInTheDocument();
  });

  it("Auto suggest needs a provider and says so; Browse styles opens Direction", async () => {
    const user = userEvent.setup();
    fake(demo());
    render(<App />);
    await toBrief(user);
    const auto = screen.getByRole("button", { name: /Auto suggest/ });
    expect(auto).toBeDisabled();
    expect(auto).toHaveAttribute("title", expect.stringMatching(/AI provider/));
    await user.click(screen.getByRole("button", { name: /Browse styles/ }));
    expect(await screen.findByRole("heading", { name: "Direction" })).toBeInTheDocument();
  });
});
