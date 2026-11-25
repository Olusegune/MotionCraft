import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api, type ModelEntry } from "../lib/api";
import { createProject } from "../lib/project";
import { updateSettings } from "../lib/settings";
import { animateChoices } from "../pages/AnimateScene";
import { CAMERA_MOVES, defaultAnimate, emotionText, fitToModel, performanceFrom, videoAspect, videoLimits, videoPrompt } from "../lib/videoPrompt";
import type { Beat, MotionProject } from "../types";

const beat: Beat = { beatId: "a", startSec: 0, endSec: 8, primary: "awe", secondary: "wonder", intensity: 4, energy: 3 };
const prov = { actor: "user" as const, provider: "import", model: "file", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null };
const entry = (provider: string, model: string, name: string, extra: Partial<ModelEntry> = {}): ModelEntry => ({ provider: provider as never, model, name, media: "video", official: provider === "google", listed: true, source: "builtin", imageInput: true, price: { known: false, unit: null, value: null, note: "" }, ...extra });

function scene(): MotionProject {
  const p = createProject("Animate demo");
  p.intent.arc = [beat];
  p.assets = [{ id: "i1", kind: "image", path: "assets/images/a.png", name: "Opening", provenance: prov }];
  p.treatment = { a: { plan: "Opening · One window. In a Lagos apartment at dusk, a teenager comes home and turns on the kitchen light. Hold long enough to see a second place set.", motion: "", frameAssetId: "i1" } };
  return p;
}

describe("the shot, in words", () => {
  it("says the feeling from the beat and the performance from the plan's first two sentences", () => {
    expect(emotionText(beat)).toBe("awe, with wonder; strong");
    expect(emotionText({ primary: "", intensity: 2 })).toBe("quiet attention; subtle");
    expect(performanceFrom("Opening · One window. A teenager comes home. She turns on the light. A third sentence.")).toBe("A teenager comes home. She turns on the light.");
  });
  it("builds a prompt from camera, performance, emotion, dialogue, sound and look, and never asks for lettering", () => {
    const p = scene();
    const s = { ...defaultAnimate(p, beat), camera: "push", spoken: "Is that you?" };
    const t = videoPrompt(p, beat, s);
    expect(t).toContain("Keep the same people, faces, clothing, lighting and setting");
    expect(t).toContain("Camera: A slow, steady push-in towards the subject.");
    expect(t).toContain("Performance: In a Lagos apartment at dusk, a teenager comes home");
    expect(t).toContain("Emotion: awe, with wonder; strong.");
    expect(t).toContain('Dialogue: one person in the scene says, "Is that you?".');
    expect(t).toContain("Sound: natural sound that belongs to the place");
    expect(t).toContain("No on-screen text, captions, subtitles, logos or watermarks.");
    expect(videoPrompt(p, beat, { ...s, sound: false, spoken: "" })).toContain("No sound beyond the natural sound of the scene.");
    expect(videoPrompt(p, beat, { ...s, prompt: "  My own prompt.  " })).toBe("My own prompt.");     // a hand-written prompt replaces the built one
  });
  it("offers every camera move with words a model understands", () => {
    expect(CAMERA_MOVES.map((c) => c.id)).toEqual(expect.arrayContaining(["hold", "push", "pull", "orbit", "handheld", "dolly-zoom"]));
    expect(CAMERA_MOVES.every((c) => c.text.length > 20)).toBe(true);
  });
  it("makes the settings valid for the model: Veo lengths, 1080p only at 8 seconds, 16:9 or 9:16", () => {
    expect(videoLimits("veo-3.1-fast-generate-preview").durations).toEqual([4, 6, 8]);
    const base = defaultAnimate(scene(), beat);
    expect(fitToModel({ ...base, duration: 5, resolution: "1080p" }, "veo-3.1-generate-preview")).toMatchObject({ duration: 8, resolution: "1080p" });
    expect(fitToModel({ ...base, duration: 4, resolution: "1080p" }, "veo-3.1-generate-preview")).toMatchObject({ duration: 4, resolution: "720p" });
    expect(videoAspect("21:9")).toBe("16:9");
    expect(videoAspect("9:16")).toBe("9:16");
  });
  it("offers only video models that take a picture and have a key, official ones first", () => {
    const list = [entry("fal", "fal-ai/x/image-to-video", "Fal i2v"), entry("google", "veo-3.1-generate-preview", "Veo 3.1"), entry("google", "veo-3.1-fast-generate-preview", "Veo 3.1 Fast"),
      entry("kie", "kling", "Kie", { imageInput: false }), entry("google", "gemini-image", "Nano", { media: "image", imageInput: false })];
    expect(animateChoices(list, { google: true, fal: true, kie: true }).map((m) => m.name)).toEqual(["Veo 3.1 Fast", "Veo 3.1", "Fal i2v"]);
    expect(animateChoices(list, { fal: true }).map((m) => m.name)).toEqual(["Fal i2v"]);
    expect(animateChoices(list, {})).toEqual([]);
  });
});

describe("the Animate sheet on a scene", () => {
  it("shows the editable prompt, asks for confirmation, starts the job with the picture and the settings, and makes the clip the scene's frame", async () => {
    updateSettings({ generative: true });
    const user = userEvent.setup();
    const p = scene();
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const spends: string[] = [];
    const saved: MotionProject[] = [];
    const api = {
      async list() { return [{ id: p.id, name: p.name, path: "mem:1", updatedAt: p.updatedAt }]; },
      async load() { return JSON.parse(JSON.stringify(p)); },
      async save(_x: string, proj: MotionProject) { saved.push(JSON.parse(JSON.stringify(proj))); },
      async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
      async effectcraftWindowOpen() { return false; },
      async keyStatus() { return { byteplus: false, google: true, openai: false, kie: false, fal: false, anthropic: false, openrouter: false }; },
      async onMenu() { return () => undefined; },
      async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
      async assetDataUrl() { return "data:image/png;base64,AAAA"; },
      async confirmSpend(provider: string, model: string) { spends.push(`${provider}/${model}`); return "tok"; },
      async engine(method: string, params: Record<string, unknown>) {
        calls.push({ method, params });
        if (method === "models") return { models: [entry("google", "veo-3.1-fast-generate-preview", "Veo 3.1 Fast")], status: {} } as never;
        if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        if (method === "generate_start") return { id: "job1", state: "running", detail: "submitted", provider: "google", model: "veo-3.1-fast-generate-preview", kind: "video", asset: null } as never;
        if (method === "generate_poll") return { id: "job1", state: "done", detail: "done", provider: "google", model: "veo-3.1-fast-generate-preview", kind: "video", asset: { path: "assets/video/gen-job1.mp4", kind: "video", provenance: { ...prov, provider: "google" } } } as never;
        return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      },
    };
    setApiForTests(api as unknown as Api);
    render(<App />);
    await user.click(await screen.findByText("Animate demo"));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Treatment") as HTMLElement);
    await user.click(await screen.findByRole("button", { name: /Animate…/ }));
    const sheet = await screen.findByRole("dialog", { name: /Animate: awe/ });
    expect(await within(sheet).findByRole("option", { name: /Veo 3.1 Fast \(Google, official\)/ })).toBeInTheDocument();
    expect(within(sheet).getByText(/Unknown\. The provider's price is not published here/)).toBeInTheDocument();
    await user.selectOptions(within(sheet).getByLabelText("Camera"), "orbit");
    await user.type(within(sheet).getByLabelText(/A line someone in the scene says/), "Is that you?");
    const box = within(sheet).getByLabelText(/The prompt sent to the model/) as HTMLTextAreaElement;
    expect(box.value).toContain("A slow orbit around the subject");
    expect(box.value).toContain('says, "Is that you?"');
    expect(calls.some((c) => c.method === "generate_start")).toBe(false);                  // nothing is sent before the confirmation
    await user.click(within(sheet).getByRole("button", { name: "Confirm and make the clip" }));
    await waitFor(() => expect(calls.some((c) => c.method === "generate_start")).toBe(true));
    const start = calls.find((c) => c.method === "generate_start")!.params as { prompt: string; params: Record<string, unknown>; spend_token: string; provider: string };
    expect(spends).toEqual(["google/veo-3.1-fast-generate-preview"]);
    expect(start.spend_token).toBe("tok");
    expect(start.params).toMatchObject({ image: "assets/images/a.png", aspect_ratio: "16:9", duration: 8, resolution: "720p", person_generation: "allow_adult" });
    expect(start.prompt).toContain("A slow orbit around the subject");
    await waitFor(() => expect(saved.some((x) => x.treatment.a.frameAssetId === "job1")).toBe(true), { timeout: 9000 });
    const last = saved[saved.length - 1];
    expect(last.treatment.a).toMatchObject({ frameAssetId: "job1", stillAssetId: "i1", frameLoop: false });
    expect(last.treatment.a.animate).toMatchObject({ camera: "orbit", spoken: "Is that you?" });      // the choices are remembered, so the shot can be reopened and edited
    expect(last.assets!.find((a) => a.id === "job1")).toMatchObject({ kind: "video", path: "assets/video/gen-job1.mp4" });
    expect(last.budget.ledger).toEqual([expect.objectContaining({ provider: "google", what: "clip", usd: null })]);
  }, 20000);
});

import { isFalVeo, modelParams } from "../lib/videoPrompt";
describe("the settings each model is sent", () => {
  const s = { ...defaultAnimate(scene(), beat), duration: 4, resolution: "720p" as const, sound: true, negative: "text, logos" };
  it("sends Google's Veo its own names", () => {
    expect(modelParams("google", "veo-3.0-generate-001", s, "16:9")).toEqual({ aspect_ratio: "16:9", duration: 4, resolution: "720p", person_generation: "allow_adult", negative_prompt: "text, logos" });
  });
  it("sends fal's Veo its own names, with the sound switch", () => {
    expect(isFalVeo("fal-ai/veo3/fast/image-to-video")).toBe(true);
    expect(isFalVeo("fal-ai/veo3.1/fast/image-to-video")).toBe(true);
    expect(isFalVeo("fal-ai/kling-video/v2.1/master/image-to-video")).toBe(false);
    expect(modelParams("fal", "fal-ai/veo3/fast/image-to-video", { ...s, sound: false }, "9:16")).toEqual({ aspect_ratio: "9:16", duration: "4s", resolution: "720p", generate_audio: false, negative_prompt: "text, logos" });
  });
  it("sends a model whose settings are not known nothing extra, so it cannot refuse an unknown name", () => {
    expect(modelParams("fal", "fal-ai/kling-video/v2.1/master/image-to-video", s, "16:9")).toEqual({});
    expect(videoLimits("fal-ai/veo3/fast/image-to-video").durations).toEqual([4, 6, 8]);
  });
});
