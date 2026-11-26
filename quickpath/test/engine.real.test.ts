// Runs against the real EffectCraft. Skipped (and reported as skipped, never as passed) when it is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EffectCraft } from "../src/ec.ts";
import { buildComposition, renderVideo } from "../src/build.ts";
import { planFromWords, type Shape } from "../src/plan.ts";

const cli = process.env.EFFECTCRAFT_CLI ?? "C:/Program Files/EffectCraft/effectcraft-cli.exe";
const have = existsSync(cli);

for (const shape of ["16:9", "9:16", "1:1"] as Shape[]) {
  test(`a ${shape} video builds, renders to the right length, and the words appear`, { skip: have ? false : "EffectCraft not installed: NOT CHECKED" }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "qp-real-"));
    const ec = new EffectCraft(cli, [dir]);
    try {
      await ec.start();
      const plan = planFromWords("Introducing Lumen, the desk lamp that follows the sun, with soft light from morning to night. Pre-order today and be among the first.", 12);
      plan.scenes[0].sub = "A small line that is long enough to wrap onto a second line in a narrow frame";
      const built = await buildComposition(ec, plan, shape, dir);
      const before = await ec.still(built.comp, 0.0);
      const during = await ec.still(built.comp, 1.5);
      assert.ok(!before.equals(during), "the words fade in: the first frame and a frame at 1.5 s differ");
      const out = join(dir, "draft.mp4");
      const frames = await renderVideo(ec, built.comp, out, "draft");
      assert.equal(frames, Math.round(built.total * 30));
      assert.ok(statSync(out).size > 20_000, "a real movie file");
    } finally { ec.stop(); }
  });
}
