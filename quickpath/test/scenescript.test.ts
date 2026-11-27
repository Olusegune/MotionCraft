import { test } from "node:test";
import assert from "node:assert/strict";
import { looksLikeSceneScript, parseSceneScript } from "../src/scenescript.ts";
import { parseScript } from "../src/script.ts";
import { checkPlan } from "../src/server.ts";

const DASH = "—";
// The shape a PDF or Word script has once its text is read out: a title, some notes, then SCENE n blocks, an END and some notes after.
const SAMPLE = `THE LONG WAY HOME

A short film about a lighthouse keeper

Format: scene script · Aspect ratio: 16:9

SCENE 1 ${DASH} THE LAST LIGHT

COLD OPEN / INTRO ${DASH} INT. LIGHTHOUSE ${DASH} NIGHT

A single faint lamp swings across the sea. The keeper watches it dim.

At “Strap in,” he pulls the lever.

SCENE 2 ${DASH} THE STORM

VERSE 1 ${DASH} EXT. CLIFF

Waves climb the rocks. The keeper climbs the stairs. ${"The lamp flickers. ".repeat(60)}

SCENE 3 ${DASH} MORNING

OUTRO ${DASH} EXT. HARBOUR ${DASH} DAWN

Boats come in with the light.

END.

Direction and science notes

SCENE 4 ${DASH} SHOULD NOT BE READ because it is after the notes
`;

test("a scene script becomes one scene per SCENE heading, with no words on screen, and stops at END", () => {
  assert.ok(looksLikeSceneScript(SAMPLE));
  assert.ok(!looksLikeSceneScript("just some words"));
  const p = parseScript(SAMPLE);                 // the usual entry point falls through to the scene reader
  assert.equal(p.title, "THE LONG WAY HOME");
  assert.equal(p.scenes.length, 3, "nothing after END counts");
  for (const s of p.scenes) { assert.equal(s.headline, ""); assert.equal(s.say, undefined); assert.ok(s.note && s.note.length > 10); }
  assert.match(p.scenes[0].note!, /^THE LAST LIGHT\. COLD OPEN \/ INTRO/);
  assert.match(p.scenes[0].note!, /A single faint lamp swings across the sea\./);
  assert.ok(p.scenes.every((s) => s.note!.length <= 900), "a long scene is cut to fit");
});

test("with no times in the script, lengths are a fair guess that favours scenes with more to show, and always fit the plan's limits", () => {
  const p = parseSceneScript(SAMPLE);
  assert.ok(p.scenes[1].seconds > p.scenes[0].seconds && p.scenes[1].seconds > p.scenes[2].seconds, "the long scene is longer");
  for (const s of p.scenes) assert.ok(s.seconds >= 4 && s.seconds <= 30, `${s.seconds}`);
  assert.ok(Math.abs(p.scriptSeconds - 45) <= 6, `about 15 s a scene, got ${p.scriptSeconds}`);
  const plan = checkPlan({ ...p, scenes: p.scenes.map(({ speaker, sound, ...s }) => s) });
  assert.equal(plan.scenes.length, 3, "a plan with scenes that have only a direction is accepted");
});

test("awkward scene scripts get plain sentences or sensible results, never a crash", () => {
  assert.throws(() => parseSceneScript("nothing here"), /could not find any scenes/);
  assert.throws(() => parseSceneScript(Array.from({ length: 13 }, (_, i) => `SCENE ${i + 1} ${DASH} X\nsomething`).join("\n")), /up to 12 scenes/);
  const one = parseSceneScript(`SCENE 1 ${DASH} ONLY\nA lone scene.`);
  assert.equal(one.scenes.length, 1);
  assert.ok(one.scenes[0].seconds >= 4);
  const noWhere = parseSceneScript(`SCENE 1 - plain heading with a hyphen\nlower case first line that is not a where line.`);
  assert.match(noWhere.scenes[0].note!, /lower case first line/);
  assert.ok(!parseSceneScript(`SCENE 1 ${DASH} WHOSE STORY?
OUTRO ${DASH} EXT. OBSERVATORY
He looks up.`).scenes[0].note!.includes("?."), "no doubled marks after a title ending in a question mark");
  assert.doesNotThrow(() => parseSceneScript("SCENE 1 " + DASH + " " + "x".repeat(50000)));
  assert.doesNotThrow(() => parseSceneScript("\n".repeat(100000) + `SCENE 1 ${DASH} A\nb`));
  assert.equal(parseSceneScript(`SCENE 1 ${DASH} A\n**bold** text with **marks**`).scenes[0].note!.includes("**"), false);
  // a timed table still wins over scenes when it has times
  const mixed = parseScript(`| **00:00–00:05** | **One.** A picture. | **VO:** “Hi.” |\n\nSCENE 1 ${DASH} IGNORED\nx`);
  assert.equal(mixed.scenes.length, 1);
  assert.equal(mixed.scenes[0].seconds, 5);
});
