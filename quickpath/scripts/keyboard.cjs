// Keyboard-only check of the running app: every visible control can be reached with Tab and shows a focus ring, nothing traps focus,
// and the confirmation window closes with Escape. Usage: node scripts/keyboard.cjs <path to QuickPath.exe>   (Node 22+)
"use strict";
const { spawn } = require("node:child_process");
const PORT = 9557;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const child = spawn(process.argv[2], [`--remote-debugging-port=${PORT}`], { stdio: "ignore" });
  let target = null;
  for (let i = 0; i < 60 && !target; i++) { await sleep(500); try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((x) => x.type === "page" && x.url.startsWith("http://127.0.0.1:")); } catch { /* not up */ } }
  if (!target) { child.kill(); throw new Error("no window"); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let n = 0; const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && waiting.has(d.id)) { waiting.get(d.id)(d); waiting.delete(d.id); } };
  const call = (method, params = {}) => new Promise((res) => { const id = ++n; waiting.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
  const key = async (k, code, vk, shift = false) => { for (const type of ["keyDown", "keyUp"]) await call("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk, modifiers: shift ? 8 : 0, ...(k === "Enter" && type === "keyDown" ? { text: String.fromCharCode(13) } : {}) }); await sleep(30); };

  const describe = `(() => {
    const e = document.activeElement; if (!e || e === document.body) return null;
    const label = e.closest('label.btn') || e.closest('.composer'); const t = label || e;
    const cs = getComputedStyle(t);
    const ring = e.tagName === 'VIDEO' /* the player draws its own focus ring on its play, volume and menu buttons */ || (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== 'none');
    const name = (e.getAttribute('aria-label') || e.id || e.textContent || e.tagName).trim().slice(0, 40);
    return { name: e.tagName.toLowerCase() + ':' + name, ring: !!ring };
  })()`;
  const focusables = `Array.from(document.querySelectorAll('button, input, select, textarea')).filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return !e.disabled && !e.closest('[hidden]') && !e.closest('dialog:not([open])') && cs.visibility !== 'hidden' && (r.width > 0 || e.type === 'file'); }).length`;

  async function tour(label) {
    await sleep(1500);                                    // let the video list and the controls finish drawing
    await ev("document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); 0");
    const expected = await ev(focusables);
    const seen = new Map();
    let steps = 0;
    for (; steps < expected + 6; steps++) {
      await key("Tab", "Tab", 9);
      const d = await ev(describe);
      if (d) seen.set(d.name + "#" + steps, d);
    }
    const noRing = [...seen.values()].filter((d) => !d.ring).map((d) => d.name);
    const names = new Set([...seen.values()].map((d) => d.name));
    const all = await ev(`Array.from(document.querySelectorAll('button, input, select, textarea')).filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return !e.disabled && !e.closest('[hidden]') && !e.closest('dialog:not([open])') && cs.visibility !== 'hidden' && (r.width > 0 || e.type === 'file'); }).map((e) => e.tagName.toLowerCase() + ':' + (e.getAttribute('aria-label') || e.id || e.textContent || e.tagName).trim().slice(0, 40))`);
    const missed = all.filter((a) => !names.has(a));
    return { label, controls: expected, reached: expected - missed.length, missed, noFocusRing: noRing };
  }

  const results = [];
  results.push(await tour("start screen"));
  await ev("document.getElementById('idea').value = 'Ember, a small coffee brand. Warm mornings start slowly. Wake up slowly.'; document.getElementById('make').click(); 0");
  for (let i = 0; i < 40; i++) { await sleep(1000); if (await ev("document.getElementById('status').textContent.startsWith('Ready')")) break; }
  results.push(await tour("studio"));
  await ev("(() => { const b = Array.from(document.querySelectorAll('.pic button')).find((x) => x.textContent === 'Make a picture'); b.click(); return 0; })()");
  await sleep(2500);
  const opened = await ev("document.getElementById('spend').open");
  const inside = await ev("(() => { const d = document.getElementById('spend'); return d.contains(document.activeElement); })()");
  await key("Tab", "Tab", 9); await key("Tab", "Tab", 9); await key("Tab", "Tab", 9); await key("Tab", "Tab", 9); await key("Tab", "Tab", 9); await key("Tab", "Tab", 9);
  const trapped = await ev("document.getElementById('spend').contains(document.activeElement)");
  await key("Escape", "Escape", 27);
  await sleep(300);
  const closed = !(await ev("document.getElementById('spend').open"));
  // the settings window: opens from the gear with the keyboard, keeps focus inside, shows a focus ring on every key box and button, closes with Escape
  await ev("document.getElementById('gear').focus(); 0");
  await key("Enter", "Enter", 13);
  await sleep(2500);
  const setOpen = await ev("document.getElementById('settings').open");
  const setSeen = new Map();
  for (let i = 0; i < 14; i++) { await key("Tab", "Tab", 9); const d = await ev(describe); if (d) setSeen.set(d.name + "#" + i, d); }
  const setInside = await ev("document.getElementById('settings').contains(document.activeElement)");
  const setNoRing = [...setSeen.values()].filter((d) => !d.ring).map((d) => d.name);
  await key("Escape", "Escape", 27);
  await sleep(300);
  const setClosed = !(await ev("document.getElementById('settings').open"));
  console.log(JSON.stringify({ settings: { opened: setOpen, focusStaysInside: setInside, noFocusRing: setNoRing, escapeCloses: setClosed } }));
  console.log(JSON.stringify({ results, dialog: { opened, focusStartsInside: inside, focusStaysInside: trapped, escapeCloses: closed } }, null, 1));
  const bad = results.some((r) => r.reached < r.controls || r.noFocusRing.length) || !(opened && trapped && closed) || !(setOpen && setInside && setClosed && !setNoRing.length);
  ws.close(); child.kill();
  if (bad) process.exitCode = 1;
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
