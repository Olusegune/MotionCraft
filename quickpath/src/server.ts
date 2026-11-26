// The local app: a tiny web server on 127.0.0.1 and one page. Nothing leaves the computer except what the person chooses to ask a model.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EffectCraft, EngineError } from "./ec.ts";
import { buildComposition, renderVideo } from "./build.ts";
import { LOOKS, lookById } from "./looks.ts";
import { clamp, makePlan, pickModel, SHAPE_LIST, SIZES, type Plan, type Shape } from "./plan.ts";
import { imageInfo, MAX_PICTURE_BYTES, MEDIA_NAME, PICTURE_NAME } from "./images.ts";
import { looksLikeMp4, MAX_CLIP_BYTES, mp4Info } from "./mp4.ts";
import { generatePicture, picturePrompt, Spend, SpendRefused } from "./ai.ts";
import { canSaveKeys, keyStatus, kieKey, PROVIDERS, providerKey, removeKey, saveKey, type Provider } from "./keys.ts";
import { effectiveCap, saveCap } from "./settings.ts";
import { MOODS } from "./music.ts";
import { resolveSound, sceneVoice, SoundRefused, type Level } from "./sound.ts";
import { ELEVEN_BASE, isPaidVoice, KIE_VOICES, knownVoice, makeElevenLines, makeKieLines, makeOpenAILines, makeVoicekillerLines, OPENAI_VOICES, parseVoicekillerReply, spokenText, splitVoicekillerKey, voiceKind, voiceMissing, VOICEKILLER_BASE, windowsVoices } from "./voice.ts";
import { dollars, download, KieError, runTask, uploadPicture, type KieOpts } from "./kie.ts";
import { isNarrator, parseScript } from "./script.ts";
import { EFFECTS, effectById } from "./fx.ts";
import { readLevels, saveLevel } from "./loudness.ts";
import { audioInfo, audioKind, AUDIO_NAME, MAX_AUDIO_BYTES, wavInfo } from "./wav.ts";

// Where the page lives: QUICKPATH_UI when the desktop app sets it, else the ui folder beside src. (The bundled desktop build has no import.meta.url.)
const UI = process.env.QUICKPATH_UI ? resolve(process.env.QUICKPATH_UI) : resolve(typeof __dirname !== "undefined" ? __dirname : fileURLToPath(new URL(".", import.meta.url)), typeof __dirname !== "undefined" ? "." : "..", "ui");
export const HOME = process.env.QUICKPATH_HOME ?? join(homedir(), "Documents", "QuickPath");
const CANDIDATES = [
  process.env.EFFECTCRAFT_CLI ?? "",
  "C:/Program Files/EffectCraft/effectcraft-cli.exe",
  "/Applications/EffectCraft.app/Contents/MacOS/effectcraft-cli",
  "/usr/local/bin/effectcraft-cli",
].filter(Boolean);
const cliPath = () => CANDIDATES.find((p) => existsSync(p)) ?? "";

const MIME: Record<string, string> = { ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".mp4": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".svg": "image/svg+xml", ".png": "image/png" };
const SHAPES = Object.keys(SIZES) as Shape[];

class Refused extends Error {}

/** A saved video's plan, re-checked as if it came from the page (the folder may have been edited by hand), or null when it cannot be read. */
function readProject(id: string): { plan: Plan; shape: Shape } | null {
  try {
    const raw = JSON.parse(readFileSync(join(HOME, "projects", id, "plan.json"), "utf-8"));
    return { plan: checkPlan(raw.plan), shape: SHAPES.includes(raw.shape) ? raw.shape : "16:9" };
  } catch { return null; }
}

/** The most recent videos, newest first: enough to show a card and reopen it. */
export function listProjects(limit = 12) {
  const root = join(HOME, "projects");
  const out: { id: string; title: string; look: string; shape: Shape; scenes: number; seconds: number; updated: string; hasFinal: boolean }[] = [];
  let ids: string[] = [];
  try { ids = readdirSync(root).filter((x) => /^[a-f0-9]{12}$/.test(x)); } catch { return out; }
  for (const id of ids) {
    const file = join(root, id, "plan.json");
    let mtime: Date;
    try { mtime = statSync(file).mtime; } catch { continue; }
    const p = readProject(id);
    if (!p) continue;
    let hasFinal = false;
    try { hasFinal = readdirSync(join(root, id)).some((f) => f.startsWith("final-") && f.endsWith(".mp4")); } catch { /* none */ }
    out.push({ id, title: p.plan.title, look: p.plan.look, shape: p.shape, scenes: p.plan.scenes.length, seconds: Math.round(p.plan.scenes.reduce((n, x) => n + x.seconds, 0) * 10) / 10, updated: mtime.toISOString(), hasFinal });
  }
  return out.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, limit);
}

/** Removes a saved video's folder. On Windows it goes to the Recycle Bin (so it can be put back); elsewhere, or with QUICKPATH_DELETE=permanent, it is deleted. */
export async function removeProject(id: string): Promise<"recycled" | "deleted"> {
  if (!/^[a-f0-9]{12}$/.test(id)) throw new Refused("That video could not be removed.");
  const dir = join(HOME, "projects", id);
  if (!existsSync(join(dir, "plan.json"))) throw new Refused("That video could not be removed.");        // only folders that are QuickPath videos
  if (process.platform === "win32" && process.env.QUICKPATH_DELETE !== "permanent") {
    const q = dir.replace(/'/g, "''");
    await new Promise<void>((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory('${q}', 'OnlyErrorDialogs', 'SendToRecycleBin')`],
      { windowsHide: true, timeout: 60_000 }, (err) => (err ? reject(new Refused("Windows would not move that video to the Recycle Bin.")) : resolve())));
    return "recycled";
  }
  rmSync(dir, { recursive: true, force: true });
  return "deleted";
}


/** What the voice windows and errors say about each paid voice provider. */
const VOICE_PROVIDER: Record<VoiceKind, { key: "kie" | "openai" | "elevenlabs" | "voicekiller"; name: string; model: string; missing: string; note: string }> = {
  kie: { key: "kie", name: "Kie.ai", model: "ElevenLabs voices", get missing() { return NO_KIE; }, note: "Kie.ai charges about $0.03 for each line of speech (up to 1,000 characters), so every scene costs about that, however short. The real cost is read back from Kie afterwards." },
  openai: { key: "openai", name: "OpenAI", model: "tts-1 voices", get missing() { return NO_OPENAI; }, note: "OpenAI charges $15 per million characters." },
  eleven: { key: "elevenlabs", name: "ElevenLabs", model: "ElevenLabs voices", get missing() { return NO_ELEVEN; }, note: "Billed by ElevenLabs against your own plan (about $0.15 per 1,000 characters if you go past it). The price shown is an estimate; your ElevenLabs account shows the real use." },
  vk: { key: "voicekiller", name: "Voicekiller", model: "Voicekiller voices", get missing() { return NO_VK; }, note: "Billed by Voicekiller through your own plan. QuickPath cannot see that price, so it adds nothing to its own spending total; each line uses some of your plan." },
};
/** A voice's name for a window: Kie and ElevenLabs ids are looked up in the known lists, Voicekiller's choice is its name, OpenAI's is the voice. */
const voiceLabel = (v: string) => (v.startsWith("kie:") || v.startsWith("eleven:") ? (KIE_VOICES.find((x) => x.id === v.slice(v.indexOf(":") + 1))?.name ?? elevenNames.get(v.slice(7)) ?? "") : v.startsWith("vk:") ? v.slice(3) : v.startsWith("openai:") ? v.slice(7) : "");
const elevenNames = new Map<string, string>();

/** The paid voices a plan uses (a scene's own voice, else the video's), each with the distinct words it must speak. */
function paidJobs(plan: Plan): { voice: string; texts: string[] }[] {
  const by = new Map<string, Set<string>>();
  for (const s of plan.scenes) {
    const v = sceneVoice(plan, s);
    if (!isPaidVoice(v)) continue;
    (by.get(v) ?? by.set(v, new Set()).get(v)!).add(spokenText(s));
  }
  return [...by].map(([voice, set]) => ({ voice, texts: [...set] }));
}
const jobKey = (jobs: { voice: string; texts: string[] }[]) => jobs.map((j) => `${j.voice}:${j.texts.join("|")}`).join("||");


// Voice lists for the pickers: asked for once and kept ten minutes. A failure gives the safe fallback (ElevenLabs' standard voices, no Voicekiller voices) rather than an error.
const listCache = new Map<string, { at: number; value: unknown }>();
async function cached<T>(name: string, make: () => Promise<T>): Promise<T> {
  const hit = listCache.get(name);
  if (hit && Date.now() - hit.at < 600_000) return hit.value as T;
  const value = await make();
  listCache.set(name, { at: Date.now(), value });
  return value;
}
async function elevenVoiceList(): Promise<{ id: string; name: string }[]> {
  const key = await providerKey("elevenlabs");
  if (!key) return [];
  return cached(`eleven:${key.slice(-6)}`, async () => {
    try {
      const r = await fetch(`${process.env.QUICKPATH_ELEVEN_BASE ?? ELEVEN_BASE}/v1/voices`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const j = (await r.json()) as { voices?: { voice_id?: string; name?: string }[] };
        const out = (j.voices ?? []).filter((v) => /^[A-Za-z0-9]{20}$/.test(String(v.voice_id)) && v.name).map((v) => ({ id: String(v.voice_id), name: String(v.name).slice(0, 40) })).slice(0, 100);
        for (const v of out) elevenNames.set(v.id, v.name);
        if (out.length) return out;
      }
    } catch { /* fall back */ }
    return KIE_VOICES;       // ElevenLabs' standard voices: the same ids work in every account
  });
}
async function vkVoiceList(): Promise<string[]> {
  const key = await providerKey("voicekiller");
  const k = key ? splitVoicekillerKey(key) : null;
  if (!k) return [];
  return cached(`vk:${k.userId}`, async () => {
    try {
      const r = await fetch(`${process.env.QUICKPATH_VOICEKILLER_BASE ?? VOICEKILLER_BASE}/api/generate-speech/voicelist`, { method: "POST", headers: { "api-key": k.apiKey, userid: k.userId }, signal: AbortSignal.timeout(8_000) });
      return r.ok ? parseVoicekillerReply(await r.text()) : [];
    } catch { return []; }
  });
}

/** What Settings shows. Whether each key is set and where it comes from, never the key. */
async function settingsView() {
  const keys: Record<string, { set: boolean; source: string | null }> = {};
  for (const p of PROVIDERS) keys[p] = await keyStatus(p);
  const model = await pickModel(process.env.QUICKPATH_OLLAMA_BASE ?? "http://127.0.0.1:11434");
  return { keys, canSaveKeys: canSaveKeys(), ollama: { found: !!model, model }, capUsd: effectiveCap(HOME), spentUsd: new Spend(join(HOME, "spend.jsonl")).spent() };
}

/** Asks the provider a free question to see whether the saved key works (Kie.ai: the credit balance; OpenAI: the model list). Nothing is made or charged. */
async function checkKey(p: Provider): Promise<{ ok: boolean; message: string }> {
  const key = await providerKey(p);
  if (!key) return { ok: false, message: "No key is saved yet." };
  if (p === "elevenlabs") {
    try {
      const r = await fetch(`${process.env.QUICKPATH_ELEVEN_BASE ?? ELEVEN_BASE}/v1/user`, { headers: { "xi-api-key": key }, signal: AbortSignal.timeout(15_000) });
      if (r.status === 401) return { ok: false, message: "ElevenLabs did not accept this key. Copy it again from your ElevenLabs profile (Developers, API keys)." };
      if (r.status === 403) return { ok: true, message: "ElevenLabs accepted the key, but this key may not be allowed to read your account (voices can still work). Try Make the voiceover to find out." };
      if (!r.ok) return { ok: false, message: `ElevenLabs answered with an error (${r.status}). Try again in a moment.` };
      const j = (await r.json().catch(() => ({}))) as { subscription?: { character_count?: number; character_limit?: number; tier?: string } };
      const s = j.subscription;
      const left = s && Number.isFinite(s.character_limit) && Number.isFinite(s.character_count) ? Math.max(0, (s.character_limit as number) - (s.character_count as number)) : null;
      return { ok: true, message: left === null ? "The key works." : `The key works${s?.tier ? ` (${s.tier} plan)` : ""}. Characters left this period: ${left.toLocaleString("en-US")}.` };
    } catch { return { ok: false, message: "Could not reach ElevenLabs. Check your internet connection." }; }
  }
  if (p === "voicekiller") {
    const k = splitVoicekillerKey(key);
    if (!k) return { ok: false, message: "QuickPath needs both your Voicekiller User ID and your API key. Save them again in Settings." };
    try {
      const r = await fetch(`${process.env.QUICKPATH_VOICEKILLER_BASE ?? VOICEKILLER_BASE}/api/generate-speech/voicelist`, { method: "POST", headers: { "api-key": k.apiKey, userid: k.userId }, signal: AbortSignal.timeout(15_000) });
      if (r.status === 401 || r.status === 403) return { ok: false, message: "Voicekiller did not accept the User ID and key. Copy them again from your Voicekiller API page." };
      if (!r.ok) return { ok: false, message: `Voicekiller answered with an error (${r.status}). Try again in a moment.` };
      const text = await r.text();
      const n = parseVoicekillerReply(text).length;
      return { ok: true, message: n ? `The key works. ${n} voices available.` : `The key was accepted, but the voice list was not in a shape QuickPath understands. It began: ${text.replace(/\s+/g, " ").slice(0, 200)}` };
    } catch { return { ok: false, message: "Could not reach Voicekiller. Check your internet connection." }; }
  }
  if (p === "fal") {
    // fal has no balance question, so ask for a request that cannot exist: a wrong key is refused outright (401 or 403), a good key gets "not found" or similar.
    try {
      const r = await fetch(`${process.env.QUICKPATH_FAL_BASE ?? "https://queue.fal.run"}/fal-ai/flux/dev/requests/00000000-0000-0000-0000-000000000000/status`, { headers: { Authorization: `Key ${key}` }, signal: AbortSignal.timeout(15_000) });
      if (r.status === 401 || r.status === 403) return { ok: false, message: "fal did not accept this key. Copy it again from your account page." };
      return { ok: true, message: "fal accepted the key. (QuickPath does not use fal yet; a later version will.)" };
    } catch { return { ok: false, message: "Could not reach fal. Check your internet connection." }; }
  }
  const url = p === "kie" ? `${process.env.QUICKPATH_KIE_BASE ?? "https://api.kie.ai/api/v1"}/chat/credit` : `${process.env.QUICKPATH_OPENAI_BASE ?? "https://api.openai.com/v1"}/models`;
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if (r.status === 401 || r.status === 403) return { ok: false, message: "The provider did not accept this key. Copy it again from your account page." };
    if (!r.ok) return { ok: false, message: `The provider answered with an error (${r.status}). Try again in a moment.` };
    if (p === "kie") {
      const j = (await r.json().catch(() => ({}))) as { code?: number; data?: unknown };
      if (typeof j.code === "number" && j.code !== 200) return { ok: false, message: j.code === 401 ? "The provider did not accept this key." : "The provider could not check this key right now." };
      const n = typeof j.data === "number" ? j.data : Number(j.data);
      return { ok: true, message: Number.isFinite(n) ? `The key works. Credits left: ${n}.` : "The key works." };
    }
    return { ok: true, message: "The key works." };
  } catch { return { ok: false, message: "Could not reach the provider. Check your internet connection." }; }
}

/** Where Kie.ai is, and how patiently to wait. Tests point these at a fake; otherwise they are Kie's own. */
const kieOpts = (): KieOpts => (process.env.QUICKPATH_KIE_BASE ? { base: process.env.QUICKPATH_KIE_BASE, allowLocalHttp: true, pollMs: 20 } : {});
const NO_KIE = "No Kie.ai key was found. Add one in Settings (the sliders button at the top right), then try again.";
const NO_ELEVEN = "No ElevenLabs key was found. Add one in Settings (the sliders button at the top right), then try again.";
const NO_VK = "No Voicekiller key was found. Add your User ID and API key in Settings (the sliders button at the top right), then try again.";
const NO_OPENAI = "No OpenAI key was found. Add one in Settings (the sliders button at the top right), then try again.";
const projectDir = (id: string) => { if (!/^[a-f0-9]{12}$/.test(id) || !existsSync(join(HOME, "projects", id))) throw new Refused("Make your video first."); return join(HOME, "projects", id); };

/** Checks and trims a plan from the page: the page is never trusted. */
export function checkPlan(raw: any): Plan {
  if (!raw || !Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > 12) throw new Refused("A video needs between 1 and 12 scenes.");
  const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const scenes = raw.scenes.map((s: any) => ({ headline: text(s?.headline, 90), sub: text(s?.sub, 120), seconds: clamp(Number(s?.seconds) || 3, 1.5, 30), ...(typeof s?.picture === "string" && MEDIA_NAME.test(s.picture) ? { picture: s.picture } : {}), ...(Array.isArray(s?.more) && typeof s?.picture === "string" && s.more.filter((m: unknown) => typeof m === "string" && /^[a-f0-9]{12}\.mp4$/.test(m)).length ? { more: s.more.filter((m: unknown) => typeof m === "string" && /^[a-f0-9]{12}\.mp4$/.test(m)).slice(0, 6) } : {}), ...(typeof s?.say === "string" && s.say.trim() ? { say: text(s.say, 600) } : {}), ...(text(s?.card, 60) ? { card: text(s.card, 60) } : {}), ...(text(s?.note, 900) ? { note: text(s.note, 900) } : {}), ...(typeof s?.voice === "string" && knownVoice(s.voice) ? { voice: s.voice } : {}), ...(Array.isArray(s?.fx) && s.fx.some((x: unknown) => typeof x === "string" && effectById(x)) ? { fx: [...new Set(s.fx.filter((x: unknown) => typeof x === "string" && effectById(x)))].slice(0, 6) } : {}) }));
  if (scenes.some((s: { headline: string; card?: string; picture?: string; note?: string }) => !s.headline && !s.card && !s.picture && !s.note)) throw new Refused("Every scene needs some words (or a picture or clip).");
  const total = scenes.reduce((n: number, s: { seconds: number }) => n + s.seconds, 0);
  if (total > 180) throw new Refused("Keep it under three minutes.");
  const voice = typeof raw.voice === "string" && knownVoice(raw.voice) ? raw.voice : undefined;
  const m = raw.music;
  const level: Level = m?.level === "soft" || m?.level === "loud" ? m.level : "medium";
  const music = m && typeof m.file === "string" && AUDIO_NAME.test(m.file) ? { file: m.file, level } : m && typeof m.mood === "string" && MOODS.some((x) => x.id === m.mood) ? { mood: m.mood, level } : undefined;
  const refs = Array.isArray(raw.refs) ? raw.refs.slice(0, 24).filter((r: any) => r && typeof r.name === "string" && MEDIA_NAME.test(r.name) && !r.name.endsWith(".mp4")).map((r: any) => ({ name: r.name, label: text(r.label, 40) || "Reference" })) : [];
  return { title: text(raw.title, 60) || scenes[0].headline || scenes[0].card || "My video", look: lookById(raw.look).id, scenes, source: raw.source === "model" ? "model" : "words", ...(voice ? { voice } : {}), ...(music ? { music } : {}), ...(refs.length ? { refs } : {}) };
}

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => { const r = queue.then(job, job); queue = r.catch(() => undefined); return r; };

async function render(planIn: unknown, shapeIn: unknown, quality: "draft" | "final", idIn?: unknown) {
  // The checks that need no engine come first, so a plain problem (a bad plan, a paid voice not made yet) is named even where EffectCraft is missing.
  const plan = checkPlan(planIn);
  const shape: Shape = SHAPES.includes(shapeIn as Shape) ? (shapeIn as Shape) : "16:9";
  const id = typeof idIn === "string" && /^[a-f0-9]{12}$/.test(idIn) ? idIn : randomBytes(6).toString("hex");
  const dir = join(HOME, "projects", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.json"), JSON.stringify({ plan, shape }, null, 2));
  const resolved = await resolveSound(dir, plan);          // scenes are lengthened to fit their voice; refused if a paid voice was not made yet
  const cli = cliPath();
  if (!cli) throw new Refused("EffectCraft was not found. Install EffectCraft 0.24.1, or set EFFECTCRAFT_CLI to its effectcraft-cli program.");
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const built = await buildComposition(ec, resolved.plan, shape, dir, resolved.sound);
    const file = quality === "draft" ? "draft.mp4" : `final-${Date.now()}.mp4`;
    const frames = await renderVideo(ec, built.comp, join(dir, file), quality);
    return { id, file, url: `/media/${id}/${file}`, frames, seconds: built.total, path: join(dir, file), scenes: resolved.plan.scenes.map((x) => x.seconds) };
  } finally { ec.stop(); }
}

/** What the page may do: load only its own files, run only its own script, talk only to this server. No framing, no plugins, no other base address. */
export const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": CSP });
  res.end(data);
}

async function readBody(req: IncomingMessage, max: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > max) throw new Refused("That request is too big.");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > max) throw new Refused("That request is too big."); chunks.push(c as Buffer); }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<any> {
  try { return JSON.parse((await readBody(req, 64 * 1024)).toString("utf-8") || "{}"); } catch (e) { if (e instanceof Refused) throw e; throw new Refused("That request was not understood."); }
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string) {
  let st;
  try { st = statSync(file); if (!st.isFile()) throw new Error(); } catch { return send(res, 404, { error: "Not found." }); }
  const type = MIME[extname(file)] ?? "application/octet-stream";
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
  if (range && type === "video/mp4") {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start > end || start >= st.size) { res.writeHead(416, { "content-range": `bytes */${st.size}` }); return res.end(); }
    res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${st.size}`, "content-length": end - start + 1 });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": type === "video/mp4" ? "no-store" : "no-cache", "x-content-type-options": "nosniff", "content-security-policy": CSP });
  createReadStream(file).pipe(res);
}

/** The EffectCraft program that goes with the command-line tool found: on Windows the .exe beside it, on a Mac the app, else null. */
function editorApp(): { cmd: string; args: (file: string) => string[] } | null {
  const cli = cliPath();
  if (!cli) return null;
  if (process.platform === "darwin") { const app = cli.replace(/\/Contents\/.*$/, ""); return app.endsWith(".app") ? { cmd: "open", args: (f) => ["-a", app, f] } : null; }
  const exe = join(resolve(cli, ".."), process.platform === "win32" ? "effectcraft.exe" : "effectcraft");
  return existsSync(exe) ? { cmd: exe, args: (f) => [f] } : null;
}

function openFolder(path: string) {
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", ["/select,", path]] : process.platform === "darwin" ? ["open", ["-R", path]] : ["xdg-open", [resolve(path, "..")]];
  try { spawn(cmd as string, args as string[], { shell: false, detached: true, stdio: "ignore" }).unref(); } catch { /* the person can still find it from the path shown */ }
}

export function start(port = Number(process.env.PORT ?? 4177)) {
  mkdirSync(join(HOME, "projects"), { recursive: true });
  const spend = new Spend(join(HOME, "spend.jsonl"), () => effectiveCap(HOME));
  const server = createServer(async (req, res) => {
    try {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      const host = String(req.headers.host ?? "");
      if (host !== `127.0.0.1:${p}` && host !== `localhost:${p}`) return send(res, 403, { error: "Not allowed." });
      const origin = req.headers.origin;
      if (origin && origin !== `http://127.0.0.1:${p}` && origin !== `http://localhost:${p}`) return send(res, 403, { error: "Not allowed." });
      const url = new URL(req.url ?? "/", `http://${host}`);

      if (req.method === "GET" && url.pathname === "/api/status") {
        return send(res, 200, { shapes: SHAPE_LIST, recycles: process.platform === "win32" && process.env.QUICKPATH_DELETE !== "permanent", engine: !!cliPath(), voices: await windowsVoices(), openaiVoices: (await providerKey("openai")) ? [...OPENAI_VOICES] : [], elevenVoices: await elevenVoiceList(), vkVoices: await vkVoiceList(), kieVoices: (await providerKey("kie")) ? KIE_VOICES : [], moods: MOODS, effects: EFFECTS.map((e) => ({ id: e.id, name: e.name })), looks: LOOKS.map((l) => ({ id: l.id, name: l.name, bg: l.bg, text: l.text, accent: l.accent })), home: HOME });
      }
      if (req.method === "GET" && url.pathname === "/api/projects") {
        return send(res, 200, { projects: listProjects() });
      }
      if (req.method === "GET" && url.pathname === "/api/project") {
        const id = url.searchParams.get("id") ?? "";
        const found = /^[a-f0-9]{12}$/.test(id) ? readProject(id) : null;
        if (!found) throw new Refused("That video could not be opened.");
        return send(res, 200, { id, ...found });
      }
      if (req.method === "POST" && url.pathname === "/api/project/remove") {
        const b = await readJson(req);
        return send(res, 200, { how: await removeProject(String(b.id ?? "")) });
      }
      if (req.method === "GET" && url.pathname === "/api/settings") {
        return send(res, 200, await settingsView());
      }
      if (req.method === "POST" && url.pathname === "/api/settings/key") {
        const b = await readJson(req);
        const p = String(b.provider ?? "") as Provider;
        if (!PROVIDERS.includes(p)) throw new Refused("Unknown provider.");
        // Voicekiller wants a User ID as well as a key: the page sends them as two fields, and they are kept together as one entry
        const raw = p === "voicekiller" && typeof b.userId === "string" ? `${b.userId.trim()}:${String(b.key ?? "").trim()}` : String(b.key ?? "");
        try { await saveKey(p, raw); } catch (e) { throw new Refused((e as Error).message); }
        return send(res, 200, await settingsView());
      }
      if (req.method === "POST" && url.pathname === "/api/settings/key/remove") {
        const b = await readJson(req);
        const p = String(b.provider ?? "") as Provider;
        if (!PROVIDERS.includes(p)) throw new Refused("Unknown provider.");
        await removeKey(p);
        return send(res, 200, await settingsView());
      }
      if (req.method === "POST" && url.pathname === "/api/settings/check") {
        const b = await readJson(req);
        const p = String(b.provider ?? "") as Provider;
        if (!PROVIDERS.includes(p)) throw new Refused("Unknown provider.");
        return send(res, 200, await checkKey(p));
      }
      if (req.method === "POST" && url.pathname === "/api/settings/cap") {
        const b = await readJson(req);
        try { saveCap(HOME, b.usd); } catch (e) { throw new Refused((e as Error).message); }
        return send(res, 200, await settingsView());
      }
      if (req.method === "POST" && url.pathname === "/api/plan") {
        const b = await readJson(req);
        const idea = String(b.idea ?? "").trim().slice(0, 3000);
        if (idea.length < 3) throw new Refused("Tell me a little about your video first.");
        const id = randomBytes(6).toString("hex");
        mkdirSync(join(HOME, "projects", id, "assets"), { recursive: true });
        return send(res, 200, { ...(await makePlan(idea, Number(b.seconds) || 15)), id });
      }
      if (req.method === "POST" && url.pathname === "/api/script") {
        const b = await readJson(req);
        let parsed;
        try { parsed = parseScript(String(b.script ?? "")); } catch (e) { throw new Refused((e as Error).message); }
        const id = randomBytes(6).toString("hex");
        mkdirSync(join(HOME, "projects", id, "assets"), { recursive: true });
        const kieSet = !!(await providerKey("kie"));
        const narrator = typeof b.narrator === "string" && knownVoice(b.narrator) ? b.narrator : kieSet ? `kie:${KIE_VOICES.find((v) => v.name === "Daniel")!.id}` : "";
        const character = typeof b.character === "string" && knownVoice(b.character) ? b.character : kieSet ? `kie:${KIE_VOICES.find((v) => v.name === "Jessica")!.id}` : "";
        const scenes = parsed.scenes.map(({ speaker, sound, ...s }) => ({ ...s, ...(!isNarrator(speaker) && character ? { voice: character } : {}), ...(sound ? { note: `${s.note ?? ""} Sound: ${sound}`.trim().slice(0, 900) } : {}) }));
        const plan = checkPlan({ title: parsed.title, look: parsed.look, scenes, voice: narrator || undefined, source: "words" });
        return send(res, 200, { ...plan, id, scriptSeconds: parsed.scriptSeconds });
      }
      if (req.method === "GET" && url.pathname === "/api/audio/unmeasured") {          // sound files the page should measure (the browser can decode MP3; the server reads WAV itself)
        const dir = projectDir(url.searchParams.get("id") ?? "");
        let files: string[] = [];
        try { files = readdirSync(join(dir, "assets", "audio")).filter((f) => f.endsWith(".mp3") && AUDIO_NAME.test(f)); } catch { /* none yet */ }
        const known = readLevels(dir);
        return send(res, 200, { files: files.filter((f) => !(f in known)) });
      }
      if (req.method === "POST" && url.pathname === "/api/audio/level") {
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        if (!saveLevel(dir, String(b.file ?? ""), b.db)) throw new Refused("That sound level could not be saved.");
        return send(res, 200, { saved: true });
      }
      if (req.method === "POST" && url.pathname === "/api/open-editor") {          // opens this video's project in EffectCraft itself: every scene is real layers there
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        const file = join(dir, "video.ecproj");
        if (!existsSync(file)) throw new Refused("Press Update video first, so there is a project to open.");
        const app = editorApp();
        if (!app) throw new Refused("EffectCraft was not found. Open the folder instead and open video.ecproj with EffectCraft yourself.");
        try { spawn(app.cmd, app.args(file), { shell: false, detached: true, stdio: "ignore" }).unref(); } catch { throw new Refused("EffectCraft would not start. Open video.ecproj from your QuickPath folder instead."); }
        return send(res, 200, { opened: true, file });
      }
      if (req.method === "POST" && url.pathname === "/api/plan/save") {      // keeps edits safe between renders: the same checks as a render, nothing is made or paid for
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        const plan = checkPlan(b.plan);
        const shape: Shape = SHAPES.includes(b.shape) ? b.shape : "16:9";
        writeFileSync(join(dir, "plan.json"), JSON.stringify({ plan, shape }, null, 2));
        return send(res, 200, { saved: true });
      }
      if (req.method === "POST" && url.pathname === "/api/render") {
        const b = await readJson(req);
        const out = await serial(() => render(b.plan, b.shape, b.quality === "final" ? "final" : "draft", b.id));
        return send(res, 200, out);
      }
      if (req.method === "POST" && url.pathname === "/api/upload") {
        const id = url.searchParams.get("id") ?? "";
        if (!/^[a-f0-9]{12}$/.test(id) || !existsSync(join(HOME, "projects", id))) throw new Refused("Make your video first, then add a picture.");
        const type = String(req.headers["content-type"] ?? "").split(";")[0].trim();
        const sound = type === "audio/wav" || type === "audio/x-wav" || type === "audio/mpeg";
        if (!sound && type !== "image/png" && type !== "image/jpeg" && type !== "video/mp4") throw new Refused("Use a PNG or JPEG picture, an MP4 clip, or a WAV or MP3 sound.");
        if (sound) {
          const audio = await readBody(req, MAX_AUDIO_BYTES);
          const kind = audioKind(audio);                         // the file's own bytes decide, not its name or the header
          if (!kind) throw new Refused("That does not look like a WAV or MP3 sound that can be read.");
          const wi = kind === "wav" ? wavInfo(audio) : null;
          if (wi && wi.seconds > 1800) throw new Refused("Use a sound under thirty minutes.");
          const aname = `${randomBytes(6).toString("hex")}.${kind}`;
          mkdirSync(join(HOME, "projects", id, "assets", "audio"), { recursive: true });
          writeFileSync(join(HOME, "projects", id, "assets", "audio", aname), audio, { flag: "wx" });
          return send(res, 200, { name: aname, seconds: wi?.seconds });
        }
        const clip = type === "video/mp4";
        const body = await readBody(req, clip ? MAX_CLIP_BYTES : MAX_PICTURE_BYTES);
        let ext: string, width: number, height: number, seconds: number | undefined;
        if (clip) {                                         // the file's own bytes decide, not its name or the header
          const m = looksLikeMp4(body) ? mp4Info(body) : null;
          if (!m) throw new Refused("That does not look like an MP4 clip that can be read.");
          if (m.seconds > 600) throw new Refused("Use a clip under ten minutes.");
          ext = "mp4"; width = m.width; height = m.height; seconds = m.seconds;
        } else {
          const info = imageInfo(body);
          if (!info || info.ext === "webp") throw new Refused("That does not look like a PNG or JPEG picture, or it is too large.");
          ext = info.ext; width = info.width; height = info.height;
        }
        const name = `${randomBytes(6).toString("hex")}.${ext}`;
        mkdirSync(join(HOME, "projects", id, "assets"), { recursive: true });
        writeFileSync(join(HOME, "projects", id, "assets", name), body, { flag: "wx" });
        return send(res, 200, { name, width, height, seconds, url: `/media/${id}/assets/${name}` });
      }
      if (req.method === "POST" && url.pathname === "/api/ai/quote") {
        const b = await readJson(req);
        const id = String(b.id ?? "");
        if (!/^[a-f0-9]{12}$/.test(id) || !existsSync(join(HOME, "projects", id))) throw new Refused("Make your video first.");
        const shape: Shape = SHAPES.includes(b.shape) ? b.shape : "16:9";
        const typed = String(b.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
        const prompt = typed || picturePrompt(String(b.headline ?? "").slice(0, 90), String(b.sub ?? "").slice(0, 120), String(b.idea ?? "").slice(0, 300), shape);
        if (!(await kieKey())) throw new Refused("No Kie.ai key was found. Save one in Windows Credential Manager as QuickPath/kie, or set KIE_API_KEY, and try again.");
        return send(res, 200, spend.quote(id, prompt, shape));
      }
      if (req.method === "POST" && url.pathname === "/api/ai/picture") {
        const b = await readJson(req);
        const id = String(b.id ?? ""), prompt = String(b.prompt ?? "");
        if (!/^[a-f0-9]{12}$/.test(id) || !existsSync(join(HOME, "projects", id))) throw new Refused("Make your video first.");
        const held = spend.redeem(String(b.token ?? ""), id, prompt);          // one confirmation buys one picture
        const key = await kieKey();
        if (!key) throw new Refused("No Kie.ai key was found.");
        const out = await generatePicture(prompt, held.shape, key, { base: process.env.QUICKPATH_KIE_BASE, allowLocalHttp: !!process.env.QUICKPATH_KIE_BASE });
        spend.record(id, 0.02, "picture");
        const name = `${randomBytes(6).toString("hex")}.${out.info.ext}`;
        mkdirSync(join(HOME, "projects", id, "assets"), { recursive: true });
        writeFileSync(join(HOME, "projects", id, "assets", name), out.bytes, { flag: "wx" });
        return send(res, 200, { name, width: out.info.width, height: out.info.height, url: `/media/${id}/assets/${name}`, spentUsd: spend.spent() });
      }
      if (req.method === "POST" && url.pathname === "/api/voice/quote") {
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        const plan = checkPlan(b.plan);
        const jobs = paidJobs(plan);
        if (!jobs.length) return send(res, 200, { needed: false });
        let usd = 0, lines = 0, chars = 0;
        for (const j of jobs) { const m = voiceMissing(dir, j.voice, j.texts); usd += m.usd; lines += m.lines; chars += m.chars; }
        if (chars === 0) return send(res, 200, { needed: false });
        const kinds = [...new Set(jobs.map((j) => voiceKind(j.voice)!))];
        for (const k of kinds) if (!(await providerKey(VOICE_PROVIDER[k].key))) throw new Refused(VOICE_PROVIDER[k].missing);
        const names = [...new Set(jobs.map((j) => voiceLabel(j.voice)))].filter(Boolean).join(", ");
        const offer = { provider: kinds.map((k) => VOICE_PROVIDER[k].name).join(" and "), model: `${kinds.length === 1 ? (names.includes(",") ? VOICE_PROVIDER[kinds[0]].model : VOICE_PROVIDER[kinds[0]].model.replace("voices", "voice")) : "voices"} ${names}`.trim(), usd: Math.max(0.001, Math.round(usd * 10000) / 10000), note: kinds.map((k) => VOICE_PROVIDER[k].note).join(" "), what: kinds.length === 1 && kinds[0] === "kie" ? `${lines} line${lines === 1 ? "" : "s"} of speech` : `${chars} characters of speech (${lines} line${lines === 1 ? "" : "s"})` };
        return send(res, 200, { needed: true, ...spend.quote(b.id, jobKey(jobs), "16:9", offer) });
      }
      if (req.method === "POST" && url.pathname === "/api/voice/make") {
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        const plan = checkPlan(b.plan);
        const jobs = paidJobs(plan);
        if (!jobs.length) throw new Refused("Only paid voices need to be made first.");
        const held = spend.redeem(String(b.token ?? ""), String(b.id), jobKey(jobs));
        const keys: Partial<Record<VoiceKind, string>> = {};
        for (const j of jobs) { const k = voiceKind(j.voice)!; if (!keys[k]) { const v = await providerKey(VOICE_PROVIDER[k].key); if (!v) throw new Refused(VOICE_PROVIDER[k].missing); keys[k] = v; } }
        let made = 0, usd = 0;
        for (const j of jobs) {
          const k = voiceKind(j.voice)!, estimate = voiceMissing(dir, j.voice, j.texts).usd;
          if (k === "kie") { const r = await makeKieLines(dir, j.voice, j.texts, keys.kie!, kieOpts()); made += r.made; usd += r.usd; }
          else if (k === "eleven") { const r = await makeElevenLines(dir, j.voice, j.texts, keys.eleven!, { base: process.env.QUICKPATH_ELEVEN_BASE }).catch((e) => { throw new Refused((e as Error).message); }); made += r.made; usd += r.usd; }
          else if (k === "vk") { const r = await makeVoicekillerLines(dir, j.voice, j.texts, keys.vk!, { base: process.env.QUICKPATH_VOICEKILLER_BASE }).catch((e) => { throw new Refused((e as Error).message); }); made += r.made; }
          else { made += await makeOpenAILines(dir, j.voice, j.texts, keys.openai!, { base: process.env.QUICKPATH_OPENAI_BASE }).catch((e) => { throw new Refused((e as Error).message); }); usd += estimate; }
        }
        spend.record(String(b.id), Math.round(usd * 10000) / 10000, `${made} spoken lines`, held.offer);
        return send(res, 200, { made, spentUsd: spend.spent() });
      }
      if (req.method === "POST" && url.pathname === "/api/ai/music/quote") {
        const b = await readJson(req);
        projectDir(String(b.id ?? ""));
        const typed = String(b.style ?? "").replace(/\s+/g, " ").trim().slice(0, 900);
        const style = typed || `Instrumental background music for a short video about: ${String(b.idea ?? "").replace(/\s+/g, " ").trim().slice(0, 200)}. Soft, steady, no vocals, easy to talk over.`.slice(0, 900);
        if (!(await providerKey("kie"))) throw new Refused(NO_KIE);
        return send(res, 200, spend.quote(String(b.id), style, "16:9", { provider: "Kie.ai", model: "Suno V6 Mini (music)", usd: 0.06, note: "About $0.06 a track (measured on a real call: 12 credits). The real cost is read back from Kie afterwards. You get one track the length of your video.", what: "one music track" }));
      }
      if (req.method === "POST" && url.pathname === "/api/ai/music") {
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        const style = String(b.style ?? "");
        const held = spend.redeem(String(b.token ?? ""), String(b.id), style);
        const key = await providerKey("kie");
        if (!key) throw new Refused(NO_KIE);
        const seconds = clamp(Math.ceil(Number(b.seconds) || 15) + 3, 10, 360);
        const m = await runTask("ai-music-api/generate", { custom_mode: true, instrumental: true, model: "V6_MINI", title: "QuickPath music", style, duration: seconds }, key, { timeoutMs: 420_000, ...kieOpts() });
        const bytes = await download(m.urls[0], MAX_AUDIO_BYTES, kieOpts());
        const info = audioKind(bytes) === "mp3" ? audioInfo(bytes) : null;
        if (!info) throw new KieError("What came back from Kie.ai was not a usable sound.");
        const name = `${randomBytes(6).toString("hex")}.mp3`;
        mkdirSync(join(dir, "assets", "audio"), { recursive: true });
        writeFileSync(join(dir, "assets", "audio", name), bytes, { flag: "wx" });
        const usd = dollars(m.credits, held.offer.usd);
        spend.record(String(b.id), usd, "music track", held.offer);
        return send(res, 200, { name, seconds: Math.round(info.seconds * 10) / 10, usd, spentUsd: spend.spent() });
      }
      if (req.method === "POST" && url.pathname === "/api/ai/animate/batch/quote") {      // one price for several clips, confirmed once
        const b = await readJson(req);
        projectDir(String(b.id ?? ""));
        const clips = Math.floor(Number(b.clips));
        if (!(clips >= 1 && clips <= 24)) throw new Refused("Choose between 1 and 24 clips.");
        if (!(await providerKey("kie"))) throw new Refused(NO_KIE);
        return send(res, 200, spend.quote(String(b.id), `batch|${clips}`, "16:9", { provider: "Kie.ai", model: "Wan 2.2 Turbo (picture to video, 720p)", usd: 0.4, note: `${clips} clips at about $0.40 each (measured: 9 real clips cost $0.40 each). Each is started from a picture, or from the last frame of the clip before it. This one confirmation covers all ${clips}; it stops if a clip fails, and the real cost of each is read back and counted.`, what: `${clips} short video clips` }, clips));
      }
      if (req.method === "GET" && url.pathname === "/api/film/cost") {
        const id = url.searchParams.get("id") ?? "";
        projectDir(id);
        return send(res, 200, { filmUsd: spend.spentFor(id), spentUsd: spend.spent(), capUsd: effectiveCap(HOME) });
      }
      if (req.method === "POST" && url.pathname === "/api/ai/animate/quote") {
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        const picture = String(b.picture ?? "");
        if (!PICTURE_NAME.test(picture) || !existsSync(join(dir, "assets", picture))) throw new Refused("That picture is not in this video.");
        const prompt = String(b.prompt ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || "Gentle natural motion, a very slow camera push-in, soft light.";
        if (!(await providerKey("kie"))) throw new Refused(NO_KIE);
        return send(res, 200, { ...spend.quote(String(b.id), `${picture}|${prompt}`, "16:9", { provider: "Kie.ai", model: "Wan 2.2 Turbo (picture to video, 720p)", usd: 0.4, note: "An estimate: Kie.ai prices video by the second (about $0.04 to $0.08 a second, a clip of about 5 seconds). Your picture is uploaded to Kie.ai for 24 hours so the model can start from it. The real cost is read back afterwards.", what: "one short video clip" }), prompt });
      }
      if (req.method === "POST" && url.pathname === "/api/ai/animate") {
        const b = await readJson(req);
        const dir = projectDir(String(b.id ?? ""));
        const picture = String(b.picture ?? "");
        if (!PICTURE_NAME.test(picture)) throw new Refused("That picture is not in this video.");
        const prompt = String(b.prompt ?? "");
        const held = spend.redeem(String(b.token ?? ""), String(b.id), `${picture}|${prompt}`, { batch: b.batch === true });
        const key = await providerKey("kie");
        if (!key) throw new Refused(NO_KIE);
        let src: Buffer;
        try { src = readFileSync(join(dir, "assets", picture)); } catch { throw new Refused("That picture is not in this video."); }
        const info = imageInfo(src);
        if (!info) throw new Refused("That picture cannot be read.");
        const mime = info.ext === "png" ? "image/png" : info.ext === "jpg" ? "image/jpeg" : "image/webp";
        const url = await uploadPicture(src, mime, `${randomBytes(6).toString("hex")}.${info.ext}`, key, { ...kieOpts(), base: process.env.QUICKPATH_KIE_UPLOAD_BASE });
        const m = await runTask("wan/2-2-a14b-image-to-video-turbo", { image_url: url, prompt, resolution: "720p", enable_prompt_expansion: false, acceleration: "none" }, key, { timeoutMs: 600_000, ...kieOpts() });
        const bytes = await download(m.urls[0], MAX_CLIP_BYTES, kieOpts());
        const clip = looksLikeMp4(bytes) ? mp4Info(bytes) : null;
        if (!clip) throw new KieError("What came back from Kie.ai was not a usable clip.");
        const name = `${randomBytes(6).toString("hex")}.mp4`;
        mkdirSync(join(dir, "assets"), { recursive: true });
        writeFileSync(join(dir, "assets", name), bytes, { flag: "wx" });
        const usd = dollars(m.credits, held.offer.usd);
        spend.record(String(b.id), usd, "picture to video", held.offer);
        return send(res, 200, { name, seconds: Math.round(clip.seconds * 10) / 10, width: clip.width, height: clip.height, usd, spentUsd: spend.spent() });
      }
      if (req.method === "POST" && url.pathname === "/api/reveal") {
        const b = await readJson(req);
        const m = /^\/media\/([a-f0-9]{12})\/([\w.-]+\.mp4)$/.exec(String(b.url ?? ""));
        if (!m) throw new Refused("Nothing to show.");
        openFolder(join(HOME, "projects", m[1], m[2]));
        return send(res, 200, { ok: true });
      }
      const pic = /^\/media\/([a-f0-9]{12})\/assets\/([a-f0-9]{12}\.(?:png|jpg|webp|mp4))$/.exec(url.pathname);
      if (req.method === "GET" && pic) return serveFile(req, res, join(HOME, "projects", pic[1], "assets", pic[2]));
      const snd = /^\/media\/([a-f0-9]{12})\/assets\/audio\/([a-f0-9]{12}\.(?:wav|mp3))$/.exec(url.pathname);        // the page measures how loud a voice is
      if (req.method === "GET" && snd) return serveFile(req, res, join(HOME, "projects", snd[1], "assets", "audio", snd[2]));
      const media = /^\/media\/([a-f0-9]{12})\/([\w.-]+\.mp4)$/.exec(url.pathname);
      if (req.method === "GET" && media) return serveFile(req, res, join(HOME, "projects", media[1], media[2]));
      if (req.method === "GET") {
        const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
        const file = normalize(join(UI, rel));
        if (file !== UI && !file.startsWith(UI + sep)) return send(res, 404, { error: "Not found." });
        return serveFile(req, res, file);
      }
      send(res, 405, { error: "Not allowed." });
    } catch (e) {
      const msg = (e as Error).message ?? "";
      const known = e instanceof Refused || e instanceof EngineError || e instanceof SpendRefused || e instanceof SoundRefused || e instanceof KieError || /^(Kie\.ai|OpenAI|The picture|What came back|Your Kie|That Windows voice|The Windows voice)/.test(msg);
      send(res, known ? 400 : 500, { error: known ? (e as Error).message : "Something went wrong. Try again." });
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (process.argv[1] && typeof import.meta.url === "string" && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const s = start();
  s.on("listening", () => {
    const a = s.address();
    console.log(`QuickPath is running: http://127.0.0.1:${typeof a === "object" && a ? a.port : ""}`);
  });
}

