// Opens a script file (PDF, Word or text) in the real app, the way a person would, and reports what came out: how many scenes, how long, what the first one says.
// Usage: node scripts/check-script-import.cjs <path to the script file> [screenshot prefix]
"use strict";
const { spawn } = require("node:child_process");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const PORT = 9557;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const file = resolve(process.argv[2] ?? ""), shot = process.argv[3];
  const home = mkdtempSync(join(tmpdir(), "qp-imp-"));
  const electron = join(ROOT, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  const env = { ...process.env, QUICKPATH_HOME: home };
  for (const k of ["KIE_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "VOICEKILLER_API_KEY", "FAL_KEY"]) delete env[k];
  const child = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`], { stdio: "ignore", env });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = t.find((x) => x.type === "page" && x.url.startsWith("http://127.0.0.1:")); } catch { /* not up yet */ } }
  if (!target) { child.kill(); throw new Error("the app window never appeared"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const waiting = new Map(), problems = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") problems.push(d.params.exceptionDetails.exception?.description?.slice(0, 200) ?? "error"); else if (d.method === "Log.entryAdded" && d.params.entry.level === "error") problems.push(d.params.entry.text.slice(0, 200)); };
  const call = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  const until = async (expr, secs = 120) => { for (let i = 0; i < secs * 2; i++) { if (await ev(expr)) return true; await sleep(500); } throw new Error("timed out waiting for: " + expr); };
  const snap = async (name) => { if (!shot) return; const s = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(`${shot}-${name}.png`, Buffer.from(s.result.data, "base64")); };
  await call("Runtime.enable"); await call("Log.enable"); await call("DOM.enable");
  await sleep(1500);

  const doc = await call("DOM.getDocument");
  const q = await call("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector: "#scriptFile" });
  await call("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [file] });
  await until("(document.getElementById('scriptFileNote').textContent || '').startsWith('Loaded') || /could not|over 8|did not/i.test(document.getElementById('scriptFileNote').textContent)", 60);
  const out = { note: await ev("document.getElementById('scriptFileNote').textContent"), chars: await ev("document.getElementById('idea').value.length") };
  out.firstLines = (await ev("document.getElementById('idea').value.split('\\n').filter(Boolean).slice(0, 4).join(' | ')")).slice(0, 240);
  await snap("loaded");
  await ev("document.getElementById('make').click(); 0");
  await until("document.querySelectorAll('.scene').length > 0 || /could not|up to 12|five minutes/i.test(document.getElementById('startnote').textContent)", 120);
  out.startnote = await ev("document.getElementById('startnote').textContent");
  out.scenes = await ev("state.plan ? state.plan.scenes.map((s) => ({ seconds: s.seconds, headline: s.headline, note: (s.note || '').slice(0, 70) })) : null");
  out.title = await ev("state.plan && state.plan.title");
  await until("(document.getElementById('status').textContent || '').startsWith('Ready') || /EffectCraft was not/i.test(document.getElementById('status').textContent)", 240);
  out.status = await ev("document.getElementById('status').textContent");
  await sleep(1200);
  await snap("studio");
  out.problems = problems;
  console.log(JSON.stringify(out, null, 2));
  ws.close(); child.kill();
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
