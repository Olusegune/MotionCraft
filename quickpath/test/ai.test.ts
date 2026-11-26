import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASPECT, ESTIMATE_USD, generatePicture, NO_LETTERING, picturePrompt, Spend, SpendRefused } from "../src/ai.ts";
import { solidPng } from "./png.ts";

const ledger = () => join(mkdtempSync(join(tmpdir(), "qp-spend-")), "spend.jsonl");

test("a quote works once, for the project and words it was made for", () => {
  const s = new Spend(ledger(), 5);
  const q = s.quote("aaaaaaaaaaaa", "a calm lake", "16:9");
  assert.equal(q.estimateUsd, ESTIMATE_USD);
  assert.match(q.token, /^[a-f0-9]{32}$/);
  assert.throws(() => s.redeem(q.token, "bbbbbbbbbbbb", "a calm lake"), SpendRefused);   // wrong project, and the quote is now gone
  const q2 = s.quote("aaaaaaaaaaaa", "a calm lake", "16:9");
  assert.throws(() => s.redeem(q2.token, "aaaaaaaaaaaa", "a different prompt"), SpendRefused);
  const q3 = s.quote("aaaaaaaaaaaa", "a calm lake", "9:16");
  assert.equal(s.redeem(q3.token, "aaaaaaaaaaaa", "a calm lake").shape, "9:16");
  assert.throws(() => s.redeem(q3.token, "aaaaaaaaaaaa", "a calm lake"), SpendRefused, "a used quote cannot be used again");
  assert.throws(() => s.redeem("0".repeat(32), "aaaaaaaaaaaa", "x"), SpendRefused, "a made-up token is refused");
});

test("a quote runs out after five minutes", () => {
  let now = 1_000_000;
  const s = new Spend(ledger(), 5, () => now);
  const q = s.quote("aaaaaaaaaaaa", "p", "16:9");
  now += 301_000;
  assert.throws(() => s.redeem(q.token, "aaaaaaaaaaaa", "p"), /run out/);
});

test("the spending limit stops new quotes, counted from the ledger on disk", () => {
  const file = ledger();
  const s = new Spend(file, 0.05);
  s.record("aaaaaaaaaaaa", 0.02, "picture");
  s.record("aaaaaaaaaaaa", 0.02, "picture");
  assert.equal(s.spent(), 0.04);
  assert.throws(() => s.quote("aaaaaaaaaaaa", "p", "16:9"), /spending limit/);
  assert.equal(new Spend(file, 5).spent(), 0.04, "a fresh run reads the same total");
  assert.doesNotThrow(() => new Spend(file, 5).quote("aaaaaaaaaaaa", "p", "16:9"));
});

test("the picture prompt bans lettering and carries the scene and the idea", () => {
  const p = picturePrompt("Warm mornings", "start slowly", "A coffee brand called Ember", "9:16");
  assert.ok(p.includes(NO_LETTERING));
  assert.ok(p.includes("Warm mornings") && p.includes("vertical") && p.includes("Ember"));
  assert.ok(p.length <= 700);
});

function fakeKie(script: { create?: () => any; states: any[]; image?: Buffer }) {
  const calls: { url: string; body?: any }[] = [];
  let polls = 0;
  const fetchImpl = (async (url: string, init?: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/jobs/createTask")) return json(script.create ? script.create() : { code: 200, data: { taskId: "t1" } });
    if (url.includes("/jobs/recordInfo")) return json({ code: 200, data: script.states[Math.min(polls++, script.states.length - 1)] });
    return new Response(script.image ?? solidPng(8, 4, [1, 2, 3]), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const done = { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://files.example/p.png"] }) };

test("a picture is made: the request is right, the answer is waited for, the bytes are checked", async () => {
  const k = fakeKie({ states: [{ state: "waiting" }, { state: "generating" }, done] });
  const out = await generatePicture("a calm lake", "9:16", "test-key-0123456789", { fetchImpl: k.fetchImpl, pollMs: 1 });
  assert.equal(out.info.ext, "png");
  const create = k.calls[0].body;
  assert.equal(create.model, "google/imagen4-fast");
  assert.equal(create.input.aspect_ratio, "9:16");
  assert.match(create.input.negative_prompt, /text/);
  assert.equal(k.calls.filter((c) => c.url.includes("recordInfo")).length, 3);
});

test("provider trouble gives a plain sentence, never a crash", async () => {
  const fail = fakeKie({ states: [{ state: "fail", failMsg: "content policy" }] });
  await assert.rejects(generatePicture("p", "16:9", "k".repeat(20), { fetchImpl: fail.fetchImpl, pollMs: 1 }), /content policy/);
  const credit = fakeKie({ states: [], create: () => ({ code: 402, msg: "no credits" }) });
  await assert.rejects(generatePicture("p", "16:9", "k".repeat(20), { fetchImpl: credit.fetchImpl }), /out of credit/);
  const badKey = fakeKie({ states: [], create: () => ({ code: 401, msg: "bad" }) });
  await assert.rejects(generatePicture("p", "16:9", "k".repeat(20), { fetchImpl: badKey.fetchImpl }), /did not accept the key/);
  const refused = fakeKie({ states: [], create: () => ({ code: 422, msg: "bad prompt" }) });
  await assert.rejects(generatePicture("p", "16:9", "k".repeat(20), { fetchImpl: refused.fetchImpl }), /nothing was charged/);
  const notPicture = fakeKie({ states: [done], image: Buffer.from("<html>not a picture</html>") });
  await assert.rejects(generatePicture("p", "16:9", "k".repeat(20), { fetchImpl: notPicture.fetchImpl, pollMs: 1 }), /not a usable picture/);
  const slow = fakeKie({ states: [{ state: "generating" }] });
  await assert.rejects(generatePicture("p", "16:9", "k".repeat(20), { fetchImpl: slow.fetchImpl, pollMs: 1, timeoutMs: 20 }), /taking too long/);
});

test("only https result addresses are followed", async () => {
  const k = fakeKie({ states: [{ state: "success", resultJson: JSON.stringify({ resultUrls: ["http://169.254.169.254/latest", "file:///etc/passwd"] }) }] });
  await assert.rejects(generatePicture("p", "16:9", "k".repeat(20), { fetchImpl: k.fetchImpl, pollMs: 1 }), /sent no picture/);
  assert.equal(k.calls.filter((c) => c.url.startsWith("http://169") || c.url.startsWith("file:")).length, 0);
  void readFileSync;
});

test("the picture prompt reads cleanly: no doubled full stops or stray punctuation", () => {
  const p = picturePrompt("Wake up slowly.", "start now!", "A coffee brand. Warm mornings. Wake up slowly.", "16:9");
  assert.ok(!/[.!?]\s*[.!?]/.test(p.slice(NO_LETTERING.length)), "no doubled stops: " + p);
  assert.ok(p.includes("Wake up slowly (start now)") && p.includes("Warm mornings. Wake up slowly."));
});

test("every shape asks the picture model for a ratio it offers, and shapes that get trimmed say where the subject belongs", () => {
  const offered = new Set(["1:1", "16:9", "9:16", "3:4", "4:3"]);
  for (const shape of Object.keys(ASPECT) as (keyof typeof ASPECT)[]) {
    assert.ok(offered.has(ASPECT[shape]), `${shape} asks for ${ASPECT[shape]}`);
    const p = picturePrompt("A headline", "", "an idea", shape);
    assert.ok(p.length <= 700);
    assert.equal(/trimmed/.test(p), shape === "21:9" || shape === "4:5", `${shape}: ${p.slice(-90)}`);
  }
  assert.match(picturePrompt("x", "", "y", "21:9"), /ultra-wide cinematic/);
  assert.match(picturePrompt("x", "", "y", "4:5"), /portrait/);
});
