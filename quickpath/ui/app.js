"use strict";
// One page, no framework. User text only ever goes in through textContent or .value, never innerHTML.
const $ = (id) => document.getElementById(id);
const state = { plan: null, shape: "16:9", seconds: 15, id: null, busy: false, dirty: false, last: null, looks: [] };

const LENGTHS = [10, 15, 30, 60];
const SHAPES = [["16:9", "Wide"], ["9:16", "Tall"], ["1:1", "Square"]];

async function api(path, body) {
  const r = await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Something went wrong. Try again.");
  return j;
}

function segmented(host, items, current, onPick) {
  host.textContent = "";
  for (const [value, label] of items) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = label; b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(value === current));
    b.addEventListener("click", () => { onPick(value); segmented(host, items, value, onPick); });
    host.appendChild(b);
  }
}

function say(text, kind = "") { const s = $("status"); s.textContent = text; s.className = "muted " + kind; }
function setBusy(on, text = "") {
  state.busy = on;
  for (const id of ["make", "update", "final", "again", "add"]) $(id).disabled = on;
  $("empty").hidden = !on; $("busy").textContent = text;
  if (on) { $("video").hidden = true; $("video").pause(); }
}

// The first frame is only background (the words fade in), so a fresh video waits a moment in, where the words are.
$("video").addEventListener("loadedmetadata", (e) => { const v = e.target; if (v.currentTime === 0 && v.duration > 3) v.currentTime = 1.2; });

function shapeClass() { $("screen").className = "screen" + (state.shape === "9:16" ? " portrait" : state.shape === "1:1" ? " square" : ""); }

function drawScenes() {
  const ol = $("scenes"); ol.textContent = "";
  state.plan.scenes.forEach((s, i) => {
    const li = document.createElement("li"); li.className = "scene";
    const top = document.createElement("div"); top.className = "top2";
    const n = document.createElement("span"); n.textContent = `Scene ${i + 1}`;
    const g = document.createElement("span"); g.className = "grow";
    const sec = document.createElement("input"); sec.type = "number"; sec.min = "1.5"; sec.max = "30"; sec.step = "0.5"; sec.value = String(s.seconds);
    sec.setAttribute("aria-label", `Scene ${i + 1} seconds`);
    sec.addEventListener("input", () => { s.seconds = Math.min(30, Math.max(1.5, Number(sec.value) || 3)); touch(); });
    const u = document.createElement("span"); u.textContent = "s";
    const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "×"; del.setAttribute("aria-label", `Remove scene ${i + 1}`);
    del.disabled = state.plan.scenes.length <= 1;
    del.addEventListener("click", () => { state.plan.scenes.splice(i, 1); drawScenes(); touch(); });
    top.append(n, g, sec, u, del);
    const h = document.createElement("input"); h.value = s.headline; h.maxLength = 90; h.setAttribute("aria-label", `Scene ${i + 1} headline`);
    h.addEventListener("input", () => { s.headline = h.value; touch(); });
    const sub = document.createElement("input"); sub.value = s.sub; sub.maxLength = 120; sub.placeholder = "Small line (optional)"; sub.setAttribute("aria-label", `Scene ${i + 1} small line`);
    sub.addEventListener("input", () => { s.sub = sub.value; touch(); });
    li.append(top, h, sub); ol.appendChild(li);
  });
}

function drawLooks() {
  const host = $("looks"); host.textContent = "";
  for (const l of state.looks) {
    const b = document.createElement("button"); b.type = "button"; b.className = "look"; b.title = l.name;
    b.setAttribute("role", "radio"); b.setAttribute("aria-label", l.name); b.setAttribute("aria-checked", String(l.id === state.plan.look));
    const rgb = (c) => `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;
    b.style.background = rgb(l.bg);
    const bar = document.createElement("i"); bar.style.background = rgb(l.accent); b.appendChild(bar);
    b.addEventListener("click", () => { state.plan.look = l.id; drawLooks(); touch(); });
    host.appendChild(b);
  }
}

function touch() { state.dirty = true; $("update").classList.add("primary"); say("You changed something. Press Update video to see it."); }

async function render(quality) {
  const label = quality === "final" ? "Saving the full-size video…" : "Making your video…";
  setBusy(true, label); say("");
  try {
    const out = await api("/api/render", { plan: state.plan, shape: state.shape, quality, id: state.id });
    state.id = out.id;
    if (quality === "draft") {
      const v = $("video"); v.src = out.url + "?t=" + Date.now(); v.hidden = false; $("empty").hidden = true;
      state.dirty = false; state.last = null; $("done").hidden = true;
      say(`Ready: ${out.seconds} seconds. Press play. Change any words, then Update video.`, "ok");
    } else {
      state.last = out.url; $("done").hidden = false; $("path").textContent = out.path;
      const v = $("video"); v.hidden = false; $("empty").hidden = true; v.src = out.url + "?t=" + Date.now();
      say("Saved. Your full-size video is in your QuickPath folder.", "ok");
    }
  } catch (e) {
    $("empty").hidden = true; if ($("video").src) $("video").hidden = false;
    say(e.message, "error");
  } finally { setBusy(false); if (state.last || $("video").src) $("empty").hidden = true; $("update").classList.toggle("primary", state.dirty); }
}

async function make() {
  const idea = $("idea").value.trim();
  if (idea.length < 3) { $("startnote").textContent = "Tell me a little about your video first."; $("idea").focus(); return; }
  $("startnote").textContent = "";
  $("make").disabled = true; $("startnote").textContent = "Writing the scenes…";
  try {
    state.plan = await api("/api/plan", { idea, seconds: state.seconds });
    state.id = null; state.dirty = false;
    $("start").hidden = true; $("studio").hidden = false; shapeClass(); drawScenes(); drawLooks();
    await render("draft");
  } catch (e) { $("startnote").textContent = e.message; $("make").disabled = false; }
}

function init() {
  segmented($("len"), LENGTHS.map((n) => [n, `${n} s`]), state.seconds, (v) => (state.seconds = v));
  segmented($("shape"), SHAPES, state.shape, (v) => { state.shape = v; });
  $("make").addEventListener("click", make);
  $("idea").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) make(); });
  document.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => { $("idea").value = b.dataset.ex; $("idea").focus(); }));
  $("update").addEventListener("click", () => render("draft"));
  $("final").addEventListener("click", () => render("final"));
  $("add").addEventListener("click", () => { if (state.plan.scenes.length >= 12) return; state.plan.scenes.push({ headline: "New scene", sub: "", seconds: 3 }); drawScenes(); touch(); });
  $("again").addEventListener("click", () => { if (state.dirty && !confirm("Start over? Your changes will be lost.")) return; $("studio").hidden = true; $("start").hidden = false; $("make").disabled = false; $("startnote").textContent = ""; $("video").removeAttribute("src"); state.plan = null; state.id = null; });
  $("reveal").addEventListener("click", () => state.last && api("/api/reveal", { url: state.last }).catch(() => {}));
  api("/api/status").then((s) => {
    state.looks = s.looks;
    const e = $("engine");
    e.textContent = s.engine ? "EffectCraft ready" : "EffectCraft not found";
    e.className = "engine" + (s.engine ? "" : " bad");
    if (!s.engine) $("startnote").textContent = "EffectCraft 0.24.1 is needed to make videos. Install it, then reload this page.";
  }).catch(() => {});
}
init();
