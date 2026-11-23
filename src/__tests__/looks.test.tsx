import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { approve, createProject } from "../lib/project";
import { applyLook, currentLook, detectConflicts, DIMENSIONS, FAMILIES, samePair } from "../lib/styles";
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

async function open(user: ReturnType<typeof userEvent.setup>, stage?: string) {
  await user.click(await screen.findByText("Looks demo"));
  await screen.findByRole("heading", { name: "Brief" });
  if (!stage) return;
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === stage) as HTMLElement);
  await screen.findByRole("heading", { name: stage });
}

describe("looks: one family for every dimension", () => {
  it("applyLook sets all seven dimensions, keeps chosen intensities, clears conflicts, and ignores an unknown family", () => {
    const p = createProject("x");
    p.style.dimensions.motion = { familyId: "swiss", intensity: "strong" };
    p.style.conflicts = [{ a: "motion:swiss", b: "texture:cut-paper", reason: "r", overridden: true }];
    const q = applyLook(p, "bauhaus");
    expect(Object.keys(q.style.dimensions).sort()).toEqual(DIMENSIONS.map((d) => d.id).sort());
    expect(q.style.dimensions.motion).toEqual({ familyId: "bauhaus", intensity: "strong" });
    expect(q.style.dimensions.color).toEqual({ familyId: "bauhaus", intensity: "moderate" });
    expect(q.style.conflicts).toEqual([]);
    expect(applyLook(p, "no-such-family")).toBe(p);
    expect(p.style.dimensions.motion?.familyId).toBe("swiss");           // the original is untouched
  });

  it("currentLook is the family only when all seven dimensions agree", () => {
    const p = createProject("x");
    expect(currentLook(p)).toBeNull();
    expect(currentLook(applyLook(p, "collage"))).toBe("collage");
    const q = applyLook(p, "collage"); q.style.dimensions.camera = { familyId: "swiss", intensity: "subtle" };
    expect(currentLook(q)).toBeNull();
    const r = applyLook(p, "collage"); delete r.style.dimensions.texture;
    expect(currentLook(r)).toBeNull();
  });

  it("an override is remembered whichever order the dimensions come back in (the project file lists them A to Z)", () => {
    const p = createProject("x");
    p.style.dimensions.typography = { familyId: "cinematic-title", intensity: "moderate" };
    p.style.dimensions.color = { familyId: "neon-light", intensity: "moderate" };
    const first = detectConflicts(p);
    expect(first).toHaveLength(1); expect(first[0].overridden).toBe(false);
    const saved = { ...p, style: { ...p.style, conflicts: [{ a: first[0].a, b: first[0].b, reason: first[0].reason, overridden: true }] } };
    // after a reload the dimensions come back alphabetically: color first, typography second
    const reloaded = { ...saved, style: { ...saved.style, dimensions: { color: p.style.dimensions.color, typography: p.style.dimensions.typography } } };
    const again = detectConflicts(reloaded);
    expect(again).toHaveLength(1); expect(again[0].overridden).toBe(true);
    expect(samePair({ a: "x", b: "y" }, "y", "x")).toBe(true); expect(samePair({ a: "x", b: "y" }, "x", "z")).toBe(false);
  });

  it("every family has a picture and every picture colour is a token", () => {
    const tokens = readFileSync("src/styles/tokens.css", "utf-8");
    const art = readFileSync("src/shell/StyleArt.tsx", "utf-8");
    for (const f of FAMILIES) {
      expect(tokens).toContain(`--mc-art-${f.id}-bg:`);
      expect(art).toMatch(new RegExp(`(^|\\s)"?${f.id}"?: <>`));
    }
    expect(art).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);                       // no raw colours in the drawing code
  });
});

describe("style presets on Direction and Brief", () => {
  it("Direction offers all twelve families as cards, and clicking one uses it for every dimension, saved with the project", async () => {
    const user = userEvent.setup();
    const saved = fake(createProject("Looks demo"));
    render(<App />);
    await open(user, "Direction");
    const group = screen.getByRole("group", { name: "Style presets" });
    expect(within(group).getAllByRole("button")).toHaveLength(12);
    const card = within(group).getByRole("button", { name: /Bauhaus/ });
    expect(card).toHaveAttribute("aria-pressed", "false");
    await user.click(card);
    expect(card).toHaveAttribute("aria-pressed", "true");
    await new Promise((r) => setTimeout(r, 1400));
    const last = saved[saved.length - 1];
    expect(Object.values(last.style.dimensions).map((v) => v!.familyId)).toEqual(Array(7).fill("bauhaus"));
    await user.click(within(group).getByRole("button", { name: /Neon/ }));
    expect(card).toHaveAttribute("aria-pressed", "false");
  });

  it("an approved direction keeps the cards off until it is unlocked", async () => {
    const user = userEvent.setup();
    fake(approve(createProject("Looks demo"), "B"));
    render(<App />);
    await open(user, "Direction");
    const group = screen.getByRole("group", { name: "Style presets" });
    for (const b of within(group).getAllByRole("button")) expect(b).toBeDisabled();
  });

  it("Brief shows three quick picks that apply a look, and a way to all the styles", async () => {
    const user = userEvent.setup();
    fake(createProject("Looks demo"));
    render(<App />);
    await open(user);
    const picks = screen.getByRole("group", { name: "Quick style picks" });
    expect(within(picks).getAllByRole("button").map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/Bauhaus/), expect.stringMatching(/Cut-paper/), expect.stringMatching(/Neon/)]));
    const cut = within(picks).getByRole("button", { name: /Cut-paper/ });
    await user.click(cut);
    expect(cut).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /Explore all styles/ }));
    expect(await screen.findByRole("heading", { name: "Direction" })).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Style presets" })).getByRole("button", { name: /Cut-paper/ })).toHaveAttribute("aria-pressed", "true");
  });
});
