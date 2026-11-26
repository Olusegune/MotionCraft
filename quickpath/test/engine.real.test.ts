// Runs against the real EffectCraft. Skipped (and reported as skipped, never as passed) when it is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { solidPng } from "./png.ts";
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

test("a scene with the person's own picture builds, shows the picture, and renders", { skip: have ? false : "EffectCraft not installed: NOT CHECKED" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-real-pic-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "0123456789ab.png"), solidPng(64, 36, [30, 160, 60]));
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const plan = planFromWords("A green field. Wake up slowly.", 6);
    plan.scenes[0].picture = "0123456789ab.png";
    plan.scenes[1].picture = "ffffffffffff.png";           // named but missing: the scene still builds, without it
    const built = await buildComposition(ec, plan, "16:9", dir);
    const still = await ec.still(built.comp, 1.0, 320);
    const png = PNG_PIXEL(still, 8, 8);                    // top-left corner: the green picture under a 45% black veil
    assert.ok(png.g > png.r + 20 && png.g > png.b + 20, `the picture shows, got ${JSON.stringify(png)}`);
    const frames = await renderVideo(ec, built.comp, join(dir, "d.mp4"), "draft");
    assert.equal(frames, Math.round(built.total * 30));
  } finally { ec.stop(); }
});

/** One pixel of a PNG made by EffectCraft (8-bit RGB or RGBA, non-interlaced), by unfiltering the rows. */
function PNG_PIXEL(buf: Buffer, x: number, y: number): { r: number; g: number; b: number } {
  const w = buf.readUInt32BE(16), bitDepth = buf[24], colorType = buf[25];
  assert.equal(bitDepth, 8);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(bpp, `unsupported PNG colour type ${colorType}`);
  const idat: Buffer[] = [];
  for (let i = 8; i < buf.length;) { const len = buf.readUInt32BE(i), type = buf.toString("ascii", i + 4, i + 8); if (type === "IDAT") idat.push(buf.subarray(i + 8, i + 8 + len)); i += 12 + len; }
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  const rows: Buffer[] = [];
  for (let r = 0; r <= y; r++) {
    const f = raw[r * (stride + 1)], line = Buffer.from(raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1)));
    const prev = rows[r - 1] ?? Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      line[i] = (line[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (pa <= pb && pa <= pc ? a : pb <= pc ? b : c))) & 255;
    }
    rows.push(line);
  }
  const o = x * bpp;
  return { r: rows[y][o], g: rows[y][o + 1], b: rows[y][o + 2] };
}
