// Drives the packaged desktop app from outside, through Chromium's debug port, to check it end to end. Needs Node 22+ (global WebSocket).
// Usage: node scripts/drive.cjs <path to QuickPath.exe> [screenshot.png]
"use strict";
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const PORT = 9555;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exe = process.argv[2], shot = process.argv[3];
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`], { stdio: "ignore", windowsHide: false });
  let targets = null;
  for (let i = 0; i < 60 && !targets; i++) {
    await sleep(500);
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); targets = t.find((x) => x.type === "page" && x.url.startsWith("http://127.0.0.1:")); } catch { /* not up yet */ }
  }
  if (!targets) { child.kill(); throw new Error("the app window never appeared"); }
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const call = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };

  const out = { url: targets.url };
  out.title = await ev("document.title");
  out.engine = await ev("document.getElementById('engine').textContent");
  await ev("document.getElementById('idea').value = 'Ember, a small coffee brand. Warm mornings start slowly. Wake up slowly.'; document.getElementById('make').click(); 0");
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await ev("document.getElementById('status').textContent.startsWith('Ready')")) break; }
  out.status = await ev("document.getElementById('status').textContent");
  out.scenes = await ev("document.querySelectorAll('.scene').length");
  out.video = await ev("(() => { const v = document.getElementById('video'); return { w: v.videoWidth, h: v.videoHeight, d: v.duration }; })()");
  if (shot) { const s = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(shot, Buffer.from(s.result.data, "base64")); }
  out.escapeTest = await ev("(() => { try { return typeof require + '/' + typeof process; } catch (e) { return 'blocked'; } })()");
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  child.kill();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
