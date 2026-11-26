import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanModelPlan, planFromWords, SHAPE_LIST, sceneCount, SIZES, spread } from "../src/plan.ts";
import { LOOKS, suggestLook } from "../src/looks.ts";
import { CAP, DESC, fitSize, LINE, layoutScene, safeText, wrapText } from "../src/build.ts";
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
  for (const { width: w, height: h } of SHAPE_LIST) {
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

test("words that look like file paths are kept as words (an invisible mark stops EffectCraft opening them as files)", () => {
  const ZW = String.fromCharCode(0x200b);
  for (const t of ["/slow start", "~/notes", "C:" + String.fromCharCode(92) + "Users", "c:/x", String.fromCharCode(92, 92) + "server", String.fromCharCode(92) + "x"]) assert.equal(safeText(t), ZW + t, t);
  for (const t of ["slow start", "50/50", "see C:" + String.fromCharCode(92) + "x", "C:", "a/b", "https://example.com", "@file", ""]) assert.equal(safeText(t), t, t);
});

test("every shape has a real size, a name, and a ratio that matches its size", () => {
  assert.deepEqual(SHAPE_LIST.map((x) => x.id), ["16:9", "9:16", "1:1", "4:5", "21:9", "4:3"]);
  for (const x of SHAPE_LIST) {
    const [a, b] = x.id.split(":").map(Number);
    // 21:9 is sold as 2560x1080 (2.37 to 1), a touch wider than an exact 21:9 (2.33 to 1): the size everyone means by it. The rest are exact.
    assert.ok(Math.abs(x.width / x.height - a / b) < (x.id === "21:9" ? 0.05 : 0.005), `${x.id} is ${x.width}x${x.height}`);
    assert.ok(x.name.length > 2);
    assert.ok(x.width % 2 === 0 && x.height % 2 === 0 && x.width <= 4096 && x.height <= 4096, "even sizes, within what video allows");
    assert.deepEqual(SIZES[x.id], { width: x.width, height: x.height });
  }
});

test("the small line never touches the headline, and everything stays inside the frame, in every shape (using EffectCraft's measured line spacing)", () => {
  const heads = ["Short", "Warm mornings start slowly with a cup of something good", "A very long headline that goes on for quite a few words so that it needs many lines in a narrow frame"];
  for (const { width: w, height: h } of SHAPE_LIST) for (const head of heads) for (const sub of ["", "Ember coffee brings you gently into the day", "A longer small line that also needs to wrap onto two or even three lines in a narrow frame"]) {
    const l = layoutScene(head, sub, w, h);
    const lastBase = l.headY + (l.lines - 1) * l.headSize * LINE;
    const headBottom = lastBase + DESC * l.headSize, headTop = l.headY - CAP * l.headSize;
    assert.ok(headTop > h * 0.04, `${w}x${h}: headline top ${headTop}`);
    if (sub) {
      const subTop = l.subY - CAP * l.subSize, subBottom = l.subY + (l.subLines - 1) * l.subSize * LINE + DESC * l.subSize;
      assert.ok(subTop - headBottom >= l.subSize * 0.3, `${w}x${h} "${head.slice(0, 12)}": gap ${(subTop - headBottom).toFixed(1)} under ${l.subSize * 0.3}`);
      assert.ok(subBottom < h * 0.96, `${w}x${h}: small line bottom ${subBottom}`);
    } else assert.ok(headBottom < h * 0.96, `${w}x${h}: headline bottom ${headBottom}`);
    assert.ok(l.barY > 0 && l.barY + l.barH < headTop, `${w}x${h}: the accent line sits above the words`);
  }
});
