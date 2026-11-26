import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api } from "../lib/api";
import { createProject } from "../lib/project";
import { logQaFix, relinkAsset } from "../lib/layers";
import type { QaFinding, QaReport } from "../pages/review/QaPanel";
import type { MotionProject } from "../types";

const MOVE: QaFinding = { id: "m1", check: "safe-title", tier: 1, severity: "warn", at: { layerId: 4 },
  evidence: { detail: "“Hello” reaches about 56 px outside the 90% safe area (estimated from its size and position).", measured: 56, threshold: 0, estimated: true },
  cause: "Some screens crop the edges. Move the text inwards.", fix: { label: "Move it 56 px right", safe: true, kind: "move" } };
const RELINK: QaFinding = { id: "r1", check: "missing-assets", tier: 1, severity: "error", evidence: { detail: "assets/images/logo.png is not in the project folder." },
  cause: "The file was moved.", fix: { label: "Relink to assets/brand/logo.png", safe: true, kind: "relink", relink: { assetId: "a1", to: "assets/brand/logo.png" } } };

const report = (...fs: QaFinding[]): QaReport => {
  const by = (c: string) => fs.filter((f) => f.check === c);
  return { counts: { error: fs.filter((f) => f.severity === "error").length, warn: fs.filter((f) => f.severity === "warn").length, info: 0 }, checked: 2, total: 2,
    results: [
      { check: "missing-assets", label: "Missing assets", state: by("missing-assets").length ? "findings" : "passed", reason: "", count: by("missing-assets").length, findings: by("missing-assets") },
      { check: "safe-title", label: "Safe-title violations", state: by("safe-title").length ? "findings" : "passed", reason: "", count: by("safe-title").length, findings: by("safe-title") }] };
};

function fake(project: MotionProject) {
  const log = { calls: [] as { method: string; params: Record<string, unknown> }[], saved: [] as MotionProject[] };
  let fixed = false;
  const api = {
    async list() { return [{ id: project.id, name: project.name, path: "mem:1", updatedAt: project.updatedAt }]; },
    async load() { return JSON.parse(JSON.stringify(project)); },
    async save(_p: string, p: MotionProject) { log.saved.push(JSON.parse(JSON.stringify(p))); },
    async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
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
      if (method === "qa_run") {
        const assets = ((params.facts as { assets: { path: string }[] }).assets);
        const relinked = assets.some((a) => a.path === "assets/brand/logo.png");
        return report(...(fixed ? [] : [MOVE]), ...(relinked ? [] : [RELINK])) as never;
      }
      if (method === "qa_fix") { fixed = true; return { applied: 1, fixed: [4], path: "x", dirty: false, activeComp: 1, comps: [], layers: [{ id: 4, name: "Hello", kind: "Text", index: 1, parent: null, nativeLocked: false, approvedHere: false, hash: "new" }] } as never; }
      if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
      return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
    },
  };
  setApiForTests(api as unknown as Api);
  return log;
}

const asset = (): MotionProject["assets"] => [{ id: "a1", kind: "image", path: "assets/images/logo.png", provenance: { actor: "user", provider: "import", model: "", at: "t", licence: "", costReported: false, costValue: null, costUnit: null } }];

async function toReview(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByText(name));
  await screen.findByRole("heading", { name: "Brief" });
  const bar = screen.getByRole("navigation", { name: "Stages" });
  await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Review") as HTMLElement);
  await user.click(await screen.findByRole("button", { name: "Run checks" }));
  await screen.findByText(/2 of 2 checks ran/);
}

describe("one-click safe fixes (P4-04)", () => {
  it("applies the move fix: the page names only the check and the layer, one QA revision is logged, and the checks run again", async () => {
    const user = userEvent.setup();
    const p = createProject("Fix demo"); p.assets = asset();
    const log = fake(p);
    render(<App />);
    await toReview(user, "Fix demo");
    await user.click(screen.getByRole("button", { name: "Apply fix" }));
    await screen.findByText(/Done: Move it 56 px right/);
    const call = log.calls.find((c) => c.method === "qa_fix")!;
    expect(Object.keys(call.params).sort()).toEqual(["check", "facts", "layer"]);          // no commands from the page
    expect(call.params).toMatchObject({ check: "safe-title", layer: 4 });
    expect(log.calls.filter((c) => c.method === "qa_run")).toHaveLength(2);                // checked again afterwards
    expect(screen.queryByText(/reaches about 56 px/)).not.toBeInTheDocument();
    const saved = await vi_waitSaved(log);
    expect(saved.revisions.filter((r) => r.kind === "qa_fix" && r.actor === "agent:qa")).toEqual([expect.objectContaining({ layers: [4], summary: "Move it 56 px right" })]);
    expect(saved.approvals).toHaveLength(0);
  });

  it("an approved layer cannot be fixed: the button is off and says why", async () => {
    const user = userEvent.setup();
    const p = createProject("Locked demo"); p.assets = asset();
    p.layerMap = [{ engineLayerId: 4, compId: "1", role: "title", provenance: { actor: "user", at: "t", costReported: false }, lock: "approved", approvedHash: "h", lastKnownHash: "h" }];
    const log = fake(p);
    render(<App />);
    await toReview(user, "Locked demo");
    const buttons = screen.getAllByRole("button", { name: /Apply fix|Relink/ });
    expect(buttons[0]).toHaveTextContent("Relink");
    expect(buttons[1]).toBeDisabled();
    expect(screen.getByText(/Approved layer: unlock it first/)).toBeInTheDocument();
    await user.click(buttons[1]);
    expect(log.calls.some((c) => c.method === "qa_fix")).toBe(false);
  });

  it("relinking changes MotionCraft's record only, logs one revision, and says so", async () => {
    const user = userEvent.setup();
    const p = createProject("Relink demo"); p.assets = asset();
    const log = fake(p);
    render(<App />);
    await toReview(user, "Relink demo");
    await user.click(screen.getByRole("button", { name: "Relink" }));
    await screen.findByText(/Only MotionCraft's record changed/);
    const saved = await vi_waitSaved(log, (s) => s.assets?.[0]?.path === "assets/brand/logo.png");
    expect(saved.revisions.some((r) => r.kind === "qa_fix" && /EffectCraft's own link is unchanged/.test(r.summary))).toBe(true);
    expect(log.calls.some((c) => c.method === "qa_fix")).toBe(false);                      // the composition was not touched
    expect(screen.queryByRole("button", { name: "Relink" })).not.toBeInTheDocument();
  });

  it("logQaFix and relinkAsset are small and exact", () => {
    const p = createProject("T"); p.assets = asset();
    expect(relinkAsset(p, "nope", "x")).toBe(p);
    expect(relinkAsset(p, "a1", "assets/brand/logo.png").assets![0].path).toBe("assets/brand/logo.png");
    const q = logQaFix(p, [7], "did it");
    expect(q.revisions[0]).toMatchObject({ actor: "agent:qa", kind: "qa_fix", layers: [7], summary: "did it" });
    expect(q.approvals).toEqual([]);
  });
});

import { waitFor } from "@testing-library/react";
async function vi_waitSaved(log: { saved: MotionProject[] }, pred: (p: MotionProject) => boolean = (p) => p.revisions.some((r) => r.kind === "qa_fix")): Promise<MotionProject> {
  let found: MotionProject | undefined;
  await waitFor(() => { found = [...log.saved].reverse().find(pred); expect(found).toBeTruthy(); }, { timeout: 4000 });
  return found!;
}
