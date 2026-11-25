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
