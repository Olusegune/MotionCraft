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

test("every shape builds with two looks, and every look builds in the wide shape", { skip }, async () => {
  const { LOOKS } = await import("../src/looks.ts");
  const { SHAPE_LIST } = await import("../src/plan.ts");
  for (const sh of SHAPE_LIST) for (const look of ["midnight", "paper"]) {
    const r = await run(plan([{ headline: `${look} in ${sh.id}`, sub: "a small line that wraps in a narrow frame" }], look), sh.id);
    assert.ok(r.textAppears, `${look} ${sh.id}`);
  }
  for (const l of LOOKS) {
    const r = await run(plan([{ headline: `${l.name} wide`, sub: "check" }], l.id), "16:9");
    assert.ok(r.textAppears, l.id);
  }
});

test("each shape renders at its own size: the draft is half of it, and the picture keeps its shape", { skip }, async () => {
  const { execFileSync } = await import("node:child_process");
  const { SHAPE_LIST } = await import("../src/plan.ts");
  let probe = true;
  try { execFileSync("ffprobe", ["-version"], { stdio: "ignore" }); } catch { probe = false; }
  for (const sh of SHAPE_LIST) {
    const dir = mkdtempSync(join(tmpdir(), "qp-shape-"));
    const ec = new EffectCraft(cli, [dir]);
    try {
      await ec.start();
      const built = await buildComposition(ec, plan([{ headline: `Shape ${sh.id}`, sub: "check the frame" }, { headline: "Second" }]), sh.id, dir);
      assert.equal(built.width, sh.width);
      assert.equal(built.height, sh.height);
      const out = join(dir, "d.mp4");
      await renderVideo(ec, built.comp, out, "draft");
      if (probe) {
        const [w, h] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", out]).toString().trim().split(",").map(Number);
        const half = (n: number) => Math.floor(n / 2 / 2) * 2;          // half size, rounded down to an even number (video sizes must be even): 4:5 gives 540 by 674
        assert.equal(w, half(sh.width), `${sh.id} draft width`);
        assert.equal(h, half(sh.height), `${sh.id} draft height`);
      }
    } finally { ec.stop(); }
  }
});

test("two videos built at the same time in one process do not disturb each other", { skip }, async () => {
  const [a, b] = await Promise.all([run(plan([{ headline: "Video A", sub: "first" }, { headline: "More A" }])), run(plan([{ headline: "Video B" }, { headline: "More B" }, { headline: "Even more B" }]), "1:1")]);
  assert.equal(a.built.total, 6);
  assert.equal(b.built.total, 9);
  assert.ok(a.textAppears && b.textAppears);
});
