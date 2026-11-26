import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import type { MotionProject } from "../types";

function fake(project: MotionProject) {
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save() { /* keep */ },
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
}

async function toReview(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Review demo"));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Review") as HTMLElement);
  await screen.findByRole("heading", { name: "Review" });
}

describe("the Review page in the studio layout", () => {
  it("fills the page with the picture, has no title row, and keeps a notes dock and a calm inspector", async () => {
    const user = userEvent.setup();
    fake(createProject("Review demo"));
    render(<App />);
    await toReview(user);
    expect(screen.getByRole("group", { name: "Preview player" })).toHaveClass("fill");
    expect(document.querySelector(".studio")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Review" })).toHaveClass("visually-hidden");     // the title stays for screen readers
    expect(screen.getByRole("heading", { name: "Review the draft" })).toBeInTheDocument();
    expect(screen.getByText(/0 notes · not yet approved/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Notes at the playhead" })).toBeInTheDocument();
  });

  it("a note typed at the playhead appears in the strip, can be jumped to and removed", async () => {
    const user = userEvent.setup();
    fake(createProject("Review demo"));
    render(<App />);
    await toReview(user);
    const dock = screen.getByRole("heading", { name: "Notes at the playhead" }).closest("section") as HTMLElement;
    await user.type(within(dock).getByPlaceholderText(/What should change/), "Hold the title longer");
    await user.click(within(dock).getByRole("button", { name: /Add note/ }));
    const list = within(dock).getByRole("list");
    expect(list).toHaveTextContent("Hold the title longer");
    expect(screen.getByText(/1 note · not yet approved/)).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: /^Go to / })).toBeInTheDocument();
    await user.click(within(list).getByRole("button", { name: /^Remove note at / }));
    expect(within(dock).queryByRole("list")).toBeNull();
    expect(within(dock).getByText(/No notes yet/)).toBeInTheDocument();
  });
});
