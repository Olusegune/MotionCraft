import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { markerItems } from "../lib/songmap";
import type { MotionProject } from "../types";

const SECTIONS = [
  { start: 0, end: 16, label: "INTRO", group: "A", energy: 2, mood: "Dreamlike" }, { start: 16, end: 32, label: "VERSE", group: "B", energy: 7, mood: "Driving" },
  { start: 32, end: 48, label: "CHORUS", group: "C", energy: 10, mood: "Celebratory" }, { start: 48, end: 88, label: "OUTRO", group: "A", energy: 1, mood: "Dreamlike" },
];
const ANALYSIS = { duration: 88, bpm: 120, beats: [0.5, 1, 1.5, 2], downbeats: [0.5, 2.5], peaks: [0.1, 0.5], silences: [], estimate: true, sections: SECTIONS, transients: [{ t: 16, strength: 1 }], energyCurve: [[0, 0.1]] };
const SONGMAP = { source: "pulseframe", analyzer: "librosa-baseline+demucs+whisper-align", duration: 191.44, bpm: 120.18, beats: [0.4, 0.9], downbeats: [0.4], lyricMatch: 0.827, warnings: ["A section that was empty was dropped."],
  sections: [{ start: 0, end: 18.49, label: "INTRO", group: "Intro", energy: 4, mood: "Intimate" }, { start: 18.49, end: 38.46, label: "VERSE", group: "Verse 1", energy: 4, mood: "Intimate" }],
  lyrics: [{ text: "My mind dey pack bag", start: 18.93, end: 21.15, section: "Verse 1" }, { text: "Before trouble land", start: 21.15, end: 23.59, section: "Verse 1" }] };

function fake(project: MotionProject, o: { connected?: boolean } = {}) {
  const log = { calls: [] as { method: string; params: Record<string, unknown> }[], imported: [] as string[], saved: [] as MotionProject[] };
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save(_p: string, p: MotionProject) { log.saved.push(JSON.parse(JSON.stringify(p))); },
    async engineStatus() { return o.connected === false ? { state: "missing", pinned: "0.24.1", detail: "none" } : { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async startupStep() { /* unused */ },
    async uncleanSession() { return null; },
    async sessionBegin() { /* unused */ },
    async sessionEnd() { /* unused */ },
    async pickSongMap() { return "C:\\music\\exit plan.songmap.json"; },
    async importSongMap(_p: string, source: string) { log.imported.push(source); return { path: "assets/audio/imp-abcd1234-exit-plan.songmap.json", name: "exit plan" }; },
    async engine(method: string, params: Record<string, unknown>) {
      log.calls.push({ method, params });
      switch (method) {
        case "llm_status": return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        case "audio_analyze": return ANALYSIS as never;
        case "songmap_import": return SONGMAP as never;
        case "sync_markers": case "sync_labelled_markers": return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [], markers: 1 } as never;
        default: return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      }
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

function withAudio(): MotionProject {
  const p = createProject("Audio demo");
  p.assets = [{ id: "au1", kind: "audio", path: "assets/audio/song.wav", name: "song", provenance: { actor: "user", provider: "import", model: "", at: "t", licence: "", costReported: false, costValue: null, costUnit: null } }];
  return p;
}

async function toAudio(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByText("Audio demo"));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Build") as HTMLElement);
  await screen.findAllByRole("button", { name: /^Audio/ });
  const fold = screen.getAllByRole("button", { name: /^Audio/ }).find((b) => b.hasAttribute("aria-expanded"))!;
  await user.click(fold);
}

describe("song structure on the Audio panel (P3-01)", () => {
  it("shows the estimated structure as a labelled bar and list, and writes beats and section markers together", async () => {
    const user = userEvent.setup();
    const log = fake(withAudio());
    render(<App />);
    await toAudio(user);
    await user.click(await screen.findByRole("button", { name: /Analyse/ }));
    const bar = await screen.findByRole("img", { name: /Song structure: INTRO 0:00 to 0:16, VERSE 0:16 to 0:32, CHORUS 0:32 to 0:48, OUTRO 0:48 to 1:28/ });
    expect(bar).toBeInTheDocument();
    expect(screen.getByText(/Estimated from loudness and how busy and bright each bar is/)).toBeInTheDocument();
    expect(screen.getByText(/1 sharp attacks|1 sharp attack/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Write markers to composition" }));
    await waitFor(() => expect(log.calls.some((c) => c.method === "sync_labelled_markers")).toBe(true));
    const call = log.calls.find((c) => c.method === "sync_labelled_markers")!;
    expect(call.params.replace).toBe(true);
    const items = call.params.items as { time: number; comment: string }[];
    expect(items.filter((i) => i.comment === "motioncraft:beat")).toHaveLength(4);
    expect(items.filter((i) => i.comment.startsWith("motioncraft:section:")).map((i) => i.comment)).toEqual(
      ["motioncraft:section:INTRO A", "motioncraft:section:VERSE B", "motioncraft:section:CHORUS C", "motioncraft:section:OUTRO A"]);
    expect(await screen.findByText(/This replaced the composition's other markers/)).toBeInTheDocument();
    expect(log.calls.some((c) => c.method === "sync_markers")).toBe(false);
  });

  it("with only beats selected it uses the original beats write", async () => {
    const user = userEvent.setup();
    const log = fake(withAudio());
    render(<App />);
    await toAudio(user);
    await user.click(await screen.findByRole("button", { name: /Analyse/ }));
    await screen.findByRole("img", { name: /Song structure/ });
    await user.click(screen.getByRole("checkbox", { name: /Section starts/ }));
    await user.click(screen.getByRole("button", { name: "Write markers to composition" }));
    await waitFor(() => expect(log.calls.find((c) => c.method === "sync_markers")?.params).toMatchObject({ times: [0.5, 1, 1.5, 2], replace: true }));
  });

  it("imports a Pulseframe SongMap, keeps it in the project, shows its sections and offers its lyric lines as markers", async () => {
    const user = userEvent.setup();
    const log = fake(withAudio());
    render(<App />);
    await toAudio(user);
    await user.click(await screen.findByRole("button", { name: /Import SongMap/ }));
    expect(await screen.findByText(/SongMap exit plan read: 2 sections, 2 lyric lines\. 1 things were dropped or changed\./)).toBeInTheDocument();
    expect(log.imported).toEqual(["C:\\music\\exit plan.songmap.json"]);
    expect(log.calls.find((c) => c.method === "songmap_import")!.params).toEqual({ rel: "assets/audio/imp-abcd1234-exit-plan.songmap.json" });
    await screen.findByRole("img", { name: /Song structure: INTRO 0:00 to 0:18, VERSE 0:18 to 0:38/ });
    expect(screen.getByText(/83% of the lyric words heard/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Lyric lines \(2\)/ })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Write markers to composition" }));
    await waitFor(() => expect(log.calls.some((c) => c.method === "sync_labelled_markers")).toBe(true));
    const items = log.calls.find((c) => c.method === "sync_labelled_markers")!.params.items as { comment: string }[];
    expect(items.map((i) => i.comment)).toContain("motioncraft:lyric:My mind dey pack bag");
    expect(items.map((i) => i.comment)).toContain("motioncraft:section:VERSE");           // a long group name such as "Verse 1" is left off the comment
    const saved = await waitFor(() => { const s = [...log.saved].reverse().find((p) => p.songmaps?.length); expect(s).toBeTruthy(); return s!; }, { timeout: 4000 });
    expect(saved.songmaps).toEqual([expect.objectContaining({ path: "assets/audio/imp-abcd1234-exit-plan.songmap.json", name: "exit plan" })]);
    expect((saved.assets ?? []).every((a) => a.kind !== "audio" || a.path === "assets/audio/song.wav")).toBe(true);   // the SongMap is not listed as an audio track
  });

  it("the write button is off without a connected engine", async () => {
    const user = userEvent.setup();
    fake(withAudio(), { connected: false });
    render(<App />);
    await toAudio(user);
    await user.click(await screen.findByRole("button", { name: /Analyse/ }));
    await screen.findByRole("img", { name: /Song structure/ });
    expect(screen.getByRole("button", { name: "Write markers to composition" })).toBeDisabled();
  });
});

describe("markerItems", () => {
  it("builds the engine's marker comments in time order, leaving long group names off", () => {
    const items = markerItems({ beats: [1, 0.5], sections: [{ start: 0.5, end: 9, label: "VERSE", group: "Verse 1", energy: 3, mood: "x" }, { start: 9, end: 20, label: "CHORUS", group: "C", energy: 9, mood: "y" }],
      lyrics: [{ text: "a".repeat(80), start: 0.2, end: 1 }] });
    expect(items.map((i) => [i.time, i.comment])).toEqual([[0.2, "motioncraft:lyric:" + "a".repeat(50)], [0.5, "motioncraft:beat"], [0.5, "motioncraft:section:VERSE"], [1, "motioncraft:beat"], [9, "motioncraft:section:CHORUS C"]]);
    expect(markerItems({})).toEqual([]);
  });
});
