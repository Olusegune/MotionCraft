import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solidPng } from "./png.ts";
import { writeWav } from "../src/wav.ts";

process.env.QUICKPATH_HOME = mkdtempSync(join(tmpdir(), "qp-"));
process.env.KIE_API_KEY = "test-key-0123456789abcdef";
process.env.OPENAI_API_KEY = "test-openai-0123456789abcdef";            // found first, so the real Credential Manager is never read in tests
const fake = createServer((req, res) => {
  const addr = fake.address() as { port: number };
  const send = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  req.resume();
  if (req.url?.endsWith("/audio/speech")) { res.writeHead(200, { "content-type": "audio/wav" }); return res.end(writeWav(new Float32Array(11025), new Float32Array(11025), 22050)); }
  if (req.url?.endsWith("/jobs/createTask")) return send({ code: 200, data: { taskId: "t-1" } });
  if (req.url?.includes("/jobs/recordInfo")) return send({ code: 200, data: { state: "success", resultJson: JSON.stringify({ resultUrls: [`http://127.0.0.1:${addr.port}/img.png`] }) } });
  res.writeHead(200, { "content-type": "image/png" }); res.end(solidPng(48, 27, [20, 120, 200]));
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
process.env.QUICKPATH_KIE_BASE = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
process.env.QUICKPATH_OPENAI_BASE = process.env.QUICKPATH_KIE_BASE;
const { start } = await import("../src/server.ts");
const server = start(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as { port: number }).port;
after(() => { server.close(); fake.close(); });

function call(method: string, path: string, opts: { host?: string; origin?: string; body?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: opts.host ?? `127.0.0.1:${port}`, ...(opts.origin ? { origin: opts.origin } : {}), ...(opts.headers ?? {}) } }, (res) => {
      let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode ?? 0, text: t }));
    });
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

test("the page and status are served to the local address", async () => {
  const page = await call("GET", "/");
  assert.equal(page.status, 200);
  assert.match(page.text, /QuickPath/);
  const st = JSON.parse((await call("GET", "/api/status")).text);
  assert.ok(Array.isArray(st.looks) && st.looks.length >= 5);
});

test("a request with another Host or Origin is refused (DNS rebinding and cross-site)", async () => {
  assert.equal((await call("GET", "/api/status", { host: `evil.example:${port}` })).status, 403);
  assert.equal((await call("POST", "/api/plan", { origin: "http://evil.example", body: "{}" })).status, 403);
});

test("files outside the page folder and odd media names are not served", async () => {
  assert.equal((await call("GET", "/..%2f..%2fpackage.json")).status, 404);
  assert.equal((await call("GET", "/../package.json")).status, 404);
  assert.equal((await call("GET", "/media/zzzz/x.mp4")).status, 404);
  assert.equal((await call("GET", "/media/aaaaaaaaaaaa/..%2f..%2fx.mp4")).status, 404);
});

test("a huge or broken body gets a plain message, not a crash", async () => {
  const big = await call("POST", "/api/plan", { body: JSON.stringify({ idea: "x".repeat(70_000) }) });
  assert.equal(big.status, 400);
  assert.match(JSON.parse(big.text).error, /too big/);
  const bad = await call("POST", "/api/plan", { body: "{nope" });
  assert.equal(bad.status, 400);
  const short = await call("POST", "/api/plan", { body: JSON.stringify({ idea: "a" }) });
  assert.equal(short.status, 400);
});

test("an invalid plan is refused before anything is started", async () => {
  const r = await call("POST", "/api/render", { body: JSON.stringify({ plan: { scenes: [] } }) });
  assert.equal(r.status, 400);
});


function upload(id: string, type: string, body: Buffer) {
  return new Promise<{ status: number; json: any }>((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path: `/api/upload?id=${id}`, headers: { host: `127.0.0.1:${port}`, "content-type": type, "content-length": String(body.length) } }, (res) => {
      let t = ""; res.on("data", (d) => (t += d)); res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(t || "{}") }));
    });
    req.on("error", reject); req.end(body);
  });
}

test("a picture can be added to a project: checked by its bytes, stored under a random name, and served back", async () => {
  const plan = await call("POST", "/api/plan", { body: JSON.stringify({ idea: "A quiet morning with coffee", seconds: 10 }) });
  const { id } = JSON.parse(plan.text);
  assert.match(id, /^[a-f0-9]{12}$/);
  const ok = await upload(id, "image/png", solidPng(32, 18, [200, 40, 40]));
  assert.equal(ok.status, 200);
  assert.match(ok.json.name, /^[a-f0-9]{12}\.png$/);
  const back = await call("GET", ok.json.url);
  assert.equal(back.status, 200);
});

test("uploads are refused when the type lies, the bytes are not a picture, or the project is unknown", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "Another idea here", seconds: 10 }) })).text);
  assert.equal((await upload(id, "text/html", solidPng(4, 4, [0, 0, 0]))).status, 400);
  assert.equal((await upload(id, "image/svg+xml", Buffer.from("<svg/>"))).status, 400);
  assert.equal((await upload(id, "image/png", Buffer.from("<html><script>alert(1)</script>"))).status, 400);
  assert.equal((await upload("../../etc", "image/png", solidPng(4, 4, [0, 0, 0]))).status, 400);
  assert.equal((await upload("aaaaaaaaaaaa", "image/png", solidPng(4, 4, [0, 0, 0]))).status, 400);
});

test("a picture over the size limit is refused before it is read", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "Big picture test", seconds: 10 }) })).text);
  const r = await upload(id, "image/png", Buffer.alloc(12 * 1024 * 1024 + 10, 1));
  assert.equal(r.status, 400);
  assert.match(r.json.error, /too big/);
});


import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

function rawUpload(id: string, type: string, body: Buffer) { return upload(id, type, body); }

test("a clip can be added: read from its own boxes, stored under a random name, and served with ranges", { skip: (() => { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return false; } catch { return "ffmpeg not installed: NOT CHECKED"; } })() }, async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "A clip on a scene", seconds: 10 }) })).text);
  const dir = mkdtempSync(join(tmpdir(), "qp-c-"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=1:size=160x90:rate=30", "-pix_fmt", "yuv420p", join(dir, "c.mp4")]);
  const ok = await rawUpload(id, "video/mp4", readFileSync(join(dir, "c.mp4")));
  assert.equal(ok.status, 200);
  assert.match(ok.json.name, /^[a-f0-9]{12}\.mp4$/);
  assert.equal(ok.json.width, 160);
  const ranged = await call("GET", ok.json.url, { headers: { range: "bytes=0-99" } });
  assert.equal(ranged.status, 206);
});

test("clips that are not clips are refused", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "Bad clip tests", seconds: 10 }) })).text);
  assert.equal((await rawUpload(id, "video/mp4", Buffer.from("this is not a movie at all, just text"))).status, 400);
  assert.equal((await rawUpload(id, "video/mp4", solidPng(8, 8, [0, 0, 0]))).status, 400);
  assert.equal((await rawUpload(id, "video/webm", Buffer.alloc(100))).status, 400);
});

test("AI pictures: no confirmation, no picture. One confirmation buys one picture, saved under a random name, and is counted.", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "A picture made by a model", seconds: 10 }) })).text);
  const without = await call("POST", "/api/ai/picture", { body: JSON.stringify({ id, token: "0".repeat(32), prompt: "x" }) });
  assert.equal(without.status, 400);
  const q = JSON.parse((await call("POST", "/api/ai/quote", { body: JSON.stringify({ id, shape: "16:9", headline: "Steam rising", sub: "", idea: "coffee" }) })).text);
  assert.match(q.token, /^[a-f0-9]{32}$/);
  assert.equal(q.estimateUsd, 0.02);
  assert.ok(q.prompt.includes("Steam rising"));
  const wrongWords = await call("POST", "/api/ai/picture", { body: JSON.stringify({ id, token: q.token, prompt: "something else" }) });
  assert.equal(wrongWords.status, 400, "a quote made for other words is refused");
  const q2 = JSON.parse((await call("POST", "/api/ai/quote", { body: JSON.stringify({ id, shape: "16:9", headline: "Steam rising", sub: "", idea: "coffee" }) })).text);
  const made = await call("POST", "/api/ai/picture", { body: JSON.stringify({ id, token: q2.token, prompt: q2.prompt }) });
  assert.equal(made.status, 200, made.text);
  const out = JSON.parse(made.text);
  assert.match(out.name, /^[a-f0-9]{12}\.png$/);
  assert.ok(out.spentUsd >= 0.02);
  const again = await call("POST", "/api/ai/picture", { body: JSON.stringify({ id, token: q2.token, prompt: q2.prompt }) });
  assert.equal(again.status, 400, "the confirmation is used up");
  assert.equal((await call("GET", out.url)).status, 200);
});


const PLAN = (voice: string) => ({ title: "t", look: "midnight", source: "words", voice, scenes: [{ headline: "Warm mornings", sub: "start slowly", seconds: 3 }, { headline: "Wake up slowly", sub: "", seconds: 3 }] });

test("a paid voice: no confirmation, no voice; one confirmation makes the missing lines once and is counted", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "A voice made by a model", seconds: 10 }) })).text);
  const raw = await call("POST", "/api/render", { body: JSON.stringify({ plan: PLAN("openai:nova"), id }) });
  assert.equal(raw.status, 400);
  assert.match(JSON.parse(raw.text).error, /Make the voiceover first/);
  const q = JSON.parse((await call("POST", "/api/voice/quote", { body: JSON.stringify({ id, plan: PLAN("openai:nova") }) })).text);
  assert.equal(q.needed, true);
  assert.equal(q.provider, "OpenAI");
  assert.ok(q.estimateUsd > 0 && q.estimateUsd < 0.01);
  assert.match(q.what, /characters of speech/);
  const wrongPlan = await call("POST", "/api/voice/make", { body: JSON.stringify({ id, token: q.token, plan: { ...PLAN("openai:nova"), scenes: [{ headline: "Something else", sub: "", seconds: 3 }] } }) });
  assert.equal(wrongPlan.status, 400, "a confirmation for other words is refused");
  const q2 = JSON.parse((await call("POST", "/api/voice/quote", { body: JSON.stringify({ id, plan: PLAN("openai:nova") }) })).text);
  const made = await call("POST", "/api/voice/make", { body: JSON.stringify({ id, token: q2.token, plan: PLAN("openai:nova") }) });
  assert.equal(made.status, 200, made.text);
  assert.equal(JSON.parse(made.text).made, 2);
  const again = JSON.parse((await call("POST", "/api/voice/quote", { body: JSON.stringify({ id, plan: PLAN("openai:nova") }) })).text);
  assert.equal(again.needed, false, "saved lines are never paid for twice");
  assert.equal((await call("POST", "/api/voice/make", { body: JSON.stringify({ id, token: q2.token, plan: PLAN("openai:nova") }) })).status, 400, "the confirmation is used up");
});

test("Windows voices need no quote, and a voice name that is not a real choice is dropped", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "A free voice here", seconds: 10 }) })).text);
  const free = JSON.parse((await call("POST", "/api/voice/quote", { body: JSON.stringify({ id, plan: PLAN("win:Microsoft David Desktop") }) })).text);
  assert.equal(free.needed, false);
  const evil = JSON.parse((await call("POST", "/api/voice/quote", { body: JSON.stringify({ id, plan: PLAN("win:x'; calc #") }) })).text);
  assert.equal(evil.needed, false, "the voice was dropped, not run");
});

function uploadAudio(id: string, type: string, body: Buffer) { return upload(id, type, body); }

test("sound files are accepted only if their bytes are WAV or MP3", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "Music upload tests", seconds: 10 }) })).text);
  const ok = await uploadAudio(id, "audio/wav", writeWav(new Float32Array(4410), new Float32Array(4410), 44100));
  assert.equal(ok.status, 200);
  assert.match(ok.json.name, /^[a-f0-9]{12}\.wav$/);
  assert.equal((await uploadAudio(id, "audio/wav", Buffer.from("not a sound at all"))).status, 400);
  assert.equal((await uploadAudio(id, "audio/mpeg", solidPng(8, 8, [0, 0, 0]))).status, 400);
  assert.equal((await uploadAudio(id, "audio/ogg", Buffer.alloc(100))).status, 400);
});

test("the plan's sound fields are re-checked on the server", async () => {
  const { checkPlan } = await import("../src/server.ts");
  const p = checkPlan({ scenes: [{ headline: "a", seconds: 3, say: "x".repeat(900) }], voice: "win:ok name", music: { mood: "nope", level: "loud" } });
  assert.equal(p.voice, "win:ok name");
  assert.equal(p.music, undefined, "an unknown mood is dropped");
  assert.equal(p.scenes[0].say?.length, 600);
  const q = checkPlan({ scenes: [{ headline: "a", seconds: 3 }], voice: "powershell:evil", music: { file: "../../x.wav" } });
  assert.equal(q.voice, undefined);
  assert.equal(q.music, undefined);
  const r = checkPlan({ scenes: [{ headline: "a", seconds: 3 }], music: { mood: "warm", level: "weird" } });
  assert.deepEqual(r.music, { mood: "warm", level: "medium" });
});

import { mkdirSync, writeFileSync, utimesSync } from "node:fs";

function seed(id: string, content: string, mtime?: number) {
  const dir = join(process.env.QUICKPATH_HOME as string, "projects", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.json"), content);
  if (mtime) utimesSync(join(dir, "plan.json"), mtime / 1000, mtime / 1000);
}

test("Your videos: saved plans are listed newest first, and anything unreadable is left out, not shown", async () => {
  const good = (title: string) => JSON.stringify({ plan: { title, look: "paper", source: "words", scenes: [{ headline: "One", sub: "", seconds: 3 }, { headline: "Two", sub: "", seconds: 4 }] }, shape: "9:16" });
  seed("111111111111", good("Older one"), Date.now() - 86_400_000 * 3);
  seed("222222222222", good("Newer one"), Date.now() - 1000);
  seed("333333333333", "{ this is not json", Date.now());
  seed("444444444444", JSON.stringify({ plan: { scenes: [] } }), Date.now());
  const list = JSON.parse((await call("GET", "/api/projects")).text).projects as { id: string; title: string; shape: string; scenes: number; seconds: number }[];
  const ids = list.map((p) => p.id);
  assert.ok(ids.indexOf("222222222222") !== -1 && ids.indexOf("222222222222") < ids.indexOf("111111111111"), "newest first");
  assert.ok(!ids.includes("333333333333") && !ids.includes("444444444444"), "damaged and empty plans are not listed");
  const newer = list.find((p) => p.id === "222222222222")!;
  assert.deepEqual([newer.title, newer.shape, newer.scenes, newer.seconds], ["Newer one", "9:16", 2, 7]);
});

test("opening a saved video re-checks it like any plan from the page, and bad ids are refused", async () => {
  seed("555555555555", JSON.stringify({ plan: { title: "Edited by hand", look: "../../etc/passwd", voice: "powershell:evil", music: { file: "../x.wav" }, source: "words", scenes: [{ headline: "Hi", sub: "", seconds: 99999, picture: "../../secret.png" }] }, shape: "nope" }));
  const ok = JSON.parse((await call("GET", "/api/project?id=555555555555")).text);
  assert.equal(ok.shape, "16:9");
  assert.equal(ok.plan.look, "midnight");
  assert.equal(ok.plan.voice, undefined);
  assert.equal(ok.plan.music, undefined);
  assert.equal(ok.plan.scenes[0].picture, undefined);
  assert.equal(ok.plan.scenes[0].seconds, 30);
  for (const bad of ["../../etc", "zzzz", "", "555555555555/../x", "AAAAAAAAAAAA", "999999999999"]) assert.equal((await call("GET", `/api/project?id=${encodeURIComponent(bad)}`)).status, 400, bad);
});

test("removing a video: only real QuickPath videos, only by exact id, and the folder is gone afterwards", async () => {
  process.env.QUICKPATH_DELETE = "permanent";                    // tests must not fill the real Recycle Bin
  try {
    seed("666666666666", JSON.stringify({ plan: { title: "Remove me", look: "paper", source: "words", scenes: [{ headline: "One", sub: "", seconds: 3 }] }, shape: "16:9" }));
    const dir = join(process.env.QUICKPATH_HOME as string, "projects", "666666666666");
    assert.ok((await call("GET", "/api/projects")).text.includes("666666666666"));
    const gone = await call("POST", "/api/project/remove", { body: JSON.stringify({ id: "666666666666" }) });
    assert.equal(gone.status, 200);
    assert.equal(JSON.parse(gone.text).how, "deleted");
    assert.ok(!(await import("node:fs")).existsSync(dir));
    assert.ok(!(await call("GET", "/api/projects")).text.includes("666666666666"));
    for (const bad of ["../../x", "", "zzzz", "666666666666", "aaaaaaaaaaaa", "..", "AAAAAAAAAAAA"]) assert.equal((await call("POST", "/api/project/remove", { body: JSON.stringify({ id: bad }) })).status, 400, bad);
    mkdirSync(join(process.env.QUICKPATH_HOME as string, "projects", "777777777777"), { recursive: true });    // a folder with no plan is not ours to delete
    assert.equal((await call("POST", "/api/project/remove", { body: JSON.stringify({ id: "777777777777" }) })).status, 400);
    assert.ok((await import("node:fs")).existsSync(join(process.env.QUICKPATH_HOME as string, "projects", "777777777777")));
  } finally { delete process.env.QUICKPATH_DELETE; }
});
