import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { applyRestore, logVersion, restoreOutcome, type EngineSnapshot } from "../lib/layers";
import type { MotionProject } from "../types";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
const layer = (id: number, name: string, hash: string) => ({ id, name, kind: "Text", index: id, parent: null, nativeLocked: false, approvedHere: false, hash });

function projectWithHistory(): MotionProject {
  const p = createProject("History demo");
  p.revisions = [
    { id: "r1", at: "2026-11-23T10:00:00.000Z", actor: "agent:builder", kind: "agent_edit", layers: [3], summary: "Builder made 2 layers: Back, Title", snapshot: "after-111111", before: "before-11111" },
    { id: "r2", at: "2026-11-23T11:00:00.000Z", actor: "user", kind: "manual_edit", layers: [], summary: "Changed a note" },
  ];
  p.layerMap = [
    { engineLayerId: 2, compId: "1", role: "background", provenance: { actor: "user", at: "t", costReported: false }, lock: "approved", approvedHash: "A", lastKnownHash: "A" },
    { engineLayerId: 3, compId: "1", role: "title", provenance: { actor: "user", at: "t", costReported: false }, lock: "approved", approvedHash: "B-approved", lastKnownHash: "B-now" },
  ];
  return p;
}

function fake(project: MotionProject, connected = true) {
  const log = { calls: [] as { method: string; params: Record<string, unknown> }[], saved: [] as MotionProject[] };
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save(_p: string, p: MotionProject) { log.saved.push(JSON.parse(JSON.stringify(p))); },
    async engineStatus() { return connected ? { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" } : { state: "missing", pinned: "0.24.1", detail: "none" }; },
    async effectcraftWindowOpen() { return false; },
    async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
    async onMenu() { return () => undefined; },
    async appReady() { /* unused */ },
    async startupStep() { /* unused */ },
    async uncleanSession() { return null; },
    async sessionBegin() { /* unused */ },
    async sessionEnd() { /* unused */ },
    async engine(method: string, params: Record<string, unknown>) {
      log.calls.push({ method, params });
      switch (method) {
        case "llm_status": return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        case "snapshot_preview": return { width: 1, height: 1, time: params.time, png: PNG } as never;
        case "snapshot_diff": return { items: [{ id: 3, name: "Title", state: "changed" }, { id: 9, name: "Extra", state: "added" }], unchanged: 1, then: { layers: 2 }, now: { layers: 3 } } as never;
        case "snapshot_save": return { id: "manual-99999", bytes: 10 } as never;
        case "snapshot_restore": return { before: "prerestore-001", restored: params.id, path: "x", dirty: false, activeComp: 1, comps: [], layers: [layer(2, "Back", "A"), layer(3, "Title", "B-old")] } as never;
        default: return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      }
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

async function toReview(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByText(name));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Review") as HTMLElement);
  await screen.findByRole("heading", { name: "Review" });
}

describe("history, compare and restore (P4-05)", () => {
  it("offers Compare, Undo and Restore only where saved versions exist", async () => {
    const user = userEvent.setup();
    fake(projectWithHistory());
    render(<App />);
    await toReview(user, "History demo");
    expect(screen.getByRole("button", { name: "Compare Builder made 2 layers: Back, Title with now" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Undo Builder made 2 layers: Back, Title" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Restore the version after Builder made 2 layers: Back, Title" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Compare Changed a note/ })).not.toBeInTheDocument();
  });

  it("compare shows the old and current frames, what differs, and follows the time and the before/after choice", async () => {
    const user = userEvent.setup();
    const log = fake(projectWithHistory());
    render(<App />);
    await toReview(user, "History demo");
    await user.click(screen.getByRole("button", { name: /Compare Builder made 2 layers/ }));
    const dlg = await screen.findByRole("dialog", { name: "Compare with now" });
    await within(dlg).findByAltText(/The current composition at 1 seconds/);
    expect(within(dlg).getByAltText(/saved version at 1 seconds/)).toBeInTheDocument();
    expect(log.calls.filter((c) => c.method === "open")).toHaveLength(1);
    const prev = log.calls.filter((c) => c.method === "snapshot_preview").map((c) => c.params.id).sort();
    expect(prev).toEqual(["after-111111", "current"]);
    expect(await within(dlg).findByText("2 layers differ.")).toBeInTheDocument();
    expect(within(dlg).getByText("Title")).toBeInTheDocument();
    expect(within(dlg).getByText("Extra")).toBeInTheDocument();
    await user.click(within(dlg).getByRole("button", { name: "Before this change" }));
    await waitFor(() => expect(log.calls.some((c) => c.method === "snapshot_diff" && c.params.id === "before-11111")).toBe(true));
    expect(log.calls.filter((c) => c.method === "open")).toHaveLength(1);   // the composition is opened once, not per frame
  });

  it("undo: says what would change and which approvals are lost, restores the 'before' version, keeps matching approvals, logs one revision", async () => {
    const user = userEvent.setup();
    const log = fake(projectWithHistory());
    render(<App />);
    await toReview(user, "History demo");
    await user.click(screen.getByRole("button", { name: /Undo Builder made 2 layers/ }));
    const dlg = await screen.findByRole("dialog", { name: "Undo this change" });
    expect(await within(dlg).findByText(/2 layers would change/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Title: will go back to how it was/)).toBeInTheDocument();
    expect(within(dlg).getByText(/Extra: will be removed/)).toBeInTheDocument();
    expect(within(dlg).getByRole("note")).toHaveTextContent("Approved layers that will lose their approval: Title");
    await user.click(within(dlg).getByRole("button", { name: "Undo the change" }));
    await screen.findByText(/The state before this was saved as a version/);
    const restore = log.calls.find((c) => c.method === "snapshot_restore")!;
    expect(restore.params).toEqual({ id: "before-11111" });
    const lock = log.calls.find((c) => c.method === "lock")!;
    expect(lock.params).toEqual({ layers: [2] });                      // only the layer that still matches what was approved
    const saved = await waitForSaved(log, (p) => p.revisions.some((r) => /^Restored:/.test(r.summary)));
    const rev = saved.revisions.find((r) => /^Restored:/.test(r.summary))!;
    expect(rev).toMatchObject({ actor: "user", before: "prerestore-001", snapshot: "before-11111", layers: [3] });
    const b = (id: number) => saved.layerMap!.find((x) => x.engineLayerId === id)!;
    expect(b(2).lock).toBe("approved");
    expect(b(3)).toMatchObject({ lock: "none", lastKnownHash: "B-old" });
    expect(saved.approvals.filter((a) => a.state === "revoked" && a.target === "3")).toHaveLength(1);
  });

  it("saving a version by hand records a revision pointing at it", async () => {
    const user = userEvent.setup();
    const log = fake(projectWithHistory());
    render(<App />);
    await toReview(user, "History demo");
    await user.type(screen.getByLabelText(/Save a version now/), "Before client notes");
    await user.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByText(/Version saved/);
    expect(log.calls.map((c) => c.method).filter((m) => m === "open" || m === "snapshot_save")).toEqual(["open", "snapshot_save"]);
    const saved = await waitForSaved(log, (p) => p.revisions.some((r) => r.snapshot === "manual-99999"));
    expect(saved.revisions.find((r) => r.snapshot === "manual-99999")).toMatchObject({ actor: "user", summary: "Before client notes" });
    expect(await screen.findByRole("button", { name: "Compare Before client notes with now" })).toBeEnabled();
  });

  it("is switched off when the engine is not connected", async () => {
    const user = userEvent.setup();
    const log = fake(projectWithHistory(), false);
    render(<App />);
    await toReview(user, "History demo");
    expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Compare Builder made/ })).toBeDisabled();
    expect(log.calls.some((c) => c.method.startsWith("snapshot_"))).toBe(false);
  });
});

describe("approvals after a restore", () => {
  const snap = (layers: ReturnType<typeof layer>[]): EngineSnapshot => ({ path: "x", dirty: false, activeComp: 1, comps: [], layers });

  it("an approval holds only when the layer is back to exactly what was approved", () => {
    const p = projectWithHistory();
    expect(restoreOutcome(p, snap([layer(2, "Back", "A"), layer(3, "Title", "B-approved")]))).toEqual({ keep: [2, 3], revoke: [] });
    expect(restoreOutcome(p, snap([layer(2, "Back", "A"), layer(3, "Title", "other")]))).toEqual({ keep: [2], revoke: [3] });
    expect(restoreOutcome(p, snap([layer(3, "Title", "B-approved")]))).toEqual({ keep: [3], revoke: [2] });   // a layer that is gone loses its approval
  });

  it("applyRestore revokes with a note, adds one revision, binds new layers and drops gone ones", () => {
    const p = projectWithHistory();
    const q = applyRestore(p, snap([layer(3, "Title", "other"), layer(7, "Fresh", "F")]), { label: "Undo: x", restored: "v1", before: "v0" });
    expect(q.layerMap!.map((b) => [b.engineLayerId, b.lock])).toEqual([[3, "none"], [7, "none"]]);
    expect(q.approvals.map((a) => [a.target, a.state, a.note])).toEqual([["2", "revoked", "restored an earlier version"], ["3", "revoked", "restored an earlier version"]]);
    expect(q.revisions[q.revisions.length - 1]).toMatchObject({ summary: "Restored: Undo: x", snapshot: "v1", before: "v0" });
  });

  it("logVersion names the version and never touches approvals", () => {
    const q = logVersion(createProject("T"), "id-123456", "  ");
    expect(q.revisions[0]).toMatchObject({ summary: "Saved a version", snapshot: "id-123456", actor: "user" });
    expect(q.approvals).toEqual([]);
  });
});

async function waitForSaved(log: { saved: MotionProject[] }, pred: (p: MotionProject) => boolean): Promise<MotionProject> {
  let found: MotionProject | undefined;
  await waitFor(() => { found = [...log.saved].reverse().find(pred); expect(found).toBeTruthy(); }, { timeout: 4000 });
  return found!;
}
