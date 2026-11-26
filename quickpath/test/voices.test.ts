// ElevenLabs (direct) and Voicekiller as voice providers: fake servers answer like the real ones are documented to, and every paid path is checked
// for what it sends, what it saves, what it records, and what happens when the provider says no. Nothing here spends money.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mp3Frames } from "./png.ts";

process.env.QUICKPATH_HOME = mkdtempSync(join(tmpdir(), "qp-voices-"));
delete process.env.KIE_API_KEY; delete process.env.OPENAI_API_KEY;
process.env.ELEVENLABS_API_KEY = "el_test_0123456789abcdef0123456789";
process.env.VOICEKILLER_API_KEY = "user_42:vk_test_0123456789abcdef";
const HOME = process.env.QUICKPATH_HOME as string;

const seen: { path: string; headers: Record<string, any>; body: any }[] = [];
let mode: "ok" | "badkey" | "noplan" | "toofast" | "junk" | "novoice" = "ok";
const mp3 = mp3Frames(120);
const fake = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body: any = null;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null; } catch { /* not json */ }
    const path = (req.url ?? "").split("?")[0];
    seen.push({ path, headers: req.headers, body });
    const json = (o: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (path.startsWith("/v1/text-to-speech/")) {
      if (mode === "badkey") return json({ detail: "invalid_api_key" }, 401);
      if (mode === "noplan") return json({ detail: "quota_exceeded" }, 402);
      if (mode === "toofast") return json({ detail: "too_many" }, 429);
      if (mode === "novoice") return json({ detail: "voice_not_found" }, 404);
      if (mode === "junk") { res.writeHead(200, { "content-type": "audio/mpeg" }); return void res.end("this is not sound"); }
      res.writeHead(200, { "content-type": "audio/mpeg" }); return void res.end(mp3);
    }
    if (path === "/v1/user") return (req.headers["xi-api-key"] === "el_test_0123456789abcdef0123456789" ? json({ subscription: { tier: "creator", character_count: 1000, character_limit: 100000 } }) : json({}, 401));
    if (path === "/v1/voices") return json({ voices: [{ voice_id: "AAAAAAAAAAAAAAAAAAAA", name: "My Cloned Voice" }, { voice_id: "short", name: "Bad Id" }, { voice_id: "BBBBBBBBBBBBBBBBBBBB", name: "Narrator" }] });
    if (path === "/api/generate-speech/voicelist") return req.headers["api-key"] === "vk_test_0123456789abcdef" && req.headers["userid"] === "user_42" ? json({ voices: [{ name: "Matthias" }, { name: "Aria" }, { name: "../evil" }] }) : json({ error: "no" }, 401);
    if (path === "/api/generate-speech") {
      if (req.headers["api-key"] !== "vk_test_0123456789abcdef" || req.headers["userid"] !== "user_42" || mode === "badkey") return json({ error: "no" }, 401);
      if (mode === "noplan") return json({ error: "no credit" }, 402);
      if (mode === "junk") { res.writeHead(200, { "content-type": "application/json" }); return void res.end(JSON.stringify({ message: "voice not found" })); }
      res.writeHead(200, { "content-type": "audio/mpeg" }); return void res.end(mp3);
    }
    res.writeHead(404); res.end();
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
process.env.QUICKPATH_ELEVEN_BASE = base;
process.env.QUICKPATH_VOICEKILLER_BASE = base;

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
const newProject = async () => (await post("/api/plan", { idea: "A voice test video", seconds: 10 })).json.id as string;
const ELEVEN = "eleven:AAAAAAAAAAAAAAAAAAAA", VK = "vk:Matthias";
const PLAN = (voice: string) => ({ title: "t", look: "midnight", source: "words", voice, scenes: [{ headline: "Warm mornings", sub: "start slowly", seconds: 3 }, { headline: "Wake up slowly", sub: "", seconds: 3 }] });

test("ElevenLabs: the request is what its API documents, one confirmation makes the missing lines once, and the estimate is recorded", async () => {
  const id = await newProject();
  assert.equal((await post("/api/render", { plan: PLAN(ELEVEN), id })).status, 400, "not made without a confirmation");
  const q = (await post("/api/voice/quote", { id, plan: PLAN(ELEVEN) })).json;
  assert.equal(q.needed, true);
  assert.equal(q.provider, "ElevenLabs");
  assert.match(q.note, /your own plan/);
  const chars = "Warm mornings. start slowly".length + "Wake up slowly".length;
  assert.ok(Math.abs(q.estimateUsd - chars * 0.00015) < 0.0001, `per character, got ${q.estimateUsd}`);
  const before = await spent(), n0 = seen.length;
  const made = await post("/api/voice/make", { id, token: q.token, plan: PLAN(ELEVEN) });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.made, 2);
  const sent = seen.slice(n0).filter((s) => s.path.startsWith("/v1/text-to-speech/"));
  assert.equal(sent.length, 2);
  assert.equal(sent[0].path, "/v1/text-to-speech/AAAAAAAAAAAAAAAAAAAA");
  assert.equal(sent[0].headers["xi-api-key"], "el_test_0123456789abcdef0123456789");
  assert.equal(sent[0].body.model_id, "eleven_turbo_v2_5");
  assert.equal(typeof sent[0].body.text, "string");
  assert.ok(Math.abs((await spent()) - before - chars * 0.00015) < 0.001, "the ledger records the estimate (to the tenth of a cent)");
  const files = readdirSync(join(HOME, "projects", id, "assets", "audio"));
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => /^[a-f0-9]{12}\.mp3$/.test(f)));
  assert.equal((await post("/api/voice/quote", { id, plan: PLAN(ELEVEN) })).json.needed, false, "saved lines are never paid for twice");
  assert.equal((await post("/api/voice/make", { id, token: q.token, plan: PLAN(ELEVEN) })).status, 400, "the confirmation is used up");
});

test("Voicekiller: both credentials go in the headers, the words go as the script, and it adds nothing to QuickPath's own spending", async () => {
  const id = await newProject();
  const q = (await post("/api/voice/quote", { id, plan: PLAN(VK) })).json;
  assert.equal(q.provider, "Voicekiller");
  assert.match(q.note, /QuickPath cannot see that price/);
  const before = await spent(), n0 = seen.length;
  const made = await post("/api/voice/make", { id, token: q.token, plan: PLAN(VK) });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.made, 2);
  const sent = seen.slice(n0).filter((s) => s.path === "/api/generate-speech");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].headers["api-key"], "vk_test_0123456789abcdef");
  assert.equal(sent[0].headers["userid"], "user_42");
  assert.equal(sent[0].body.voice_name, "Matthias");
  assert.equal(typeof sent[0].body.script, "string");
  assert.ok(Math.abs((await spent()) - before) < 0.0001, "nothing is added to the QuickPath ledger for a plan QuickPath cannot price");
  assert.equal(readdirSync(join(HOME, "projects", id, "assets", "audio")).length, 2);
});

test("when a provider says no, or sends something that is not sound: a plain message, nothing saved, nothing recorded", async () => {
  for (const [voice, name] of [[ELEVEN, "ElevenLabs"], [VK, "Voicekiller"]] as const) {
    for (const [m, pattern] of [["badkey", /did not accept/], ["noplan", /plan/], ["junk", /not a usable sound/]] as const) {
      if (voice === VK && m === "noplan") { /* covered below with its own wording */ }
      mode = m;
      const id = await newProject();
      const q = (await post("/api/voice/quote", { id, plan: PLAN(voice) })).json;
      const before = await spent();
      const r = await post("/api/voice/make", { id, token: q.token, plan: PLAN(voice) });
      assert.equal(r.status, 400, `${name} ${m}: ${r.text}`);
      assert.match(r.json.error, pattern, `${name} ${m}`);
      assert.equal(await spent(), before, `${name} ${m}: nothing recorded`);
      const dir = join(HOME, "projects", id, "assets", "audio");
      assert.equal(existsSync(dir) ? readdirSync(dir).length : 0, 0, `${name} ${m}: nothing saved`);
    }
  }
  mode = "toofast";
  const id = await newProject();
  const q = (await post("/api/voice/quote", { id, plan: PLAN(ELEVEN) })).json;
  assert.match((await post("/api/voice/make", { id, token: q.token, plan: PLAN(ELEVEN) })).json.error, /too fast/);
  mode = "novoice";
  const id2 = await newProject();
  const q2 = (await post("/api/voice/quote", { id: id2, plan: PLAN(ELEVEN) })).json;
  assert.match((await post("/api/voice/make", { id: id2, token: q2.token, plan: PLAN(ELEVEN) })).json.error, /does not have that voice/);
  mode = "ok";
});

test("voice choices are only ever real shapes, and the lists the page shows are cleaned", async () => {
  const { VOICE_CHOICE, knownVoice, parseVoicekillerVoices, splitVoicekillerKey } = await import("../src/voice.ts");
  for (const ok of ["eleven:AAAAAAAAAAAAAAAAAAAA", "vk:Matthias", "vk:Voice 2.0", "vk:a-b_c"]) assert.ok(knownVoice(ok), ok);
  for (const bad of ["eleven:short", "eleven:AAAAAAAAAAAAAAAAAAA!", "vk:", "vk:../x", "vk:" + "a".repeat(41), "vk:a\nb", "VK:Matthias", "eleven:AAAAAAAAAAAAAAAAAAAA\n"]) assert.ok(!VOICE_CHOICE.test(bad), bad);
  assert.deepEqual(splitVoicekillerKey("user_42:abc"), { userId: "user_42", apiKey: "abc" });
  assert.deepEqual(splitVoicekillerKey("u:a:b"), { userId: "u", apiKey: "a:b" }, "the first colon divides them");
  for (const bad of ["nocolon", ":key", "user:", "us er:key", ""]) assert.equal(splitVoicekillerKey(bad), null, bad);
  assert.deepEqual(parseVoicekillerVoices(["Matthias", "Aria", "../evil", "Matthias"]), ["Matthias", "Aria"]);
  assert.deepEqual(parseVoicekillerVoices({ voices: [{ name: "A" }, { voice_name: "B" }, { id: "C" }, 5, null] }), ["A", "B", "C"]);
  assert.deepEqual(parseVoicekillerVoices("junk"), []);
  assert.deepEqual(parseVoicekillerVoices(null), []);
  const s = (await call("GET", "/api/status")).json;
  assert.deepEqual(s.elevenVoices.map((v: any) => v.name), ["My Cloned Voice", "Narrator"], "the account's own voices, with bad ids dropped");
  assert.deepEqual(s.vkVoices, ["Matthias", "Aria"], "Voicekiller's list, with bad names dropped");
});

test("Settings can check both keys, says what it found, and never echoes a key", async () => {
  const ok1 = (await post("/api/settings/check", { provider: "elevenlabs" })).json;
  assert.equal(ok1.ok, true);
  assert.match(ok1.message, /creator plan/); assert.match(ok1.message, /99,000/);
  const ok2 = (await post("/api/settings/check", { provider: "voicekiller" })).json;
  assert.equal(ok2.ok, true); assert.match(ok2.message, /2 voices/);
  const view = JSON.stringify((await call("GET", "/api/settings")).json);
  assert.ok(!view.includes("el_test_") && !view.includes("vk_test_"), "no key in the settings view");
  assert.equal(JSON.parse(view).keys.elevenlabs.set, true);
  assert.equal(JSON.parse(view).keys.voicekiller.set, true);
  // a Voicekiller key with no User ID is explained when saved, and is never used if it arrives some other way
  const refused = await post("/api/settings/key", { provider: "voicekiller", key: "justakeywithnouseridatall" });
  assert.equal(refused.status, 400); assert.match(refused.json.error, /User ID and your API key/);
  const saved = await post("/api/settings/key", { provider: "voicekiller", userId: "user_77@example.com", key: "another_key_0123456789" });
  assert.equal(saved.status, 200);
  assert.ok(!JSON.stringify(saved.json).includes("another_key"), "the key is not echoed back");
  process.env.VOICEKILLER_API_KEY = "justakeywithnocolon";
  (await import("../src/keys.ts")).forgetKeys();
  assert.equal((await post("/api/settings/check", { provider: "voicekiller" })).json.ok, false, "a key in the wrong shape is not used");
  process.env.VOICEKILLER_API_KEY = "user_42:vk_test_0123456789abcdef";
  (await import("../src/keys.ts")).forgetKeys();
});

test("a fal key (written id:secret) is accepted in Settings, and junk is still refused", async () => {
  const good = "abcd1234-ef56-7890-abcd-ef1234567890:0123456789abcdef0123456789abcdef";
  assert.equal((await post("/api/settings/key", { provider: "fal", key: good })).status, 200);
  assert.ok(!JSON.stringify((await call("GET", "/api/settings")).json).includes("0123456789abcdef"), "the key is not echoed back");
  for (const bad of ["short", "has spaces in it 0123456789", "a:b", "id:secret with space", "<script>alert(1)</script>"]) assert.equal((await post("/api/settings/key", { provider: "fal", key: bad })).status, 400, bad);
});
