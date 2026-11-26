// Accessibility audit of the running page with axe-core, in four states (start screen, studio, confirmation window, settings window).
// Usage: node scripts/a11y.cjs <path to QuickPath.exe>   (needs Node 22+; axe-core is a development dependency)
"use strict";
const { spawn } = require("node:child_process");
const { readFileSync } = require("node:fs");
const PORT = 9556;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf-8");

async function main() {
  const child = spawn(process.argv[2], [`--remote-debugging-port=${PORT}`], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === "page" && x.url.startsWith("http://127.0.0.1:")); } catch { /* not up */ } }
  if (!target) { child.kill(); throw new Error("no window"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const ev = (expression) => new Promise((res, rej) => { const id = ++n; waiting.set(id, (d) => (d.result.exceptionDetails ? rej(new Error(JSON.stringify(d.result.exceptionDetails).slice(0, 300))) : res(d.result.result.value))); ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } })); });
  await ev(axeSource);
  const audit = (label) => ev(`axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } }).then(r => ({ label: ${JSON.stringify(label)}, violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map(x => x.target.join(" ")) })), passes: r.passes.length }))`);
  const results = [];
  results.push(await audit("start screen"));
  await ev("document.getElementById('idea').value = 'Ember, a small coffee brand. Warm mornings start slowly. Wake up slowly.'; document.getElementById('make').click(); 0");
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await ev("document.getElementById('status').textContent.startsWith('Ready')")) break; }
  results.push(await audit("studio"));
  await ev("(() => { const b = Array.from(document.querySelectorAll('.pic button')).find(x => x.textContent === 'Make a picture'); b.click(); return 0; })()");
  await sleep(2500);
  results.push(await audit("confirmation window (open: " + (await ev("document.getElementById('spend').open")) + ")"));
  await ev("(() => { const d = document.getElementById('spend'); if (d.open) d.close('cancel'); return 0; })()");
  await ev("document.getElementById('gear').click(); 0");
  await sleep(2500);
  results.push(await audit("settings window (open: " + (await ev("document.getElementById('settings').open")) + ")"));
  console.log(JSON.stringify(results, null, 1));
  ws.close(); child.kill();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
