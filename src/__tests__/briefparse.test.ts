import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beatsFromScript, cuesFromScript, describeSettings, parseEmotionArc, parseSettings, parseTimedScript } from "../lib/briefParse";
import { nearestFps, resolutionOf, sizeFor } from "../lib/formats";

const TYPE_V = readFileSync("docs/stress-test/type-v-civilization-brief.md", "utf-8");

describe("reading the settings a brief states", () => {
  it("finds length, shape, frame rate and 4K in the TYPE V brief", () => {
    const s = parseSettings(TYPE_V);
    expect(s).toMatchObject({ durationSec: 10, aspect: "16:9", fps: 24, width: 3840, height: 2160 });
    expect(describeSettings(s)).toEqual(["10 seconds", "16:9", "24 fps", "3840 × 2160 (4K)"]);
  });

  it("reads other ways of saying it, keeps the first mention, and ignores what it cannot read", () => {
    expect(parseSettings("A 45-second explainer in 9:16 at 29.97 fps, 1080p")).toMatchObject({ durationSec: 45, aspect: "9:16", fps: 29.97, width: 1080, height: 1920 });
    expect(parseSettings("Deliver 2560x1080 at 25fps for 12.5 s")).toMatchObject({ width: 2560, height: 1080, aspect: "21:9", fps: 25, durationSec: 12.5 });
    expect(parseSettings("UHD vertical 9:16")).toMatchObject({ width: 2160, height: 3840 });
    expect(parseSettings("10 seconds then later 30 seconds").durationSec).toBe(10);
    expect(parseSettings("Make it feel calm and warm.")).toEqual({});
    expect(parseSettings("")).toEqual({});
    expect(parseSettings("0 seconds, 99999 seconds, 17 fps")).toEqual({});                       // out of range or not a frame rate we offer
    expect(parseSettings("at 3:45 pm in 16:9").aspect).toBe("16:9");                              // a clock time is not a ratio
    expect(parseSettings("see page 14:9 of the deck").aspect).toBeUndefined();
  });

  it("sizes and frame rates", () => {
    expect(sizeFor("16:9", 2)).toEqual({ width: 3840, height: 2160 });
    expect(sizeFor("21:9", 2)).toEqual({ width: 5120, height: 2160 });
    expect(sizeFor("1:1", 2 / 3)).toEqual({ width: 720, height: 720 });
    expect(resolutionOf({ aspect: "16:9", width: 3840, height: 2160 })).toBe("uhd4k");
    expect(resolutionOf({ aspect: "16:9", width: 1000, height: 600 })).toBeNull();
    expect(nearestFps(23.98)).toBe(23.976); expect(nearestFps(24.2)).toBe(24); expect(nearestFps(17)).toBeUndefined();
  });
});

describe("reading a timed script", () => {
  it("turns the TYPE V table into four scenes with their text and sound", () => {
    const seg = parseTimedScript(TYPE_V, 10);
    expect(seg.map((s) => [s.start, s.end])).toEqual([[0, 2], [2, 5], [5, 8], [8, 10]]);
    expect(seg[0].onScreen).toBe("BEYOND A SINGLE UNIVERSE");
    expect(seg[0].visual).toMatch(/tiny white point/);
    expect(seg[0].audio).toMatch(/crystalline pulse/);
    expect(seg[2].onScreen).toBe("TYPE V");
    expect(seg[2].audio).toMatch(/bass impact/);
    expect(seg[3].onScreen).toMatch(/CIVILIZATION beneath TYPE V/);
  });

  it("reads labelled pipe lines too, in any order, and the journey names the beats", () => {
    const text = [
      "0:00–0:02 | A tiny white point emerges. | On-screen text: BEYOND A SINGLE UNIVERSE | Audio: a quiet pulse rises.",
      "0:02–0:05 | Audio: a deep swell | The point expands. | On-screen text: the line dissolves.",
      "garbage | not a row", "| --- | --- |", "5-8s | Lines connect | TYPE V | A bass impact lands.",
    ].join("\n");
    const seg = parseTimedScript(text);
    expect(seg).toHaveLength(3);
    expect(seg[1]).toMatchObject({ start: 2, end: 5, visual: "The point expands.", onScreen: "the line dissolves.", audio: "a deep swell" });
    expect(seg[2]).toMatchObject({ start: 5, end: 8, onScreen: "TYPE V" });
  });

  it("drops rows that go backwards, overlap or fall outside the piece, and clips the last one", () => {
    const text = "0:00-0:04 | a | b | c\n0:03-0:06 | overlaps | x | y\n0:04-0:12 | long | t | s\n0:20-0:25 | after the end | t | s\n0:09-0:08 | backwards | t | s";
    const seg = parseTimedScript(text, 10);
    expect(seg.map((s) => [s.start, s.end])).toEqual([[0, 4], [4, 10]]);
    expect(parseTimedScript("no table here, just words")).toEqual([]);
    expect(parseTimedScript("")).toEqual([]);
  });

  it("finds the emotional journey and builds beats from it", () => {
    const journey = parseEmotionArc(TYPE_V);
    expect(journey).toEqual(["curiosity", "awe", "quiet mastery"]);
    const beats = beatsFromScript(parseTimedScript(TYPE_V, 10), journey, 10);
    expect(beats.map((b) => [b.startSec, b.endSec, b.primary])).toEqual([[0, 2, "curiosity"], [2, 5, "awe"], [5, 8, "awe"], [8, 10, "quiet mastery"]]);
    expect(beats.map((b) => b.beatId)).toEqual(["b1", "b2", "b3", "b4"]);
    for (const b of beats) { expect(b.intensity).toBeGreaterThanOrEqual(1); expect(b.intensity).toBeLessThanOrEqual(5); expect(b.energy).toBeGreaterThanOrEqual(1); expect(b.energy).toBeLessThanOrEqual(5); }
    expect(beats[2].energy).toBeGreaterThan(beats[0].energy);                                    // the bass impact is higher than the quiet pulse
    expect(beats[3].intensity).toBeGreaterThanOrEqual(beats[0].intensity);
    expect(parseEmotionArc("no journey here")).toEqual([]);
  });

  it("without a journey the beats take the opening words of each row, and there can be no beats at all", () => {
    const seg = parseTimedScript("0:00-0:05 | A slow reveal, then more | t | s\n0:05-0:10 | Lines connect | t | s");
    expect(beatsFromScript(seg).map((b) => b.primary)).toEqual(["A slow reveal", "Lines connect"]);
    expect(beatsFromScript([])).toEqual([]);
  });

  it("lists the sound cues at the start of the rows that have audio", () => {
    const cues = cuesFromScript(parseTimedScript(TYPE_V, 10));
    expect(cues).toHaveLength(4);
    expect(cues[2]).toEqual({ t: 5, text: expect.stringMatching(/^Sound at 0:05: A restrained bass impact/) });
    expect(cuesFromScript(parseTimedScript("0:00-0:05 | visual only | text |"))).toEqual([]);
  });
});
