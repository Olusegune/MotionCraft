import { test, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.QUICKPATH_HOME = mkdtempSync(join(tmpdir(), "qp-"));
const { start } = await import("../src/server.ts");
const server = start(0);
await new Promise((r) => server.once("listening", r));
const port = (server.address() as { port: number }).port;
after(() => server.close());

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

import { solidPng } from "./png.ts";

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
