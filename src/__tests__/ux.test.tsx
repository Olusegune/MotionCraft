import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

describe("finding Settings and working manually", () => {
  it("the Projects screen says it works manually and Settings has a visible label", async () => {
    render(<App />);
    expect(await screen.findByText(/no AI account is needed/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toHaveTextContent("Settings");
    expect(screen.getByRole("button", { name: "Open project folder…" })).toBeInTheDocument();
  });

  it("inside a project the header shows the working mode and explains it", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
    await user.type(screen.getByLabelText("Name"), "Manual demo");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByRole("heading", { name: "Brief" });
    const chip = screen.getByRole("button", { name: /Working mode: Manual/ });
    expect(chip).toHaveTextContent("Working mode: Manual");
    await user.click(chip);
    expect(await screen.findByRole("dialog", { name: "Working manually" })).toHaveTextContent("Every page works without an AI account");
    await user.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(await screen.findByRole("dialog", { name: "Settings" })).toHaveTextContent("Manual.");
  });

  it("Settings offers Browse and automatic detection for EffectCraft", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("button", { name: "Browse…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find automatically" })).toBeInTheDocument();
  });
});
