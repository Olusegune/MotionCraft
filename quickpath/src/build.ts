// Turns a plan into an EffectCraft composition and renders it. Every scene is a background, an accent line, a headline and a sub line,
// each fading and sliding in and out. Text stays native and editable in EffectCraft.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EffectCraft } from "./ec.ts";
import { lookById, type Rgb } from "./looks.ts";
import { SIZES, type Plan, type Shape } from "./plan.ts";
import { imageInfo, MEDIA_NAME } from "./images.ts";
import { mp4Info } from "./mp4.ts";
import { musicKeys, type Sound } from "./sound.ts";

/** Breaks text into lines of at most `max` characters, at spaces, then evens the lines out so no single word is left alone. */
export function wrapText(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const greedy = (limit: number) => {
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (cur && (cur + " " + w).length > limit) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
    }
    if (cur) lines.push(cur);
    return lines;
  };
  const first = greedy(max);
  if (first.length < 2) return first.length ? first : [""];
  const total = words.join(" ").length;
  let limit = Math.ceil(total / first.length) + 2;           // the same number of lines, as even as the words allow
  let even = greedy(limit);
  while (even.length > first.length && limit < max) even = greedy(++limit);
  return even.length === first.length ? even : first;
}

/** The biggest text size that keeps the widest line inside `width`, up to `base`. Sans-serif text is about 0.52 em wide per character. */
export function fitSize(lines: string[], width: number, base: number, min = 36): number {
  const widest = Math.max(1, ...lines.map((l) => l.length));
  return Math.round(Math.max(min, Math.min(base, width / (widest * 0.52))));
}

const NL = String.fromCharCode(10);

export type Layout ={ headline: string; headSize: number; headY: number; sub: string; subSize: number; subY: number; barY: number; barW: number; barH: number };

/** Where everything goes for one scene in a frame of this size. y grows downward; text is placed by its first baseline.
 * The text starts big and shrinks until the whole block (headline and small line) fits inside 70% of the height and 78% of the width. */
export function layoutScene(headline: string, sub: string, width: number, height: number): Layout {
  const boxW = width * 0.78;
  let size = height > width ? 118 : 132;
  for (;;) {
    const lines = wrapText(headline, Math.max(8, Math.floor(boxW / (size * 0.52))));
    const subSize = Math.round(size * 0.36);
    const subLines = sub ? wrapText(sub, Math.max(12, Math.floor(boxW / (subSize * 0.52)))) : [];
    const lineH = size * 1.12;
    const blockH = lines.length * lineH + (subLines.length ? subSize * 1.5 * subLines.length + subSize * 0.8 : 0);
    const widest = Math.max(...lines.map((l) => l.length)) * size * 0.52;
    if ((blockH <= height * 0.7 && widest <= boxW) || size <= 36) {
      const top = height / 2 - blockH / 2;
      return {
        headline: lines.join(NL), headSize: size, headY: top + size * 0.82,
        sub: subLines.join(NL), subSize, subY: top + lines.length * lineH + subSize * 1.35,
        barY: top - size * 0.45, barW: Math.round(width * 0.09), barH: Math.max(6, Math.round(height * 0.007)),
      };
    }
    size -= 4;
  }
}

export type Built = { comp: number; project: string; total: number; width: number; height: number };

const r4 = (n: number) => Math.round(n * 10000) / 10000;

async function fadeSlide(ec: EffectCraft, layer: number, t0: number, t1: number, x: number, y: number, rise: number) {
  const fin = Math.min(0.55, (t1 - t0) / 3), fout = Math.min(0.4, (t1 - t0) / 4);
  const key = (path: string, time: number, value: unknown) => ec.run("prop.addKey", { layer, path, time: r4(time), value });
  await key("transform/opacity", t0, 0);
  await key("transform/opacity", t0 + fin, 100);
  await key("transform/opacity", t1 - fout, 100);
  await key("transform/opacity", t1 - 0.04, 0);
  await key("transform/position", t0, [x, y + rise, 0]);
  await key("transform/position", t0 + fin * 0.5, [x, y + rise * 0.15, 0]);
  await key("transform/position", t0 + fin, [x, y, 0]);
}

async function text(ec: EffectCraft, name: string, value: string, size: number, x: number, y: number, fill: Rgb): Promise<number> {
  const { layer } = await ec.run<{ layer: number }>("layer.newText", { text: value, name, size, position: [x, y] });
  await ec.run("layer.setText", { layer, fill });
  return layer;
}

/** A scene's own picture or clip, filling the frame (never stretched), under a dark veil so the words stay readable. A picture pushes in slowly;
 * a clip plays from the start of its scene, and is trimmed if it is longer than the scene or holds its last frame if shorter. */
async function media(ec: EffectCraft, dir: string, name: string, scene: number, t0: number, t1: number, width: number, height: number): Promise<boolean> {
  if (!MEDIA_NAME.test(name)) return false;
  const file = join(dir, "assets", name);
  let bytes: Buffer;
  try { bytes = readFileSync(file); } catch { return false; }
  const clip = name.endsWith(".mp4");
  const info = clip ? mp4Info(bytes) : imageInfo(bytes);
  if (!info) return false;
  const imp = await ec.run<{ items?: number[]; errors?: unknown[] }>("file.import", { paths: [file] });
  if (imp?.errors?.length || !imp?.items?.length) return false;
  const { layer } = await ec.run<{ layer: number }>("layer.addItem", { item: imp.items[0] });
  await ec.run("layer.rename", { layer, name: `Scene ${scene} ${clip ? "clip" : "picture"}` });
  const cover = Math.max(width / info.width, height / info.height) * 100;
  const key = (time: number, v: number) => ec.run("prop.addKey", { layer, path: "transform/scale", time: r4(time), value: [r4(v), r4(v), 100] });
  if (clip) {
    const natural = (info as { seconds: number }).seconds, window = t1 - t0;
    if (natural > window + 0.05) await ec.run("layer.timing", { layers: [layer], out: r4(window) });          // trim first, so sliding never runs off the end
    if (t0 > 0.001) await ec.run("layer.timing", { layers: [layer], delta: r4(t0) });                         // slide: in, out and the clip's own start move together
    if (natural < window - 0.05) await ec.run("layer.timing", { layers: [layer], out: r4(t1) });              // shorter than the scene: hold the last frame
    await ec.run("prop.set", { layer, path: "transform/scale", value: [r4(cover), r4(cover), 100] });
  } else {
    await ec.run("layer.timing", { layers: [layer], in: t0, out: t1 });
    await key(t0, cover);
    await key(Math.max(t1 - 0.04, t0), cover * 1.07);
  }
  const veil = await ec.run<{ layer: number }>("layer.newShape", { kind: "rect", name: `Scene ${scene} veil`, size: [width, height], fill: [0, 0, 0], position: [width / 2, height / 2] });
  await ec.run("layer.setTransform", { layers: [veil.layer], prop: "opacity", value: 45 });
  await ec.run("layer.timing", { layers: [veil.layer], in: t0, out: t1 });
  return true;
}

/** Voice lines at their scenes and music under everything, as ordinary audio layers (so they stay editable in EffectCraft). */
async function placeSound(ec: EffectCraft, dir: string, sound: Sound, total: number): Promise<void> {
  const add = async (file: string, name: string): Promise<number | null> => {
    const path = join(dir, "assets", "audio", file);
    const imp = await ec.run<{ items?: number[]; errors?: unknown[] }>("file.import", { paths: [path] });
    if (imp?.errors?.length || !imp?.items?.length) return null;
    const { layer } = await ec.run<{ layer: number }>("layer.addItem", { item: imp.items[0] });
    await ec.run("layer.rename", { layer, name });
    return layer;
  };
  for (const [i, v] of sound.voices.entries()) {
    if (!v) continue;
    const layer = await add(v.file, `Scene ${i + 1} voice`);
    if (layer === null) continue;
    if (v.start + v.seconds > total) await ec.run("layer.timing", { layers: [layer], out: r4(Math.max(0.1, total - v.start)) });
    await ec.run("layer.timing", { layers: [layer], delta: r4(v.start) });
  }
  if (sound.music) {
    const layer = await add(sound.music.file, "Music");
    if (layer !== null) {
      await ec.run("layer.timing", { layers: [layer], out: r4(total) });                       // a track longer than the video stops with it
      for (const [time, db] of musicKeys(total, sound.music.db, sound.voices)) await ec.run("prop.addKey", { layer, path: "audio/levels", time, value: [db, db] });
    }
  }
}

/** Builds the composition for a plan in the project folder and saves it. */
export async function buildComposition(ec: EffectCraft, plan: Plan, shape: Shape, dir: string, sound?: Sound): Promise<Built> {
  const { width, height } = SIZES[shape];
  const look = lookById(plan.look);
  const total = Math.round(plan.scenes.reduce((n, s) => n + s.seconds, 0) * 10) / 10;
  mkdirSync(dir, { recursive: true });
  await ec.run("file.newProject");
  const { comp } = await ec.run<{ comp: number }>("comp.new", { name: "Main", width, height, frameRate: 30, duration: total });
  let t = 0;
  for (const [i, s] of plan.scenes.entries()) {
    const t0 = Math.round(t * 100) / 100, t1 = Math.round((t + s.seconds) * 100) / 100;
    t += s.seconds;
    const n = i + 1;
    const lay = layoutScene(s.headline, s.sub, width, height);
    const bg = await ec.run<{ layer: number }>("layer.newSolid", { name: `Scene ${n} background`, color: i % 2 ? look.bg2 : look.bg });
    await ec.run("layer.timing", { layers: [bg.layer], in: t0, out: t1 });
    const pictured = s.picture ? await media(ec, dir, s.picture, n, t0, t1, width, height) : false;
    const ink: Rgb = pictured ? [1, 1, 1] : look.text;
    const bar = await ec.run<{ layer: number }>("layer.newShape", { kind: "rect", name: `Scene ${n} accent`, size: [lay.barW, lay.barH], fill: look.accent, position: [width / 2, lay.barY] });
    await ec.run("layer.timing", { layers: [bar.layer], in: t0, out: t1 });
    await fadeSlide(ec, bar.layer, t0, t1, width / 2, lay.barY, 18);
    const head = await text(ec, `Scene ${n} headline`, lay.headline, lay.headSize, width / 2, lay.headY, ink);
    await ec.run("layer.timing", { layers: [head], in: t0 + 0.05, out: t1 });
    await fadeSlide(ec, head, t0 + 0.05, t1, width / 2, lay.headY, 36);
    if (lay.sub) {
      const sub = await text(ec, `Scene ${n} sub`, lay.sub, lay.subSize, width / 2, lay.subY, look.accent);
      await ec.run("layer.timing", { layers: [sub], in: t0 + 0.25, out: t1 });
      await fadeSlide(ec, sub, t0 + 0.25, t1, width / 2, lay.subY, 28);
    }
  }
  if (sound) await placeSound(ec, dir, sound, total);
  const project = join(dir, "video.ecproj");
  await ec.run("file.save", { path: project });
  return { comp, project, total, width, height };
}

/** Renders the saved composition to an MP4: a half-size draft (fast) or the full size. Returns the frame count. */
export async function renderVideo(ec: EffectCraft, comp: number, output: string, quality: "draft" | "final"): Promise<number> {
  await ec.run("file.checkOutput", { path: output });
  await ec.run("renderQueue.add", { comp, format: "h264", output, ...(quality === "draft" ? { resolution: "half" } : {}) });
  const out = await ec.run<{ failed?: unknown; items?: { frames?: number }[] }>("renderQueue.render", { wait: true });
  if (out?.failed) throw new Error(`The render failed: ${JSON.stringify(out.failed)}`);
  return (out?.items ?? []).reduce((n, i) => n + (i.frames ?? 0), 0);
}
