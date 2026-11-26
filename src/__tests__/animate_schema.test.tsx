import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { setApiForTests, type Api, type ModelEntry } from "../lib/api";
import { createProject } from "../lib/project";
import { updateSettings } from "../lib/settings";
import type { ModelSchema } from "../lib/videoRequest";
import type { Beat, MotionProject } from "../types";

const beat: Beat = { beatId: "a", startSec: 0, endSec: 8, primary: "awe", intensity: 4, energy: 3 };
const prov = { actor: "user" as const, provider: "import", model: "file", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null };
const model = (provider: string, id: string, name: string): ModelEntry => ({ provider: provider as never, model: id, name, media: "video", official: provider === "google", listed: true, source: "discovered", imageInput: true,
  price: { known: false, unit: null, value: null, note: "" } });

const SEEDANCE: ModelSchema = {
  provider: "kie", model: "bytedance/seedance-2",
  caps: { text: true, imageFirst: true, imageLast: true, imageRefs: 9, videoRefs: 3, audioRefs: 3, soundOut: true, negativePrompt: false, seed: false,
          aspects: ["1:1", "16:9", "9:16", "21:9", "adaptive"], resolutions: ["480p", "720p", "1080p", "4k"], durations: { min: 4, max: 15, default: 5, type: "integer" } },
  fields: [
    { name: "prompt", role: "prompt", type: "string", required: true, description: "" },
    { name: "first_frame_url", role: "image_first", type: "string", required: false, description: "" },
    { name: "last_frame_url", role: "image_last", type: "string", required: false, description: "" },
    { name: "reference_image_urls", role: "image_refs", type: "array", list: true, maxItems: 9, required: false, description: "" },
    { name: "reference_video_urls", role: "video_refs", type: "array", list: true, maxItems: 3, required: false, description: "" },
    { name: "reference_audio_urls", role: "audio_refs", type: "array", list: true, maxItems: 3, required: false, description: "" },
    { name: "generate_audio", role: "sound", type: "boolean", required: false, default: true, description: "" },
    { name: "resolution", role: "resolution", type: "string", required: false, enum: ["480p", "720p", "1080p", "4k"], default: "720p", description: "" },
    { name: "aspect_ratio", role: "aspect_ratio", type: "string", required: false, enum: ["1:1", "16:9", "9:16", "21:9", "adaptive"], default: "16:9", description: "" },
    { name: "duration", role: "duration", type: "integer", required: false, min: 4, max: 15, default: 5, description: "" },
  ],
};

describe("the Animate sheet shows what the chosen model can do", () => {
  it("offers Kie.ai first, reads the model's schema, shows its 21:9, last frame, references and clip, and sends the files and settings it understands", async () => {
    updateSettings({ generative: true });
    const user = userEvent.setup();
    const p = createProject("Schema demo");
    p.brief.deliverables[0].aspect = "21:9";
    p.intent.arc = [beat];
    p.assets = [{ id: "i1", kind: "image", path: "assets/images/a.png", name: "Opening", provenance: prov }, { id: "i2", kind: "image", path: "assets/images/b.png", name: "Closing", provenance: prov },
      { id: "v1", kind: "video", path: "assets/video/c.mp4", name: "Reference clip", provenance: prov }, { id: "s1", kind: "audio", path: "assets/audio/s.wav", name: "Voice", provenance: prov }];
    p.treatment = { a: { plan: "Opening. A person looks up.", motion: "", frameAssetId: "i1" } };
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const api = {
      async list() { return [{ id: p.id, name: p.name, path: "mem:1", updatedAt: p.updatedAt }]; },
      async load() { return JSON.parse(JSON.stringify(p)); },
      async save(_x: string, _proj: MotionProject) { /* kept */ },
      async engineStatus() { return { state: "connected", version: "0.24.1", pinned: "0.24.1", detail: "ok" }; },
      async effectcraftWindowOpen() { return false; },
      async keyStatus() { return { byteplus: false, google: true, openai: false, kie: true, fal: true, anthropic: false, openrouter: false }; },
      async onMenu() { return () => undefined; },
      async appReady() { /* unused */ }, async startupStep() { /* unused */ }, async uncleanSession() { return null; }, async sessionBegin() { /* unused */ }, async sessionEnd() { /* unused */ },
      async assetDataUrl() { return "data:image/png;base64,AAAA"; },
      async confirmSpend() { return "tok"; },
      async engine(method: string, params: Record<string, unknown>) {
        calls.push({ method, params });
        if (method === "models") return { models: [model("google", "veo-3.1-generate-preview", "Veo 3.1"), model("fal", "fal-ai/veo3/fast/image-to-video", "Veo 3 Fast (fal)"), model("kie", "bytedance/seedance-2", "Bytedance Seedance 2.0")],
          status: { kie: { refreshed: 1, stale: false }, fal: { refreshed: 1, stale: false }, google: { refreshed: 1, stale: false } } } as never;
        if (method === "model_schema") return SEEDANCE as never;
        if (method === "llm_status") return { ready: false, reason: "none", config: { provider: null, model: "" }, providers: [] } as never;
        if (method === "generate_start") return { id: "j1", state: "running", detail: "submitted", provider: "kie", model: "bytedance/seedance-2", kind: "video", asset: null } as never;
        return { path: "x", dirty: false, activeComp: 1, comps: [], layers: [] } as never;
      },
    };
    setApiForTests(api as unknown as Api);
    render(<App />);
    await user.click(await screen.findByText("Schema demo"));
    await screen.findByRole("heading", { name: "Brief" });
    const bar = screen.getByRole("navigation", { name: "Stages" });
    await user.click(Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Treatment") as HTMLElement);
    await user.click(await screen.findByRole("button", { name: /Animate…/ }));
    const sheet = await screen.findByRole("dialog", { name: /Animate: awe/ });
    const models = within(sheet).getByLabelText("Video model") as HTMLSelectElement;
    await waitFor(() => expect(Array.from(models.options).map((o) => o.text)).toEqual(["Bytedance Seedance 2.0 (Kie.ai)", "Veo 3 Fast (fal) (fal)", "Veo 3.1 (Google, official)"]));
    await waitFor(() => expect(calls.find((c) => c.method === "model_schema")?.params).toMatchObject({ provider: "kie", model: "bytedance/seedance-2" }));
    expect(await within(sheet).findByText(/start from a picture, end on a last frame, use up to 9 reference pictures, follow a clip \(video to video\), follow sound you give it, make its own sound/)).toBeInTheDocument();
    expect((within(sheet).getByLabelText("Shape") as HTMLSelectElement).value).toBe("21:9");                // the film's own shape, because the model offers it
    await user.selectOptions(within(sheet).getByLabelText("Size"), "4k");
    await user.selectOptions(within(sheet).getByLabelText("Length"), "12");
    await user.selectOptions(within(sheet).getByLabelText(/Last frame/), "i2");
    await user.click(within(sheet).getByLabelText("Closing"));                                              // a reference picture
    await user.selectOptions(within(sheet).getByLabelText(/A clip to follow/), "v1");
    await user.selectOptions(within(sheet).getByLabelText(/Sound or voice to follow/), "s1");
    expect(within(sheet).getByText(/Kie.ai keeps uploaded files for 24 hours/)).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Confirm and make the clip" }));
    await waitFor(() => expect(calls.some((c) => c.method === "generate_start")).toBe(true));
    const start = calls.find((c) => c.method === "generate_start")!.params as { provider: string; params: Record<string, unknown>; files: Record<string, { paths: string[]; list: boolean }> };
    expect(start.provider).toBe("kie");
    expect(start.params).toEqual({ aspect_ratio: "21:9", resolution: "4k", duration: 12, generate_audio: true });
    expect(start.files).toEqual({ first_frame_url: { paths: ["assets/images/a.png"], list: false }, last_frame_url: { paths: ["assets/images/b.png"], list: false },
      reference_image_urls: { paths: ["assets/images/b.png"], list: true }, reference_video_urls: { paths: ["assets/video/c.mp4"], list: true }, reference_audio_urls: { paths: ["assets/audio/s.wav"], list: true } });
  }, 20000);
});
