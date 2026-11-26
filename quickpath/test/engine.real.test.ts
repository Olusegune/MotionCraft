// Runs against the real EffectCraft. Skipped (and reported as skipped, never as passed) when it is not installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { solidPng } from "./png.ts";
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EffectCraft } from "../src/ec.ts";
import { buildComposition, renderVideo } from "../src/build.ts";
import { planFromWords, type Shape } from "../src/plan.ts";
import { resolveSound } from "../src/sound.ts";
import { windowsVoices } from "../src/voice.ts";

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

const ffmpegOk = (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } })();

test("clips build: one shorter than its scene holds its last frame, one longer is trimmed, both start with their scene", { skip: have && ffmpegOk ? false : "EffectCraft or ffmpeg missing: NOT CHECKED" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-real-clip-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  const src = join(dir, "src.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0xC81E1E:size=320x180:duration=1.5:rate=30", "-pix_fmt", "yuv420p", src]);
  copyFileSync(src, join(dir, "assets", "aaaaaaaaaaaa.mp4"));       // 1.5 s: shorter than its 3.8 s scene
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x1EC81E:size=320x180:duration=8:rate=30", "-pix_fmt", "yuv420p", join(dir, "assets", "bbbbbbbbbbbb.mp4")]);   // 8 s: longer than its scene
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const plan = planFromWords("One scene with a short clip. Another scene with a long clip.", 8);
    assert.equal(plan.scenes.length, 2);
    plan.scenes[0].picture = "aaaaaaaaaaaa.mp4";
    plan.scenes[1].picture = "bbbbbbbbbbbb.mp4";
    const built = await buildComposition(ec, plan, "16:9", dir);
    const t0 = plan.scenes[0].seconds;
    const red = PNG_PIXEL(await ec.still(built.comp, t0 - 0.5, 320), 8, 8);        // late in scene 1, long after its 1.5 s clip ended: the last frame is held
    assert.ok(red.r > red.g + 20 && red.r > red.b + 20, `held red frame, got ${JSON.stringify(red)}`);
    const green = PNG_PIXEL(await ec.still(built.comp, t0 + 0.6, 320), 8, 8);      // just into scene 2: the long clip has started, from its own first frame
    assert.ok(green.g > green.r + 20 && green.g > green.b + 20, `green clip, got ${JSON.stringify(green)}`);
    const end = PNG_PIXEL(await ec.still(built.comp, built.total - 0.3, 320), 8, 8);
    assert.ok(end.g > end.r + 20, `still green at the end, got ${JSON.stringify(end)}`);
    const frames = await renderVideo(ec, built.comp, join(dir, "d.mp4"), "draft");
    assert.equal(frames, Math.round(built.total * 30));
  } finally { ec.stop(); }
});

const streams = (file: string) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "csv=p=0", file]).toString().trim().split(String.fromCharCode(10)).map((x) => x.trim());
const meanDb = (file: string, from: number, len: number) => {
  const out = execFileSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(len), "-i", file, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  return out;
};

test("sound: a voice and music are in the rendered movie, scenes stretch to fit the voice, and no sound means no audio track", { skip: have && ffmpegOk && process.platform === "win32" ? false : "EffectCraft, ffmpeg or Windows voices missing: NOT CHECKED" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-real-sound-"));
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const voice = `win:${(await windowsVoices())[0]}`;
    const plan = planFromWords("Warm mornings start slowly with a cup of something good and a quiet window. Wake up slowly.", 8);
    plan.voice = voice;
    plan.music = { mood: "warm", level: "medium" };
    plan.scenes[0].seconds = 2;                                  // far too short for the sentence: the scene must grow to fit its voice
    const { plan: fitted, sound } = await resolveSound(dir, plan);
    assert.ok(fitted.scenes[0].seconds > 3, `scene 1 grew to fit its voice, got ${fitted.scenes[0].seconds}`);
    assert.ok(sound.voices.every((v) => v && v.seconds > 0.5));
    assert.ok(sound.music);
    const built = await buildComposition(ec, fitted, "16:9", dir, sound);
    const out = join(dir, "sound.mp4");
    await renderVideo(ec, built.comp, out, "draft");
    const s = streams(out);
    assert.ok(s.some((x) => x.startsWith("audio")), `an audio track, got ${s}`);
    const audioLen = Number(s.find((x) => x.startsWith("audio"))!.split(",")[1]);
    assert.ok(Math.abs(audioLen - built.total) < 0.3, `audio length ${audioLen} matches video ${built.total}`);
    assert.ok(!/mean_volume: -(?:6\d|inf)/.test(meanDb(out, 1, 2)), "there is sound in the first seconds");
    const quiet = await resolveSound(dir, { ...plan, voice: undefined, music: undefined });
    const dir2 = mkdtempSync(join(tmpdir(), "qp-real-silent-"));
    const ec2 = new EffectCraft(cli, [dir2]);
    try {
      await ec2.start();
      const b2 = await buildComposition(ec2, quiet.plan, "16:9", dir2, quiet.sound);
      const out2 = join(dir2, "silent.mp4");
      await renderVideo(ec2, b2.comp, out2, "draft");
      assert.ok(!streams(out2).some((x) => x.startsWith("audio")), "no sound chosen: no audio track");
    } finally { ec2.stop(); }
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

test("chained clips: a scene plays its clips one after the other, each from its own start, and the last one holds", { skip: have && ffmpegOk ? false : "EffectCraft or ffmpeg missing: NOT CHECKED" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-real-chain-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  const make = (name: string, color: string) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:size=320x180:duration=2:rate=30`, "-pix_fmt", "yuv420p", join(dir, "assets", name)]);
  make("aaaaaaaaaaaa.mp4", "0xC81E1E"); make("bbbbbbbbbbbb.mp4", "0x1EC81E"); make("cccccccccccc.mp4", "0x1E1EC8");     // red, green, blue: 2 s each
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const plan = planFromWords("One long scene made of three clips. Then a short one.", 8);
    plan.scenes = [{ ...plan.scenes[0], seconds: 7, picture: "aaaaaaaaaaaa.mp4", more: ["bbbbbbbbbbbb.mp4", "cccccccccccc.mp4"] }, { ...plan.scenes[1], seconds: 2 }];
    const built = await buildComposition(ec, plan, "16:9", dir);
    const at = async (t: number) => PNG_PIXEL(await ec.still(built.comp, t, 320), 8, 8);
    const red = await at(1.0), green = await at(3.0), blue = await at(5.0), held = await at(6.8);
    assert.ok(red.r > red.g + 20 && red.r > red.b + 20, `red first, got ${JSON.stringify(red)}`);
    assert.ok(green.g > green.r + 20 && green.g > green.b + 20, `green second, got ${JSON.stringify(green)}`);
    assert.ok(blue.b > blue.r + 20 && blue.b > blue.g + 20, `blue third, got ${JSON.stringify(blue)}`);
    assert.ok(held.b > held.r + 20 && held.b > held.g + 20, `the last clip holds to the end of the scene, got ${JSON.stringify(held)}`);
  } finally { ec.stop(); }
});

test("loudness and effects on the real engine: a quiet and a loud voice come out within 3 dB of each other, and an effect is heard in its scene and nowhere else", { skip: have && ffmpegOk ? false : "EffectCraft or ffmpeg missing: NOT CHECKED" }, async () => {
  const { writeWav } = await import("../src/wav.ts");
  const { voiceFileName } = await import("../src/voice.ts");
  const { checkPlan } = await import("../src/server.ts");
  const dir = mkdtempSync(join(tmpdir(), "qp-real-mix-"));
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  const speech = (amp: number) => { const n = 2 * 22050, a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * 220 * i) / 22050) * amp; return writeWav(a, a, 22050); };
  const v1 = "win:Microsoft David Desktop", v2 = "win:Microsoft Zira Desktop";
  writeFileSync(join(dir, "assets", "audio", voiceFileName(v1, "quiet")), speech(0.03));
  writeFileSync(join(dir, "assets", "audio", voiceFileName(v2, "loud")), speech(0.6));
  const plan = checkPlan({ voice: v1, scenes: [{ headline: "quiet", seconds: 4 }, { headline: "loud", seconds: 4, voice: v2 }, { headline: "effect only", say: " ", seconds: 4, fx: ["clack"] }] });
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const resolved = await resolveSound(dir, plan);
    const built = await buildComposition(ec, resolved.plan, "16:9", dir, resolved.sound);
    const out = join(dir, "mix.mp4");
    await renderVideo(ec, built.comp, out, "draft");
    const { spawnSync } = await import("node:child_process");
    const mean = (from: number, len: number) => Number(/mean_volume: (-?[\d.]+) dB/.exec(String(spawnSync("ffmpeg", ["-hide_banner", "-ss", String(from), "-t", String(len), "-i", out, "-af", "volumedetect", "-vn", "-f", "null", "-"], { encoding: "utf-8" }).stderr))![1]);
    const quiet = mean(0.5, 1.8), loud = mean(4.5, 1.8);
    assert.ok(Math.abs(quiet - loud) < 3, `voices within 3 dB: quiet ${quiet}, loud ${loud}`);
    const quietRaw = 20 * Math.log10(0.03 / Math.SQRT2), loudRaw = 20 * Math.log10(0.6 / Math.SQRT2);
    assert.ok(loudRaw - quietRaw > 25, "the sources really were far apart");
    const clack = mean(8.2, 0.4), silent = mean(10.5, 1.0);
    assert.ok(clack > silent + 12, `the clack is heard in its scene (${clack}) and the end of the scene is quiet (${silent})`);
  } finally { ec.stop(); }
});
