import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanModelPlan, planFromWords, sceneCount, spread } from "../src/plan.ts";
import { LOOKS, suggestLook } from "../src/looks.ts";
import { fitSize, layoutScene, wrapText } from "../src/build.ts";
import { checkPlan } from "../src/server.ts";

const sum = (a: number[]) => Math.round(a.reduce((n, x) => n + x, 0) * 10) / 10;

test("scene count follows the length, between 2 and 8", () => {
  assert.equal(sceneCount(6), 2);
  assert.equal(sceneCount(15), 4);
  assert.equal(sceneCount(60), 8);
  assert.equal(sceneCount(120), 8);
});

test("spread gives every scene at least 2 s and the total the asked length", () => {
  for (const [n, s] of [[3, 15], [4, 15], [8, 60], [5, 10]] as const) {
    const out = spread(n, s);
    assert.equal(out.length, n);
    assert.ok(out.every((x) => x >= 2));
    assert.ok(Math.abs(sum(out) - Math.max(s, n * 2)) < 0.6, `${n} scenes over ${s}s gave ${sum(out)}`);
  }
});

test("the idea's own words become the scenes, in order, with no invented text", () => {
  const idea = "A teaser for Ember. Warm mornings start slowly. Steam rising, a pour into a cup. Wake up slowly.";
  const p = planFromWords(idea, 15);
  assert.equal(p.source, "words");
  assert.ok(p.scenes.length >= 2 && p.scenes.length <= 4);
  const joined = p.scenes.map((s) => `${s.headline} ${s.sub}`).join(" ").toLowerCase();
  for (const w of ["ember", "warm mornings", "wake up slowly"]) assert.ok(joined.includes(w), w);
});

test("a one-word idea still makes a video", () => {
  const p = planFromWords("Hello", 10);
  assert.equal(p.scenes.length, 1);
  assert.equal(p.scenes[0].headline, "Hello");
});

test("a model's answer is cleaned and bad shapes are refused", () => {
  assert.equal(cleanModelPlan(null, 15), null);
  assert.equal(cleanModelPlan({ scenes: "no" }, 15), null);
  assert.equal(cleanModelPlan({ scenes: [{ headline: "Only one" }] }, 15), null);
  const p = cleanModelPlan({ title: ' "Hi" ', look: "nope", scenes: [{ headline: "A  b" }, { text: "Second", subtitle: "x" }, { headline: "" }] }, 12)!;
  assert.equal(p.scenes.length, 2);
  assert.equal(p.scenes[0].headline, "A b");
  assert.equal(p.scenes[1].sub, "x");
  assert.equal(p.look, "");
  assert.equal(p.source, "model");
});

test("a look is suggested from the idea's words", () => {
  assert.equal(suggestLook("a cozy coffee morning").id, "sunrise");
  assert.equal(suggestLook("eco garden plants").id, "forest");
  assert.equal(suggestLook("zzz").id, LOOKS[0].id);
});

test("text wraps evenly and sizes to fit", () => {
  const lines = wrapText("Warm mornings start slowly with steam rising", 22);
  assert.ok(lines.length >= 2);
  assert.ok(!lines.some((l) => l.split(" ").length === 1 && lines.length > 2), `orphan word in ${JSON.stringify(lines)}`);
  assert.ok(Math.max(...lines.map((l) => l.length)) - Math.min(...lines.map((l) => l.length)) <= 14);
  assert.deepEqual(wrapText("Supercalifragilisticexpialidocious", 10), ["Supercalifragilisticexpialidocious"]);
  assert.equal(fitSize(["short"], 1500, 132), 132);
  assert.ok(fitSize(["a very very long headline that is wide"], 1000, 132) < 132);
});

test("a scene's layout stays inside the frame in every shape", () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    const l = layoutScene("Warm mornings start slowly with steam rising and a pour into a cup", "A small line under the headline that is a little long", w, h);
    assert.ok(l.headY > 0 && l.headY < h, `head ${l.headY} in ${w}x${h}`);
    assert.ok(l.subY > l.headY && l.subY < h);
    assert.ok(l.barY > 0 && l.barY < l.headY);
    assert.ok(Math.max(...l.headline.split("\n").map((x) => x.length)) * l.headSize * 0.52 <= w * 0.8, "widest line fits");
  }
});

test("the server never trusts a plan from the page", () => {
  assert.throws(() => checkPlan(null));
  assert.throws(() => checkPlan({ scenes: [] }));
  assert.throws(() => checkPlan({ scenes: Array(13).fill({ headline: "x", seconds: 3 }) }));
  assert.throws(() => checkPlan({ scenes: [{ headline: "  ", seconds: 3 }] }));
  assert.throws(() => checkPlan({ scenes: Array(7).fill({ headline: "x", seconds: 30 }) }), /three minutes/);
  const p = checkPlan({ look: "../../etc", title: "t".repeat(200), scenes: [{ headline: "h".repeat(500), sub: 5, seconds: 9999 }] });
  assert.equal(p.look, LOOKS[0].id);
  assert.equal(p.title.length, 60);
  assert.equal(p.scenes[0].headline.length, 90);
  assert.equal(p.scenes[0].seconds, 30);
  assert.equal(p.scenes[0].sub, "5");
});
