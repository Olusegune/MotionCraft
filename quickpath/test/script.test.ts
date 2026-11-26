import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isNarrator, parseScript } from "../src/script.ts";
import { checkPlan } from "../src/server.ts";
import { sceneVoice } from "../src/sound.ts";

const SAMPLE = readFileSync(new URL("../samples/the-day-we-built-superintelligence.md", import.meta.url), "utf-8");

test("script: the sample film becomes seven timed scenes that add up to 90 seconds", () => {
  const p = parseScript(SAMPLE);
  assert.equal(p.title, "The Day We Built Superintelligence");
  assert.equal(p.scenes.length, 7);
  assert.deepEqual(p.scenes.map((s) => s.seconds), [10, 12, 13, 14, 16, 15, 10]);
  assert.equal(p.scriptSeconds, 90);
});

test("script: time cards, the end title, spoken words, speakers and sound are told apart", () => {
  const s = parseScript(SAMPLE).scenes;
  assert.equal(s[0].card, undefined);
  assert.equal(s[1].card, "DAY ZERO");
  assert.equal(s[2].card, "THREE MONTHS LATER");
  assert.equal(s[3].card, "ONE YEAR LATER");
  assert.equal(s[6].headline, "THE DAY WE BUILT SUPERINTELLIGENCE");
  assert.equal(s[0].say, "At 6:42, the lights went out on Tami’s street. She kept drawing them anyway.");
  assert.equal(s[4].say, "You counted one meter. How many families did you think lived behind it?");
  assert.equal(s[4].speaker, "Bisi, on mic");
  assert.ok(isNarrator(s[0].speaker) && !isNarrator(s[4].speaker));
  assert.match(s[0].sound, /^Pencil scratch/);
  assert.ok(s[1].note!.startsWith("The breakthrough."), "the picture direction keeps its words");
  assert.ok(!s[1].note!.includes("DAY ZERO") && !s[1].note!.includes("**"), "no card text or markdown left in the direction");
});

test("script: the plan it makes passes the same checks as one from the page", () => {
  const p = parseScript(SAMPLE);
  const plan = checkPlan({ ...p, scenes: p.scenes.map(({ speaker, sound, ...s }) => s) });
  assert.equal(plan.scenes.length, 7);
  assert.equal(plan.scenes[0].headline, "", "a scene with no words on screen is allowed when it has a direction");
  assert.equal(plan.scenes[1].card, "DAY ZERO");
});

test("script: awkward input gets plain sentences, never a crash", () => {
  assert.throws(() => parseScript("just some words"), /could not find any timed rows/);
  assert.throws(() => parseScript(""), /could not find any timed rows/);
  assert.throws(() => parseScript("| 00:10–00:05 | x | y |"), /do not go forward/);
  assert.throws(() => parseScript("| 00:00–00:10 | x | y |\n| 00:05–00:20 | x | y |"), /start before/);
  assert.throws(() => parseScript(Array.from({ length: 13 }, (_, i) => `| 00:${String(i * 5).padStart(2, "0")}–00:${String(i * 5 + 4).padStart(2, "0")} | x | y |`).join("\n")), /up to 12 scenes/);
  assert.throws(() => parseScript("| 00:00–05:00 | x | y |"), /under three minutes/);
  const odd = parseScript("| 0:00-0:04 | plain row, no bold | no quotes at all |");
  assert.equal(odd.scenes[0].seconds, 4);
  assert.equal(odd.scenes[0].say, undefined);
  assert.doesNotThrow(() => parseScript("|".repeat(5000) + "\n" + "| 00:00-00:03 | " + "x".repeat(20000) + " | y |"));
});

test("a scene's own voice wins over the video's, and only real voices count", () => {
  const plan = { title: "t", look: "midnight", source: "words", voice: "kie:EXAVITQu4vr4xnSDxMaL", scenes: [] } as any;
  assert.equal(sceneVoice(plan, {}), "kie:EXAVITQu4vr4xnSDxMaL");
  assert.equal(sceneVoice(plan, { voice: "openai:nova" }), "openai:nova");
  assert.equal(sceneVoice(plan, { voice: "../x" }), "kie:EXAVITQu4vr4xnSDxMaL");
  assert.equal(sceneVoice({ ...plan, voice: undefined }, {}), "");
  const checked = checkPlan({ scenes: [{ headline: "a", seconds: 3, voice: "kie:EXAVITQu4vr4xnSDxMaL" }, { headline: "b", seconds: 3, voice: "kie:notalistedvoice0000000" }, { headline: "c", seconds: 3, card: "X".repeat(200), note: "n".repeat(2000) }] });
  assert.equal(checked.scenes[0].voice, "kie:EXAVITQu4vr4xnSDxMaL");
  assert.equal(checked.scenes[1].voice, undefined, "an unlisted Kie voice is dropped");
  assert.equal(checked.scenes[2].card!.length, 60);
  assert.equal(checked.scenes[2].note!.length, 900);
});
