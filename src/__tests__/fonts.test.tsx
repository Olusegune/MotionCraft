import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { FONT_MOODS, firstAvailable, pickFonts, projectFonts, suggestMood } from "../lib/fonts";
import type { MotionProject } from "../types";

const have = new Set(["Inter", "Bahnschrift", "Agency FB", "Georgia", "Impact", "JetBrains Mono", "Segoe UI"]);

describe("choosing type from what is installed", () => {
  it("takes the first candidate that is installed, ignoring case, and never one that is not", () => {
    expect(firstAvailable(["Orbitron", "agency fb", "Bahnschrift"], have)).toBe("Agency FB");
    expect(firstAvailable(["Orbitron", "Michroma"], have)).toBe("");
    expect(firstAvailable(["Orbitron", "Michroma"], null)).toBe("Orbitron");        // no list: the first choice, shown as not checked
  });
  it("picks a sleek futuristic pair from what this computer has", () => {
    expect(pickFonts("futuristic", have)).toEqual({ mood: "futuristic", display: "Agency FB", body: "Inter" });
    expect(pickFonts("kinetic", have).display).toBe("Impact");
    expect(pickFonts("technical", have).display).toBe("JetBrains Mono");
    expect(pickFonts("nonsense", have).mood).toBe("clean");
  });
  it("every mood has candidates and a specimen", () => {
    for (const m of FONT_MOODS) { expect(m.display.length).toBeGreaterThan(2); expect(m.body.length).toBeGreaterThan(1); expect(m.sample.length).toBeGreaterThan(3); }
  });
  it("suggests futuristic type for a space film whatever look it was given, and falls back to the look", () => {
    const p = createProject("Type");
    p.brief.text = "A sleek film about a Type V civilization across the cosmos.";
    p.style.dimensions = { typography: { familyId: "bauhaus", intensity: "moderate" } };
    expect(suggestMood(p)).toBe("futuristic");
    const q = createProject("Look");
    q.brief.text = "A quarterly update.";
    q.style.dimensions = { typography: { familyId: "bold-kinetic", intensity: "moderate" } };
    expect(suggestMood(q)).toBe("kinetic");
    expect(suggestMood(createProject("none"))).toBe("clean");
  });
  it("uses the person's own choice over the suggestion", () => {
    const p = createProject("Own");
    p.brief.text = "A film about space.";
    p.style.fonts = { mood: "editorial", display: "Georgia", body: "Inter" };
    expect(projectFonts(p, have).display).toBe("Georgia");
  });
});

describe("the font picker on Direction", () => {
  it("shows the moods in their own fonts, says which suits the project, and saves a click as the project's fonts", async () => {
    const user = userEvent.setup();
    const p = createProject("Font demo");
    p.brief.text = "A film about a civilization among the stars.";
    const saved: MotionProject[] = [];
    const calls: string[] = [];
    const api = {
      async list() { return [{ id: p.id, name: p.name, path: "mem:1", updatedAt: p.updatedAt }]; },
      async load() { return JSON.parse(JSON.stringify(p)); },
      async save(_x: string, proj: MotionProject) { saved.push(JSON.parse(JSON.stringify(proj))); },
      async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
      async effectcraftWindowOpen() { return false; },
      async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
      async onMenu() { return () => undefined; },
      async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
      async assetDataUrl() { return "data:image/png;base64,AAAA"; },
      async engine(method: string) {
        calls.push(method);
        if (method === "fonts_available") return { count: have.size, families: [...have].map((f) => ({ family: f, origin: f === "Inter" ? "bundled" : "system", variable: false })) } as never;
        if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        if (method === "models") return { models: [], status: {} } as never;
        return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      },
    };
    setApiForTests(api as unknown as Api);
    render(<App />);
    await user.click(await screen.findByText("Font demo"));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Direction") as HTMLElement);
    const group = await screen.findByRole("group", { name: "Font mood" });
    await waitFor(() => expect(calls).toContain("fonts_available"));
    const futur = within(group).getByRole("button", { name: /Sleek futuristic/ });
    expect(futur).toHaveTextContent("suits this project");
    expect(futur).toHaveTextContent("Agency FB + Inter");
    expect(within(group).getByText("TYPE I · PLANETARY")).toHaveStyle({ fontFamily: '"Agency FB", sans-serif' });
    expect(screen.getByText(/Not chosen yet: the Builder will use Agency FB and Inter/)).toBeInTheDocument();
    await user.click(within(group).getByRole("button", { name: /Bold kinetic/ }));
    await waitFor(() => expect(saved.some((x) => x.style.fonts?.mood === "kinetic")).toBe(true), { timeout: 4000 });
    expect(saved[saved.length - 1].style.fonts).toEqual({ mood: "kinetic", display: "Impact", body: "Inter" });
    expect(within(group).getByRole("button", { name: /Bold kinetic/ })).toHaveAttribute("aria-pressed", "true");
    await user.clear(screen.getByLabelText(/Display font/));
    await user.type(screen.getByLabelText(/Display font/), "Eurostile Extended");
    expect(await screen.findByRole("alert")).toHaveTextContent("A chosen font is not installed");
  }, 20000);
});
