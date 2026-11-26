// Fuzzing: random and corrupted input must never crash a reader, hang the layout, or let a bad plan through. Deterministic (seeded), so a failure repeats.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { imageInfo } from "../src/images.ts";
import { looksLikeMp4, mp4Info } from "../src/mp4.ts";
import { audioKind, wavInfo, writeWav } from "../src/wav.ts";
import { layoutScene, safeText, wrapText } from "../src/build.ts";
import { checkPlan } from "../src/server.ts";
import { cleanModelPlan, planFromWords } from "../src/plan.ts";
import { jpegHeader, solidPng } from "./png.ts";

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const rand = rng(20261126);
const bytes = (n: number) => Buffer.from(Array.from({ length: n }, () => Math.floor(rand() * 256)));

/** A valid file with a few bytes flipped and maybe cut short. */
function mutate(b: Buffer): Buffer {
  const out = Buffer.from(b);
  for (let k = 0, n = 1 + Math.floor(rand() * 6); k < n; k++) out[Math.floor(rand() * out.length)] = Math.floor(rand() * 256);
  return rand() < 0.3 ? out.subarray(0, Math.floor(rand() * out.length)) : out;
}

const sane = (x: unknown) => x === null || (typeof x === "object" && Object.values(x as object).every((v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v))));

test("random bytes: no reader throws, and anything accepted has a sane size", () => {
  for (let i = 0; i < 3000; i++) {
    const b = bytes(Math.floor(rand() * 3000));
    for (const f of [() => imageInfo(b), () => mp4Info(b), () => wavInfo(b), () => audioKind(b), () => looksLikeMp4(b)]) {
      let r: unknown;
      assert.doesNotThrow(() => { r = f(); });
      assert.ok(sane(r) || typeof r === "boolean", "a finite, well-formed answer or null");
    }
  }
});

test("random bytes that start like a real format: the readers still never throw", () => {
  const heads = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("RIFF....WEBP"), Buffer.from("RIFF....WAVEfmt "), Buffer.from("....ftypisom"), Buffer.from("ID3")];
  for (let i = 0; i < 3000; i++) {
    const b = Buffer.concat([heads[i % heads.length], bytes(Math.floor(rand() * 400))]);
    for (const f of [() => imageInfo(b), () => mp4Info(b), () => wavInfo(b), () => audioKind(b)]) assert.doesNotThrow(f);
  }
});

test("valid files with flipped bytes or cut short: never a throw, never an absurd size", () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-fuzz-"));
  const seeds: Buffer[] = [solidPng(40, 30, [9, 9, 9]), jpegHeader(640, 480), writeWav(new Float32Array(2000), new Float32Array(2000), 44100)];
  try {
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=64x48:rate=15", "-pix_fmt", "yuv420p", join(dir, "c.mp4")]);
    seeds.push(readFileSync(join(dir, "c.mp4")));
  } catch { /* no ffmpeg: the other seeds still run */ }
  for (const seed of seeds) for (let i = 0; i < 1500; i++) {
    const b = mutate(seed);
    for (const f of [() => imageInfo(b), () => mp4Info(b), () => wavInfo(b), () => audioKind(b)]) {
      let r: any;
      assert.doesNotThrow(() => { r = f(); });
      if (r && typeof r === "object") {
        for (const k of ["width", "height"]) if (k in r) assert.ok(r[k] > 0 && r[k] <= 16384, `${k} ${r[k]}`);
        if ("seconds" in r) assert.ok(r.seconds > 0 && Number.isFinite(r.seconds));
      }
    }
  }
});

test("random text never breaks the layout: it ends, stays finite, and keeps every word", () => {
  const alphabet = "abc XYZ  /\\~:.-éü汉字🔥\n\t​";
  for (let i = 0; i < 1500; i++) {
    const make = (max: number) => Array.from({ length: Math.floor(rand() * max) }, () => alphabet[Math.floor(rand() * alphabet.length)] ?? "x").join("");
    const head = make(160), sub = make(120);
    for (const [w, h] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
      const l = layoutScene(head, sub, w, h);
      for (const n of [l.headSize, l.headY, l.subY, l.barY, l.barW, l.barH, l.subSize]) assert.ok(Number.isFinite(n), JSON.stringify([head, n]));
      assert.ok(l.headSize >= 36);
    }
    const words = head.split(/\s+/).filter(Boolean);
    assert.equal(wrapText(head, 5 + Math.floor(rand() * 40)).join(" ").split(/\s+/).filter(Boolean).join(" "), words.join(" "), "no word lost or invented");
    assert.ok(safeText(head) === head || safeText(head) === String.fromCharCode(0x200b) + head, "only ever adds the one invisible mark");
  }
});

test("random JSON at the plan checker: it returns a safe plan or refuses, and never throws anything else", () => {
  const junk = (depth = 0): unknown => {
    const r = rand();
    if (depth > 3 || r < 0.3) return [null, true, false, 0, -1, 1e9, NaN, "", "x", "../../x", "a".repeat(5000), "win:Evil'; calc", "openai:nova", "calc.exe", "aaaaaaaaaaaa.png", "aaaaaaaaaaaa.mp4"][Math.floor(rand() * 16)];
    if (r < 0.55) return Array.from({ length: Math.floor(rand() * 5) }, () => junk(depth + 1));
    const o: Record<string, unknown> = {};
    for (const k of ["scenes", "headline", "sub", "seconds", "picture", "say", "look", "voice", "music", "mood", "file", "level", "title", "source", "__proto__", "constructor"]) if (rand() < 0.5) Object.defineProperty(o, k, { value: junk(depth + 1), enumerable: true, writable: true, configurable: true });
    return o;
  };
  let accepted = 0;
  for (let i = 0; i < 4000; i++) {
    const input = JSON.parse(JSON.stringify(junk()) ?? "null");          // exactly what the page can send: real JSON
    try {
      const p = checkPlan(input);
      accepted++;
      assert.ok(p.scenes.length >= 1 && p.scenes.length <= 12);
      assert.ok(p.scenes.every((s) => s.headline.length > 0 && s.headline.length <= 90 && s.seconds >= 1.5 && s.seconds <= 30 && (!s.picture || /^[a-f0-9]{12}\.(png|jpg|webp|mp4)$/.test(s.picture))));
      assert.ok(!p.voice || /^(win:[A-Za-z0-9][A-Za-z0-9 .\-]{0,59}|openai:(nova|onyx|alloy|shimmer))$/.test(p.voice));
      assert.ok(!p.music || (!p.music.file || /^[a-f0-9]{12}\.(wav|mp3)$/.test(p.music.file)));
      assert.equal(({} as any).polluted, undefined, "no prototype pollution");
    } catch (e) {
      assert.ok(e instanceof Error && /scene|words|minutes/i.test(e.message), `a plain refusal, got: ${(e as Error).message}`);
    }
  }
  assert.ok(accepted >= 0);
});

test("random model answers and random ideas never break planning", () => {
  for (let i = 0; i < 1500; i++) {
    assert.doesNotThrow(() => cleanModelPlan({ title: rand() < 0.5 ? 5 : "t", look: "x", scenes: rand() < 0.3 ? "no" : Array.from({ length: Math.floor(rand() * 12) }, () => ({ headline: rand() < 0.5 ? null : "h".repeat(Math.floor(rand() * 200)), sub: rand() < 0.5 ? 1 : "s" })) }, 12));
    const idea = Array.from({ length: Math.floor(rand() * 400) }, () => "ab ,.;!?\n汉é"[Math.floor(rand() * 12)]).join("");
    const p = planFromWords(idea, 6 + Math.floor(rand() * 114));
    assert.ok(p.scenes.length >= 1 && p.scenes.length <= 8);
    assert.ok(p.scenes.every((s) => s.seconds >= 2 && s.headline.length <= 70));
  }
});
