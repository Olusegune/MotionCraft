import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { approve, createProject } from "../lib/project";
import { updateSettings } from "../lib/settings";
import type { MotionProject } from "../types";

function fake(project: MotionProject, llmReady = false) {
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
      if (method === "llm_status") return (llmReady ? { ready: true, reason: "", config: { provider: "ollama", model: "m" }, providers: [{ id: "ollama", label: "Ollama", local: true }] } : { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] }) as never;
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
    expect(within(prefs).getByRole("radio", { name: "16:9" })).toBeChecked();
    expect((within(prefs).getByLabelText("Duration (seconds)") as HTMLInputElement).value).toBe("15");
  });

  it("size, length and frame rate can be changed before the first layer, and are fixed after it", async () => {
    const user = userEvent.setup();
    const saved = fake(demo());
    render(<App />);
    await toBrief(user);
    const prefs = screen.getByRole("region", { name: "Project preferences" });
    const dur = within(prefs).getByLabelText("Duration (seconds)") as HTMLInputElement;
    await user.clear(dur); await user.type(dur, "10");
    expect(dur.value).toBe("10");
    await user.click(within(prefs).getByRole("radio", { name: "9:16" }));
    await user.selectOptions(within(prefs).getByLabelText("Resolution"), "uhd4k");
    await user.selectOptions(within(prefs).getByLabelText("Frame rate"), "24");
    expect(within(prefs).getByText(/2160 × 3840/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1400));
    const d = saved[saved.length - 1].brief.deliverables[0];
    expect(d).toMatchObject({ aspect: "9:16", width: 2160, height: 3840, fps: 24, durationSec: 10 });
  });

  it("with layers the size is shown as fixed, not editable", async () => {
    const user = userEvent.setup();
    const p = demo();
    p.revisions = [{ id: "r1", at: "t", actor: "agent:builder", kind: "agent_edit", layers: [2], summary: "Builder made 1 layer" }];
    fake(p);
    render(<App />);
    await toBrief(user);
    const prefs = screen.getByRole("region", { name: "Project preferences" });
    expect(within(prefs).queryByLabelText("Duration (seconds)")).toBeNull();
    expect(within(prefs).getByText(/1920 × 1080 · 30 fps · 15 seconds · 16:9/)).toBeInTheDocument();
    expect(within(prefs).getByText(/Fixed now that the composition has layers/)).toBeInTheDocument();
  });

  it("found in your brief: settings, scenes and sound cues are offered, and used only when asked", async () => {
    const user = userEvent.setup();
    const saved = fake(demo());
    render(<App />);
    await toBrief(user);
    const box = screen.getByPlaceholderText(/Describe the piece/);
    await user.click(box);
    await user.paste("A 10-second piece, 16:9, 4K, 24 fps. The emotional journey is curiosity → awe → quiet mastery.\n\n| Time | Visual | Text | Audio |\n|---|---|---|---|\n| 0:00–0:02 | A point appears | HELLO | a quiet pulse |\n| 0:02–0:05 | It grows | | a deep swell |\n| 0:05–0:10 | Lines connect | WORLD | a bass impact |");
    const card = await screen.findByRole("region", { name: "Found in your brief" });
    expect(card).toHaveTextContent("10 seconds · 16:9 · 24 fps · 3840 × 2160");
    expect(card).toHaveTextContent("3 scenes from the timed script: curiosity, awe, quiet mastery");
    expect(card).toHaveTextContent("3 sound cues");
    await new Promise((r) => setTimeout(r, 1400));
    expect(saved[saved.length - 1].intent.arc).toEqual([]);                      // nothing is used until asked
    await user.click(within(card).getByRole("button", { name: "Use these" }));
    await new Promise((r) => setTimeout(r, 1400));
    const p = saved[saved.length - 1];
    expect(p.brief.deliverables[0]).toMatchObject({ durationSec: 10, aspect: "16:9", fps: 24, width: 3840, height: 2160 });
    expect(p.intent.arc.map((b) => [b.startSec, b.endSec, b.primary])).toEqual([[0, 2, "curiosity"], [2, 5, "awe"], [5, 10, "quiet mastery"]]);
    expect(p.review.comments.map((c) => [c.atSec, c.text])).toEqual([[0, "Sound at 0:00: a quiet pulse"], [2, "Sound at 0:02: a deep swell"], [5, "Sound at 0:05: a bass impact"]]);
    expect(screen.queryByRole("region", { name: "Found in your brief" })).toBeNull();      // used, so nothing more to offer
  });

  it("found in your brief: Not now hides the card, and an approved intent keeps its scenes", async () => {
    const user = userEvent.setup();
    const p0 = approve(demo(), "A");
    fake(p0);
    render(<App />);
    await toBrief(user);
    await user.click(screen.getByPlaceholderText(/Describe the piece/));
    await user.paste("20 seconds\n| 0:00–0:10 | one | A | x |\n| 0:10–0:20 | two | B | y |");
    const card = await screen.findByRole("region", { name: "Found in your brief" });
    expect(card).not.toHaveTextContent("scenes");                                 // Gate A is approved: the scenes are not offered
    await user.click(within(card).getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: "Found in your brief" })).toBeNull();
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

  it("a first-time hint shows on an empty brief, goes when dismissed, and does not come back", async () => {
    try { localStorage.removeItem("mc.coach.brief"); } catch { /* none */ }
    const user = userEvent.setup();
    fake(demo());
    render(<App />);
    await toBrief(user);
    expect(screen.getByRole("note")).toHaveTextContent("Start here");
    await user.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(localStorage.getItem("mc.coach.brief")).toBe("1");
  });

  it("Make it will not redraft an intent that is approved, and says why", async () => {
    updateSettings({ llmReady: true });
    try {
      const user = userEvent.setup();
      const base = demo();
      base.intent.purpose = "inform"; base.intent.summary = "One idea, clearly."; base.intent.arc = [{ beatId: "a", startSec: 0, endSec: 5, primary: "one", intensity: 2, energy: 2 }];
      const p0 = approve(base, "A");
      p0.brief.text = "A short piece about one idea.";
      fake(p0, true);
      render(<App />);
      await toBrief(user);
      expect(screen.getByRole("button", { name: "Make it" })).toBeDisabled();
      expect(screen.getByText(/The intent is approved, so it will not be redrafted/)).toBeInTheDocument();
    } finally { updateSettings({ llmReady: false }); }
  });
});
