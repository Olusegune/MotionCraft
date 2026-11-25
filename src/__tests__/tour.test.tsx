import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Tour, TOUR_STEPS } from "../shell/Tour";
import { UpdateBanner } from "../shell/UpdateBanner";
import { getSettings, resetSettingsCacheForTests } from "../lib/settings";

describe("first-run tour", () => {
  it("steps through, can go back, and ends on starting a project", async () => {
    const onStart = vi.fn(); const onClose = vi.fn();
    render(<Tour onClose={onClose} onStart={onStart} />);
    expect(screen.getByText(`Step 1 of ${TOUR_STEPS.length}`)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Step 1 of 5")).toBeInTheDocument();
    for (let i = 1; i < TOUR_STEPS.length; i++) await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Start my first project" }));
    expect(onStart).toHaveBeenCalled();
  });
  it("can be skipped", async () => {
    const onClose = vi.fn();
    render(<Tour onClose={onClose} onStart={() => undefined} />);
    await userEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(onClose).toHaveBeenCalled();
  });
  it("defaults: tour not seen, updates on", () => {
    localStorage.clear(); resetSettingsCacheForTests();
    expect(getSettings().tourSeen).toBe(false);
    expect(getSettings().autoUpdate).toBe(true);
  });
});

describe("update banner", () => {
  it("installs only on the click, and shows a failure", async () => {
    const onInstall = vi.fn().mockRejectedValue(new Error("signature mismatch"));
    render(<UpdateBanner info={{ version: "0.2.0", current: "0.1.5", notes: null }} onInstall={onInstall} onLater={() => undefined} />);
    expect(onInstall).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Install and restart" }));
    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/signature mismatch/)).toBeInTheDocument();
  });
});

import { offlineIntent } from "../lib/makeIt";
import { createProject } from "../lib/project";
describe("Make it without an AI model", () => {
  it("drafts four scenes and a tone from a plain brief", () => {
    const p = createProject("x", { aspect: "16:9", width: 1920, height: 1080, fps: 30, durationSec: 20, alpha: false });
    p.brief.text = "An elegant, calm launch film for a watch. Quiet confidence.";
    const i = offlineIntent(p);
    expect(i.arc).toHaveLength(4);
    const j = createProject("j", p.brief.deliverables[0]); j.brief.text = "A film. Journey: curiosity → awe → quiet mastery."; expect(offlineIntent(j).arc.map((b) => b.primary)).toEqual(["Curiosity", "Awe", "Quiet mastery"]);
    expect(i.arc[3].endSec).toBe(20);
    expect(i.tone).toEqual(expect.arrayContaining(["elegant", "restrained"]));
    expect(i.summary).toMatch(/elegant/);
  });
  it("uses the scenes of a timed script", () => {
    const p = createProject("x", { aspect: "16:9", width: 1920, height: 1080, fps: 30, durationSec: 10, alpha: false });
    p.brief.script = "0:00-0:05 Visual: a dark sky. Audio: quiet hum\n0:05-0:10 Visual: a bright sun. Audio: bass impact";
    expect(offlineIntent(p).arc.length).toBeGreaterThanOrEqual(1);
  });
});

import { readdirSync, readFileSync } from "node:fs";
describe("source hygiene", () => {
  it("has no stray backspace characters (a regex written through a shell can turn word-boundary escapes into them)", () => {
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]));
    const bad = walk("src").filter((f) => /\.(ts|tsx|css)$/.test(f) && readFileSync(f, "utf-8").includes(String.fromCharCode(8)));
    expect(bad).toEqual([]);
  });
});
