import { describe, expect, it } from "vitest";
import { createProject } from "../lib/project";
import { defaultAnimate, screenText, videoPrompt } from "../lib/videoPrompt";
import { scenePictureItems } from "../lib/makeIt";
import { screenPrompt } from "../pages/SceneMaker";
import { stillAspect } from "../lib/models";
import type { Beat } from "../types";

const beat: Beat = { beatId: "a", startSec: 0, endSec: 8, primary: "wonder", secondary: "", intensity: 3, energy: 3 };
const prov = { actor: "user" as const, provider: "fal", model: "m", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null };

describe("green and blue screen clips for compositing", () => {
  it("asks the model for one flat evenly lit screen and keeps the colour off the subject", () => {
    const p = createProject("x");
    p.intent.arc = [beat];
    const plain = videoPrompt(p, beat, defaultAnimate(p, beat));
    expect(plain).not.toMatch(/chroma-key/);
    const g = videoPrompt(p, beat, { ...defaultAnimate(p, beat), keyColor: "green" });
    expect(g).toContain("pure chroma-key green (RGB 0, 177, 64)");
    expect(g).toMatch(/no gradient/);
    expect(g).toMatch(/none of that colour on the subject/);
    expect(g).not.toMatch(/Keep the same people, faces, clothing, lighting and setting/);       // the setting is replaced, not kept
    expect(videoPrompt(p, beat, { ...defaultAnimate(p, beat), keyColor: "blue" })).toContain("RGB 0, 71, 255");
    expect(screenText("blue")).not.toContain("green");
  });
  it("a hand-written prompt is still sent as written", () => {
    const p = createProject("x");
    expect(videoPrompt(p, beat, { ...defaultAnimate(p, beat), keyColor: "green", prompt: "My own words." })).toBe("My own words.");
  });
  it("a keyed scene's clip is placed with its screen taken out; a plain one is not", () => {
    const p = createProject("x");
    p.intent.arc = [beat, { ...beat, beatId: "b", startSec: 8, endSec: 16 }];
    p.assets = [{ id: "v1", kind: "video", path: "assets/video/a.mp4", name: "A", provenance: prov }, { id: "v2", kind: "video", path: "assets/video/b.mp4", name: "B", provenance: prov }];
    p.treatment = { a: { plan: "", motion: "", frameAssetId: "v1", animate: { ...defaultAnimate(p, beat), keyColor: "green" } }, b: { plan: "", motion: "", frameAssetId: "v2" } };
    const items = scenePictureItems(p);
    expect(items[0]).toMatchObject({ rel: "assets/video/a.mp4", key: "green" });
    expect(items[1].key).toBeUndefined();
  });
  it("a picture made on a screen is the one a video model can keep: its prompt asks for the subject alone, and animating it starts keyed", () => {
    const p = createProject("x");
    p.brief.deliverables[0].aspect = "21:9";
    p.intent.arc = [beat];
    p.treatment = { a: { plan: "In a Lagos apartment, a teenager drops their bag.", motion: "", frameAssetId: "s1" } };
    p.assets = [{ id: "s1", kind: "image", path: "assets/images/s.png", name: "S", screen: "green", provenance: prov }];
    const pic = screenPrompt(p, beat, "green");
    expect(pic).toMatch(/subject alone/);
    expect(pic).toContain("pure chroma-key green (RGB 0, 177, 64) screen");
    expect(pic).toMatch(/no room, furniture, sky or scenery/);
    expect(pic).toMatch(/Ignore any place or setting named above/);                // the plan's "Lagos apartment" must not come back as scenery
    expect(defaultAnimate(p, beat).keyColor).toBe("green");                       // the picture's screen carries over
    p.assets[0].screen = undefined;
    expect(defaultAnimate(p, beat).keyColor).toBeUndefined();
    expect(videoPrompt(p, beat, { ...defaultAnimate(p, beat), keyColor: "green" })).toMatch(/Keep that screen exactly as it is/);
  });
  it("a picture is asked for in a shape image models accept, the nearest to the film's", () => {
    expect(stillAspect("21:9")).toBe("16:9");
    expect(stillAspect("16:9")).toBe("16:9");
    expect(stillAspect("9:16")).toBe("9:16");
    expect(stillAspect("4:5")).toBe("3:4");
    expect(stillAspect("1:1")).toBe("1:1");
    expect(stillAspect("nonsense")).toBe("16:9");
  });
  it("a screen picture is animated locked off, and a new picture replaces the old still, so the dialog uses the new one", () => {
    const p = createProject("x");
    p.intent.arc = [beat];
    p.assets = [{ id: "s1", kind: "image", path: "assets/images/s.png", name: "S", screen: "green", provenance: prov }];
    p.treatment = { a: { plan: "", motion: "", frameAssetId: "s1" } };
    expect(defaultAnimate(p, beat)).toMatchObject({ keyColor: "green", camera: "hold" });
    p.treatment.a.animate = { ...defaultAnimate(p, beat), keyColor: undefined, camera: "push" };       // settings saved from an earlier clip on a plain picture
    expect(defaultAnimate(p, beat)).toMatchObject({ keyColor: "green", camera: "push" });             // keeps the person's choices, adds the screen
  });
});
