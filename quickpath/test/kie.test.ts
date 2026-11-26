// Kie.ai as the one provider for voices, music and video: a fake Kie that behaves like the real one answers, and every paid path is checked
// for what it sends, what it saves, what it records, and what happens when Kie says no. Nothing here spends money.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer, request } from "node:http";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solidPng, mp3Frames } from "./png.ts";

process.env.QUICKPATH_HOME = mkdtempSync(join(tmpdir(), "qp-kie-"));
process.env.KIE_API_KEY = "kie_test_0123456789abcdef0123";
const HOME = process.env.QUICKPATH_HOME as string;

// real media where ffmpeg exists (it also proves our MP3 and MP4 readers against real encoders); synthetic otherwise
let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }
const media = mkdtempSync(join(tmpdir(), "qp-kie-media-"));
if (ffmpeg) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2.5", "-q:a", "5", join(media, "voice.mp3")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=330:duration=14", "-q:a", "5", join(media, "music.mp3")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=5:size=320x180:rate=24", "-pix_fmt", "yuv420p", join(media, "clip.mp4")]);
} else { writeFileSync(join(media, "voice.mp3"), mp3Frames(100)); writeFileSync(join(media, "music.mp3"), mp3Frames(500)); }
const skipVideo = ffmpeg ? false : "ffmpeg not installed: NOT CHECKED";

type Task = { model: string; input: any };
const tasks = new Map<string, Task>();
const seen: { path: string; body: any }[] = [];
let mode: "ok" | "fail" | "refuse" | "nocredit" | "junk" = "ok";
let n = 0;

const fake = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const port = (fake.address() as { port: number }).port, self = `http://127.0.0.1:${port}`;
    const json = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    let body: any = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { /* not json */ }
    const path = (req.url ?? "").split("?")[0];
    seen.push({ path, body });
    if (path === "/jobs/createTask") {
      if (mode === "nocredit") return json({ code: 402, msg: "no credits" });
      if (mode === "refuse") return json({ code: 422, msg: "prompt not allowed" });
      const id = `t${++n}`; tasks.set(id, body); return json({ code: 200, data: { taskId: id } });
    }
    if (path === "/jobs/recordInfo") {
      const id = new URL(req.url!, self).searchParams.get("taskId")!, t = tasks.get(id);
      if (!t) return json({ code: 404 });
      if (mode === "fail") return json({ code: 200, data: { state: "fail", failMsg: "model busy" } });
      if (t.model.startsWith("elevenlabs")) return json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: [`${self}/files/voice.mp3`] }), creditsConsumed: 0.4 } });
      if (t.model.startsWith("ai-music")) return json({ code: 200, data: { state: "success", response: { data: [{ audio_url: `${self}/files/music.mp3`, duration: 14 }, { audio_url: `${self}/files/music.mp3`, duration: 14 }] }, creditsConsumed: 12 } });
      return json({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: [`${self}/files/${mode === "junk" ? "junk" : "clip"}.mp4`] }), creditsConsumed: 40 } });
    }
    if (path === "/api/file-base64-upload") return json({ success: true, data: { downloadUrl: `${self}/files/up.png` } });
    if (path === "/chat/credit") return json({ code: 200, data: 1000 });
    if (path.startsWith("/fal/")) { res.writeHead((req.headers.authorization ?? "").includes("badkey") ? 401 : 404); return void res.end("{}"); }
    if (path === "/files/voice.mp3") { res.writeHead(200, { "content-type": "audio/mpeg" }); return void res.end(readFileSync(join(media, "voice.mp3"))); }
    if (path === "/files/music.mp3") { res.writeHead(200, { "content-type": "audio/mpeg" }); return void res.end(readFileSync(join(media, "music.mp3"))); }
    if (path === "/files/clip.mp4") { res.writeHead(200, { "content-type": "video/mp4" }); return void res.end(readFileSync(join(media, "clip.mp4"))); }
    if (path === "/files/junk.mp4") { res.writeHead(200); return void res.end("this is not a video"); }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const fakeBase = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
process.env.QUICKPATH_KIE_BASE = fakeBase;
process.env.QUICKPATH_KIE_UPLOAD_BASE = fakeBase;
process.env.QUICKPATH_FAL_BASE = `${fakeBase}/fal`;

const { MemoryStore, setStore } = await import("../src/keys.ts");
setStore(new MemoryStore());
const { start } = await import("../src/server.ts");
const server = start(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as { port: number }).port;
after(() => { server.close(); fake.close(); });

function call(method: string, path: string, body?: unknown) {
  return new Promise<{ status: number; json: any; text: string }>((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...(data ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) } : {}) } }, (res) => {
      let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => { let j: any = null; try { j = JSON.parse(t); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, json: j, text: t }); });
    });
    req.on("error", reject); if (data) req.write(data); req.end();
  });
}
const post = (p: string, b: unknown) => call("POST", p, b);
const spent = async () => (await call("GET", "/api/settings")).json.spentUsd as number;
const lastModel = () => [...seen].reverse().find((s) => s.path === "/jobs/createTask")!.body;
const newProject = async (idea = "A Kie test video") => (await post("/api/plan", { idea, seconds: 10 })).json.id as string;
const SARAH = "kie:EXAVITQu4vr4xnSDxMaL";
const PLAN = (voice: string) => ({ title: "t", look: "midnight", source: "words", voice, scenes: [{ headline: "Warm mornings", sub: "start slowly", seconds: 3 }, { headline: "Wake up slowly", sub: "", seconds: 3 }] });

test("a Kie voice: only listed voices are accepted, nothing is made without a confirmation, and one confirmation makes the missing lines once", async () => {
  const id = await newProject();
  const raw = await post("/api/render", { plan: PLAN(SARAH), id });
  assert.equal(raw.status, 400);
  assert.match(raw.json.error, /Make the voiceover first/);
  const q = (await post("/api/voice/quote", { id, plan: PLAN(SARAH) })).json;
  assert.equal(q.needed, true);
  assert.equal(q.provider, "Kie.ai");
  assert.match(q.model, /ElevenLabs voice Sarah/);
  assert.ok(Math.abs(q.estimateUsd - 2 * 0.03) < 0.0001, `Kie bills each line as a block of up to 1,000 characters (measured on a real call: 4 short lines cost $0.12), so 2 lines are about $0.06, not a per-character sum. Got ${q.estimateUsd}`);
  assert.match(q.what, /2 lines of speech/);
  assert.match(q.note, /each line of speech/);
  assert.equal((await post("/api/voice/make", { id, token: "0".repeat(32), plan: PLAN(SARAH) })).status, 400, "a made-up token is refused");
  const before = await spent();
  const made = await post("/api/voice/make", { id, token: q.token, plan: PLAN(SARAH) });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.made, 2);
  const sent = seen.filter((s) => s.path === "/jobs/createTask" && s.body.model === "elevenlabs/text-to-speech-turbo-2-5");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].body.input.voice, "EXAVITQu4vr4xnSDxMaL");
  assert.ok(sent[0].body.input.text.length <= 5000);
  assert.ok(Math.abs((await spent()) - before - 2 * 0.4 * 0.005) < 0.0001, "the ledger records what Kie says it cost (0.4 credits each, $0.005 a credit)");
  const files = readdirSync(join(HOME, "projects", id, "assets", "audio"));
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => /^[a-f0-9]{12}\.mp3$/.test(f)), "saved as MP3 under a name made from the voice and the words");
  assert.equal((await post("/api/voice/quote", { id, plan: PLAN(SARAH) })).json.needed, false, "saved lines are never paid for twice");
  assert.equal((await post("/api/voice/make", { id, token: q.token, plan: PLAN(SARAH) })).status, 400, "the confirmation is used up");
});

test("a voice id that is not one of Kie's listed voices is dropped, never sent", async () => {
  const id = await newProject();
  const q = (await post("/api/voice/quote", { id, plan: PLAN("kie:AAAAAAAAAAAAAAAAAAAA") })).json;
  assert.equal(q.needed, false, "the unknown voice was dropped from the plan");
  const sentBefore = seen.length;
  await post("/api/voice/make", { id, token: "x", plan: PLAN("kie:AAAAAAAAAAAAAAAAAAAA") });
  assert.ok(!seen.slice(sentBefore).some((s) => s.path === "/jobs/createTask"), "nothing was sent to Kie");
  const status = (await call("GET", "/api/status")).json;
  assert.equal(status.kieVoices.length, 20);
  assert.ok(status.kieVoices.every((v: { id: string; name: string }) => /^[A-Za-z0-9]{20}$/.test(v.id) && v.name.length > 2));
});

test("a Kie voice renders into a movie with sound and scenes that fit it", { skip: ffmpeg && existsSync(process.env.EFFECTCRAFT_CLI ?? "C:/Program Files/EffectCraft/effectcraft-cli.exe") ? false : "EffectCraft or ffmpeg missing: NOT CHECKED" }, async () => {
  const id = await newProject();
  const q = (await post("/api/voice/quote", { id, plan: PLAN(SARAH) })).json;
  await post("/api/voice/make", { id, token: q.token, plan: PLAN(SARAH) });
  const r = await post("/api/render", { plan: PLAN(SARAH), shape: "16:9", quality: "draft", id });
  assert.equal(r.status, 200, r.text);
  const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", r.json.path]).toString();
  assert.match(streams, /audio/, "an audio track from the MP3 voice");
  assert.ok(r.json.scenes[0] >= 3 && r.json.scenes[0] <= 4.5, "the scene is as long as its 2.5 s voice needs, not stretched");
});

test("AI music: quote, one confirmation, one track saved as an MP3 you can use; the request is what Kie documents; the ledger records the real cost", async () => {
  const id = await newProject();
  const q = (await post("/api/ai/music/quote", { id, style: "", idea: "a coffee brand" })).json;
  assert.equal(q.provider, "Kie.ai");
  assert.match(q.prompt, /Instrumental background music for a short video about: a coffee brand/);
  assert.equal((await post("/api/ai/music", { id, token: q.token, style: "something else entirely", seconds: 15 })).status, 400, "a quote for other words is refused");
  const q2 = (await post("/api/ai/music/quote", { id, style: "warm acoustic, soft piano", idea: "x" })).json;
  const before = await spent();
  const r = await post("/api/ai/music", { id, token: q2.token, style: q2.prompt, seconds: 5 });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.name, /^[a-f0-9]{12}\.mp3$/);
  assert.ok(r.json.seconds > 10, `a track of ${r.json.seconds} s`);
  const sent = lastModel();
  assert.equal(sent.model, "ai-music-api/generate");
  assert.deepEqual([sent.input.custom_mode, sent.input.instrumental, sent.input.model, sent.input.title], [true, true, "V6_MINI", "QuickPath music"]);
  assert.equal(sent.input.style, "warm acoustic, soft piano");
  assert.equal(sent.input.duration, 10, "a 5 second video still asks for the shortest track Kie makes (10 s)");
  assert.ok(Math.abs((await spent()) - before - 12 * 0.005) < 0.0001, "12 credits = $0.06");
  assert.ok(existsSync(join(HOME, "projects", id, "assets", "audio", r.json.name)));
  const q3 = (await post("/api/ai/music/quote", { id, style: "x style", idea: "y" })).json;
  await post("/api/ai/music", { id, token: q3.token, style: q3.prompt, seconds: 40 });
  assert.equal(lastModel().input.duration, 43, "a 40 second video asks for 43 s: a little more than it needs");
  const q4 = (await post("/api/ai/music/quote", { id, style: "x style", idea: "y" })).json;
  await post("/api/ai/music", { id, token: q4.token, style: q4.prompt, seconds: 99999 });
  assert.equal(lastModel().input.duration, 360, "never more than Kie's limit");
});

test("the uploaded track from AI music is a file the sound check accepts, so it can be chosen as your own music", async () => {
  const id = await newProject();
  const q = (await post("/api/ai/music/quote", { id, style: "calm", idea: "z" })).json;
  const r = (await post("/api/ai/music", { id, token: q.token, style: q.prompt, seconds: 12 })).json;
  const plan = { ...PLAN(""), voice: undefined, music: { file: r.name, level: "soft" } };
  const back = (await post("/api/render", { plan, shape: "16:9", quality: "draft", id })).json;
  if (back) assert.ok(back.error === undefined || /EffectCraft/.test(back.error), "the plan with this music file is accepted by the plan checker");
});

test("Animate this picture: only a picture in the video, uploaded to Kie, started with the documented settings, saved as a clip, costed from Kie's credits", { skip: skipVideo }, async () => {
  const id = await newProject();
  const dir = join(HOME, "projects", id, "assets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0123456789ab.png"), solidPng(64, 36, [120, 80, 40]));
  assert.equal((await post("/api/ai/animate/quote", { id, picture: "ffffffffffff.png", prompt: "x" })).status, 400, "a picture that is not in this video");
  for (const bad of ["../../x.png", "0123456789ab.mp4", "0123456789ab.svg", "0123456789AB.png", ""]) assert.equal((await post("/api/ai/animate/quote", { id, picture: bad, prompt: "x" })).status, 400, bad);
  const q = (await post("/api/ai/animate/quote", { id, picture: "0123456789ab.png", prompt: "steam rising" })).json;
  assert.match(q.model, /Wan 2\.2/);
  assert.match(q.note, /uploaded to Kie\.ai for 24 hours/, "the confirmation says the picture leaves the computer");
  assert.equal((await post("/api/ai/animate", { id, token: q.token, picture: "0123456789ab.png", prompt: "something else" })).status, 400);
  const q2 = (await post("/api/ai/animate/quote", { id, picture: "0123456789ab.png", prompt: "steam rising" })).json;
  const before = await spent();
  const r = await post("/api/ai/animate", { id, token: q2.token, picture: "0123456789ab.png", prompt: "steam rising" });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.name, /^[a-f0-9]{12}\.mp4$/);
  assert.equal(r.json.width, 320);
  const up = seen.filter((s) => s.path === "/api/file-base64-upload").pop()!;
  assert.match(up.body.base64Data, /^data:image\/png;base64,/, "the picture itself is what is uploaded");
  const sent = lastModel();
  assert.equal(sent.model, "wan/2-2-a14b-image-to-video-turbo");
  assert.equal(sent.input.image_url, `${fakeBase}/files/up.png`);
  assert.deepEqual([sent.input.prompt, sent.input.resolution, sent.input.acceleration], ["steam rising", "720p", "none"]);
  assert.ok(Math.abs((await spent()) - before - 40 * 0.005) < 0.0001, "40 credits = $0.20");
  const clipBytes = readFileSync(join(dir, r.json.name));
  assert.equal(clipBytes.subarray(4, 8).toString("latin1"), "ftyp");
  assert.equal((await post("/api/upload", {})).status, 400);                       // (uploads need a real body; this only checks the route stays closed to JSON)
});

test("when Kie says no, fails, or sends something that is not what it should be: a plain message, and nothing is recorded as spent", async () => {
  const id = await newProject();
  const dir = join(HOME, "projects", id, "assets"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "0123456789ab.png"), solidPng(64, 36, [1, 2, 3]));
  for (const [m, expect] of [["nocredit", /out of credit/], ["refuse", /nothing was charged/], ["fail", /model busy/]] as const) {
    mode = m;
    const base = await spent();
    const q = (await post("/api/ai/music/quote", { id, style: `s ${m}`, idea: "i" })).json;
    const r = await post("/api/ai/music", { id, token: q.token, style: q.prompt, seconds: 12 });
    assert.equal(r.status, 400, m);
    assert.match(r.json.error, expect, m);
    const qa = (await post("/api/ai/animate/quote", { id, picture: "0123456789ab.png", prompt: m })).json;
    assert.equal((await post("/api/ai/animate", { id, token: qa.token, picture: "0123456789ab.png", prompt: m })).status, 400, m);
    assert.equal(await spent(), base, `${m}: nothing was recorded as spent`);
  }
  mode = "junk";
  if (ffmpeg) {
    const qa = (await post("/api/ai/animate/quote", { id, picture: "0123456789ab.png", prompt: "junk" })).json;
    const r = await post("/api/ai/animate", { id, token: qa.token, picture: "0123456789ab.png", prompt: "junk" });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /not a usable clip/);
    assert.equal(readdirSync(dir).filter((f) => f.endsWith(".mp4")).length, 0, "the junk was not saved");
  }
  mode = "ok";
});

test("fal: a key can be saved in Settings and checked; a wrong key is refused by fal and says so; keys are never echoed", async () => {
  const saved = await post("/api/settings/key", { provider: "fal", key: "fal_test_0123456789abcdef0123:secret" });
  assert.equal(saved.status, 400, "a colon is not part of a key as QuickPath saves them: only letters, digits, - _ .");
  const ok = await post("/api/settings/key", { provider: "fal", key: "fal_goodkey_0123456789abcdef" });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json.keys.fal, { set: true, source: "saved" });
  assert.ok(!ok.text.includes("goodkey"), "the key is not echoed");
  const good = (await post("/api/settings/check", { provider: "fal" })).json;
  assert.equal(good.ok, true);
  assert.match(good.message, /does not use fal yet/);
  await post("/api/settings/key", { provider: "fal", key: "fal_badkey_0123456789abcdef" });
  const bad = (await post("/api/settings/check", { provider: "fal" })).json;
  assert.equal(bad.ok, false);
  assert.match(bad.message, /did not accept this key/);
  await post("/api/settings/key/remove", { provider: "fal" });
  assert.equal((await call("GET", "/api/settings")).json.keys.fal.set, false);
});

test("the page offers each of these only where they make sense", async () => {
  const js = (await call("GET", "/app.js")).text;
  for (const needle of ["Animate this picture", "Make with AI", "/api/ai/animate/quote", "/api/ai/music/quote", "kieVoices"]) assert.ok(js.includes(needle), needle);
  assert.ok(!/innerHTML|eval\(|new Function/.test(js));
});

test("a script becomes a project: a narrator, a different voice for a character, nothing spent; each voice is quoted and made for its own scenes", async () => {
  const { readFileSync: rf } = await import("node:fs");
  const script = rf(new URL("../samples/the-day-we-built-superintelligence.md", import.meta.url), "utf-8");
  const before = await spent();
  const r = await post("/api/script", { script });
  assert.equal(r.status, 200, r.text);
  const plan = r.json;
  assert.equal(plan.scenes.length, 7);
  assert.equal(plan.scriptSeconds, 90);
  assert.match(plan.voice, /^kie:/, "a narrator is chosen when a Kie key exists");
  assert.match(plan.scenes[4].voice, /^kie:/, "Bisi speaks in a different voice");
  assert.notEqual(plan.scenes[4].voice, plan.voice);
  assert.equal(plan.scenes.filter((s: any) => s.voice).length, 1, "only the character's scene has its own voice");
  assert.equal(await spent(), before, "reading a script spends nothing");
  assert.equal((await post("/api/script", { script: "no timed rows here" })).status, 400);

  const id = plan.id as string;
  const q = (await post("/api/voice/quote", { id, plan })).json;
  assert.equal(q.needed, true);
  assert.match(q.what, /7 lines of speech/);
  assert.ok(Math.abs(q.estimateUsd - 7 * 0.03) < 0.0001, `7 lines, each billed as a block. Got ${q.estimateUsd}`);
  const sentBefore = seen.length;
  const made = await post("/api/voice/make", { id, token: q.token, plan });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.made, 7);
  const sent = seen.slice(sentBefore).filter((s) => s.path === "/jobs/createTask");
  assert.equal(sent.filter((s) => s.body.input.voice === plan.scenes[4].voice.slice(4)).length, 1, "exactly one line in the character's voice");
  assert.equal(sent.filter((s) => s.body.input.voice === plan.voice.slice(4)).length, 6, "six lines in the narrator's voice");
  assert.equal((await post("/api/voice/quote", { id, plan })).json.needed, false, "all seven saved, none paid for twice");
});

test("without a Kie key a script still opens, with no voices chosen", async () => {
  const { setStore: set, MemoryStore: Mem } = await import("../src/keys.ts");
  const saved = process.env.KIE_API_KEY;
  delete process.env.KIE_API_KEY; set(new Mem());
  try {
    const r = await post("/api/script", { script: "| **00:00–00:05** | **One.** A picture. | **VO:** “Hello there.” |" });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.voice, undefined);
    assert.equal(r.json.scenes[0].say, "Hello there.");
  } finally { process.env.KIE_API_KEY = saved; set(new Mem()); }
});
