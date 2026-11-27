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
  for (const id of ["make", "update", "final", "editor", "again", "add"]) $(id).disabled = on;
  $("empty").hidden = !on; $("busy").textContent = text;
  if (on) { $("video").hidden = true; $("video").pause(); }
}

// The first frame is only background (the words fade in), so a fresh video waits a moment in, where the words are.
$("video").addEventListener("loadedmetadata", (e) => { const v = e.target; if (v.currentTime === 0 && v.duration > 3) v.currentTime = 1.2; });

function shapeClass() { const sc = $("screen"), r = ratioOf(state.shape); sc.className = "screen" + (r < 1.5 ? " tall" : ""); sc.style.aspectRatio = state.shape === "21:9" ? "2560 / 1080" : state.shape.replace(":", " / "); }       // 21:9 is the 2560 by 1080 ultrawide frame, a hair wider than 21 to 9: the screen matches the video exactly

function drawScenes() {
  const ol = $("scenes"); ol.textContent = "";
  if (state.plan && state.id) { drawRefs(); drawMotion(); }
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
    if ((s.voice || state.plan.voice || "").startsWith("vk:")) {
      const tone = document.createElement("input"); tone.className = "say"; tone.value = s.tone || ""; tone.maxLength = 200; tone.placeholder = "How to say it (Voicekiller), e.g. warm, slow, almost a whisper"; tone.setAttribute("aria-label", `Scene ${i + 1} delivery`);
      tone.addEventListener("input", () => { if (tone.value) s.tone = tone.value; else delete s.tone; touch(); });
      li.append(tone);
    }
    if (s.note !== undefined) {
      const note = document.createElement("textarea"); note.className = "say"; note.rows = 3; note.maxLength = 900; note.value = s.note; note.placeholder = "Picture direction (also the starting words for an AI clip)"; note.setAttribute("aria-label", `Scene ${i + 1} picture direction`);
      note.addEventListener("input", () => { s.note = note.value; touch(); });
      li.append(note);
    }
    li.append(mediaRow(s, i));
    const rv = reviewRow(s, i); if (rv) li.append(rv);
    const fr = fxRow(s, i); if (fr) li.append(fr);
    ol.appendChild(li);
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
    const more = document.createElement("button"); more.type = "button"; more.className = "btn quiet small"; more.textContent = "Continue this clip";
    more.addEventListener("click", () => continueClip(s, i));
    const need = missingClips(s);
    if (need) { const fill = document.createElement("button"); fill.type = "button"; fill.className = "btn quiet small"; fill.textContent = `Fill the scene (${need} more, about $${(need * 0.4).toFixed(2)})`; fill.addEventListener("click", () => makeMissing(i)); row.append(thumb, rm, more, fill); return row; }
    row.append(thumb, rm, more); return row;
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

// The panels below the scene list (references, motion) live in one holder, so the scenes always come first.
function extras() {
  let x = $("extras");
  if (!x) { x = document.createElement("div"); x.id = "extras"; $("scenes").after(x); }
  return x;
}

// ---- Motion: clips that fill a scene, frames to check, and what the film has cost.
const CLIP_SECONDS = 5;
const clipsOf = (s) => (s.picture && s.picture.endsWith(".mp4") ? [s.picture, ...(s.more || [])] : []);
const missingClips = (s) => (s.picture ? Math.max(0, Math.ceil((s.seconds - 0.2) / CLIP_SECONDS) - clipsOf(s).length) : 0);
const motionWords = (s) => ((s.note || s.headline || "").replace(/ Sound:.*$/, "").replace(/\s+/g, " ").trim().slice(0, 300) + " Slow, smooth camera movement. No people unless the picture already shows them.").trim();
const CONTINUE_WORDS = "Continue the same shot without a cut: the camera keeps moving slowly the same way, same light, same place, no new people.";

// One frame of a video as a PNG, taken in the page (no extra program needed). `at` is seconds, or "end" for the last frame.
function frameOf(url, at, width = 0) {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.crossOrigin = "anonymous";
    const fail = (m) => reject(new Error(m || "Could not read a frame from that clip."));
    const timer = setTimeout(() => fail("Reading the clip took too long."), 20000);
    v.addEventListener("error", () => { clearTimeout(timer); fail(); });
    v.addEventListener("loadedmetadata", () => { v.currentTime = at === "end" ? Math.max(0, v.duration - 0.06) : Math.min(at, Math.max(0, v.duration - 0.06)); });
    v.addEventListener("seeked", () => {
      clearTimeout(timer);
      const w = width || v.videoWidth, h = Math.round((v.videoHeight * w) / v.videoWidth);
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(v, 0, 0, w, h);
      cv.toBlob((b) => (b ? resolve(b) : fail()), "image/png");
    }, { once: true });
    v.src = url;
  });
}
async function uploadPng(blob) {
  const r = await fetch(`/api/upload?id=${encodeURIComponent(state.id)}`, { method: "POST", headers: { "content-type": "image/png" }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Could not save that frame.");
  return j.name;
}

async function refreshCost() {
  const el = $("filmCost"); if (!el || !state.id) return;
  try { const c = await (await fetch(`/api/film/cost?id=${encodeURIComponent(state.id)}`)).json(); el.textContent = `This film has cost $${c.filmUsd.toFixed(2)} so far. All your videos: $${c.spentUsd.toFixed(2)} of your $${c.capUsd.toFixed(2)} limit.`; } catch { el.textContent = ""; }
}

function drawMotion() {
  let box = $("motion");
  if (!box) { box = document.createElement("section"); box.id = "motion"; box.className = "refs"; extras().append(box); }
  box.textContent = "";
  box.hidden = !state.plan.scenes.some((s) => s.picture);          // nothing to plan until a scene has a picture or clip
  const h = document.createElement("h3"); h.textContent = "Motion"; box.append(h);
  const cost = document.createElement("p"); cost.id = "filmCost"; cost.className = "note"; box.append(cost);
  const rows = state.plan.scenes.map((s, i) => ({ s, i, need: missingClips(s) })).filter((r) => r.need > 0);
  const total = rows.reduce((n, r) => n + r.need, 0);
  const p = document.createElement("p"); p.className = "note";
  p.textContent = total ? `Each AI clip is about ${CLIP_SECONDS} seconds. ${rows.length} scene${rows.length === 1 ? "" : "s"} could use ${total} more clip${total === 1 ? "" : "s"} to play all the way through: ${rows.map((r) => `scene ${r.i + 1} +${r.need}`).join(", ")}.` : "Every scene that has a picture or clip is covered by clips for its whole length.";
  box.append(p);
  if (total) {
    const go = document.createElement("button"); go.type = "button"; go.className = "btn quiet small"; go.id = "makeMissing";
    go.textContent = `Make the ${total} missing clip${total === 1 ? "" : "s"} (about $${(total * 0.4).toFixed(2)})`;
    go.addEventListener("click", () => makeMissing());
    box.append(go);
  }
  refreshCost();
}

// One confirmation for all the missing clips. Each clip starts from the scene's picture, or from the last frame of the clip before it, so the shot carries on.
async function continueClip(s, i) {
  say("");
  const have = clipsOf(s); if (!have.length) return;
  let picture;
  try { setBusy(true, "Taking the last frame of the clip…"); picture = await uploadPng(await frameOf(`/media/${state.id}/assets/${have[have.length - 1]}`, "end")); setBusy(false); } catch (e) { setBusy(false); say(e.message, "error"); return; }
  let quote;
  try { quote = await api("/api/ai/animate/quote", { id: state.id, picture, prompt: CONTINUE_WORDS }); } catch (e) { say(e.message, "error"); return; }
  const ok = await confirmSpend(quote, { title: "Continue this clip?", forWhat: `Scene ${i + 1}`, words: quote.prompt, editable: true, button: "Confirm and make the next clip" });
  if (!ok) return;
  try {
    let token = quote.token, prompt = quote.prompt;
    if (ok.edited && ok.edited !== prompt) { const q2 = await api("/api/ai/animate/quote", { id: state.id, picture, prompt: ok.edited }); token = q2.token; prompt = q2.prompt; }
    setBusy(true, "Making the next clip. This usually takes one to three minutes…");
    const out = await api("/api/ai/animate", { id: state.id, token, picture, prompt });
    s.more = [...(s.more || []), out.name]; setBusy(false); drawScenes(); touch();
    say(`Clip added (${out.seconds} s). Used so far: $${out.spentUsd.toFixed(2)}. Press Update video to see it.`, "ok");
  } catch (e) { setBusy(false); $("empty").hidden = true; if ($("video").src) $("video").hidden = false; say(e.message, "error"); }
}

async function makeMissing(only) {
  const rows = state.plan.scenes.map((s, i) => ({ s, i, need: missingClips(s) })).filter((r) => r.need > 0 && (typeof only !== "number" || r.i === only));
  const total = rows.reduce((n, r) => n + r.need, 0);
  if (!total) return;
  say("");
  let quote;
  try { quote = await api("/api/ai/animate/batch/quote", { id: state.id, clips: total }); } catch (e) { say(e.message, "error"); return; }
  const words = rows.map((r) => `Scene ${r.i + 1}: ${r.need} more clip${r.need === 1 ? "" : "s"} (${r.s.seconds} s long, ${clipsOf(r.s).length} clip${clipsOf(r.s).length === 1 ? "" : "s"} now)`).join("\n");
  const ok = await confirmSpend(quote, { title: `Make ${total} clips?`, forWhat: `${rows.length} scene${rows.length === 1 ? "" : "s"}`, words, editable: false, label: "What will be made:", button: `Confirm and make ${total} clip${total === 1 ? "" : "s"}` });
  if (!ok) return;
  let done = 0;
  try {
    for (const r of rows) {
      for (let k = 0; k < r.need; k++) {
        const s = r.s;
        setBusy(true, `Making clip ${done + 1} of ${total} (scene ${r.i + 1}). Each takes one to three minutes…`);
        const have = clipsOf(s);
        let picture, prompt;
        if (have.length) { picture = await uploadPng(await frameOf(`/media/${state.id}/assets/${have[have.length - 1]}`, "end")); prompt = CONTINUE_WORDS; }
        else { picture = s.picture; prompt = motionWords(s); }
        const out = await api("/api/ai/animate", { id: state.id, token: quote.token, picture, prompt, batch: true, step: `clip ${done + 1} of ${total}` });
        if (have.length) s.more = [...(s.more || []), out.name]; else s.picture = out.name;
        done++; touch();
      }
    }
    setBusy(false); drawScenes();
    say(`${done} clip${done === 1 ? "" : "s"} made. Check them under each scene, then press Update video.`, "ok");
  } catch (e) {
    setBusy(false); $("empty").hidden = true; if ($("video").src) $("video").hidden = false; drawScenes();
    say(`${e.message} ${done} of ${total} clips were made; you were only charged for those.`, "error");
  }
}

// Frames from each clip of a scene, to look at before the video is made, and a way to drop a clip you do not like.
function reviewRow(s, i) {
  const clips = clipsOf(s);
  if (!clips.length) return null;
  const d = document.createElement("details"); d.className = "review";
  const sum = document.createElement("summary"); sum.textContent = `Check the ${clips.length === 1 ? "clip" : clips.length + " clips"}`; d.append(sum);
  let filled = false;
  d.addEventListener("toggle", async () => {
    if (!d.open || filled) return; filled = true;
    for (const [k, name] of clips.entries()) {
      const row = document.createElement("div"); row.className = "pic";
      const lab = document.createElement("span"); lab.className = "note"; lab.textContent = `Clip ${k + 1}`; row.append(lab);
      for (const at of [0, 1.7, 3.4, "end"]) {
        const img = document.createElement("img"); img.alt = `Clip ${k + 1} frame`; img.style.height = "54px"; img.style.borderRadius = "5px";
        try { img.src = URL.createObjectURL(await frameOf(`/media/${state.id}/assets/${name}`, at, 240)); } catch { img.alt = "frame unavailable"; }
        row.append(img);
      }
      const drop = document.createElement("button"); drop.type = "button"; drop.className = "btn quiet small"; drop.textContent = "Discard this clip";
      drop.addEventListener("click", () => {
        const rest = clips.filter((c) => c !== name);
        if (rest.length) { s.picture = rest[0]; if (rest.length > 1) s.more = rest.slice(1); else delete s.more; } else { delete s.picture; delete s.more; }
        drawScenes(); touch();
      });
      row.append(drop); d.append(row);
    }
  });
  return d;
}


// ---- Sound: every voice brought to the same level, and small effects for the moments a script names.
// The browser can decode MP3; the server cannot. So the page measures each new MP3 (speech only, gaps ignored, same method as the server uses for WAV) and tells the server the number.
async function measureAudio() {
  if (!state.id) return;
  let files = [];
  try { files = (await (await fetch(`/api/audio/unmeasured?id=${encodeURIComponent(state.id)}`)).json()).files || []; } catch { return; }
  for (const f of files) {
    try {
      const buf = await (await fetch(`/media/${state.id}/assets/audio/${f}`)).arrayBuffer();
      const ab = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf);
      const size = Math.max(1, Math.round(ab.sampleRate * 0.05)), blocks = [];
      for (let i = 0; i < ab.length; i += size) {
        let s = 0; const end = Math.min(ab.length, i + size);
        for (let k = i; k < end; k++) { let v = 0; for (let c = 0; c < ab.numberOfChannels; c++) v += ab.getChannelData(c)[k]; v /= ab.numberOfChannels; s += v * v; }
        blocks.push(s / (end - i));
      }
      const loud = Math.max(0, ...blocks); if (loud <= 0) continue;
      const kept = blocks.filter((b) => b >= Math.max(1e-5, loud * Math.pow(10, -3.5)));
      if (!kept.length) continue;
      const db = 10 * Math.log10(kept.reduce((a, b) => a + b, 0) / kept.length);
      if (Number.isFinite(db)) await api("/api/audio/level", { id: state.id, file: f, db: Math.max(-80, Math.min(0, db)) });
    } catch { /* a sound the browser cannot read keeps its own level */ }
  }
}

function fxRow(s, i) {
  if (!state.effects || !state.effects.length) return null;
  const d = document.createElement("details"); d.className = "review";
  const sum = document.createElement("summary");
  const label = () => { sum.textContent = `Sound effects${s.fx && s.fx.length ? ` (${s.fx.length})` : ""}`; };
  label(); d.append(sum);
  const row = document.createElement("div"); row.className = "pic";
  for (const e of state.effects) {
    const b = document.createElement("button"); b.type = "button"; b.className = "btn quiet small"; b.textContent = e.name;
    const sync = () => b.setAttribute("aria-pressed", String(!!(s.fx && s.fx.includes(e.id))));
    sync();
    b.addEventListener("click", () => {
      const on = !(s.fx && s.fx.includes(e.id));
      s.fx = on ? [...(s.fx || []), e.id].slice(0, 6) : (s.fx || []).filter((x) => x !== e.id);
      if (!s.fx.length) delete s.fx;
      row.querySelectorAll("button").forEach((x, k) => x.setAttribute("aria-pressed", String(!!(s.fx && s.fx.includes(state.effects[k].id)))));
      label(); touch();
    });
    row.append(b);
  }
  const note = document.createElement("p"); note.className = "note"; note.textContent = "Simple built-in sounds that mark a moment, placed in order across the scene and kept low under the voice. They are made on this computer, not recordings.";
  d.append(row, note);
  return d;
}

function drawRefs() {
  let box = $("refs");
  if (!box) { box = document.createElement("details"); box.id = "refs"; box.className = "refs"; extras().prepend(box); }
  const wasOpen = box.open;
  box.textContent = "";
  const h = document.createElement("summary"); h.textContent = `References${(state.plan.refs || []).length ? ` (${state.plan.refs.length} pictures)` : ""}`; box.append(h);
  box.open = wasOpen || (state.plan.refs || []).length > 0 && box.dataset.shown !== "1";
  box.dataset.shown = "1";
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
    $("spendPromptLabel").textContent = opts.label ? opts.label : opts.editable ? "The words sent to the model. You can change them." : "The words that will be spoken.";
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
    setBusy(false); state.musicFile = out.name; state.musicSeconds = Number(out.seconds) || 0; showFitMusic(); return out;
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
  const paid = (v) => !!v && /^(?:openai|kie|eleven|vk):/.test(v);
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

let saveTimer = 0;
function autosave() {                                           // edits are kept on disk a moment after the last change, so a closed or crashed page loses nothing
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { if (state.plan && state.id) api("/api/plan/save", { id: state.id, plan: state.plan, shape: state.shape }).catch(() => {}); }, 1200);
}
function touch() { autosave(); state.dirty = true; $("update").classList.add("primary"); say("You changed something. Press Update video to see it."); }

async function render(quality) {
  const label = quality === "final" ? "Saving the full-size video…" : "Making your video…";
  setBusy(true, label); say("");
  try {
    if (!(await ensureVoice())) { setBusy(false); if ($("video").src) { $("video").hidden = false; $("empty").hidden = true; } return; }
    setBusy(true, label);
    await measureAudio();
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
  const isScript = /\|\s*\**\s*\d{1,2}:\d{2}\s*[\u2013\u2014-]\s*\d{1,2}:\d{2}/.test(idea) || /^\s*SCENE\s+\d+\s*[\u2014\u2013:-]/im.test(idea);
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
  for (const k of s.elevenVoices || []) opt(v, "eleven:" + k.id, `${k.name} (ElevenLabs, your plan)`);
  for (const n of s.vkVoices || []) opt(v, "vk:" + n, `${n} (Voicekiller, your plan)`);
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
      state.musicFile = j.name; state.musicSeconds = Number(j.seconds) || 0; showFitMusic(); apply(); touch();
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
    const input = el("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: k.set ? "Paste a new key to replace it" : (provider === "voicekiller" ? "Paste your API key here" : "Paste your key here"), "aria-label": `${title} key` });
    const userId = provider === "voicekiller" ? el("input", { type: "text", autocomplete: "off", spellcheck: "false", placeholder: "Your User ID", "aria-label": `${title} User ID` }) : null;
    const save = el("button", { class: "btn small primary", type: "button", text: "Save key" }); save.disabled = true;
    const ready = () => { save.disabled = input.value.trim().length < 8 || (userId !== null && userId.value.trim().length < 1); };
    input.addEventListener("input", ready); if (userId) userId.addEventListener("input", ready);
    save.addEventListener("click", async () => {
      save.disabled = true; setMsg("Saving…");
      try { const key = input.value, uid = userId ? userId.value : undefined; input.value = ""; if (userId) userId.value = ""; await api("/api/settings/key", { provider, key, ...(uid !== undefined ? { userId: uid } : {}) }); setMsg(`${title} key saved. It is not shown again.`, "ok"); await renderSettings(); }
      catch (e) { setMsg(e.message, "error"); }
    });
    const check = el("button", { class: "btn small", type: "button", text: "Check it works" });
    check.addEventListener("click", async () => { check.disabled = true; setMsg("Checking…"); try { const r = await api("/api/settings/check", { provider }); setMsg(r.message, r.ok ? "ok" : "error"); } catch (e) { setMsg(e.message, "error"); } check.disabled = false; });
    const rm = el("button", { class: "btn small quiet", type: "button", text: "Remove" });
    rm.addEventListener("click", async () => { if (!confirm(`Remove the saved ${title} key from this computer?`)) return; try { await api("/api/settings/key/remove", { provider }); setMsg(`${title} key removed.`, "ok"); await renderSettings(); } catch (e) { setMsg(e.message, "error"); } });
    const keyrow = el("div", { class: "keyrow" });
    if (s.canSaveKeys) { if (userId) keyrow.append(userId); keyrow.append(input, save); }
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
  body.append(row("elevenlabs", "Voices (ElevenLabs, your own account)", "Voiceovers straight from your ElevenLabs account and plan, including voices you made or cloned there.", "In ElevenLabs open your profile, Developers, API keys, create a key, and paste it here.", "Billed against your ElevenLabs plan (about $0.15 per 1,000 characters if you go past it), always asked first."));
  body.append(row("voicekiller", "Voices (Voicekiller, your own account)", "Voiceovers from your Voicekiller account, with its voices and cloned voices.", "On your Voicekiller API page copy your User ID and your API key, then paste each into its own box here.", "Billed by Voicekiller through your plan; QuickPath cannot see the price."));
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


// ---- Steady progress: the server knows what it is busy with, so a page that was reloaded (or opened later) can still say so, and pick the result up when it is done.
let remoteWas = null;
function showActivity(items) {
  const el = $("activity");
  if (!items.length) {
    el.hidden = true;
    if (remoteWas && !state.busy) {
      const was = remoteWas; remoteWas = null;
      if (state.id && state.id === was.project && !state.dirty) openProject(state.id);          // finished while this page was away: show the result
      else if (!state.id) drawRecent();
    }
    remoteWas = null;
    return;
  }
  const a = items[0], m = Math.floor(a.seconds / 60), s = String(a.seconds % 60).padStart(2, "0");
  el.textContent = `${a.what}${a.step ? ` (${a.step})` : ""}${a.title ? ` for “${a.title}”` : ""}: ${m}:${s} so far. You can leave this open; it keeps going.`;
  if (a.project && a.project !== state.id && !state.busy) {
    const open = document.createElement("button"); open.type = "button"; open.className = "btn quiet small"; open.textContent = "Open it";
    open.addEventListener("click", () => openProject(a.project));
    el.append(open);
  }
  el.hidden = false;
  if (!state.busy) remoteWas = { project: a.project };
}
async function pollActivity() {
  try { showActivity((await (await fetch("/api/activity")).json()).items || []); } catch { /* the server is not answering: leave the banner as it is */ }
}


// ---- Reading a script from a file: PDF (pdf.js, vendored, runs in the page), Word (.docx is a zip of XML: read here) or plain text. Nothing leaves the computer.
async function pdfText(bytes) {
  const pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;
  const out = [];
  for (let p = 1; p <= Math.min(doc.numPages, 80); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const lines = []; let line = "", y = null;
    for (const it of tc.items) {
      if (typeof it.str !== "string") continue;
      const iy = it.transform ? it.transform[5] : 0;
      if (y !== null && Math.abs(iy - y) > 2) { lines.push({ t: line, y }); line = ""; }
      line += it.str; y = iy;
      if (it.hasEOL) { lines.push({ t: line, y: iy }); line = ""; y = null; }
    }
    if (line) lines.push({ t: line, y: y ?? 0 });
    const gaps = []; for (let i = 1; i < lines.length; i++) gaps.push(Math.abs(lines[i - 1].y - lines[i].y));
    const typical = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
    lines.forEach((l, i) => { if (i && typical && Math.abs(lines[i - 1].y - l.y) > typical * 1.45) out.push(""); out.push(l.t.replace(/\s+$/, "")); });
    out.push("");
  }
  return out.join("\n");
}
async function inflateRaw(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function docxText(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1; for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("That does not look like a Word file.");
  let p = dv.getUint32(eocd + 16, true); const n = dv.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (name === "word/document.xml") {
      const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
      const raw = bytes.subarray(start, start + csize);
      if (csize > 20 * 1024 * 1024) throw new Error("That Word file is too big.");
      const xml = new TextDecoder().decode(method === 8 ? await inflateRaw(raw) : raw);
      return xml.replace(/<w:tab\/>/g, " ").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n\n").replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\n{3,}/g, "\n\n");
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error("I could not find the text in that Word file.");
}
async function textFromFile(name, bytes) {
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".pdf")) return pdfText(bytes);
  if (lower.endsWith(".docx")) return docxText(bytes);
  return new TextDecoder("utf-8").decode(bytes);
}
async function importScriptBytes(name, bytes) {
  const note = $("scriptFileNote");
  if (bytes.length > 8 * MB) { note.textContent = "That file is over 8 MB."; return; }
  note.textContent = "Reading the file…";
  try {
    const text = (await textFromFile(name, bytes)).trim();
    if (text.length < 20) throw new Error("I could not find any text in that file (a scanned page is a picture, not text).");
    const box = $("idea"); box.value = text.slice(0, 40000); box.dispatchEvent(new Event("input", { bubbles: true }));
    note.textContent = `Loaded ${name} (${text.length.toLocaleString("en-US")} characters). Press Make my video.`;
    box.focus();
  } catch (e) { note.textContent = e.message || "Could not read that file."; }
}
// the desktop app's File menu hands the file over here
window.importScriptFile = async (name, b64) => { const bin = atob(b64), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); await importScriptBytes(String(name).slice(0, 200), bytes); };
function fitScenesToMusic() {
  const target = state.musicSeconds, total = state.plan.scenes.reduce((n, s) => n + s.seconds, 0);
  if (!target || !total) return;
  const f = target / total; let acc = 0;
  state.plan.scenes.forEach((s, i) => {
    const last = i === state.plan.scenes.length - 1;
    s.seconds = last ? Math.max(1.5, Math.min(30, Math.round((target - acc) * 2) / 2)) : Math.max(1.5, Math.min(30, Math.round(s.seconds * f * 2) / 2));
    acc += s.seconds;
  });
  drawScenes(); touch();
  say(`Scenes now add up to ${Math.round(acc)} s, to match the music (${Math.round(target)} s).`, "ok");
}
function showFitMusic() {
  let b = $("fitMusic");
  if (!b) { b = document.createElement("button"); b.id = "fitMusic"; b.type = "button"; b.className = "btn quiet small"; b.addEventListener("click", fitScenesToMusic); $("musicOpts").after(b); }
  b.hidden = !(state.musicSeconds > 0);
  b.textContent = `Fit scenes to the music (${Math.round(state.musicSeconds || 0)} s)`;
}

function init() {
  $("scriptFile").addEventListener("change", async (e) => { const f = e.target.files && e.target.files[0]; if (f) await importScriptBytes(f.name, new Uint8Array(await f.arrayBuffer())); e.target.value = ""; });
  pollActivity(); setInterval(pollActivity, 2500);
  segmented($("len"), LENGTHS.map((n) => [n, `${n} s`]), state.seconds, (v) => (state.seconds = v));
  shapePicker($("shape"), state.shape, (v) => { state.shape = v; });
  $("make").addEventListener("click", make);
  $("idea").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) make(); });
  document.querySelectorAll("[data-ex]").forEach((b) => b.addEventListener("click", () => { $("idea").value = b.dataset.ex; $("idea").focus(); }));
  $("update").addEventListener("click", () => render("draft"));
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && state.plan && !state.busy && $("studio").hidden === false) { e.preventDefault(); render("draft"); } });
  $("final").addEventListener("click", () => render("final"));
  $("editor").addEventListener("click", async () => {
    if (state.dirty && !confirm("You changed something since the last video. EffectCraft will open the last version you made. Open it anyway?")) return;
    try { await api("/api/open-editor", { id: state.id }); say("Opening EffectCraft with your project. Every scene is real, editable layers there.", "ok"); } catch (e) { say(e.message, "error"); }
  });
  $("add").addEventListener("click", () => { if (state.plan.scenes.length >= 12) return; state.plan.scenes.push({ headline: "New scene", sub: "", seconds: 3 }); drawScenes(); touch(); });
  $("gear").addEventListener("click", openSettings);
  $("aiLink").addEventListener("click", openSettings);
  $("settingsDone").addEventListener("click", () => $("settings").close());
  $("again").addEventListener("click", () => { if (state.dirty && !confirm("Start over? Your changes will be lost.")) return; $("studio").hidden = true; $("start").hidden = false; $("make").disabled = false; $("startnote").textContent = ""; $("video").removeAttribute("src"); state.plan = null; state.id = null; drawRecent(); });
  $("reveal").addEventListener("click", () => state.last && api("/api/reveal", { url: state.last }).catch(() => {}));
  api("/api/status").then((s) => {
    state.looks = s.looks; state.recycles = !!s.recycles; state.effects = s.effects || [];
    fillSound(s);
    drawRecent();
    const e = $("engine");
    e.textContent = s.engine ? "EffectCraft ready" : "EffectCraft not found";
    e.className = "engine" + (s.engine ? "" : " bad");
    if (!s.engine) $("startnote").textContent = "EffectCraft 0.24.1 is needed to make videos. Install it, then reload this page.";
  }).catch(() => { drawRecent(); });
}
init();
