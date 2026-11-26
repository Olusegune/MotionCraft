import { describe, expect, it } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { RECHECK_MIN_MS, shouldRecheckOnFocus } from "../lib/engineCheck";

describe("when EffectCraft is looked for again", () => {
  it("only when it was not found, and not within 30 seconds of the last look", () => {
    expect(shouldRecheckOnFocus("missing", 0, RECHECK_MIN_MS)).toBe(true);
    expect(shouldRecheckOnFocus("missing", 1000, 1000 + RECHECK_MIN_MS - 1)).toBe(false);
    for (const s of ["connected", "version-mismatch", "error", undefined]) expect(shouldRecheckOnFocus(s, 0, 10 * RECHECK_MIN_MS)).toBe(false);
  });
});

function fake(state: "missing" | "version-mismatch" | "connected") {
  const calls = { status: 0 };
  setApiForTests({
    async list() { return []; },
    async engineStatus() { calls.status++; return { state, version: state === "missing" ? undefined : "0.23.1", pinned: "0.24.1", detail: "x" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async startupStep() { /* unused */ },
    async uncleanSession() { return null; },
    async engine() { return { ready: false, reason: "", config: { provider: null, model: "" }, providers: [] } as never; },
  } as unknown as Api);
  return calls;
}

describe("focus does not start a loop of engine checks (the flashing terminal window)", () => {
  it.each(["version-mismatch", "connected"] as const)("%s: focusing the window many times checks once, at start-up", async (state) => {
    const calls = fake(state);
    render(<App />);
    await waitFor(() => expect(calls.status).toBe(1));
    for (let i = 0; i < 6; i++) act(() => { window.dispatchEvent(new Event("focus")); });
    await new Promise((r) => setTimeout(r, 150));
    expect(calls.status).toBe(1);
    expect(screen.getByRole("heading", { name: "Projects" })).toBeInTheDocument();
  });

  it("missing: focus checks again once, then waits (30 s) even if focus keeps coming back", async () => {
    const calls = fake("missing");
    render(<App />);
    await waitFor(() => expect(calls.status).toBe(1));
    for (let i = 0; i < 6; i++) act(() => { window.dispatchEvent(new Event("focus")); });
    await new Promise((r) => setTimeout(r, 150));
    expect(calls.status).toBe(1);   // the start-up check was under 30 s ago, so none of the six focus events started another
  });
});
