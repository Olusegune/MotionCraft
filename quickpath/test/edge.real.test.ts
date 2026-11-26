// Awkward input against the real EffectCraft: whatever a person can type must build, render, and show the words, never crash or leave a blank frame.
// Skipped (and reported as skipped, never as passed) when EffectCraft is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EffectCraft } from "../src/ec.ts";
import { buildComposition, renderVideo } from "../src/build.ts";
import type { Plan, Shape } from "../src/plan.ts";

const cli = process.env.EFFECTCRAFT_CLI ?? "C:/Program Files/EffectCraft/effectcraft-cli.exe";
const skip = existsSync(cli) ? false : "EffectCraft not installed: NOT CHECKED";

const plan = (scenes: { headline: string; sub?: string; seconds?: number }[], look = "midnight"): Plan => ({
  title: "edge", look, source: "words", scenes: scenes.map((s) => ({ headline: s.headline, sub: s.sub ?? "", seconds: s.seconds ?? 3 })),
});

async function run(p: Plan, shape: Shape = "16:9") {
  const dir = mkdtempSync(join(tmpdir(), "qp-edge-"));
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const built = await buildComposition(ec, p, shape, dir);
    const early = await ec.still(built.comp, 0.0, 320);
    const shown = await ec.still(built.comp, 1.4, 320);
    const out = join(dir, "d.mp4");
    const frames = await renderVideo(ec, built.comp, out, "draft");
    return { built, frames, size: statSync(out).size, textAppears: !early.equals(shown) };
  } finally { ec.stop(); }
}

const CASES: [string, { headline: string; sub?: string }][] = [
  ["quotes and apostrophes", { headline: `She said "hello" and it's fine`, sub: `Don't "quote" me` }],
  ["backslashes and slashes", { headline: "C:\\Users\\me\\file / path \\n not a newline", sub: "a\\b" }],
  ["a headline that starts with a slash", { headline: "/slow start", sub: "~/notes and more" }],
  ["a path-like second line", { headline: ["line one", "/line two", "~three"].join(String.fromCharCode(10)), sub: ["sub one", "\\\\four"].join(String.fromCharCode(10)) }],
  ["a network path", { headline: "\\\\server\\share is not a file", sub: "C:/Users/me/x.txt" }],
  ["a real newline inside the words", { headline: "First line\nSecond line", sub: "x\ny" }],
  ["emoji", { headline: "Coffee time ☕🔥 let's go 🚀", sub: "✨ new ✨" }],
  ["Chinese, Japanese and Korean", { headline: "早上好，开始美好的一天", sub: "おはようございます 좋은 아침" }],
  ["Arabic (right to left)", { headline: "صباح الخير يا صديقي", sub: "ابدأ يومك ببطء" }],
  ["accents and symbols", { headline: "Café crème — déjà vu & <b>bold</b> % $ # @ ! ?", sub: "© ® ™ € £ ¥" }],
  ["one very long word", { headline: "Supercalifragilisticexpialidocious".repeat(3), sub: "" }],
  ["a very long sentence", { headline: "word ".repeat(40).trim(), sub: "more ".repeat(40).trim() }],
  ["a single character", { headline: "A", sub: "" }],
  ["only punctuation", { headline: "...!!!???", sub: "---" }],
  ["only spaces in the small line", { headline: "Headline", sub: "     " }],
];

for (const [name, s] of CASES) {
  test(`odd text builds, renders and shows: ${name}`, { skip }, async () => {
    const r = await run(plan([s, { headline: "Second scene", sub: "with a small line" }]));
    assert.equal(r.frames, Math.round(r.built.total * 30));
    assert.ok(r.size > 10_000);
    assert.ok(r.textAppears, "the words fade in: the first frame and a frame at 1.4 s differ");
  });
}

test("the extremes: 12 scenes of the minimum length, and 8 scenes over 120 s", { skip }, async () => {
  const many = plan(Array.from({ length: 12 }, (_, i) => ({ headline: `Scene number ${i + 1}`, sub: "tiny", seconds: 1.5 })));
  const a = await run(many);
  assert.equal(a.built.total, 18);
  assert.equal(a.frames, 540);
  const long = plan(Array.from({ length: 8 }, (_, i) => ({ headline: `Long scene ${i + 1}`, sub: "", seconds: 15 })), "pop");
  const b = await run(long, "9:16");
  assert.equal(b.built.total, 120);
  assert.equal(b.frames, 3600);
});

test("every look builds in every shape", { skip }, async () => {
  const { LOOKS } = await import("../src/looks.ts");
  for (const l of LOOKS) for (const shape of ["16:9", "9:16", "1:1"] as Shape[]) {
    const r = await run(plan([{ headline: `${l.name} in ${shape}`, sub: "check" }], l.id), shape);
    assert.ok(r.textAppears, `${l.id} ${shape}`);
  }
});

test("two videos built at the same time in one process do not disturb each other", { skip }, async () => {
  const [a, b] = await Promise.all([run(plan([{ headline: "Video A", sub: "first" }, { headline: "More A" }])), run(plan([{ headline: "Video B" }, { headline: "More B" }, { headline: "Even more B" }]), "1:1")]);
  assert.equal(a.built.total, 6);
  assert.equal(b.built.total, 9);
  assert.ok(a.textAppears && b.textAppears);
});
