import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import App from "../App";

// jsdom cannot compute colours, so contrast is checked separately from the tokens (UI_UX.md section 10) and by eye.
async function violations(container: HTMLElement) {
  const r = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
  return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
}

describe("accessibility (axe, no contrast)", () => {
  it("Projects and every stage page have no violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await screen.findByText(/no AI account is needed/);
    expect(await violations(container)).toEqual([]);
    await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
    expect(await violations(container)).toEqual([]);            // with the New project sheet open
    await user.type(screen.getByLabelText("Name"), "A11y");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    await screen.findByRole("heading", { name: "Brief" });
    for (const stage of ["Brief", "Intent", "Direction", "Treatment", "Build", "Review", "Deliver"]) {
      const bar = screen.getByRole("navigation", { name: "Stages" });
      await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === stage)!);
      await screen.findByRole("heading", { name: stage });
      expect({ stage, v: await violations(container) }).toEqual({ stage, v: [] });
    }
  }, 60000);

  it("Settings, models and command palette sheets have no violations", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole("button", { name: "Settings" }));
    await screen.findByRole("dialog", { name: "Settings" });
    expect(await violations(container)).toEqual([]);
    await user.keyboard("{Escape}");
    await user.keyboard("{Control>}k{/Control}");
    await screen.findByRole("dialog", { name: "Command palette" });
    expect(await violations(container)).toEqual([]);
  }, 30000);
});
