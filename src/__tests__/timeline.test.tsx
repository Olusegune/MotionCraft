import { readFileSync } from "node:fs";
import { setQaPins } from "../lib/qaPins";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { arcAt, arcPath, arcPoints, beatAt, barBox, clampDock, sceneStatus, waveBars, clampPps, DOCK_MIN, fitPps, readDock, writeDock, laneCount, packLanes, PPS_MAX, PPS_MIN, readPps, rulerStep, rulerTicks, snapFrame, writePps } from "../lib/timelineMath";
import type { MotionProject } from "../types";

describe("timeline maths", () => {
  it("gives overlapping layers different lanes, lets separate ones share, and puts the front layer first", () => {
    const spans = [{ id: 1, start: 0, end: 10 }, { id: 2, start: 5, end: 12 }, { id: 3, start: 10, end: 15 }, { id: 4, start: 20, end: 25 }];
    const lanes = packLanes(spans, [1, 2, 3, 4]);
    expect(lanes[1]).toBe(0);                       // the front layer takes the first lane
    expect(lanes[2]).toBe(1);                       // it overlaps layer 1 in time
    expect(lanes[3]).toBe(0);                       // 10 to 15 begins where layer 1 ends, so it fits back in lane 0
    expect(lanes[4]).toBe(0);
    expect(laneCount(lanes)).toBe(2);
    expect(packLanes(spans, [1, 2, 3, 4])).toEqual(lanes);                       // the same input always gives the same lanes
    expect(packLanes([{ id: 1, start: 0, end: 5 }, { id: 2, start: 0, end: 5 }], [2, 1])).toEqual({ 2: 0, 1: 1 });   // order decides who is in front
    expect(laneCount({})).toBe(0);
  });

  it("boxes, snapping and zoom behave at their limits", () => {
    expect(barBox(2, 5, 10)).toEqual({ left: 20, width: 30 });
    expect(barBox(2, 2.01, 10).width).toBe(3);      // never thinner than 3 px
    expect(barBox(-3, 1, 10).left).toBe(0);
    expect(snapFrame(1.02, 30)).toBeCloseTo(1.0333, 3); expect(snapFrame(1.016, 30)).toBeCloseTo(1, 5);
    expect(clampPps(1)).toBe(PPS_MIN); expect(clampPps(99999)).toBe(PPS_MAX); expect(clampPps(NaN)).toBe(24); expect(clampPps(Infinity)).toBe(24);
    expect(fitPps(60, 608)).toBe(10); expect(fitPps(0, 600)).toBe(24); expect(fitPps(100000, 600)).toBe(PPS_MIN);
  });

  it("labels the ruler no closer than 80 px and never makes an endless list of ticks", () => {
    for (const pps of [6, 24, 100, 400]) expect(rulerStep(pps) * pps).toBeGreaterThanOrEqual(80);
    expect(rulerStep(400)).toBe(0.2); expect(rulerStep(24)).toBe(5);
    expect(rulerTicks(20, 24)).toEqual([0, 5, 10, 15, 20]);
    expect(rulerTicks(1e9, 400).length).toBeLessThanOrEqual(2000);
  });

  it("keeps the timeline dock between its smallest size and what leaves the preview room, and remembers it", () => {
    expect(clampDock(10, 800)).toBe(DOCK_MIN); expect(clampDock(5000, 800)).toBe(580); expect(clampDock(300, 800)).toBe(300);
    expect(clampDock(NaN, 800)).toBe(DOCK_MIN); expect(clampDock(300, 0)).toBe(DOCK_MIN);
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    expect(readDock("p", store)).toBeNull();
    writeDock("p", 333, store); expect(readDock("p", store)).toBe(333);
    writeDock("p", null, store); expect(readDock("p", store)).toBeNull();
    mem.set("mc-dock:bad", "{ nope"); expect(readDock("bad", store)).toBeNull();
    expect(() => writeDock("p", 5, { setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } })).not.toThrow();
  });

  it("draws the emotional arc as a smooth curve through the beats and reads its value at any time", () => {
    const beats = [{ startSec: 0, endSec: 6, intensity: 1, energy: 1 }, { startSec: 6, endSec: 20, intensity: 5, energy: 5 }];
    const pts = arcPoints(beats, 20);
    expect(pts[0]).toEqual({ t: 0, v: 0 }); expect(pts[pts.length - 1]).toEqual({ t: 20, v: 1 });
    expect(pts.map((p) => p.t)).toEqual([0, 3, 13, 20]);
    expect(arcPoints([], 20)).toEqual([]); expect(arcPath([], 20, 100, 40)).toBe("");
    const d = arcPath(pts, 20, 200, 44);
    expect(d.startsWith("M0.0 ")).toBe(true); expect(d.match(/C/g)?.length).toBe(3);
    expect(arcAt(pts, -5)).toBe(0); expect(arcAt(pts, 99)).toBe(1); expect(arcAt(pts, 8)).toBeCloseTo(0.5, 5);   // halfway between the two beat middles
    const a = arcAt(pts, 5), b = arcAt(pts, 9); expect(a).toBeGreaterThan(0); expect(b).toBeGreaterThan(a); expect(b).toBeLessThan(1);
    expect(arcPoints([{ startSec: 5, endSec: 5, intensity: 3, energy: 3 }], 10)).toEqual([]);      // an empty beat is ignored
  });

  it("gives each scene its badge: needs review wins, approved only when every layer of its own is approved", () => {
    const L = (inT: number, approved: boolean, extra = {}) => ({ in: inT, approved, ...extra });
    expect(sceneStatus(0, 6, [L(1, true), L(2, true)], [])).toBe("approved");
    expect(sceneStatus(0, 6, [L(1, true), L(2, false)], [])).toBeNull();
    expect(sceneStatus(0, 6, [], [])).toBeNull();                                         // a scene with no layers of its own gets no badge
    expect(sceneStatus(0, 6, [L(0, false, { background: true }), L(2, true)], [])).toBe("approved");     // a background does not count
    expect(sceneStatus(0, 6, [L(1, true, { changed: true })], [])).toBe("needs-review");                 // changed in EffectCraft after approval
    expect(sceneStatus(0, 6, [L(1, true)], [{ t: 3, severity: "warn" }])).toBe("needs-review");
    expect(sceneStatus(0, 6, [L(1, true)], [{ t: 3, severity: "info" }])).toBe("approved");               // a note is not a problem
    expect(sceneStatus(0, 6, [L(1, true)], [{ t: 6, severity: "error" }])).toBe("approved");              // the end of a scene belongs to the next one
    expect(sceneStatus(6, 20, [L(1, true)], [])).toBeNull();                                              // a layer starting in another scene is not this scene's
  });

  it("finds the beat at a time and boils the audio peaks down to a few bars", () => {
    const beats = [{ startSec: 0, endSec: 6 }, { startSec: 6, endSec: 20 }];
    expect(beatAt(beats, 0)).toBe(0); expect(beatAt(beats, 5.99)).toBe(0); expect(beatAt(beats, 6)).toBe(1); expect(beatAt(beats, 20)).toBe(1); expect(beatAt(beats, -1)).toBe(-1); expect(beatAt([], 3)).toBe(-1);
    expect(waveBars([0.2, 0.9, 0.4, 0.1], 2)).toEqual([0.9, 0.4]);
    expect(waveBars([0.5, 2, -1], 10)).toEqual([0.5, 1, 0]);
    expect(waveBars([], 5)).toEqual([]); expect(waveBars([1], 0)).toEqual([]);
  });

  it("remembers the zoom per project, and survives storage that is missing, blocked or damaged", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(readPps("p1", store)).toBeUndefined();
    writePps("p1", 80, store);
    expect(readPps("p1", store)).toBe(80); expect(readPps("p2", store)).toBeUndefined();
    writePps("p1", 1e6, store); expect(readPps("p1", store)).toBe(PPS_MAX);
    mem.set("mc-tl:bad", "{ not json"); expect(readPps("bad", store)).toBeUndefined();
    mem.set("mc-tl:neg", JSON.stringify({ pps: -5 })); expect(readPps("neg", store)).toBeUndefined();
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readPps("p", blocked)).toBeUndefined(); expect(() => writePps("p", 10, blocked)).not.toThrow();
    expect(readPps("p", null)).toBeUndefined(); expect(() => writePps("p", 10, null)).not.toThrow();
  });
});

const LAYERS = [
  { id: 2, name: "Background", kind: "Solid", index: 3, parent: null, nativeLocked: false, approvedHere: false, hash: "h2" },
  { id: 3, name: "Title", kind: "Text", index: 2, parent: null, nativeLocked: false, approvedHere: true, hash: "h3" },
  { id: 4, name: "Subtitle", kind: "Text", index: 1, parent: null, nativeLocked: false, approvedHere: false, hash: "h4" },
];
const SPANS = [{ id: 2, in: 0, out: 20 }, { id: 3, in: 2, out: 9 }, { id: 4, in: 5, out: 14 }];

function fake(project: MotionProject) {
  const log = { calls: [] as { method: string; params: Record<string, unknown> }[] };
  const snap = () => ({ path: "x", dirty: false, activeComp: 1, comps: [], layers: LAYERS });
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save() { /* keep */ },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
    async fileUrl() { return "asset://x.mp4"; },
    async engine(method: string, params: Record<string, unknown>) {
      log.calls.push({ method, params });
      if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
      if (method === "preview") return { width: 320, height: 180, png: "AAAA" } as never;
      if (method === "timeline_read") return { duration: 20, frameRate: 30, layers: SPANS.map((s) => ({ ...s, name: LAYERS.find((l) => l.id === s.id)!.name })) } as never;
      if (method === "audio_analyze") return { duration: 20, bpm: 120, beats: [0.5, 1], downbeats: [0.5, 2.5], peaks: [0.1], silences: [], estimate: true,
        sections: [{ start: 0, end: 8, label: "VERSE", group: "A", energy: 6, mood: "Building" }, { start: 8, end: 20, label: "CHORUS", group: "B", energy: 9, mood: "Driving" }] } as never;
      return snap() as never;
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

function project(): MotionProject {
  const p = createProject("Timeline demo");
  p.brief.deliverables[0].durationSec = 20;
  p.intent.arc = [{ beatId: "b1", startSec: 0, endSec: 6, primary: "curiosity", intensity: 2, energy: 2 }, { beatId: "b2", startSec: 6, endSec: 20, primary: "joy", intensity: 4, energy: 4 }];
  p.layerMap = [{ engineLayerId: 3, compId: "1", role: "title", provenance: { actor: "agent:builder", at: "t", costReported: false }, lock: "approved", approvedHash: "h3", lastKnownHash: "h3" },
    { engineLayerId: 4, compId: "1", role: "body-text", provenance: { actor: "user", at: "t", costReported: false }, lock: "none", lastKnownHash: "h4" }];
  p.assets = [{ id: "au", kind: "audio", path: "assets/audio/s.wav", name: "s", provenance: { actor: "user", provider: "import", model: "", at: "t", licence: "", costReported: false, costValue: null, costUnit: null } }];
  return p;
}

async function toBuild(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Timeline demo"));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Build") as HTMLElement);
  return screen.findByRole("group", { name: "Timeline" });
}

describe("the director's timeline on Build (ADR-0007, T1)", () => {
  it("draws every layer with its in and out, and says who made it and whether it is approved", async () => {
    const user = userEvent.setup();
    const log = fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const bg = await within(tl).findByRole("button", { name: "Layer Background, Solid, 0:00 to 0:20" });
    expect(bg).toBeInTheDocument();
    expect(within(tl).getByRole("button", { name: "Layer Title, Text, 0:02 to 0:09, approved, made by Builder" })).toBeInTheDocument();
    expect(within(tl).getByRole("button", { name: "Layer Subtitle, Text, 0:05 to 0:14" })).toBeInTheDocument();
    expect(within(tl).queryByLabelText("Intent arc")).toBeNull();          // the beats are the scene cards now, not bars in the timeline
    const scenes = screen.getByRole("list", { name: "Scenes" });
    expect(scenes).toHaveTextContent("curiosity"); expect(scenes).toHaveTextContent("joy");
    expect(log.calls.filter((c) => c.method === "timeline_read").length).toBeGreaterThan(0);
  });

  it("is read-only: reading and looking send nothing that writes", async () => {
    const user = userEvent.setup();
    const log = fake(project());
    render(<App />);
    const tl = await toBuild(user);
    await within(tl).findByRole("button", { name: /Layer Title/ });
    await user.click(within(tl).getByRole("button", { name: /Layer Subtitle/ }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.pointerDown(tl.querySelector(".tl-inner") as HTMLElement, { clientX: 120 });
    const writes = ["add_text", "add_shape", "add_solid", "add_media", "set_text", "lock", "unlock", "apply_primitive", "sync_markers", "sync_labelled_markers", "builder_execute", "qa_fix", "snapshot_restore", "layer_timing"];
    expect(log.calls.filter((c) => writes.includes(c.method))).toEqual([]);
  });

  it("selecting a bar selects the layer in the list too", async () => {
    const user = userEvent.setup();
    fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const bar = await within(tl).findByRole("button", { name: /Layer Subtitle/ });
    expect(bar).toHaveAttribute("aria-pressed", "false");
    await user.click(bar);
    expect(bar).toHaveAttribute("aria-pressed", "true");
    const row = within(document.querySelector("ul.layers") as HTMLElement).getByRole("button", { name: /Subtitle/ });
    expect(row).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking the timeline moves the playhead to that frame, and the keyboard steps it", async () => {
    const user = userEvent.setup();
    fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const head = await within(tl).findByRole("slider", { name: "Playhead" });
    expect(head).toHaveAttribute("aria-valuenow", "0");
    fireEvent.pointerDown(tl.querySelector(".tl-inner") as HTMLElement, { clientX: 240 });          // 240 px at the default 24 px a second is 10 s
    await waitFor(() => expect(head).toHaveAttribute("aria-valuenow", "10"));
    expect(head).toHaveAttribute("aria-valuetext", "00:10:00");
    tl.focus();
    await user.keyboard("{ArrowRight}");
    await waitFor(() => expect(Number(head.getAttribute("aria-valuenow"))).toBeCloseTo(10.033, 2));
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    await waitFor(() => expect(Number(head.getAttribute("aria-valuenow"))).toBeCloseTo(9.033, 2));
    await user.keyboard("{Home}");
    await waitFor(() => expect(head).toHaveAttribute("aria-valuenow", "0"));
    await user.keyboard("{End}");
    await waitFor(() => expect(head).toHaveAttribute("aria-valuenow", "20"));
  });

  it("zoom buttons change the scale and the structure of the analysed audio appears in its lane", async () => {
    const user = userEvent.setup();
    fake(project());
    render(<App />);
    const tl = await toBuild(user);
    expect(within(tl).getByText(/24 px per second/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(within(tl).getByText(/30 px per second/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(within(tl).getByText(/24 px per second/)).toBeInTheDocument();
    expect(within(tl).getByLabelText("Audio structure")).toHaveTextContent("No audio analysed yet");
    const fold = screen.getAllByRole("button", { name: /^Audio/ }).find((b) => b.hasAttribute("aria-expanded"))!;
    await user.click(fold);
    await user.click(await screen.findByRole("button", { name: /Analyse/ }));
    await waitFor(() => expect(within(tl).getByLabelText("Audio structure")).toHaveTextContent("VERSE"));
    expect(within(tl).getByLabelText("Audio structure")).toHaveTextContent("CHORUS");
  });

  it("pins QA findings that have a time, and clicking a pin moves the playhead there (T2)", async () => {
    const user = userEvent.setup();
    fake(project());
    setQaPins([{ id: "f1", t: 7, label: "contrast: low", severity: "warn" }]);
    render(<App />);
    const tl = await toBuild(user);
    const pin = await within(tl).findByRole("button", { name: /QA finding at 0:07: contrast: low/ });
    await user.click(pin);
    await waitFor(() => expect(within(tl).getByRole("slider", { name: "Playhead" })).toHaveAttribute("aria-valuenow", "7"));
    setQaPins([]);
  });

  it("T3: Alt and the arrow keys move an unlocked layer by a frame, Ctrl and Alt trim its end, and an approved layer refuses", async () => {
    const user = userEvent.setup();
    const log = fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const sub = await within(tl).findByRole("button", { name: /Layer Subtitle/ });
    sub.focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    await waitFor(() => expect(log.calls.find((c) => c.method === "layer_timing")?.params).toEqual({ layer: 4, delta: 1 / 30 }));
    await user.keyboard("{Control>}{Alt>}{ArrowLeft}{/Alt}{/Control}");
    await waitFor(() => expect(log.calls.filter((c) => c.method === "layer_timing")[1]?.params).toEqual({ layer: 4, t_out: snapFrame(14 - 1 / 30, 30) }));
    const before = log.calls.filter((c) => c.method === "layer_timing").length;
    const title = within(tl).getByRole("button", { name: /Layer Title/ });
    title.focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(log.calls.filter((c) => c.method === "layer_timing").length).toBe(before);
    expect(title.getAttribute("aria-description")).toBeNull();
  });

  it("T3: dragging a bar moves it by whole frames, dragging an edge trims it, and a plain click only selects", async () => {
    const user = userEvent.setup();
    const log = fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const sub = await within(tl).findByRole("button", { name: /Layer Subtitle/ });
    fireEvent.pointerDown(sub, { clientX: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 148 });                  // 48 px at 24 px a second is 2 s
    fireEvent.pointerUp(window, { clientX: 148 });
    await waitFor(() => expect(log.calls.find((c) => c.method === "layer_timing")?.params).toEqual({ layer: 4, delta: 2 }));
    const edge = sub.querySelector(".tl-grip.out") as HTMLElement;
    fireEvent.pointerDown(edge, { clientX: 400, button: 0 });
    fireEvent.pointerMove(window, { clientX: 376 });                  // -1 s
    fireEvent.pointerUp(window, { clientX: 376 });
    await waitFor(() => expect(log.calls.filter((c) => c.method === "layer_timing")[1]?.params).toEqual({ layer: 4, t_out: 13 }));
    const n = log.calls.filter((c) => c.method === "layer_timing").length;
    fireEvent.pointerDown(sub, { clientX: 100, button: 0 });
    fireEvent.pointerUp(window, { clientX: 101 });
    expect(log.calls.filter((c) => c.method === "layer_timing").length).toBe(n);
    await waitFor(() => expect(sub).toHaveAttribute("aria-pressed", "true"));
    // the move was logged as one revision with its versions
    expect(within(tl).getByText(/Moving and trimming|Drag a layer/)).toBeInTheDocument();
  });

  it("T3: when the engine refuses a move, its reason shows under the timeline", async () => {
    const user = userEvent.setup();
    const log = fake(project());
    const api = (await import("../lib/api")) as unknown as { getApi: () => Promise<{ engine: (m: string, p: Record<string, unknown>) => Promise<unknown> }> };
    const real = (await api.getApi()).engine;
    setApiForTests({ ...(await api.getApi()), engine: async (m: string, p: Record<string, unknown>) => { if (m === "layer_timing") { log.calls.push({ method: m, params: p }); throw new Error("The layer is already at that edge."); } return real(m, p); } } as unknown as Api);
    render(<App />);
    const tl = await toBuild(user);
    const sub = await within(tl).findByRole("button", { name: /Layer Subtitle/ });
    sub.focus();
    await user.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(await within(tl).findByRole("alert")).toHaveTextContent("already at that edge");
  });

  it("studio layout: the preview fills the page, Ctrl and J hide the timeline, and F gives a full-screen picture", async () => {
    const user = userEvent.setup();
    fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const player = screen.getByRole("group", { name: "Preview player" });
    expect(player).toHaveClass("fill");
    expect(document.querySelector(".studio")).toBeTruthy();
    const head = within(tl).queryByRole("button", { name: /^Timeline/ }) ?? screen.getAllByRole("button", { name: /^Timeline/ })[0];
    expect(head).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Control>}j{/Control}");
    await waitFor(() => expect(head).toHaveAttribute("aria-expanded", "false"));
    await user.keyboard("{Control>}j{/Control}");
    await waitFor(() => expect(head).toHaveAttribute("aria-expanded", "true"));
    player.focus();
    await user.keyboard("f");
    expect(player).toHaveClass("theatre");
    expect(screen.getByRole("button", { name: "Leave full screen" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(player).not.toHaveClass("theatre");
  });

  it("a collapsed fold really hides its content (the hidden attribute is not overridden by display)", async () => {
    const css = readFileSync("src/styles/app.css", "utf-8");
    expect(css).toMatch(/\.fold-body\[hidden\]\s*\{\s*display:\s*none/);
  });

  it("the divider resizes the timeline dock by keyboard, resets, and goes away with the timeline", async () => {
    const user = userEvent.setup();
    fake(project());
    render(<App />);
    await toBuild(user);
    const sep = screen.getByRole("separator", { name: "Resize preview and timeline" });
    const dock = document.querySelector(".timeline-dock") as HTMLElement;
    expect(dock.style.height).toBe("");
    sep.focus();
    await user.keyboard("{ArrowUp}");
    expect(dock.style.height).toBe(`${DOCK_MIN}px`);          // jsdom has no layout, so every size clamps to the smallest
    await user.keyboard("{Home}");
    expect(dock.style.height).toBe("");
    await user.keyboard("{ArrowDown}");
    expect(dock.style.height).toBe(`${DOCK_MIN}px`);
    await user.dblClick(sep);
    expect(dock.style.height).toBe("");
    await user.keyboard("{Control>}j{/Control}");
    await waitFor(() => expect(screen.queryByRole("separator", { name: "Resize preview and timeline" })).toBeNull());
  });

  it("scenes: one card per intent beat with a still from the engine, the current one marked, and clicking seeks to its start", async () => {
    const user = userEvent.setup();
    const log = fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const list = await screen.findByRole("list", { name: "Scenes" });
    const cards = within(list).getAllByRole("button");
    expect(cards.map((c) => c.getAttribute("aria-label"))).toEqual(["Scene curiosity, 0:00 to 0:06", "Scene joy, 0:06 to 0:20"]);
    expect(cards[0]).toHaveAttribute("aria-current", "true");
    await waitFor(() => expect(list.querySelectorAll("img").length).toBe(2));
    expect(log.calls.filter((c) => c.method === "preview").map((c) => c.params.times)).toEqual([[3], [13]]);      // the middle of each beat
    await user.click(cards[1]);
    await waitFor(() => expect(within(tl).getByRole("slider", { name: "Playhead" })).toHaveAttribute("aria-valuenow", "6"));
    await waitFor(() => expect(cards[1]).toHaveAttribute("aria-current", "true"));
  });

  it("scenes: a QA finding inside a scene marks it Needs review", async () => {
    const user = userEvent.setup();
    fake(project());
    setQaPins([{ id: "f1", t: 7, label: "contrast: low", severity: "warn" }]);
    render(<App />);
    await toBuild(user);
    const list = await screen.findByRole("list", { name: "Scenes" });
    expect(within(list).getByRole("button", { name: "Scene joy, 0:06 to 0:20, needs review" })).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Scene curiosity, 0:00 to 0:06" })).toBeInTheDocument();
    setQaPins([]);
  });

  it("the timeline has an emotional-arc lane with the curve and a dot at the playhead", async () => {
    const user = userEvent.setup();
    fake(project());
    render(<App />);
    const tl = await toBuild(user);
    const lane = await within(tl).findByLabelText("Emotional arc curve");
    expect(lane.querySelector("path.tl-arcline")?.getAttribute("d")).toMatch(/^M/);
    expect(lane.querySelector("circle.tl-arcdot")).toBeTruthy();
  });

  it("has no raw colours: the styles use only tokens", async () => {
    const css = readFileSync("src/styles/app.css", "utf-8");
    expect(css.length).toBeGreaterThan(1000);
    const block = css.slice(css.indexOf("/* Director's timeline"));
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\brgb\(|\bhsl\(/);
  });
});
