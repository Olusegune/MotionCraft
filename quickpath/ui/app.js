"use strict";
// One page, no framework. Words from people, models and files only ever go in as plain text (textContent or .value), never as HTML.
const $ = (id) => document.getElementById(id);
const state = { plan: null, shape: "16:9", seconds: 15, id: null, busy: false, dirty: false, last: null, looks: [], idea: "" };
const MB = 1024 * 1024;

const LENGTHS = [10, 15, 30, 60];
// The same list the server accepts (a test checks they match). Each is drawn to scale on its button.
const SHAPES = [["16:9", "Wide"], ["9:16", "Tall"], ["1:1", "Square"], ["4:5", "Portrait"], ["21:9", "Cinema"], ["4:3", "Classic"]];
const ratioOf = (shape) => { const [w, h] = shape.split(":").map(Number); return w / h; };

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

/** The shape picker: each button shows the shape drawn to scale, its name and its ratio. */
function shapePicker(host, current, onPick) {
  host.textContent = "";
  for (const [value, name] of SHAPES) {
    const r = ratioOf(value), w = r >= 1 ? 26 : Math.round(26 * r), h = r >= 1 ? Math.round(26 / r) : 26;
    const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(value === current));
    b.setAttribute("aria-label", `${name}, ${value}`); b.title = `${name} ${value}`;
    const box = document.createElement("i"); box.style.width = `${w}px`; box.style.height = `${h}px`;
    const label = document.createElement("span"); label.textContent = value;
    b.append(box, label);
    b.addEventListener("click", () => { onPick(value); shapePicker(host, value, onPick); });
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

function shapeClass() { const sc = $("screen"), r = ratioOf(state.shape); sc.className = "screen" + (r < 1.5 ? " tall" : ""); sc.style.aspectRatio = state.shape === "21:9" ? "2560 / 1080" : state.shape.replace(":", " / "); }       // 21:9 is the 2560 by 1080 ultrawide frame, a hair wider than 21 to 9: the screen matches the video exactly

function drawScenes() {
  const ol = $("scenes"); ol.textContent = "";
  if (state.plan && state.id) drawRefs();
  state.plan.scenes.forEach((s, i) => {
    const li = document.createElement("li"); li.className = "scene"; li.dataset.i = String(i);
    const top = document.createElement("div"); top.className = "top2";
    const n = document.createElement("span"); n.textContent = `Scene ${i + 1}`;
    const g = document.createElement("span"); g.className = "grow";
    const sec = document.createElement("input"); sec.type = "number"; sec.min = "1.5"; sec.max = "30"; sec.step = "0.5"; sec.value = String(s.seconds);
    sec.setAttribute("aria-label", `Scene ${i + 1} seconds`);
    sec.addEventListener("input", () => { s.seconds = Math.min(30, Math.max(1.5, Number(sec.value) || 3)); touch(); drawTimeline(); });
    const u = document.createElement("span"); u.textContent = "s";
    const del = document.createElement("button"); del.type = "button"; del.className = "del"; del.textContent = "×"; del.setAttribute("aria-label", `Remove scene ${i + 1}`);
    del.disabled = state.plan.scenes.length <= 1;
    del.addEventListener("click", () => { state.plan.scenes.splice(i, 1); drawScenes(); touch(); });
    top.append(n, g, sec, u, del);
    const h = document.createElement("input"); h.value = s.headline; h.maxLength = 90; h.setAttribute("aria-label", `Scene ${i + 1} headline`);
    h.addEventListener("input", () => { s.headline = h.value; touch(); });
    const sub = document.createElement("input"); sub.value = s.sub; sub.maxLength = 120; sub.placeholder = "Small line (optional)"; sub.setAttribute("aria-label", `Scene ${i + 1} small line`);
    sub.addEventListener("input", () => { s.sub = sub.value; touch(); });
    if (s.card !== undefined || s.note) h.placeholder = "Words on screen (empty: none)";
    li.append(top, h, sub);
    if (s.card !== undefined || s.note) {
      const card = document.createElement("input"); card.value = s.card || ""; card.maxLength = 60; card.placeholder = "Time card (a few words shown low in the frame, optional)"; card.setAttribute("aria-label", `Scene ${i + 1} time card`);
      card.addEventListener("input", () => { if (card.value) s.card = card.value; else delete s.card; touch(); });
      li.append(card);
    }
    if (state.plan.voice || s.voice) {
      const say = document.createElement("input"); say.className = "say"; say.value = s.say || ""; say.maxLength = 600; say.placeholder = "Voice says (empty: reads the words above)"; say.setAttribute("aria-label", `Scene ${i + 1} voice says`);
      say.addEventListener("input", () => { s.say = say.value; touch(); });
      li.append(say);
    }
    if (state.plan.voice || s.voice) {
      const vs = document.createElement("select"); vs.className = "say"; vs.setAttribute("aria-label", `Scene ${i + 1} speaker`);
      const same = document.createElement("option"); same.value = ""; same.textContent = "Speaker: same voice as the video"; vs.appendChild(same);
      for (const o of $("voice").options) if (o.value) vs.appendChild(o.cloneNode(true));
      vs.value = s.voice || "";
      vs.addEventListener("change", () => { if (vs.value) s.voice = vs.value; else delete s.voice; touch(); });
      li.append(vs);
    }
    if (s.note !== undefined) {
      const note = document.createElement("textarea"); note.className = "say"; note.rows = 3; note.maxLength = 900; note.value = s.note; note.placeholder = "Picture direction (also the starting words for an AI clip)"; note.setAttribute("aria-label", `Scene ${i + 1} picture direction`);
      note.addEventListener("input", () => { s.note = note.value; touch(); });
      li.append(note);
    }
    li.append(mediaRow(s, i)); ol.appendChild(li);
  });
  drawTimeline();
}

// The scenes laid out in time under the video: each block as wide as its scene is long, a line that moves with the video, and the scene being played lit up.
function drawTimeline() {
  const tl = $("timeline"); tl.textContent = "";
  if (!state.plan) return;
  state.plan.scenes.forEach((s, i) => {
    const b = document.createElement("button"); b.type = "button"; b.style.flex = `${s.seconds} 1 0`;
    b.textContent = String(i + 1); b.title = `Scene ${i + 1}: ${s.headline} (${s.seconds} s)`; b.setAttribute("aria-label", `Go to scene ${i + 1}, ${s.seconds} seconds`);
    b.addEventListener("click", () => {
      const at = state.plan.scenes.slice(0, i).reduce((n, x) => n + x.seconds, 0) + 1.2;       // a moment in, where the words are
      const v = $("video"); if (v.src) v.currentTime = Math.min(at, v.duration || at);
      const card = document.querySelector(`.scene[data-i="${i}"] input[aria-label$="headline"]`); if (card) card.focus({ preventScroll: false });
    });
    tl.appendChild(b);
  });
  const ph = document.createElement("div"); ph.className = "playhead"; ph.hidden = true; ph.setAttribute("aria-hidden", "true"); tl.appendChild(ph);
  markPlaying();
}

function markPlaying() {
  if (!state.plan) return;
  const v = $("video"), total = state.plan.scenes.reduce((n, x) => n + x.seconds, 0);
  const t = v.src && !v.hidden ? v.currentTime : -1;
  let acc = 0, now = -1;
  state.plan.scenes.forEach((s, i) => { if (t >= acc && t < acc + s.seconds) now = i; acc += s.seconds; });
  document.querySelectorAll("#timeline button").forEach((b, i) => b.classList.toggle("on", i === now));
  document.querySelectorAll(".scene").forEach((c, i) => c.classList.toggle("on", i === now));
  const tl = $("timeline"), ph = tl.querySelector(".playhead");
  if (ph) { ph.hidden = t < 0; if (t >= 0) { const w = tl.clientWidth - 8; ph.style.left = `${4 + Math.min(1, t / total) * w}px`; } }
}
$("video").addEventListener("timeupdate", markPlaying);
$("video").addEventListener("seeked", markPlaying);
$("video").addEventListener("loadeddata", markPlaying);

function mediaRow(s, i) {
  const row = document.createElement("div"); row.className = "pic";
  if (s.picture && state.id) {
    const src = `/media/${state.id}/assets/${s.picture}`;
    const isClip = s.picture.endsWith(".mp4");
    const thumb = document.createElement(isClip ? "video" : "img");
    if (isClip) { thumb.muted = true; thumb.preload = "metadata"; thumb.src = src + "#t=0.5"; } else { thumb.src = src; thumb.alt = `Scene ${i + 1} picture`; }
    const rm = document.createElement("button"); rm.type = "button"; rm.className = "btn quiet small"; rm.textContent = isClip ? "Remove clip" : "Remove picture";
    rm.addEventListener("click", () => { delete s.picture; drawScenes(); touch(); });
    if (!isClip) {
      const an = document.createElement("button"); an.type = "button"; an.className = "btn quiet small"; an.textContent = "Animate this picture";
      an.addEventListener("click", () => askAnimate(s, i));
      row.append(thumb, rm, an); return row;
    }
    row.append(thumb, rm); return row;
  }
  const label = document.createElement("label"); label.className = "btn quiet small";
  label.textContent = "Add picture or clip";
  const input = document.createElement("input"); input.type = "file"; input.accept = "image/png,image/jpeg,video/mp4"; input.className = "visually-hidden";
  input.setAttribute("aria-label", `Add a picture or clip to scene ${i + 1}`);
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0]; if (!f) return;
    const clip = f.type === "video/mp4";
    if (f.size > (clip ? 150 : 12) * MB) { say(`That file is over ${clip ? 150 : 12} MB. Try a smaller one.`, "error"); return; }
    say(clip ? "Adding the clip…" : "Adding the picture…");
    try {
      const r = await fetch(`/api/upload?id=${encodeURIComponent(state.id)}`, { method: "POST", headers: { "content-type": f.type }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not add that file.");
      s.picture = j.name; drawScenes(); touch();
    } catch (e) { say(e.message, "error"); }
  });
  label.appendChild(input);
  const ai = document.createElement("button"); ai.type = "button"; ai.className = "btn quiet small"; ai.textContent = "Make a picture";
  ai.addEventListener("click", () => askPicture(s, i));
  row.append(label, ai);
  if (state.plan.refs && state.plan.refs.length) {
    const pick = document.createElement("select"); pick.setAttribute("aria-label", `Use a reference picture for scene ${i + 1}`); pick.style.width = "auto";
    const first = document.createElement("option"); first.value = ""; first.textContent = "Use a reference…"; pick.appendChild(first);
    for (const r of state.plan.refs) { const o = document.createElement("option"); o.value = r.name; o.textContent = r.label; pick.appendChild(o); }
    pick.addEventListener("change", () => { if (!pick.value) return; s.picture = pick.value; drawScenes(); touch(); });
    row.append(pick);
  }
  return row;
}

// The reference shelf: pictures kept for the whole video (characters, places, props). A sheet of panels is cut into pictures here, in the page, and each is saved as a PNG.
async function addRef(blob, label) {
  const r = await fetch(`/api/upload?id=${encodeURIComponent(state.id)}`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Could not add that picture.");
  state.plan.refs = [...(state.plan.refs || []), { name: j.name, label: label.slice(0, 40) || "Reference" }].slice(-24);
}
function drawRefs() {
  let box = $("refs");
  if (!box) { box = document.createElement("section"); box.id = "refs"; box.className = "refs"; $("scenes").before(box); }
  box.textContent = "";
  const h = document.createElement("h3"); h.textContent = "References"; box.append(h);
  const p = document.createElement("p"); p.className = "note"; p.textContent = "Pictures kept for the whole video. Cut a sheet of panels into pictures, then use any of them on a scene.";
  box.append(p);
  const strip = document.createElement("div"); strip.className = "pic";
  for (const r of state.plan.refs || []) {
    const fig = document.createElement("figure"); fig.style.margin = "0"; fig.style.textAlign = "center";
    const img = document.createElement("img"); img.src = `/media/${state.id}/assets/${r.name}`; img.alt = r.label; img.style.height = "56px"; img.style.borderRadius = "6px";
    const cap = document.createElement("figcaption"); cap.className = "note"; cap.textContent = r.label;
    fig.append(img, cap); strip.append(fig);
  }
  box.append(strip);
  const num = (id, v, label, max) => { const w = document.createElement("label"); w.className = "note"; w.textContent = label + " "; const i = document.createElement("input"); i.type = "number"; i.min = "0"; i.max = String(max); i.value = String(v); i.style.width = "72px"; i.id = id; w.append(i); return w; };
  const row = document.createElement("div"); row.className = "pic";
  const file = document.createElement("input"); file.type = "file"; file.id = "refFile"; file.accept = "image/png,image/jpeg,image/webp"; file.setAttribute("aria-label", "Choose a sheet or a picture");
  const labels = document.createElement("input"); labels.id = "refLabels"; labels.placeholder = "Names, left to right then down (e.g. Pencil, Drawing, Candle)"; labels.setAttribute("aria-label", "Names of the panels"); labels.style.minWidth = "260px";
  const go = document.createElement("button"); go.type = "button"; go.className = "btn quiet small"; go.textContent = "Cut into pictures";
  row.append(file, num("refCols", 3, "Across", 8), num("refRows", 2, "Down", 8), num("refTop", 0, "Title band at the top, %", 40), num("refBot", 0, "Caption band under each panel, %", 40), labels, go);
  box.append(row);
  go.addEventListener("click", async () => {
    const f = file.files && file.files[0]; if (!f) { say("Choose a picture or a sheet first.", "error"); return; }
    if (f.size > 25 * MB) { say("That file is over 25 MB.", "error"); return; }
    const bot = Math.min(40, Math.max(0, Number($("refBot").value) || 0)) / 100;
    const cols = Math.max(1, Number($("refCols").value) || 1), rows = Math.max(1, Number($("refRows").value) || 1), top = Math.min(40, Math.max(0, Number($("refTop").value) || 0)) / 100;
    const names = $("refLabels").value.split(",").map((x) => x.trim());
    say("Cutting the sheet…");
    try {
      const bmp = await createImageBitmap(f);
      const cw = Math.floor(bmp.width / cols), ch = Math.floor((bmp.height * (1 - top)) / rows), y0 = Math.round(bmp.height * top);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const keep = Math.floor(ch * (1 - bot)), inset = Math.round(Math.min(cw, keep) * 0.012);   // a thin inset drops the border between panels
        const cv = document.createElement("canvas"); cv.width = cw - 2 * inset; cv.height = keep - 2 * inset;
        cv.getContext("2d").drawImage(bmp, c * cw + inset, y0 + r * ch + inset, cv.width, cv.height, 0, 0, cv.width, cv.height);
        const blob = await new Promise((ok) => cv.toBlob(ok, "image/png"));
        await addRef(blob, names[r * cols + c] || `${f.name.replace(/\.[^.]+$/, "")} ${r * cols + c + 1}`);
      }
      drawRefs(); drawScenes(); touch(); say("The pictures are on the shelf. Use them on any scene.", "ok");
    } catch (e) { say(e.message || "Could not cut that picture.", "error"); }
  });
}

// Nothing is spent until the person presses Confirm: the quote shows the model, the provider, an estimate and what is sent.
// Resolves to true when confirmed. `words` is shown in the box; when `editable`, the person may change it and the caller gets the final text.
function confirmSpend(quote, opts) {
  return new Promise((resolve) => {
    const dlg = $("spend");
    $("spendTitle").textContent = opts.title;
    $("spendWhat").textContent = opts.forWhat;
    $("spendModel").textContent = `${quote.model} via ${quote.provider}`;
    $("spendPrice").textContent = `About $${quote.estimateUsd.toFixed(quote.estimateUsd < 0.01 ? 4 : 2)} for ${quote.what}. ${quote.note}`;
    $("spendLimit").textContent = `Used so far: $${quote.spentUsd.toFixed(2)} of your $${quote.capUsd.toFixed(2)} limit.`;
    $("spendPromptLabel").textContent = opts.editable ? "The words sent to the model. You can change them." : "The words that will be spoken.";
    $("spendPrompt").value = opts.words; $("spendPrompt").readOnly = !opts.editable;
    $("spendFoot").textContent = `Nothing is sent until you press Confirm. This pays for ${quote.what}.`;
    $("spendConfirm").textContent = opts.button;
    $("spendErr").textContent = "";
    dlg.returnValue = "";
    dlg.onclose = () => resolve(dlg.returnValue === "confirm" ? { edited: $("spendPrompt").value.replace(/\s+/g, " ").trim() } : null);
    dlg.showModal();
  });
}

async function askPicture(s, i) {
  say("");
  let quote;
  try { quote = await api("/api/ai/quote", { id: state.id, shape: state.shape, headline: s.headline, sub: s.sub, idea: state.idea }); }
  catch (e) { say(e.message, "error"); return; }
  const ok = await confirmSpend(quote, { title: "Make a picture with AI?", forWhat: `Scene ${i + 1}`, words: quote.prompt, editable: true, button: "Confirm and make the picture" });
  if (!ok) return;
  try {
    let token = quote.token, prompt = quote.prompt;
    if (ok.edited && ok.edited !== prompt) { const q2 = await api("/api/ai/quote", { id: state.id, shape: state.shape, prompt: ok.edited }); token = q2.token; prompt = q2.prompt; }   // edited words need their own quote
    setBusy(true, "Making the picture…");
    const out = await api("/api/ai/picture", { id: state.id, token, prompt });
    s.picture = out.name; setBusy(false); drawScenes(); touch();
    say(`Picture added. Used so far: $${out.spentUsd.toFixed(2)}. Press Update video to see it.`, "ok");
  } catch (e) { setBusy(false); $("empty").hidden = true; if ($("video").src) $("video").hidden = false; say(e.message, "error"); }
}

// Music made by AI: asks first (price, and the words describing the music, which can be changed), then makes one track as long as the video needs.
async function askMusic() {
  say("");
  const total = state.plan.scenes.reduce((n, x) => n + x.seconds, 0);
  let quote;
  try { quote = await api("/api/ai/music/quote", { id: state.id, style: "", idea: state.idea }); } catch (e) { say(e.message, "error"); return false; }
  const ok = await confirmSpend(quote, { title: "Make music with AI?", forWhat: `${Math.round(total)} seconds of video`, words: quote.prompt, editable: true, button: "Confirm and make the music" });
  if (!ok) return false;
  try {
    let token = quote.token, style = quote.prompt;
    if (ok.edited && ok.edited !== style) { const q2 = await api("/api/ai/music/quote", { id: state.id, style: ok.edited, idea: state.idea }); token = q2.token; style = q2.prompt; }
    setBusy(true, "Making the music. This can take a minute or two…");
    const out = await api("/api/ai/music", { id: state.id, token, style, seconds: total });
    setBusy(false); state.musicFile = out.name; return out;
  } catch (e) { setBusy(false); $("empty").hidden = true; if ($("video").src) $("video").hidden = false; say(e.message, "error"); return false; }
}

// A scene's picture brought to life as a short video clip. The window says the picture is uploaded to Kie.ai, and shows the price, before anything is sent.
async function askAnimate(s, i) {
  say("");
  const first = s.note ? s.note.replace(/ Sound:.*$/, "").slice(0, 420) : `${s.headline}. Gentle natural motion, a very slow camera push-in, soft light.`;
  let quote;
  try { quote = await api("/api/ai/animate/quote", { id: state.id, picture: s.picture, prompt: first }); } catch (e) { say(e.message, "error"); return; }
  const ok = await confirmSpend(quote, { title: "Bring this picture to life?", forWhat: `Scene ${i + 1}`, words: quote.prompt, editable: true, button: "Confirm and make the clip" });
  if (!ok) return;
  try {
    let token = quote.token, prompt = quote.prompt;
    if (ok.edited && ok.edited !== prompt) { const q2 = await api("/api/ai/animate/quote", { id: state.id, picture: s.picture, prompt: ok.edited }); token = q2.token; prompt = q2.prompt; }
    setBusy(true, "Bringing the picture to life. This usually takes one to three minutes…");
    const out = await api("/api/ai/animate", { id: state.id, token, picture: s.picture, prompt });
    s.picture = out.name; setBusy(false); drawScenes(); touch();
    say(`Clip added (${out.seconds} s). Used so far: $${out.spentUsd.toFixed(2)}. Press Update video to see it.`, "ok");
  } catch (e) { setBusy(false); $("empty").hidden = true; if ($("video").src) $("video").hidden = false; say(e.message, "error"); }
}

// A paid voice must be made, and confirmed, before the video is. Windows voices need nothing.
async function ensureVoice() {
  const paid = (v) => !!v && (v.startsWith("openai:") || v.startsWith("kie:"));
  if (!paid(state.plan.voice) && !state.plan.scenes.some((x) => paid(x.voice))) return true;
  const q = await api("/api/voice/quote", { id: state.id, plan: state.plan });
  if (!q.needed) return true;
  const words = state.plan.scenes.map((s) => (s.say && s.say.trim()) || [s.headline, s.sub].filter(Boolean).join(". ")).join("\n");
  const ok = await confirmSpend(q, { title: "Make the voiceover?", forWhat: `${state.plan.scenes.length} scenes`, words, editable: false, button: "Confirm and make the voiceover" });
  if (!ok) return false;
  setBusy(true, "Making the voiceover…");
  const out = await api("/api/voice/make", { id: state.id, token: q.token, plan: state.plan });
  say(`Voiceover made. Used so far: $${out.spentUsd.toFixed(2)}.`, "ok");
  return true;
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
    if (!(await ensureVoice())) { setBusy(false); if ($("video").src) { $("video").hidden = false; $("empty").hidden = true; } return; }
    setBusy(true, label);
    const out = await api("/api/render", { plan: state.plan, shape: state.shape, quality, id: state.id });
    state.id = out.id;
    if (Array.isArray(out.scenes) && out.scenes.some((sec, k) => state.plan.scenes[k] && Math.abs(sec - state.plan.scenes[k].seconds) > 0.05)) {
      out.scenes.forEach((sec, k) => { if (state.plan.scenes[k]) state.plan.scenes[k].seconds = sec; });
      drawScenes();                                         // scenes grew to fit their voice: show the new lengths
    }
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
  const isScript = /\|\s*\**\s*\d{1,2}:\d{2}\s*[\u2013\u2014-]\s*\d{1,2}:\d{2}/.test(idea);
  $("make").disabled = true; $("startnote").textContent = isScript ? "Reading your script…" : "Writing the scenes…";
  const slow = setTimeout(() => { $("startnote").textContent = "Still writing. A model on your computer can take a moment; if it takes too long, your own words are used."; }, 7000);
  try {
    state.plan = isScript ? await api("/api/script", { script: idea }) : await api("/api/plan", { idea, seconds: state.seconds });
    state.idea = idea; state.id = state.plan.id; state.dirty = false; state.musicFile = null; $("voice").value = ""; $("music").value = ""; $("musicOpts").hidden = true; $("musicFileLabel").hidden = true;
    $("start").hidden = true; $("recent").hidden = true; $("studio").hidden = false; shapeClass(); drawScenes(); drawLooks();
    await render("draft");
  } catch (e) { $("startnote").textContent = e.message; $("make").disabled = false; } finally { clearTimeout(slow); }
}

function fillSound(s) {
  const v = $("voice"); v.textContent = "";
  const opt = (sel, value, label) => { const o = document.createElement("option"); o.value = value; o.textContent = label; sel.appendChild(o); };
  opt(v, "", "No voiceover");
  for (const n of s.voices || []) opt(v, "win:" + n, `${n.replace(/^Microsoft /, "").replace(/ Desktop$/, "")} (Windows, free)`);
  for (const k of s.kieVoices || []) opt(v, "kie:" + k.id, `${k.name} (Kie, ElevenLabs, paid)`);
  for (const n of s.openaiVoices || []) opt(v, "openai:" + n, `${n[0].toUpperCase() + n.slice(1)} (OpenAI, paid)`);
  v.addEventListener("change", () => { if (!state.plan) return; if (v.value) state.plan.voice = v.value; else delete state.plan.voice; drawScenes(); touch(); });
  const m = $("music"); m.textContent = "";
  opt(m, "", "No music");
  for (const x of s.moods || []) opt(m, "mood:" + x.id, `${x.name}: ${x.note}`);
  opt(m, "file", "My own sound file…");
  if (s.kieVoices && s.kieVoices.length) opt(m, "ai", "Make with AI (Suno, paid)…");
  const apply = () => {
    if (!state.plan) return;
    const level = $("level").value;
    if (m.value.startsWith("mood:")) state.plan.music = { mood: m.value.slice(5), level };
    else if (m.value === "file" && state.musicFile) state.plan.music = { file: state.musicFile, level };
    else delete state.plan.music;
    $("musicOpts").hidden = !m.value; $("musicFileLabel").hidden = m.value !== "file";
  };
  let lastMusic = "";
  m.addEventListener("change", async () => {
    if (m.value === "ai") {                                         // made by AI: asks first, then the track becomes the sound file for this video
      const out = await askMusic();
      if (out) { m.value = "file"; lastMusic = "file"; apply(); touch(); say(`AI music added (${out.seconds} s). Used so far: $${out.spentUsd.toFixed(2)}. Press Update video to hear it.`, "ok"); }
      else m.value = lastMusic;
      return;
    }
    lastMusic = m.value; apply(); touch();
  });
  $("level").addEventListener("change", () => { apply(); touch(); });
  $("musicFile").addEventListener("change", async (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 40 * MB) { say("That sound file is over 40 MB. Try a smaller one.", "error"); return; }
    say("Adding the sound…");
    try {
      const r = await fetch(`/api/upload?id=${encodeURIComponent(state.id)}`, { method: "POST", headers: { "content-type": f.type === "audio/mpeg" ? "audio/mpeg" : "audio/wav" }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Could not add that sound.");
      state.musicFile = j.name; apply(); touch();
    } catch (err) { say(err.message, "error"); }
  });
}

// "Your videos": what is saved in the QuickPath folder, newest first. Opening one rebuilds its draft so it is always current.
const when = (iso) => {
  const d = new Date(iso), now = new Date(), days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  const t = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return days === 0 ? `Today, ${t}` : days === 1 ? `Yesterday, ${t}` : d.toLocaleDateString([], { month: "short", day: "numeric", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
};

async function drawRecent() {
  let list = [];
  try { list = (await api("/api/projects")).projects; } catch { /* the list is a convenience */ }
  const host = $("recentList"); host.textContent = "";
  $("recent").hidden = !list.length || !$("studio").hidden;
  for (const p of list.slice(0, 9)) {
    const li = document.createElement("li");
    const b = document.createElement("button"); b.type = "button"; b.className = "vid";
    const look = state.looks.find((l) => l.id === p.look) || state.looks[0];
    const rgb = (c) => `rgb(${c.map((x) => Math.round(x * 255)).join(",")})`;
    const poster = document.createElement("div"); poster.className = "vid-poster";
    if (look) { poster.style.background = rgb(look.bg); poster.style.color = rgb(look.text); }
    const bar = document.createElement("i"); if (look) bar.style.background = rgb(look.accent);
    const t = document.createElement("b"); t.textContent = p.title || "Untitled";
    poster.append(bar, t);
    const meta = document.createElement("div"); meta.className = "vid-meta";
    const m = document.createElement("span"); m.textContent = `${p.scenes} scene${p.scenes === 1 ? "" : "s"} · ${p.seconds} s · ${p.shape}`;
    const w = document.createElement("span"); w.textContent = `${when(p.updated)}${p.hasFinal ? " · saved" : ""}`;
    meta.append(m, w);
    b.append(poster, meta);
    b.addEventListener("click", () => openProject(p.id));
    const x = document.createElement("button"); x.type = "button"; x.className = "vid-x"; x.textContent = "\u00d7"; x.setAttribute("aria-label", `Remove ${p.title || "this video"}`); x.title = "Remove this video";
    x.addEventListener("click", async () => {
      const how = state.recycles ? "It goes to the Recycle Bin, so you can put it back." : "This cannot be undone.";
      if (!confirm(`Remove "${p.title || "this video"}" and its files? ${how}`)) return;
      try { await api("/api/project/remove", { id: p.id }); drawRecent(); } catch (e) { $("startnote").textContent = e.message; }
    });
    li.append(b, x); host.appendChild(li);
  }
}

async function openProject(id) {
  $("startnote").textContent = "Opening…";
  try {
    const p = await api(`/api/project?id=${encodeURIComponent(id)}`);
    state.plan = p.plan; state.shape = p.shape; state.id = p.id; state.idea = p.plan.title; state.dirty = false;
    state.musicFile = p.plan.music && p.plan.music.file ? p.plan.music.file : null;
    const v = $("voice"); v.value = p.plan.voice || ""; if (v.value !== (p.plan.voice || "")) { v.value = ""; delete state.plan.voice; }
    const m = $("music"), mu = p.plan.music;
    m.value = mu ? (mu.file ? "file" : "mood:" + mu.mood) : ""; if (mu && m.value !== (mu.file ? "file" : "mood:" + mu.mood)) { m.value = ""; delete state.plan.music; }
    $("level").value = (state.plan.music && state.plan.music.level) || "medium";
    $("musicOpts").hidden = !m.value; $("musicFileLabel").hidden = m.value !== "file";
    shapePicker($("shape"), state.shape, (x) => { state.shape = x; });
    $("start").hidden = true; $("recent").hidden = true; $("studio").hidden = false; shapeClass(); drawScenes(); drawLooks();
    $("startnote").textContent = "";
    await render("draft");
  } catch (e) { $("startnote").textContent = e.message; }
}

// ---- Settings: where keys are entered. A key goes to the server once and is never shown again; the screen only knows whether one is set.
const SOURCES = { env: "Set with a computer setting", saved: "Saved by QuickPath", motioncraft: "Using the key saved in MotionCraft" };

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) { if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v); }
  for (const c of kids) e.append(c);
  return e;
}

function setMsg(text, kind = "") { const m = $("settingsMsg"); m.textContent = text; m.className = "note " + (kind === "ok" ? "settings-msg-ok" : ""); if (kind === "error") m.classList.add("error"); }

async function renderSettings() {
  const s = await api("/api/settings");
  const body = $("settingsBody"); body.textContent = "";

  // The model on this computer
  body.append(el("section", { class: "conn" },
    el("h3", {}, "Scenes: a model on this computer ", el("span", { class: "badge" + (s.ollama.found ? " good" : ""), text: s.ollama.found ? "Found" : "Not found" })),
    el("p", { class: "hint", text: s.ollama.found
      ? `${s.ollama.model} (through Ollama) writes your scenes. It is free and nothing leaves your computer.`
      : "Optional. Without it, your own sentences are cut into scenes. Install Ollama and a model such as qwen3 to let a model write them. No key is needed." })));

  const row = (provider, title, what, where, cost) => {
    const k = s.keys[provider];
    const input = el("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: k.set ? "Paste a new key to replace it" : "Paste your key here", "aria-label": `${title} key` });
    const save = el("button", { class: "btn small primary", type: "button", text: "Save key" }); save.disabled = true;
    input.addEventListener("input", () => { save.disabled = input.value.trim().length < 8; });
    save.addEventListener("click", async () => {
      save.disabled = true; setMsg("Saving…");
      try { const key = input.value; input.value = ""; await api("/api/settings/key", { provider, key }); setMsg(`${title} key saved. It is not shown again.`, "ok"); await renderSettings(); }
      catch (e) { setMsg(e.message, "error"); }
    });
    const check = el("button", { class: "btn small", type: "button", text: "Check it works" });
    check.addEventListener("click", async () => { check.disabled = true; setMsg("Checking…"); try { const r = await api("/api/settings/check", { provider }); setMsg(r.message, r.ok ? "ok" : "error"); } catch (e) { setMsg(e.message, "error"); } check.disabled = false; });
    const rm = el("button", { class: "btn small quiet", type: "button", text: "Remove" });
    rm.addEventListener("click", async () => { if (!confirm(`Remove the saved ${title} key from this computer?`)) return; try { await api("/api/settings/key/remove", { provider }); setMsg(`${title} key removed.`, "ok"); await renderSettings(); } catch (e) { setMsg(e.message, "error"); } });
    const keyrow = el("div", { class: "keyrow" });
    if (s.canSaveKeys) keyrow.append(input, save);
    const actions = el("div", { class: "keyrow" });
    if (k.set) actions.append(check);
    if (k.source === "saved") actions.append(rm);
    return el("section", { class: "conn" },
      el("h3", {}, `${title} `, el("span", { class: "badge" + (k.set ? " good" : ""), text: k.set ? "Key set" : "No key" })),
      el("p", { text: what }),
      el("p", { class: "hint", text: k.set ? `${SOURCES[k.source] || ""}. ${cost}` : `${where} ${cost}` }),
      keyrow, actions,
      s.canSaveKeys ? el("span", {}) : el("p", { class: "hint", text: "Saving keys from here works on Windows. On this system, set the key as a computer setting instead (see the user guide)." }));
  };
  body.append(row("kie", "Pictures, voices, music and video (Kie.ai)", "One account for AI pictures (Imagen), voices (ElevenLabs), music (Suno) and video clips (Wan).", "Create a key in your Kie.ai account (kie.ai, API Key page), then paste it here.", "Pictures about $0.02, voices about $0.03 per 1,000 characters, a music track or a video clip a few cents to a few tens of cents. Always asked first."));
  body.append(row("openai", "Voices (OpenAI)", "More natural voiceovers. The free Windows voices need no key.", "Create a key in your OpenAI account (platform.openai.com, API keys), then paste it here.", "About $0.002 for a 15 second video, always asked first."));
  body.append(row("fal", "fal (optional, not used yet)", "A second place to make AI pictures and videos. QuickPath does not use fal yet: saving a key now is safe, and a later version will.", "Create a key in your fal account (fal.ai, Keys page), then paste it here.", "Nothing is charged by saving it."));

  // The spending limit
  const cap = el("input", { type: "number", min: "0.5", max: "100", step: "0.5", value: String(s.capUsd), "aria-label": "Spending limit in dollars", class: "capnum" });
  const capSave = el("button", { class: "btn small", type: "button", text: "Save limit" });
  capSave.addEventListener("click", async () => { try { await api("/api/settings/cap", { usd: Number(cap.value) }); setMsg("Spending limit saved.", "ok"); await renderSettings(); } catch (e) { setMsg(e.message, "error"); } });
  body.append(el("section", { class: "conn" },
    el("h3", {}, "Spending limit"),
    el("p", { class: "hint", text: `Paid AI stops when the total reaches this. Used so far: $${s.spentUsd.toFixed(2)}.` }),
    el("div", { class: "keyrow" }, el("span", { text: "$" }), cap, capSave)));
}

async function openSettings() {
  setMsg("");
  try { await renderSettings(); } catch (e) { setMsg(e.message, "error"); }
  const d = $("settings"); if (!d.open) d.showModal();
}

function init() {
  segmented($("len"), LENGTHS.map((n) => [n, `${n} s`]), state.seconds, (v) => (state.seconds = v));
  shapePicker($("shape"), state.shape, (v) => { state.shape = v; });
  $("make").addEventListener("click", make);
  $("idea").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) make(); });
  document.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => { $("idea").value = b.dataset.ex; $("idea").focus(); }));
  $("update").addEventListener("click", () => render("draft"));
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && state.plan && !state.busy && $("studio").hidden === false) { e.preventDefault(); render("draft"); } });
  $("final").addEventListener("click", () => render("final"));
  $("add").addEventListener("click", () => { if (state.plan.scenes.length >= 12) return; state.plan.scenes.push({ headline: "New scene", sub: "", seconds: 3 }); drawScenes(); touch(); });
  $("gear").addEventListener("click", openSettings);
  $("aiLink").addEventListener("click", openSettings);
  $("settingsDone").addEventListener("click", () => $("settings").close());
  $("again").addEventListener("click", () => { if (state.dirty && !confirm("Start over? Your changes will be lost.")) return; $("studio").hidden = true; $("start").hidden = false; $("make").disabled = false; $("startnote").textContent = ""; $("video").removeAttribute("src"); state.plan = null; state.id = null; drawRecent(); });
  $("reveal").addEventListener("click", () => state.last && api("/api/reveal", { url: state.last }).catch(() => {}));
  api("/api/status").then((s) => {
    state.looks = s.looks; state.recycles = !!s.recycles;
    fillSound(s);
    drawRecent();
    const e = $("engine");
    e.textContent = s.engine ? "EffectCraft ready" : "EffectCraft not found";
    e.className = "engine" + (s.engine ? "" : " bad");
    if (!s.engine) $("startnote").textContent = "EffectCraft 0.24.1 is needed to make videos. Install it, then reload this page.";
  }).catch(() => { drawRecent(); });
}
init();
