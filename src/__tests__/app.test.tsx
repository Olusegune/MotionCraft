import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

type User = ReturnType<typeof userEvent.setup>;

function nav(name: string): HTMLElement {
  const bar = screen.getByRole("navigation", { name: "Stages" });
  return Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === name) as HTMLElement;
}
async function newProject(user: User, name = "Demo") {
  await user.click((await screen.findAllByRole("button", { name: "New project" }))[0]);
  await user.type(screen.getByLabelText("Name"), name);
  await user.click(screen.getByRole("button", { name: "Create project" }));
  await screen.findByRole("heading", { name: "Brief" });
}

describe("shell", () => {
  it("starts on Projects with an empty state and creates a project", async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    await newProject(user);
    expect(screen.getByRole("navigation", { name: "Stages" })).toBeInTheDocument();
  });

  it("shows seven stages and four gate diamonds with text status", async () => {
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    const bar = screen.getByRole("navigation", { name: "Stages" });
    for (const s of ["Brief", "Intent", "Direction", "Treatment", "Build", "Review", "Deliver"]) expect(bar).toHaveTextContent(s);
    const gates = screen.getAllByRole("button", { name: /^Gate [ABCD],/ });
    expect(gates).toHaveLength(4);
    expect(gates[0]).toHaveAccessibleName("Gate A, Intent: not reached");
  });

  it("disables Assisted and Agent-led with a reason when no provider exists", async () => {
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    await user.click(nav("Intent"));
    const assisted = await screen.findByRole("radio", { name: "Assisted" });
    expect(assisted).toBeDisabled();
    expect(assisted).toHaveAttribute("title", expect.stringContaining("AI provider"));
    expect(screen.getByRole("radio", { name: "Manual" })).toBeChecked();
  });

  it("completes gate A manually, locks the card, and unlocking needs confirmation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    await user.click(nav("Intent"));
    expect(await screen.findByRole("button", { name: "Approve intent" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Purpose"), "inform");
    await user.type(screen.getByLabelText("Summary"), "Calm and clear.");
    await user.click(screen.getByRole("button", { name: "Add beat" }));
    await user.type(screen.getByLabelText("Primary emotion"), "calm");
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve intent" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Approve intent" }));
    expect(await screen.findByText(/Approved at Gate A/)).toBeInTheDocument();
    expect(screen.getByLabelText("Summary")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Unlock to edit" }));
    expect(await screen.findByRole("dialog", { name: "Unlock approved material" })).toBeInTheDocument();
    expect(screen.getByLabelText("Summary")).toBeDisabled(); // nothing changes until confirmed
    await user.click(screen.getByRole("button", { name: /Unlock and create revision 1/ }));
    await waitFor(() => expect(screen.getByLabelText("Summary")).toBeEnabled());
  });

  it("keeps Build usable without an engine and says why", async () => {
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    await user.click(nav("Build"));
    expect(await screen.findByText("EffectCraft is not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Build preview" })).toBeDisabled();
  });

  it("opens the command palette with Ctrl+K and navigates", async () => {
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    await user.keyboard("{Control>}k{/Control}");
    await user.type(await screen.findByLabelText("Search actions"), "review{Enter}");
    expect(await screen.findByRole("heading", { name: "Review" })).toBeInTheDocument();
  });

  it("never offers final render before sign-off", async () => {
    const user = userEvent.setup();
    render(<App />);
    await newProject(user);
    await user.click(nav("Deliver"));
    await user.click(await screen.findByRole("button", { name: "Render final…" }));
    expect(await screen.findByText(/Approve for final render in Review first/)).toBeInTheDocument();
  });
});
