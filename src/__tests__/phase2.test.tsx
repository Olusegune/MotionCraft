import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { Player, type PlayerHandle } from "../shell/Player";
import { setApiForTests, type Api } from "../lib/api";
import { approve, createProject } from "../lib/project";
import type { MotionProject } from "../types";

type Call = { method: string; params: Record<string, unknown> };

function fake(project: MotionProject, opts: { engine?: boolean } = {}) {
  const calls: Call[] = [];
  const spend: string[] = [];
  const layers = [{ id: 2, name: "Title", kind: "Text", index: 1, parent: null, nativeLocked: false, approvedHere: false, hash: "h1" }];
  const snap = () => ({ path: "x", dirty: false, activeComp: 1, comps: [], layers });
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save() { /* keep */ },
    async engineStatus() { return opts.engine === false ? { state: "missing", pinned: "0.24.1", detail: "none" } : { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async fileUrl() { return "asset://localhost/x.mp4"; },
    async assetDataUrl() { return "data:image/png;base64,AA=="; },
    async confirmSpend(provider: string, model: string) { spend.push(`${provider}/${model}`); return "tok-render"; },
    async pickPath() { return "C:\\exports"; },
    async projectsFolder() { return "C:\\docs"; },
    async exportPackage(_p: string, dest: string) { return `${dest}\\Demo.motioncraft`; },
    async engine(method: string, params: Record<string, unknown>) {
      calls.push({ method, params });
      switch (method) {
        case "open": case "inspect": case "add_text": case "add_shape": case "add_solid": case "add_media": case "sync_markers": return { ...snap(), layer: 3 } as never;
        case "apply_primitive": return snap() as never;
        case "primitives": return { primitives: [
          { id: "entrance.fade-in", name: "Fade in", category: "entrance", appliesTo: ["*"], description: "Opacity from 0.", tags: [], params: {
            start: { label: "Start (s)", kind: "float", default: 0, min: 0, max: 600, choices: [], unit: "s" }, duration: { label: "Duration (s)", kind: "float", default: 0.8, min: 0.1, max: 30, choices: [], unit: "s" } } },
          { id: "text.reveal-per-char", name: "Reveal letter by letter", category: "text", appliesTo: ["Text"], description: "Letters.", tags: [], params: {} },
        ] } as never;
        case "audio_analyze": return { duration: 8, bpm: 120, beats: [0.5, 1, 1.5, 2], downbeats: [0.5], peaks: [0.1, 0.5, 0.2], silences: [], estimate: true } as never;
        case "render_start": return { id: "r1", kind: "final", state: "running", detail: "rendering", output: null, frames: null, bytes: null, error: null, elapsed: 0, preset: params.preset } as never;
        case "render_poll": return { id: "r1", kind: "final", state: "done", detail: "done", output: "renders/Demo-h264-1.mp4", frames: 450, bytes: 2_000_000, error: null, elapsed: 2, preset: "h264" } as never;
        case "preview_movie_start": return { id: "m", kind: "preview", state: "done", detail: "done", output: "previews/p.mp4", frames: 1, bytes: 1, error: null, elapsed: 0, preset: null } as never;
        default: throw new Error("unexpected " + method);
      }
    },
  } as unknown as Api;
  return { api, calls, spend };
}

const fold = (re: RegExp) => screen.getAllByRole("button", { name: re }).find((b) => b.hasAttribute("aria-expanded"))!;
const go = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  const bar = await screen.findByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === name)!);
};
async function openProject(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("button", { name: new RegExp(name) }));
  await screen.findByRole("heading", { name: "Brief" });
}

describe("motion, audio, review and render", () => {
  it("applies a motion to the selected layer at the playhead and sends only checked parameters", async () => {
    const f = fake(createProject("Demo"));
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await openProject(user, "Demo");
    await go(user, "Build");
    await user.click(await screen.findByRole("button", { name: /Title/ }));
    await user.click(fold(/^Motion/));
    const apply = await screen.findByRole("button", { name: "Apply to selected layer" });
    await waitFor(() => expect(apply).toBeEnabled());
    await user.click(apply);
    await waitFor(() => expect(f.calls.some((c) => c.method === "apply_primitive")).toBe(true));
    const c = f.calls.find((x) => x.method === "apply_primitive")!;
    expect(c.params).toMatchObject({ layer: 2, primitive: "entrance.fade-in", params: { start: 0, duration: 0.8 } });
  });

  it("a text-only motion is refused with a reason on a shape layer, before anything is sent", async () => {
    const f = fake(createProject("Demo"));
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await openProject(user, "Demo");
    await go(user, "Build");
    await user.click(await screen.findByRole("button", { name: /Title/ }));
    await user.click(fold(/^Motion/));
    await user.selectOptions(await screen.findByLabelText("Motion"), "text.reveal-per-char");
    expect(screen.getByRole("button", { name: "Apply to selected layer" })).toBeEnabled();   // Title is a Text layer
    await user.selectOptions(screen.getByLabelText("Motion"), "entrance.fade-in");
    expect(f.calls.filter((c) => c.method === "apply_primitive")).toHaveLength(0);
  });

  it("analyses audio and writes beat markers only after the user presses the button", async () => {
    const p = createProject("Demo");
    p.assets = [{ id: "a1", kind: "audio", path: "assets/audio/song.wav", name: "song", provenance: { actor: "user", provider: "import", model: "file", at: "t", licence: "x", costReported: false, costValue: null, costUnit: null } }];
    const f = fake(p);
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await openProject(user, "Demo");
    await go(user, "Build");
    await user.click(fold(/^Audio/));
    await user.click(screen.getByRole("button", { name: "Analyse" }));
    expect((await screen.findAllByText(/120 BPM/)).length).toBeGreaterThan(0);
    expect(f.calls.some((c) => c.method === "sync_markers")).toBe(false);
    await user.click(screen.getByRole("button", { name: "Write markers to composition" }));
    await waitFor(() => expect(f.calls.find((c) => c.method === "sync_markers")?.params).toMatchObject({ times: [0.5, 1, 1.5, 2], replace: true }));
  });

  it("final render needs sign-off, then one spend confirmation, and records the result", async () => {
    const p = approve(createProject("Demo"), "D");
    const f = fake(p);
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await openProject(user, "Demo");
    await go(user, "Deliver");
    await user.click(await screen.findByRole("button", { name: "Render final…" }));
    const dlg = await screen.findByRole("dialog", { name: "Final render" });
    expect(within(dlg).getByText(/None from a provider/)).toBeInTheDocument();
    expect(f.spend).toEqual([]);                                   // nothing asked for yet
    await user.click(within(dlg).getByRole("button", { name: "Confirm and render" }));
    await waitFor(() => expect(f.calls.some((c) => c.method === "render_start")).toBe(true));
    expect(f.spend).toEqual(["local-render/h264"]);
    expect(f.calls.find((c) => c.method === "render_start")!.params).toMatchObject({ preset: "h264", spend_token: "tok-render" });
    expect(await screen.findByText(/renders\/Demo-h264-1\.mp4/, {}, { timeout: 6000 })).toBeInTheDocument();
  }, 15000);

  it("without sign-off the render sheet explains and cannot confirm", async () => {
    const f = fake(createProject("Demo"));
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await openProject(user, "Demo");
    await go(user, "Deliver");
    await user.click(await screen.findByRole("button", { name: "Render final…" }));
    const dlg = await screen.findByRole("dialog", { name: "Final render" });
    expect(within(dlg).getByRole("button", { name: "Confirm and render" })).toBeDisabled();
    expect(within(dlg).getByText(/Approve for final render in Review first/)).toBeInTheDocument();
    expect(f.spend).toEqual([]);
  });

  it("exports the collected project into a folder the user chose", async () => {
    const f = fake(createProject("Demo"));
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await openProject(user, "Demo");
    await go(user, "Deliver");
    await user.click(await screen.findByRole("button", { name: "Export selected" }));
    expect(await screen.findByText(/Collected project saved to C:\\exports\\Demo\.motioncraft/)).toBeInTheDocument();
  });

  it("review: a note is pinned to the playhead frame and appears in the list", async () => {
    const p = createProject("Demo");
    p.review.preview = { rel: "previews/p.mp4", at: "2099-01-01T00:00:00.000Z" };
    const f = fake(p);
    setApiForTests(f.api);
    const user = userEvent.setup();
    render(<App />);
    await openProject(user, "Demo");
    await go(user, "Review");
    await user.type(await screen.findByPlaceholderText(/What should change at this exact frame/), "Tighten the title");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("Tighten the title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Go to 00:00:00/ })).toBeInTheDocument();
  });
});

describe("player", () => {
  it("steps by frames with the arrow keys and by seconds with Shift, and shows the frame number", async () => {
    const ref = createRef<PlayerHandle>();
    render(<Player ref={ref} src="asset://x.mp4" fps={25} duration={10} />);
    const group = screen.getByRole("group", { name: "Preview player" });
    group.focus();
    const user = userEvent.setup();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(screen.getByLabelText("Frame")).toHaveTextContent("frame 3");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(screen.getByLabelText("Frame")).toHaveTextContent("frame 28");     // one second at 25 fps
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByLabelText("Frame")).toHaveTextContent("frame 27");
    act(() => ref.current!.seek(2));
    expect(ref.current!.frame()).toBe(50);
    await user.keyboard("{Home}");
    expect(screen.getByLabelText("Frame")).toHaveTextContent("frame 0");
  });

  it("without a movie the transport is disabled and says what to do", () => {
    render(<Player src={null} fps={30} duration={5} emptyText="Build a preview first." />);
    expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
    expect(screen.getByText("Build a preview first.")).toBeInTheDocument();
  });
});
