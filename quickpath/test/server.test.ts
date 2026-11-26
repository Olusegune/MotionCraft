import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { solidPng } from "./png.ts";
import { writeWav } from "../src/wav.ts";
import { MemoryStore, setStore } from "../src/keys.ts";

process.env.QUICKPATH_HOME = mkdtempSync(join(tmpdir(), "qp-"));
process.env.KIE_API_KEY = "test-key-0123456789abcdef";
process.env.OPENAI_API_KEY = "test-openai-0123456789abcdef";            // found first, so the real Credential Manager is never read in tests
const fake = createServer((req, res) => {
  const addr = fake.address() as { port: number };
  const send = (o: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
  req.resume();
  if (req.url?.endsWith("/chat/credit") || req.url?.endsWith("/models")) {
    if ((req.headers.authorization ?? "").includes("badkey")) { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ code: 401, msg: "bad key" })); }
    return send(req.url.endsWith("/models") ? { data: [] } : { code: 200, data: 1234 });
  }
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

test("every response carries a strict content-security-policy, and the bundled fonts are served", async () => {
  for (const path of ["/", "/api/status", "/style.css", "/fonts/inter-latin-400-normal.woff2"]) {
    const r = await new Promise<{ status: number; csp: string; type: string }>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, method: "GET", path, headers: { host: `127.0.0.1:${port}` } }, (res) => { res.resume(); res.on("end", () => resolve({ status: res.statusCode ?? 0, csp: String(res.headers["content-security-policy"] ?? ""), type: String(res.headers["content-type"] ?? "") })); });
      req.on("error", reject); req.end();
    });
    assert.equal(r.status, 200, path);
    assert.match(r.csp, /default-src 'self'/, path);
    assert.match(r.csp, /object-src 'none'/);
    assert.match(r.csp, /frame-ancestors 'none'/);
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(r.csp), "no loose rules: " + r.csp);
    if (path.endsWith(".woff2")) assert.equal(r.type, "font/woff2");
  }
});

test("the page itself uses no inline script or style, so the strict policy cannot break it", async () => {
  const html = (await call("GET", "/")).text;
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), "no inline script");
  assert.ok(!/\sstyle\s*=/i.test(html), "no inline style attribute");
  assert.ok(!/\son\w+\s*=/i.test(html), "no inline event handler");
  assert.ok(!/<style/i.test(html), "no style block");
  assert.ok(!/https?:\/\//i.test(html.replace(/http:\/\/www\.w3\.org/g, "")), "no outside address in the page");
});

test("the page script hides the video list whenever the studio opens, from a new video or a saved one", async () => {
  const js = (await call("GET", "/app.js")).text;
  const opens = js.split(String.fromCharCode(10)).filter((l) => l.includes('$("studio").hidden = false'));
  assert.ok(opens.length >= 2, "two ways into the studio");
  for (const l of opens) assert.ok(l.includes('$("recent").hidden = true'), "hides the list: " + l.trim().slice(0, 80));
});

test("two renders requested at the same moment are queued one after the other, and both finish", { skip: existsSync(process.env.EFFECTCRAFT_CLI ?? "C:/Program Files/EffectCraft/effectcraft-cli.exe") ? false : "EffectCraft not installed: NOT CHECKED" }, async () => {
  const mk = (title: string) => JSON.stringify({ plan: { title, look: "ocean", source: "words", scenes: [{ headline: title, sub: "", seconds: 3 }, { headline: "And more", sub: "", seconds: 3 }] }, shape: "16:9", quality: "draft" });
  const [a, b] = await Promise.all([call("POST", "/api/render", { body: mk("First at once") }), call("POST", "/api/render", { body: mk("Second at once") })]);
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  const ja = JSON.parse(a.text), jb = JSON.parse(b.text);
  assert.notEqual(ja.id, jb.id);
  assert.equal(ja.frames, 180);
  assert.equal(jb.frames, 180);
  assert.equal((await call("GET", ja.url, { headers: { range: "bytes=0-9" } })).status, 206);
});


// ---- Settings: keys are saved, checked and removed from the page, and never come back out ----
const settingsGet = async () => JSON.parse((await call("GET", "/api/settings")).text);
const post = (path: string, obj: unknown) => call("POST", path, { body: JSON.stringify(obj) });

async function withMemoryKeys<T>(fn: (store: MemoryStore) => Promise<T>): Promise<T> {
  const saved = { kie: process.env.KIE_API_KEY, openai: process.env.OPENAI_API_KEY };
  delete process.env.KIE_API_KEY; delete process.env.OPENAI_API_KEY;
  const store = new MemoryStore();
  setStore(store);
  try { return await fn(store); }
  finally { process.env.KIE_API_KEY = saved.kie; process.env.OPENAI_API_KEY = saved.openai; setStore(new MemoryStore()); }
}

test("Settings shows whether a key is set and where it comes from, and never the key", async () => {
  const text = (await call("GET", "/api/settings")).text;
  const v = JSON.parse(text);
  assert.equal(v.keys.kie.set, true);
  assert.equal(v.keys.kie.source, "env");
  assert.ok(!text.includes(process.env.KIE_API_KEY as string) && !text.includes(process.env.OPENAI_API_KEY as string), "no key in the answer");
  assert.equal(typeof v.capUsd, "number");
  assert.equal(typeof v.spentUsd, "number");
  assert.equal(typeof v.ollama.found, "boolean");
});

test("a key pasted into Settings is saved to the key store, trimmed, and never echoed; removing it removes only that", async () => {
  await withMemoryKeys(async (store) => {
    assert.equal((await settingsGet()).keys.kie.set, false);
    const key = "kie_test_0123456789abcdef0123";
    const saved = await post("/api/settings/key", { provider: "kie", key: `  ${key}\n` });
    assert.equal(saved.status, 200, saved.text);
    assert.ok(!saved.text.includes(key), "the answer never contains the key");
    const view = JSON.parse(saved.text);
    assert.deepEqual(view.keys.kie, { set: true, source: "saved" });
    assert.equal(view.keys.openai.set, false);
    assert.equal(store.items.get("QuickPath/kie"), key, "saved under QuickPath's own name, trimmed");
    assert.ok(!(await call("GET", "/api/settings")).text.includes(key));
    store.items.set("kie-api-key.motioncraft", "motioncraft_key_0123456789abcdef");
    const gone = JSON.parse((await post("/api/settings/key/remove", { provider: "kie" })).text);
    assert.equal(store.items.has("QuickPath/kie"), false);
    assert.equal(store.items.get("kie-api-key.motioncraft"), "motioncraft_key_0123456789abcdef", "MotionCraft's own entry is never touched");
    assert.deepEqual(gone.keys.kie, { set: true, source: "motioncraft" }, "and it is still found as a fallback");
  });
});

test("keys that cannot be keys are refused with a plain message and nothing is stored", async () => {
  await withMemoryKeys(async (store) => {
    for (const bad of ["", "short", "has spaces in the middle of it 0123456789", "line1\nline2_0123456789abcdef", "x'; calc #0123456789abcdef", "a".repeat(300), "<script>alert(1)</script>0123", "key with \u0000 nul 0123456789abcdef"]) {
      const r = await post("/api/settings/key", { provider: "kie", key: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.match(JSON.parse(r.text).error, /does not look like a key/);
    }
    assert.equal((await post("/api/settings/key", { provider: "evil", key: "kie_test_0123456789abcdef0123" })).status, 400);
    assert.equal((await post("/api/settings/key/remove", { provider: "../x" })).status, 400);
    assert.equal(store.items.size, 0, "nothing was stored");
  });
});

test("a key set another way (a setting) is reported as such, and removing the saved one leaves it working", async () => {
  await withMemoryKeys(async (store) => {
    process.env.OPENAI_API_KEY = "env_openai_0123456789abcdef";
    setStore(store);
    await post("/api/settings/key", { provider: "openai", key: "saved_openai_0123456789abcdef" });
    assert.equal((await settingsGet()).keys.openai.source, "env", "a setting wins over a saved key");
    await post("/api/settings/key/remove", { provider: "openai" });
    assert.deepEqual((await settingsGet()).keys.openai, { set: true, source: "env" });
  });
});

test("Check key asks the provider a free question: works, wrong key, no key", async () => {
  await withMemoryKeys(async () => {
    assert.equal(JSON.parse((await post("/api/settings/check", { provider: "kie" })).text).ok, false);
    await post("/api/settings/key", { provider: "kie", key: "kie_test_0123456789abcdef0123" });
    const good = JSON.parse((await post("/api/settings/check", { provider: "kie" })).text);
    assert.equal(good.ok, true);
    assert.match(good.message, /Credits left: 1234/);
    await post("/api/settings/key", { provider: "openai", key: "openai_badkey_0123456789abcdef" });
    const bad = JSON.parse((await post("/api/settings/check", { provider: "openai" })).text);
    assert.equal(bad.ok, false);
    assert.match(bad.message, /did not accept this key/);
    assert.ok(!JSON.stringify(bad).includes("badkey_0123"), "the key is not repeated back");
  });
});

test("the spending limit can be changed in Settings, applies to the next quote, and rejects silly numbers", async () => {
  try {
    const set = await post("/api/settings/cap", { usd: 12.5 });
    assert.equal(set.status, 200);
    assert.equal(JSON.parse(set.text).capUsd, 12.5);
    const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "A limit test video", seconds: 10 }) })).text);
    const q = JSON.parse((await post("/api/ai/quote", { id, shape: "16:9", headline: "x", sub: "", idea: "y" })).text);
    assert.equal(q.capUsd, 12.5, "the quote shows the new limit");
    for (const bad of [0, 0.1, -3, 101, 1e9, "abc", null, NaN, "5; drop"]) assert.equal((await post("/api/settings/cap", { usd: bad })).status, 400, String(bad));
    assert.equal((await settingsGet()).capUsd, 12.5, "a refused value changes nothing");
    await post("/api/settings/cap", { usd: 0.5 });
    const refused = await post("/api/ai/quote", { id, shape: "16:9", headline: "x", sub: "", idea: "y" });
    assert.equal(refused.status, 200, "0.50 still allows one 2-cent picture if little is spent");
  } finally { await post("/api/settings/cap", { usd: 5 }); }
});

test("the Settings screen: a gear button and a window exist, key boxes are password fields that do not autofill, and no key is ever kept on the page", async () => {
  const html = (await call("GET", "/")).text, js = (await call("GET", "/app.js")).text;
  assert.match(html, /id="gear"/);
  assert.match(html, /<dialog id="settings"/);
  assert.match(html, /aria-label="Settings and connections"/);
  assert.match(js, /type: "password", autocomplete: "off", spellcheck: "false"/, "key boxes hide what is typed and are not remembered by the browser");
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(js), "the page script builds nothing from strings of HTML");
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie/.test(js), "nothing is kept in the browser");
  assert.match(js, /const key = input\.value; input\.value = ""/, "the box is emptied before the key is sent");
  assert.ok(!/console\.(log|info|debug)/.test(js), "nothing is logged by the page");
});

test("the server never writes a key to a file or a log, and never returns one", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../src/server.ts", import.meta.url), "utf-8") + (await import("node:fs")).readFileSync(new URL("../src/keys.ts", import.meta.url), "utf-8");
  assert.ok(!/console\.(log|error|warn|info)\([^)]*key/i.test(src), "no key is logged");
  assert.ok(!/writeFileSync\([^)]*key/i.test(src), "no key is written to a file");
  assert.match(src, /stdio: \["pipe", "pipe", "ignore"\]/, "the key goes to Windows on standard input, not the command line");
});


test("the page and the server agree on the shapes, and the status says what each one is", async () => {
  const st = JSON.parse((await call("GET", "/api/status")).text);
  assert.deepEqual(st.shapes.map((x: { id: string }) => x.id), ["16:9", "9:16", "1:1", "4:5", "21:9", "4:3"]);
  const js = (await call("GET", "/app.js")).text;
  const line = js.split(String.fromCharCode(10)).find((l) => l.startsWith("const SHAPES = "))!;
  const pageIds = [...line.matchAll(/\["(\d+:\d+)", "(\w+)"\]/g)].map((m) => m[1]);
  assert.deepEqual(pageIds, st.shapes.map((x: { id: string }) => x.id), "the page lists exactly the shapes the server accepts, in the same order");
  const names = [...line.matchAll(/\["(\d+:\d+)", "(\w+)"\]/g)].map((m) => m[2]);
  assert.deepEqual(names, st.shapes.map((x: { name: string }) => x.name));
});

test("a picture request for a cinema or portrait video asks for the trimmed shape; an unknown shape is treated as wide", async () => {
  const { id } = JSON.parse((await call("POST", "/api/plan", { body: JSON.stringify({ idea: "Shape quote test", seconds: 10 }) })).text);
  const wide = JSON.parse((await post("/api/ai/quote", { id, shape: "21:9", headline: "A scene", sub: "", idea: "x" })).text);
  assert.match(wide.prompt, /ultra-wide cinematic/);
  assert.match(wide.prompt, /trimmed/);
  const odd = JSON.parse((await post("/api/ai/quote", { id, shape: "../../etc", headline: "A scene", sub: "", idea: "x" })).text);
  assert.doesNotMatch(odd.prompt, /ultra-wide|portrait|vertical/);
  assert.match(odd.prompt, /A wide, cinematic/);
});

test("a saved video remembers its shape for every shape, and reopens in it", { skip: existsSync(process.env.EFFECTCRAFT_CLI ?? "C:/Program Files/EffectCraft/effectcraft-cli.exe") ? false : "EffectCraft not installed: NOT CHECKED" }, async () => {
  for (const shape of ["21:9", "4:5", "4:3"]) {
    const plan = { title: `Saved ${shape}`, look: "forest", source: "words", scenes: [{ headline: `In ${shape}`, sub: "", seconds: 3 }, { headline: "Second", sub: "", seconds: 3 }] };
    const r = JSON.parse((await post("/api/render", { plan, shape, quality: "draft" })).text);
    assert.equal(r.frames, 180, shape);
    const back = JSON.parse((await call("GET", `/api/project?id=${r.id}`)).text);
    assert.equal(back.shape, shape);
    const listed = (JSON.parse((await call("GET", "/api/projects")).text).projects as { id: string; shape: string }[]).find((p) => p.id === r.id);
    assert.equal(listed?.shape, shape);
  }
});
