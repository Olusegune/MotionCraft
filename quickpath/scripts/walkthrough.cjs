// Makes the first-time-user walkthrough: runs the real app in a clean, empty QuickPath folder, takes the pictures through Chromium's debug port, and writes
// docs/WALKTHROUGH.md (for GitHub) and docs/WALKTHROUGH.html (one file with the pictures inside, opened from the Help menu).
// Usage: node scripts/walkthrough.cjs        (needs the unpackaged app: `npm run bundle` first; EffectCraft must be installed to make the videos)
// Nothing here spends money: a made-up key is set only so the price window can be shown, and the window is closed with Cancel.
"use strict";
const { spawn } = require("node:child_process");
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");

const ROOT = resolve(__dirname, "..");
const IMG = join(ROOT, "docs", "img");
const PORT = 9556;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SCRIPT = readFileSync(join(ROOT, "samples", "the-day-we-built-superintelligence.md"), "utf-8");

async function main() {
  mkdirSync(IMG, { recursive: true });
  const home = mkdtempSync(join(tmpdir(), "qp-walk-"));
  const electron = join(ROOT, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
  const env = { ...process.env, QUICKPATH_HOME: home, KIE_API_KEY: "walkthrough_not_a_real_key_000000" };
  delete env.OPENAI_API_KEY; delete env.ELEVENLABS_API_KEY; delete env.VOICEKILLER_API_KEY; delete env.FAL_KEY;
  const child = spawn(electron, [ROOT, `--remote-debugging-port=${PORT}`], { stdio: "ignore", env });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(500);
    try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); target = t.find((x) => x.type === "page" && x.url.startsWith("http://127.0.0.1:")); } catch { /* not up yet */ }
  }
  if (!target) { child.kill(); throw new Error("the app window never appeared"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const call = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  const snap = async (name) => { const s = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(join(IMG, `${name}.png`), Buffer.from(s.result.data, "base64")); console.log("saved", name); };
  const until = async (expr, secs = 90) => { for (let i = 0; i < secs * 2; i++) { if (await ev(expr)) return true; await sleep(500); } throw new Error("timed out waiting for: " + expr); };
  const aside = (js) => ev(`(() => { const a = document.querySelector('aside'); if (!a) return 0; ${js}; return 1; })()`);

  await sleep(1500);
  await snap("01-start");

  // 2: an idea and a shape
  await ev(`(() => { const i = document.getElementById('idea'); i.value = 'A 15 second teaser for Ember, a small coffee brand. Warm mornings start slowly. Wake up slowly.'; i.dispatchEvent(new Event('input', { bubbles: true })); const b = Array.from(document.querySelectorAll('#shape button')).find((x) => (x.getAttribute('aria-label') || '').endsWith(', 21:9')); if (b) b.click(); return 0; })()`);
  await sleep(500);
  await snap("02-idea");

  // 3: the studio after Make
  await ev("document.getElementById('make').click(); 0");
  await until("(document.getElementById('status').textContent || '').startsWith('Ready')");
  await ev("(() => { const v = document.getElementById('video'); v.currentTime = 2.5; return 0; })()");
  await sleep(1500);
  await snap("03-studio");
  await aside("a.scrollTop = 0");
  await sleep(300);
  await snap("04-scenes");

  // 5/6: references and motion, then the sound choices
  // a picture of your own on scene 1 (a gradient made here, standing in for a photo), so the motion panel has something to plan
  await ev(`(async () => { const c = document.createElement('canvas'); c.width = 1280; c.height = 720; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 0, 720); g.addColorStop(0, '#f6b26b'); g.addColorStop(0.6, '#e8805a'); g.addColorStop(1, '#3b2a4a'); x.fillStyle = g; x.fillRect(0, 0, 1280, 720); x.fillStyle = '#fff3d6'; x.beginPath(); x.arc(640, 430, 120, 0, 7); x.fill(); const blob = await new Promise((r) => c.toBlob(r, 'image/png')); const r = await fetch('/api/upload?id=' + state.id, { method: 'POST', headers: { 'content-type': 'image/png' }, body: blob }); const j = await r.json(); state.plan.scenes[0].picture = j.name; drawScenes(); return 0; })()`);
  await sleep(1200);
  await aside("const r = document.getElementById('refs'); if (r) { r.open = true; a.scrollTop = r.offsetTop - 12; }");
  await sleep(400);
  await snap("05-references");
  await aside("a.scrollTop = a.scrollHeight");
  await sleep(300);
  await snap("06-sound");

  // 7: the price window (opening it sends nothing; Cancel closes it)
  await aside("a.scrollTop = 0");
  await ev(`(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => x.textContent === 'Make a picture'); if (b) b.click(); return 0; })()`);
  await until("document.getElementById('spend') && document.getElementById('spend').open", 20);
  await sleep(500);
  await snap("07-price");
  await ev("document.getElementById('spend').close('cancel'); 0");

  // 8: settings
  await ev("document.getElementById('gear').click(); 0");
  await until("document.getElementById('settings').open", 20);
  await sleep(900);
  await snap("08-settings");
  await ev("document.getElementById('settings').close(); 0");

  // 9/10: a timed script
  await ev("document.getElementById('again').click(); 0");
  await sleep(500);
  await ev(`(() => { const i = document.getElementById('idea'); i.value = ${JSON.stringify(SCRIPT)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 0; })()`);
  await sleep(500);
  await snap("09-script-pasted");
  await ev("document.getElementById('make').click(); 0");
  // the script picks a narrator and a second voice for Bisi when a Kie key exists, so Update asks first: show that window, then carry on with no voice
  await until("document.getElementById('spend') && document.getElementById('spend').open", 120);
  await sleep(600);
  await snap("10-script-voices");
  await ev("document.getElementById('spend').close('cancel'); 0");
  await sleep(800);
  await ev("(() => { delete state.plan.voice; state.plan.scenes.forEach((s) => delete s.voice); drawScenes(); document.getElementById('voice').value = ''; document.getElementById('update').click(); return 0; })()");
  await until("(document.getElementById('status').textContent || '').startsWith('Ready')", 180);
  await sleep(1500);
  await aside("a.scrollTop = 0");
  await snap("11-script-studio");
  await aside("const s = document.querySelectorAll('.scene')[1]; if (s) a.scrollTop = s.offsetTop - 12");
  await sleep(300);
  await snap("12-script-scene");
  const projectId = await ev("state.id");
  console.log("project", join(home, "projects", projectId));
  writeFileSync(join(IMG, "..", ".walkthrough-project.txt"), join(home, "projects", projectId, "video.ecproj"));
  ws.close();
  child.kill();
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
