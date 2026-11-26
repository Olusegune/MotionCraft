// The local model (Ollama) is a bonus, never a requirement: whatever it does, planning must finish with a usable plan, and soon.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makePlan, planWithModel } from "../src/plan.ts";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let handler: Handler = (_req, res) => { res.statusCode = 404; res.end(); };
const server = createServer((req, res) => handler(req, res));
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => server.closeAllConnections?.() ?? server.close());

const tags = (names: string[]) => JSON.stringify({ models: names.map((name) => ({ name })) });
const chat = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
const GOOD = { title: "Ember", look: "sunrise", scenes: [{ headline: "Warm mornings", sub: "start slowly" }, { headline: "Wake up slowly", sub: "" }, { headline: "Ember coffee", sub: "" }, { headline: "Try it today", sub: "" }] };
const serve = (names: string[], answer: (req: IncomingMessage, res: ServerResponse) => void): Handler => (req, res) => {
  if (req.url === "/api/tags") { res.setHeader("content-type", "application/json"); return void res.end(tags(names)); }
  req.resume(); answer(req, res);
};

test("a good model answer becomes the plan", async () => {
  handler = serve(["qwen3:8b"], (_q, res) => res.end(chat(JSON.stringify(GOOD))));
  const p = await planWithModel("A coffee brand called Ember", 15, base, 3000);
  assert.equal(p?.source, "model");
  assert.equal(p?.scenes.length, 4);
  assert.equal(p?.look, "sunrise");
});

test("the model talks around the JSON, or thinks out loud first: the plan is still found", async () => {
  handler = serve(["llama3.1:8b"], (_q, res) => res.end(chat("<think>let me plan this</think>Sure! Here you go:\n```json\n" + JSON.stringify(GOOD) + "\n```\nHope that helps.")));
  const p = await planWithModel("x idea", 15, base, 3000);
  assert.equal(p?.scenes[0].headline, "Warm mornings");
});

test("a model that never answers: planning gives up after the time limit and the idea's own words are used", async () => {
  handler = serve(["qwen3:8b"], () => { /* never answers */ });
  const t = Date.now();
  const p = await makePlan("Introducing Lumen, the desk lamp that follows the sun. Soft light all day. Pre-order today.", 15, base, 1500);
  assert.ok(Date.now() - t < 6_000, "gave up at the time limit");
  assert.equal(p.source, "words");
  assert.ok(p.scenes.length >= 2);
});

test("odd answers fall back, never throw: an error, not JSON, the wrong shape, one scene, empty", async () => {
  const cases: [string, (q: IncomingMessage, r: ServerResponse) => void][] = [
    ["http 500", (_q, r) => { r.statusCode = 500; r.end("boom"); }],
    ["not json at all", (_q, r) => r.end("this is not json")],
    ["json but no choices", (_q, r) => r.end("{}")],
    ["prose, no braces", (_q, r) => r.end(chat("I would write three scenes about coffee."))],
    ["wrong shape", (_q, r) => r.end(chat(JSON.stringify({ hello: "world" })))],
    ["one scene only", (_q, r) => r.end(chat(JSON.stringify({ title: "t", scenes: [{ headline: "only one" }] })))],
    ["broken json", (_q, r) => r.end(chat('{"title": "t", "scenes": [{"headline": '))],
    ["empty content", (_q, r) => r.end(chat(""))],
    ["connection reset", (q, _r) => q.socket.destroy()],
  ];
  for (const [name, answer] of cases) {
    handler = serve(["qwen3:8b"], answer);
    assert.equal(await planWithModel("idea here", 15, base, 3000), null, name);
    const p = await makePlan("Warm mornings start slowly. Wake up slowly. Ember coffee. Try it today.", 15, base, 3000);
    assert.equal(p.source, "words", name);
  }
});

test("no model running, or only picture models installed: straight to the idea's own words", async () => {
  handler = (_q, r) => { r.statusCode = 404; r.end(); };
  assert.equal(await planWithModel("idea", 15, base, 1000), null);
  handler = serve(["qwen2.5vl:7b", "llava:13b", "nomic-embed-text"], (_q, r) => r.end(chat(JSON.stringify(GOOD))));
  assert.equal(await planWithModel("idea", 15, base, 1000), null, "a vision or embedding model is not asked to write scenes");
  assert.equal(await planWithModel("idea", 15, "http://127.0.0.1:1", 1000), null, "nothing listening");
});

test("a model's scene text is cleaned: lengths capped, quotes trimmed, looks checked", async () => {
  const wild = { title: ' "A very long title that goes on and on and on and on and on" ', look: "../../etc", scenes: [{ headline: "h".repeat(300), sub: "s".repeat(300) }, { headline: '"quoted"', sub: "" }] };
  handler = serve(["qwen3:8b"], (_q, res) => res.end(chat(JSON.stringify(wild))));
  const p = await makePlan("idea words here", 10, base);
  assert.equal(p.source, "model");
  assert.ok(p.title.length <= 40 && p.scenes[0].headline.length <= 70 && p.scenes[0].sub.length <= 90);
  assert.equal(p.scenes[1].headline, "quoted");
  assert.ok(["midnight", "sunrise", "paper", "forest", "ocean", "pop"].includes(p.look), "an unknown look is replaced by a real one");
});
