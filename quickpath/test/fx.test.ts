import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EFFECTS, effectsFor, fxFileName, fxTimes, makeEffect } from "../src/fx.ts";
import { blocksOf, levelOf, readLevels, saveLevel, speechDb, voiceGain, wavSpeechDb, MAX_GAIN_DB, VOICE_TARGET_DB } from "../src/loudness.ts";
import { parseScript } from "../src/script.ts";
import { checkPlan } from "../src/server.ts";
import { resolveSound } from "../src/sound.ts";
import { voiceFileName } from "../src/voice.ts";
import { wavInfo, writeWav } from "../src/wav.ts";

const SAMPLE = readFileSync(new URL("../samples/the-day-we-built-superintelligence.md", import.meta.url), "utf-8");

/** A speech-like WAV: a tone at `amp` for `on` seconds, then `off` seconds of silence. */
function tone(amp: number, on: number, off = 0, rate = 22050): Buffer {
  const n = Math.round((on + off) * rate), a = new Float32Array(n);
  for (let i = 0; i < Math.round(on * rate); i++) a[i] = Math.sin((2 * Math.PI * 220 * i) / rate) * amp;
  return writeWav(a, a, rate);
}

test("every effect is a valid stereo sound that is the same every time, never clips, and starts and ends at silence", () => {
  for (const e of EFFECTS) {
    const a = makeEffect(e.id), b = makeEffect(e.id), info = wavInfo(a)!;
    assert.ok(a.equals(b), `${e.id} is deterministic`);
    assert.equal(info.channels, 2);
    assert.ok(Math.abs(info.seconds - e.seconds) < 0.02, `${e.id} length ${info.seconds}`);
    let peak = 0;
    for (let i = 44; i + 1 < a.length; i += 2) peak = Math.max(peak, Math.abs(a.readInt16LE(i)));
    assert.ok(peak > 8000 && peak < 30000, `${e.id} peak ${peak}`);
    assert.ok(Math.abs(a.readInt16LE(44)) < 200 && Math.abs(a.readInt16LE(a.length - 2)) < 200, `${e.id} starts and ends quietly`);
  }
  assert.equal(new Set(EFFECTS.map((e) => fxFileName(e.id))).size, EFFECTS.length, "each effect has its own file name");
  assert.match(fxFileName("match"), /^[a-f0-9]{12}\.wav$/);
  assert.ok(!makeEffect("match").equals(makeEffect("clack")), "effects differ");
  assert.ok(wavInfo(makeEffect("nope")), "an unknown effect still makes a sound rather than failing");
});

test("a script's sound notes pick the effects they name, in the order named, each once", () => {
  assert.deepEqual(effectsFor("Pencil scratch, a fan winding down, then a single match strike."), ["scratch", "fan", "match"]);
  assert.deepEqual(effectsFor("Three dry confirmation tones resolve into a low chord."), ["tones"]);
  assert.deepEqual(effectsFor("Switch clack. The hum of a refrigerator joins the score."), ["clack", "hum"]);
  assert.deepEqual(effectsFor("Voices and footsteps give way to the sound of a crew pulling cable."), ["footsteps", "cable"]);
  assert.deepEqual(effectsFor("Drop the score under her question. Hold the room tone."), [], "nothing asked for, nothing added");
  assert.deepEqual(effectsFor(""), []);
  const fx = parseScript(SAMPLE).scenes.map((s) => s.fx);
  assert.deepEqual(fx[0], ["scratch", "fan", "match"]);
  assert.deepEqual(fx[1], ["tones"]);
  assert.deepEqual(fx[2], ["clack", "hum"]);
  assert.deepEqual(fx[3], ["click"]);
  assert.deepEqual(fx[4], ["paper"]);
  assert.deepEqual(fx[5], ["footsteps", "cable"]);
});

test("effects are placed inside their scene and cut off at its end; a plan only keeps real effects", () => {
  const t = fxTimes(10, 6, ["scratch", "fan", "match"]);
  assert.equal(t.length, 3);
  for (const c of t) { assert.ok(c.start >= 10.2 && c.start + c.seconds <= 16.001, `${c.id} ${c.start} +${c.seconds}`); }
  assert.ok(t[0].start < t[1].start && t[1].start < t[2].start, "in order");
  assert.deepEqual(fxTimes(0, 0.2, ["scratch"]), [], "a scene too short for it gets nothing rather than a cut-off blip");
  assert.deepEqual(fxTimes(0, 5, ["nope"]), []);
  const plan = checkPlan({ scenes: [{ headline: "a", seconds: 5, fx: ["match", "nope", "match", "../x", 7, "clack"] }, { headline: "b", seconds: 5, fx: ["nope"] }] });
  assert.deepEqual(plan.scenes[0].fx, ["match", "clack"]);
  assert.equal(plan.scenes[1].fx, undefined);
});

test("loudness: the speech level ignores gaps, and the gain brings voices to the target without ever going wild", () => {
  const loud = wavSpeechDb(tone(0.5, 2))!, quiet = wavSpeechDb(tone(0.05, 2))!;
  assert.ok(Math.abs(loud - 20 * Math.log10(0.5 / Math.SQRT2)) < 0.3, `a 0.5 tone is about -9 dB, got ${loud}`);
  assert.ok(Math.abs(loud - quiet - 20) < 0.5, `ten times quieter is 20 dB lower, got ${loud - quiet}`);
  assert.ok(Math.abs(wavSpeechDb(tone(0.5, 1, 3))! - loud) < 0.5, "silence around the speech does not change the level");
  assert.equal(wavSpeechDb(tone(0, 2)), null, "silence has no level");
  assert.equal(wavSpeechDb(Buffer.from("not a wav")), null);
  assert.equal(speechDb([]), null);
  assert.equal(speechDb(blocksOf([0, 0, 0, 0], 100)), null);
  assert.equal(voiceGain(VOICE_TARGET_DB), 0);
  assert.equal(voiceGain(-30), 10);
  assert.equal(voiceGain(-60), MAX_GAIN_DB, "a very quiet voice is lifted by at most 12 dB");
  assert.equal(voiceGain(0), -MAX_GAIN_DB, "a very loud one is lowered by at most 12 dB");
  for (const bad of [null, undefined, NaN, Infinity]) assert.equal(voiceGain(bad as any), 0, `no measurement means no change (${bad})`);
});

test("saved levels: only real sound files in the folder, only believable numbers", () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-lev-"));
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  writeFileSync(join(dir, "assets", "audio", "aaaaaaaaaaaa.mp3"), "x");
  assert.equal(saveLevel(dir, "aaaaaaaaaaaa.mp3", -23.46), true);
  assert.equal(readLevels(dir)["aaaaaaaaaaaa.mp3"], -23.5);
  for (const [f, v] of [["bbbbbbbbbbbb.mp3", -20], ["aaaaaaaaaaaa.mp3", "loud"], ["aaaaaaaaaaaa.mp3", 5], ["aaaaaaaaaaaa.mp3", -200], ["aaaaaaaaaaaa.mp3", NaN], ["../x.mp3", -20], ["levels.json", -20]] as [string, unknown][]) assert.equal(saveLevel(dir, f, v), false, `${f} ${v}`);
  writeFileSync(join(dir, "assets", "audio", "levels.json"), JSON.stringify({ "aaaaaaaaaaaa.mp3": -21, "../evil.mp3": -5, "cccccccccccc.mp3": "x", "dddddddddddd.mp3": 50 }));
  assert.deepEqual(readLevels(dir), { "aaaaaaaaaaaa.mp3": -21 }, "a hand-edited file is re-checked");
  assert.equal(levelOf(dir, "aaaaaaaaaaaa.mp3"), -21);
  assert.equal(levelOf(dir, "eeeeeeeeeeee.mp3"), null, "an MP3 nobody measured has no level");
});

test("a quiet voice and a loud voice are both brought to the same level, and the plan's effects become cues inside their scenes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-res-"));
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  const v1 = "win:Microsoft David Desktop", v2 = "win:Microsoft Zira Desktop";
  writeFileSync(join(dir, "assets", "audio", voiceFileName(v1, "first")), tone(0.05, 2));       // quiet
  writeFileSync(join(dir, "assets", "audio", voiceFileName(v2, "second")), tone(0.5, 2));       // loud
  const plan = checkPlan({ voice: v1, scenes: [{ headline: "first", seconds: 4, fx: ["match", "clack"] }, { headline: "second", seconds: 4, voice: v2, fx: ["knock"] }] });
  const { sound } = await resolveSound(dir, plan);
  const g1 = sound.voices[0]!.gain!, g2 = sound.voices[1]!.gain!;
  assert.ok(g1 > 8 && g1 <= 12, `the quiet voice is lifted, got ${g1}`);
  assert.ok(g2 < -5, `the loud voice is lowered, got ${g2}`);
  const after1 = wavSpeechDb(tone(0.05, 2))! + g1, after2 = wavSpeechDb(tone(0.5, 2))! + g2;
  assert.ok(Math.abs(after1 - after2) < 3, `after the gain they are within 3 dB: ${after1} and ${after2}`);
  assert.equal(sound.fx!.length, 3);
  assert.deepEqual(sound.fx!.map((f) => f.scene), [1, 1, 2]);
  for (const f of sound.fx!) {
    const sceneStart = f.scene === 1 ? 0 : 4;
    assert.ok(f.start >= sceneStart && f.start + f.seconds <= sceneStart + 4.001, `${f.id} inside its scene`);
  }
});

test("the page can measure sound it is allowed to read, report a believable level, and learn which effects exist", async () => {
  const { request } = await import("node:http");
  const { existsSync } = await import("node:fs");
  process.env.QUICKPATH_HOME = mkdtempSync(join(tmpdir(), "qp-snd-"));
  const home = process.env.QUICKPATH_HOME as string;
  const { start } = await import("../src/server.ts?sound");
  const server = start(0); await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const call = (method: string, path: string, body?: unknown) => new Promise<{ status: number; json: any; type: string; len: number }>((resolve) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...(data ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) } : {}) } }, (res) => { const c: Buffer[] = []; res.on("data", (d) => c.push(d)); res.on("end", () => { const b = Buffer.concat(c); let j: any = null; try { j = JSON.parse(b.toString()); } catch { /* binary */ } resolve({ status: res.statusCode ?? 0, json: j, type: String(res.headers["content-type"] ?? ""), len: b.length }); }); });
    if (data) req.write(data); req.end();
  });
  try {
    const made = await call("POST", "/api/script", { script: "| **00:00–00:05** | **One.** A picture. | **VO:** “Hello there.” **Sound:** A single match strike. |" });
    const id = made.json.id as string;
    assert.deepEqual(made.json.scenes[0].fx, ["match"]);
    assert.ok((await call("GET", "/api/status")).json.effects.some((e: any) => e.id === "match" && e.name === "Match strike"));
    mkdirSync(join(home, "projects", id, "assets", "audio"), { recursive: true });
    writeFileSync(join(home, "projects", id, "assets", "audio", "aaaaaaaaaaaa.mp3"), "not really sound");
    assert.deepEqual((await call("GET", `/api/audio/unmeasured?id=${id}`)).json.files, ["aaaaaaaaaaaa.mp3"]);
    const served = await call("GET", `/media/${id}/assets/audio/aaaaaaaaaaaa.mp3`);
    assert.equal(served.status, 200); assert.match(served.type, /audio\/mpeg/);
    assert.equal((await call("GET", `/media/${id}/assets/audio/levels.json`)).status, 404, "only sound files are served from there");
    assert.equal((await call("GET", `/media/${id}/assets/audio/..%2F..%2Fplan.json`)).status, 404);
    assert.equal((await call("POST", "/api/audio/level", { id, file: "aaaaaaaaaaaa.mp3", db: -22.3 })).status, 200);
    assert.deepEqual((await call("GET", `/api/audio/unmeasured?id=${id}`)).json.files, [], "measured once, never again");
    for (const bad of [{ file: "aaaaaaaaaaaa.mp3", db: 3 }, { file: "aaaaaaaaaaaa.mp3", db: "x" }, { file: "../../plan.json", db: -20 }, { file: "bbbbbbbbbbbb.mp3", db: -20 }]) assert.equal((await call("POST", "/api/audio/level", { id, ...bad })).status, 400, JSON.stringify(bad));
    assert.equal((await call("POST", "/api/audio/level", { id: "../../x", file: "aaaaaaaaaaaa.mp3", db: -20 })).status, 400);
    assert.ok(!existsSync(join(home, "plan.json")));
  } finally { server.close(); }
});
