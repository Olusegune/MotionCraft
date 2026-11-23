import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { approve, createProject } from "../lib/project";
import type { RenderJob } from "../pages/build/usePreview";
import type { MotionProject } from "../types";

const job = (over: Partial<RenderJob> & { id: string }): RenderJob => ({
  kind: "final", state: "interrupted", detail: "interrupted", output: null, frames: null, bytes: null, error: "Cancelled.", elapsed: 4, preset: "h264",
  resumable: true, reason: "", parts: { done: 12, total: 30 }, framesDone: 720, framesTotal: 1800, ...over,
});

interface Opts { unfinished?: RenderJob[]; start?: RenderJob; resume?: RenderJob; poll?: RenderJob[] }

function fake(project: MotionProject, o: Opts = {}) {
  const log = { calls: [] as { method: string; params: Record<string, unknown> }[], spend: [] as string[], unfinished: [...(o.unfinished ?? [])] };
  const polls = [...(o.poll ?? [])];
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save() { /* keep */ },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async startupStep() { /* unused */ },
    async uncleanSession() { return null; },
    async sessionBegin() { /* unused */ },
    async sessionEnd() { /* unused */ },
    async fileUrl() { return "asset://x.mp4"; },
    async confirmSpend(provider: string, model: string) { log.spend.push(`${provider}/${model}`); return `tok-${log.spend.length}`; },
    async engine(method: string, params: Record<string, unknown>) {
      log.calls.push({ method, params });
      switch (method) {
        case "llm_status": return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        case "render_jobs": return { jobs: log.unfinished } as never;
        case "render_start": return (o.start ?? job({ id: "aaaaaaaaaaaa", state: "running", detail: "part 1 of 30", error: null, parts: { done: 0, total: 30 }, framesDone: 0 })) as never;
        case "render_resume": return (o.resume ?? job({ id: params.job as string, state: "running", detail: "resuming", error: null })) as never;
        case "render_poll": return (polls.shift() ?? job({ id: params.job as string, state: "running", error: null })) as never;
        case "render_cancel": return job({ id: params.job as string, state: "running", detail: "stopping", error: null }) as never;
        case "render_discard": log.unfinished = log.unfinished.filter((u) => u.id !== params.job); return { discarded: params.job } as never;
        default: return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      }
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

const signed = () => approve(createProject("Render demo"), "D");

async function toDeliver(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Render demo"));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Deliver") as HTMLElement);
  await screen.findByRole("heading", { name: "Deliver" });
}

describe("render with resume (P5-02, AT-13)", () => {
  it("shows the parts as they finish, offers Cancel, and says an interruption can be resumed", async () => {
    const user = userEvent.setup();
    const log = fake(signed(), { poll: [job({ id: "aaaaaaaaaaaa", state: "running", detail: "part 13 of 30", error: null, parts: { done: 12, total: 30 }, framesDone: 720 })] });
    render(<App />);
    await toDeliver(user);
    await user.click(screen.getByRole("button", { name: "Render final…" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and render" }));
    expect(await screen.findByText(/Rendering…/)).toBeInTheDocument();
    expect(screen.getByText(/only the missing part is rendered again/)).toBeInTheDocument();
    await screen.findByText(/12 of 30 parts finished/, undefined, { timeout: 4000 });   // the page polls once a second
    expect(screen.getByLabelText("Render progress")).toHaveAttribute("max", "1800");
    expect(log.calls.find((c) => c.method === "render_start")!.params).toMatchObject({ preset: "h264", has_audio: false, spend_token: "tok-1" });
    expect(log.calls.filter((c) => c.method === "open").length).toBeGreaterThan(0);   // Deliver opens the composition itself
    await user.click(screen.getByRole("button", { name: "Cancel render" }));
    expect(log.calls.find((c) => c.method === "render_cancel")!.params).toEqual({ job: "aaaaaaaaaaaa" });
  });

  it("tells the engine when the project has audio, and shows why a render cannot be resumed", async () => {
    const user = userEvent.setup();
    const p = signed();
    p.assets = [{ id: "au", kind: "audio", path: "assets/audio/a.wav", provenance: { actor: "user", provider: "import", model: "", at: "t", licence: "", costReported: false, costValue: null, costUnit: null } }];
    const log = fake(p, { start: job({ id: "bbbbbbbbbbbb", state: "running", detail: "rendering", error: null, parts: null, resumable: false, reason: "This project has audio. Joining parts could glitch the sound, so it renders in one piece and cannot be resumed." }) });
    render(<App />);
    await toDeliver(user);
    await user.click(screen.getByRole("button", { name: "Render final…" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and render" }));
    expect(await screen.findByText(/cannot be resumed/)).toBeInTheDocument();
    expect(log.calls.find((c) => c.method === "render_start")!.params.has_audio).toBe(true);
    expect(screen.queryByRole("button", { name: "Resume render" })).not.toBeInTheDocument();
  });

  it("an unfinished render found on disk can be resumed: a fresh confirmation, then only the missing part", async () => {
    const user = userEvent.setup();
    const log = fake(signed(), { unfinished: [job({ id: "cccccccccccc" })] });
    render(<App />);
    await toDeliver(user);
    const sec = await screen.findByRole("heading", { name: "Unfinished renders" });
    const item = sec.closest("section")!;
    expect(item).toHaveTextContent("12 of 30 parts finished (720 of 1800 frames)");
    expect(item).toHaveTextContent("Cancelled.");
    await user.click(within(item).getByRole("button", { name: "Resume the h264 render" }));
    const dlg = await screen.findByRole("dialog", { name: "Resume render" });
    expect(dlg).toHaveTextContent("12 of 30 parts are already finished");
    expect(log.calls.some((c) => c.method === "render_resume")).toBe(false);       // nothing yet: it waits for the click
    await user.click(within(dlg).getByRole("button", { name: "Confirm and resume" }));
    await waitFor(() => expect(log.calls.some((c) => c.method === "render_resume")).toBe(true));
    expect(log.calls.find((c) => c.method === "render_resume")!.params).toEqual({ job: "cccccccccccc", spend_token: "tok-1" });
    expect(log.spend).toEqual(["local-render/h264"]);
    expect(await screen.findByText(/Rendering…/)).toBeInTheDocument();
  });

  it("a render of an older version of the project cannot be resumed, only discarded", async () => {
    const user = userEvent.setup();
    const log = fake(signed(), { unfinished: [job({ id: "dddddddddddd", changed: true })] });
    render(<App />);
    await toDeliver(user);
    const item = (await screen.findByRole("heading", { name: "Unfinished renders" })).closest("section")!;
    expect(item).toHaveTextContent("The project changed since this render started");
    expect(within(item).getByRole("button", { name: "Resume the h264 render" })).toBeDisabled();
    await user.click(within(item).getByRole("button", { name: "Discard the h264 render" }));
    const dlg = await screen.findByRole("dialog", { name: "Discard this render" });
    expect(dlg).toHaveTextContent("Nothing else is touched");
    await user.click(within(dlg).getByRole("button", { name: "Discard the finished parts" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Unfinished renders" })).not.toBeInTheDocument());
    expect(log.calls.find((c) => c.method === "render_discard")!.params).toEqual({ job: "dddddddddddd" });
  });

  it("a render that was just interrupted offers Resume and Discard on the spot", async () => {
    const user = userEvent.setup();
    fake(signed(), { poll: [job({ id: "aaaaaaaaaaaa", state: "interrupted", error: "the engine crashed", detail: "interrupted" })] });
    render(<App />);
    await toDeliver(user);
    await user.click(screen.getByRole("button", { name: "Render final…" }));
    await user.click(await screen.findByRole("button", { name: "Confirm and render" }));
    expect(await screen.findByText("Render interrupted", undefined, { timeout: 4000 })).toBeInTheDocument();
    expect(await screen.findByText("the engine crashed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume render" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Discard" })).toBeEnabled();
  });
});
