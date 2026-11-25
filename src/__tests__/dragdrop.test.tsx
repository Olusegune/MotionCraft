import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api, type DropEvent } from "../lib/api";
import { createProject } from "../lib/project";
import { importSummary } from "../shell/Media";

describe("importSummary", () => {
  it("says what was added and why the rest was not", () => {
    expect(importSummary(2, [])).toBe("Added 2 files.");
    expect(importSummary(1, ["That is not a picture, video or audio file MotionCraft can use."])).toMatch(/^Added 1 file\. 1 not added: That is not a picture/);
    expect(importSummary(0, [])).toBe("Nothing to add.");
  });
});

describe("dragging files onto the window", () => {
  it("shows a drop target, then adds the good files, reports the bad one and saves them in the project", async () => {
    const p = createProject("Drop demo");
    let handler: (e: DropEvent) => void = () => undefined;
    const saved: unknown[] = [];
    const api = {
      async list() { return [{ id: p.id, name: p.name, path: "mem:1", updatedAt: p.updatedAt }]; },
      async load() { return JSON.parse(JSON.stringify(p)); },
      async save(_path: string, proj: unknown) { saved.push(proj); },
      async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
      async effectcraftWindowOpen() { return false; },
      async keyStatus() { return { byteplus: false, google: false, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
      async onMenu() { return () => undefined; },
      async onFilesDropped(cb: (e: DropEvent) => void) { handler = cb; return () => undefined; },
      async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
      async importAsset(_proj: string, src: string) {
        if (src.endsWith(".txt")) throw new Error("That is not a picture, video or audio file MotionCraft can use.");
        return { kind: src.endsWith(".mp4") ? "video" : "image", path: `assets/images/${src.split("/").pop()}`, name: src.split("/").pop() };
      },
      async assetDataUrl() { return "data:image/png;base64,AAAA"; },
      async engine(method: string) {
        if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        if (method === "models") return { models: [], status: {} } as never;
        return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      },
    };
    setApiForTests(api as unknown as Api);
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("Drop demo"));
    await screen.findByRole("heading", { name: "Brief" });
    await act(async () => { handler({ type: "enter", paths: ["C:/a/pic.png"] }); });
    expect(screen.getByText("Drop to add to this project")).toBeInTheDocument();
    await act(async () => { handler({ type: "drop", paths: ["C:/a/pic.png", "C:/a/clip.mp4", "C:/a/notes.txt"] }); });
    expect(screen.queryByText("Drop to add to this project")).not.toBeInTheDocument();
    expect(await screen.findByText(/Added 2 files\. 1 not added/)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1400));
    const last = saved[saved.length - 1] as { assets: { name: string; kind: string }[] };
    expect(last.assets.map((a) => `${a.name}:${a.kind}`)).toEqual(["pic.png:image", "clip.mp4:video"]);
  });
});

import { fillFrames, scenePictureItems } from "../lib/makeIt";
describe("a scene can use the person's own clip", () => {
  it("fillFrames hands out their pictures and clips first, and the clip is placed behind its scene", () => {
    const p = createProject("v");
    p.intent.arc = [{ beatId: "a", startSec: 0, endSec: 3, primary: "one", intensity: 2, energy: 2 }, { beatId: "b", startSec: 3, endSec: 6, primary: "two", intensity: 2, energy: 2 }];
    const prov = { actor: "user" as const, provider: "import", model: "file", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null };
    p.assets = [{ id: "c1", kind: "video", path: "assets/video/c.mp4", provenance: prov }, { id: "i1", kind: "image", path: "assets/images/i.png", provenance: prov }, { id: "s1", kind: "audio", path: "assets/audio/s.wav", provenance: prov }];
    const q = fillFrames(p);
    expect(q.treatment.a.frameAssetId).toBe("c1");
    expect(q.treatment.b.frameAssetId).toBe("i1");                       // audio is never a picture
    expect(scenePictureItems(q).map((x) => [x.rel, x.t_in, x.t_out])).toEqual([["assets/video/c.mp4", 0, 3], ["assets/images/i.png", 3, 6]]);
  });
});

import { needsRights, rightsLabel, setRights } from "../lib/rights";
describe("rights notes on imported files", () => {
  const prov = (provider: string) => ({ actor: "user" as const, provider, model: "file", at: "t", licence: "Imported by you. Make sure you have the rights to use it.", costReported: false, costValue: null, costUnit: null });
  it("asks about imports only, and records the answer with a licence line", () => {
    const mine = { id: "a", kind: "image" as const, path: "assets/images/a.png", provenance: prov("import") };
    const made = { id: "b", kind: "image" as const, path: "assets/images/b.png", provenance: prov("kie") };
    expect(needsRights(mine)).toBe(true);
    expect(needsRights(made)).toBe(false);
    const done = setRights(mine, "licensed");
    expect(needsRights(done)).toBe(false);
    expect(rightsLabel(done.rights)).toBe("Licensed to me");
    expect(done.provenance.licence).toMatch(/Licensed/);
    expect(setRights(done, undefined).provenance.licence).toMatch(/Make sure you have the rights/);
  });
});
