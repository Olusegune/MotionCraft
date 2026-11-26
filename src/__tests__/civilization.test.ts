import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beatsFromScript, parseEmotionArc, parseFonts, parseSettings, parseTimedScript } from "../lib/briefParse";
import { offlineIntent, reconcileArc } from "../lib/makeIt";
import { createProject } from "../lib/project";

/** The stress-test script exactly as the owner wrote it (two tables, unlabelled columns, a dash for no voiceover, a second table of single times). */
const script = readFileSync("docs/stress-test/civilization-script.md", "utf-8");

describe("the Civilization I–VII script as written", () => {
  const segs = parseTimedScript(script, 90);
  it("reads all ten shots with their times", () => {
    expect(segs.map((s) => [s.start, s.end])).toEqual([[0, 8], [8, 18], [18, 28], [28, 38], [38, 43], [43, 53], [53, 63], [63, 73], [73, 83], [83, 90]]);
  });
  it("reads the columns by their headings: the shot's name first, then what we see; the voiceover; a dash is no voiceover", () => {
    expect(segs[0].visual).toMatch(/^Opening · One window\. In a Lagos apartment/);
    expect(segs[0].audio).toBe("“It starts with a light coming on.”");
    expect(segs[5].audio).toBe("");                                  // Type IV has no voiceover ("—")
    expect(segs[9].audio).toBe("");
  });
  it("takes the on-screen text of each shot from the second table, and none for the final dinner shot", () => {
    expect(segs.map((s) => s.onScreen)).toEqual([
      "CIVILIZATION I–VII / What Would We Become?", "TYPE I · PLANETARY", "TYPE II · STELLAR", "TYPE III · GALACTIC", "BEYOND THE ORIGINAL KARDASHEV SCALE",
      "TYPE IV · UNIVERSAL", "TYPE V · MULTIVERSAL", "TYPE VI · SPACETIME ENGINEERING", "TYPE VII · UNIVERSE DESIGN", ""]);
  });
  it("names each scene from its shot", () => {
    const beats = beatsFromScript(segs, [], 90);
    expect(beats.map((b) => b.primary)).toEqual(["Opening · One window", "Type I · Planetary", "Type II · Stellar", "Type III · Galactic", "Transition · Beyond the original scale",
      "Type IV · Universal", "Type V · Multiversal", "Type VI · Spacetime engineering", "Type VII · Universe design", "Closing · Two places at the table"]);
  });
  it("gives the engine's offline draft ten scenes and a purpose", () => {
    const p = createProject("c");
    p.brief.text = script; p.brief.deliverables[0].durationSec = 90;
    const i = offlineIntent(p);
    expect(i.arc).toHaveLength(10);
    expect(i.arc[9].endSec).toBe(90);
  });
});

describe("script tables in other shapes", () => {
  it("still reads labelled cells and tables with no header", () => {
    const t = "| 0:00–0:02 | A point | On-screen text: HELLO | Audio: hum |";
    expect(parseTimedScript(t)).toEqual([{ start: 0, end: 2, visual: "A point", onScreen: "HELLO", audio: "hum" }]);
    expect(parseTimedScript("0:00-0:05 | a sky | WORDS | boom")).toEqual([{ start: 0, end: 5, visual: "a sky", onScreen: "WORDS", audio: "boom" }]);
  });
  it("keeps a header-less table's third column as on-screen text, as before", () => {
    const [s] = parseTimedScript("| 1:00–1:05 | Visual: sky | Words here | Audio: x |");
    expect(s.onScreen).toBe("Words here");
  });
  it("reads settings, journey and fonts from the brief text around the tables", () => {
    expect(parseSettings("A 90 second film in 21:9 at 24 fps").durationSec).toBe(90);
    expect(parseEmotionArc("The emotional journey is curiosity → awe → quiet mastery.")).toHaveLength(3);
    expect(parseFonts("Use Space Grotesk Medium for the title")).toEqual(expect.arrayContaining([expect.stringMatching(/Space Grotesk/)]));
  });
});

describe("lining the Director's scenes up with the script", () => {
  it("fills in a row the model dropped, from the script, and keeps the model's emotions for the rest", () => {
    const nine = parseTimedScript(script, 90).slice(0, 9).map((s, i) => ({ beatId: `m${i}`, startSec: s.start, endSec: s.end, primary: "awe", secondary: undefined, intensity: 4 as const, energy: 3 as const }));
    const arc = reconcileArc(nine, script, 90);
    expect(arc).toHaveLength(10);
    expect(arc[0]).toMatchObject({ primary: "awe", intensity: 4, startSec: 0, endSec: 8, beatId: "b1" });
    expect(arc[9]).toMatchObject({ startSec: 83, endSec: 90 });
    expect(arc[9].primary).toMatch(/^Closing/);
  });
  it("leaves the model's scenes alone when there is no timed script", () => {
    const arc = [{ beatId: "x", startSec: 0, endSec: 5, primary: "calm", intensity: 2 as const, energy: 2 as const }];
    expect(reconcileArc(arc, "Just a brief with no table.", 5)).toBe(arc);
  });
});

import { audioToAdd } from "../lib/makeIt";
describe("the project's sound goes into the composition", () => {
  const prov = { actor: "user" as const, provider: "import", model: "file", at: "t", licence: "own", costReported: false, costValue: null, costUnit: null };
  it("lists audio files that are not layers yet and leaves pictures alone", () => {
    const p = createProject("a");
    p.assets = [{ id: "i", kind: "image", path: "assets/images/a.png", provenance: prov }, { id: "s", kind: "audio", path: "assets/audio/imp-1-score.wav", provenance: prov }, { id: "t", kind: "audio", path: "assets/audio/imp-2-vo.wav", provenance: prov }];
    expect(audioToAdd(p, ["Background"])).toEqual(["assets/audio/imp-1-score.wav", "assets/audio/imp-2-vo.wav"]);
    expect(audioToAdd(p, ["imp-1-score.wav"])).toEqual(["assets/audio/imp-2-vo.wav"]);
    expect(audioToAdd(p, ["imp-1-score.wav", "imp-2-vo.wav"])).toEqual([]);
  });
});
