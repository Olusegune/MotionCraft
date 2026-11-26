import { describe, expect, it } from "vitest";
import { buildRequest, chooseAspect, durationChoices, formatDuration, nearestDuration, type ModelSchema } from "../lib/videoRequest";

const seedance: ModelSchema = {
  provider: "kie", model: "bytedance/seedance-2",
  caps: { text: true, imageFirst: true, imageLast: true, imageRefs: 9, videoRefs: 3, audioRefs: 3, soundOut: true, negativePrompt: false, seed: false,
          aspects: ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"], resolutions: ["480p", "720p", "1080p", "4k"], durations: { min: 4, max: 15, default: 5, type: "integer" } },
  fields: [
    { name: "prompt", role: "prompt", type: "string", required: true, description: "" },
    { name: "first_frame_url", role: "image_first", type: "string", required: false, description: "" },
    { name: "last_frame_url", role: "image_last", type: "string", required: false, description: "" },
    { name: "reference_image_urls", role: "image_refs", type: "array", list: true, maxItems: 9, required: false, description: "" },
    { name: "reference_video_urls", role: "video_refs", type: "array", list: true, maxItems: 3, required: false, description: "" },
    { name: "reference_audio_urls", role: "audio_refs", type: "array", list: true, maxItems: 3, required: false, description: "" },
    { name: "generate_audio", role: "sound", type: "boolean", required: false, default: true, description: "" },
    { name: "resolution", role: "resolution", type: "string", required: false, enum: ["480p", "720p", "1080p", "4k"], default: "720p", description: "" },
    { name: "aspect_ratio", role: "aspect_ratio", type: "string", required: false, enum: ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9", "adaptive"], default: "16:9", description: "" },
    { name: "duration", role: "duration", type: "integer", required: false, min: 4, max: 15, default: 5, description: "" },
  ],
};
const falVeo: ModelSchema = {
  provider: "fal", model: "fal-ai/veo3/fast/image-to-video",
  caps: { text: true, imageFirst: true, imageLast: false, imageRefs: 0, videoRefs: 0, audioRefs: 0, soundOut: true, negativePrompt: true, seed: true, aspects: ["auto", "16:9", "9:16"], resolutions: ["720p", "1080p"],
          durations: { values: ["4s", "6s", "8s"], default: "8s", type: "string" } },
  fields: [
    { name: "prompt", role: "prompt", type: "string", required: true, description: "" },
    { name: "image_url", role: "image_first", type: "string", required: true, description: "" },
    { name: "aspect_ratio", role: "aspect_ratio", type: "string", required: false, enum: ["auto", "16:9", "9:16"], default: "auto", description: "" },
    { name: "resolution", role: "resolution", type: "string", required: false, enum: ["720p", "1080p"], default: "720p", description: "" },
    { name: "duration", role: "duration", type: "string", required: false, enum: ["4s", "6s", "8s"], default: "8s", description: "" },
    { name: "generate_audio", role: "sound", type: "boolean", required: false, default: true, description: "" },
    { name: "negative_prompt", role: "negative_prompt", type: "string", required: false, description: "" },
    { name: "seed", role: "seed", type: "integer", required: false, description: "" },
  ],
};

describe("which aspect ratio a model is given", () => {
  it("uses the film's own when the model offers it (Seedance 2.0 does 21:9)", () => {
    expect(chooseAspect(seedance.caps.aspects, "21:9")).toBe("21:9");
  });
  it("otherwise the nearest shape, never auto while a real ratio is offered", () => {
    expect(chooseAspect(falVeo.caps.aspects, "21:9")).toBe("16:9");
    expect(chooseAspect(["auto", "16:9", "9:16"], "4:5")).toBe("9:16");
    expect(chooseAspect(["1:1", "16:9"], "2.39:1")).toBe("16:9");
    expect(chooseAspect(["adaptive"], "21:9")).toBe("adaptive");
    expect(chooseAspect([], "21:9")).toBeUndefined();
  });
});

describe("lengths", () => {
  it("lists the offered ones, or every second between the limits", () => {
    expect(durationChoices(falVeo.caps.durations)).toEqual([4, 6, 8]);
    expect(durationChoices(seedance.caps.durations)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(durationChoices({})).toEqual([]);
  });
  it("writes a length the way the model's field wants it", () => {
    expect(formatDuration(falVeo.fields[4], 6)).toBe("6s");
    expect(formatDuration({ ...falVeo.fields[4], enum: ["5", "10"] }, 10)).toBe("10");
    expect(formatDuration(seedance.fields[9], 8)).toBe(8);
    expect(nearestDuration([4, 6, 8], 7)).toBe(6);
    expect(nearestDuration([], 7)).toBeUndefined();
  });
});

describe("the request for a model", () => {
  it("Seedance 2.0 on Kie: start and last frame, references of every kind, 21:9, sound, 4k, 10 seconds", () => {
    const r = buildRequest(seedance, { firstFrame: "assets/images/a.png", lastFrame: "assets/images/b.png", refVideos: ["assets/video/c.mp4"], refAudios: ["assets/audio/s.wav"],
      refImages: ["assets/images/a.png", "assets/images/b.png"], resolution: "4k", duration: 10, sound: true }, "21:9");
    expect(r.params).toEqual({ aspect_ratio: "21:9", resolution: "4k", duration: 10, generate_audio: true });
    expect(r.files).toEqual({ first_frame_url: { paths: ["assets/images/a.png"], list: false }, last_frame_url: { paths: ["assets/images/b.png"], list: false },
      reference_image_urls: { paths: ["assets/images/a.png", "assets/images/b.png"], list: true }, reference_video_urls: { paths: ["assets/video/c.mp4"], list: true },
      reference_audio_urls: { paths: ["assets/audio/s.wav"], list: true } });
  });
  it("fal's Veo 3 Fast: its own names and its text lengths, with no last frame or references to send", () => {
    const r = buildRequest(falVeo, { firstFrame: "assets/images/a.png", lastFrame: "assets/images/b.png", refImages: ["assets/images/b.png"], duration: 4, resolution: "720p", sound: false, negative: "text, logos", seed: 7 }, "21:9");
    expect(r.params).toEqual({ aspect_ratio: "16:9", resolution: "720p", duration: "4s", generate_audio: false, negative_prompt: "text, logos", seed: 7 });
    expect(r.files).toEqual({ image_url: { paths: ["assets/images/a.png"], list: false } });
  });
  it("never sends a setting the model does not have or a value it does not offer", () => {
    const r = buildRequest(falVeo, { resolution: "4k", duration: 7 }, "16:9");
    expect(r.params.resolution).toBeUndefined();                    // 4k is not one of its sizes
    expect(r.params.duration).toBe("6s");                           // the nearest it offers
    expect(buildRequest(seedance, { negative: "x", seed: 1 }, "16:9").params).toEqual({ aspect_ratio: "16:9" });   // no negative prompt or seed field on this model
  });
  it("caps references at the model's limit", () => {
    const many = Array.from({ length: 12 }, (_, i) => `assets/images/p${i}.png`);
    expect(buildRequest(seedance, { refImages: many }, "16:9").files.reference_image_urls.paths).toHaveLength(9);
  });
});
