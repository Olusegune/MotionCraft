// Drives the packaged desktop app from outside, through Chromium's debug port, to check it end to end. Needs Node 22+ (global WebSocket).
// Usage: node scripts/drive.cjs <path to QuickPath.exe> [screenshot-prefix] [app folder, to run an unpackaged build with electron.exe]
"use strict";
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const PORT = 9555;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const exe = process.argv[2], shot = process.argv[3], appDir = process.argv[4];
  const child = spawn(exe, [...(appDir ? [appDir] : []), `--remote-debugging-port=${PORT}`], { stdio: "ignore", windowsHide: false });
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
  const snap = async (name) => { if (!shot) return; const s = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(`${shot}-${name}.png`, Buffer.from(s.result.data, "base64")); };
  await sleep(1200);
  await snap("start");
  out.title = await ev("document.title");
  out.engine = await ev("document.getElementById('engine').textContent");
  await ev("document.getElementById('idea').value = 'Ember, a small coffee brand. Warm mornings start slowly. Wake up slowly.'; document.getElementById('make').click(); 0");
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await ev("document.getElementById('status').textContent.startsWith('Ready')")) break; }
  out.status = await ev("document.getElementById('status').textContent");
  out.scenes = await ev("document.querySelectorAll('.scene').length");
  out.video = await ev("(() => { const v = document.getElementById('video'); return { w: v.videoWidth, h: v.videoHeight, d: v.duration }; })()");
  await ev("(() => { const v = document.getElementById('video'); v.currentTime = 5.2; return 0; })()");
  await sleep(1500);
  await snap("studio");
  // the confirmation window (opening it sends nothing: only pressing Confirm does) and narrower windows
  await ev("(() => { const b = Array.from(document.querySelectorAll('.pic button')).find((x) => x.textContent === 'Make a picture'); if (b) b.click(); return 0; })()");
  await sleep(2500);
  out.dialogOpen = await ev("document.getElementById('spend').open");
  await snap("dialog");
  await ev("(() => { const d = document.getElementById('spend'); if (d.open) d.close('cancel'); return 0; })()");
  for (const w of [1000, 760]) {
    await call("Emulation.setDeviceMetricsOverride", { width: w, height: 800, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    out["overflow" + w] = await ev("document.documentElement.scrollWidth > innerWidth + 1");
    await snap("studio-" + w);
  }
  await call("Emulation.clearDeviceMetricsOverride");
  out.escapeTest = await ev("(() => { try { return typeof require + '/' + typeof process; } catch (e) { return 'blocked'; } })()");
  console.log(JSON.stringify(out, null, 1));
  ws.close();
  child.kill();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
