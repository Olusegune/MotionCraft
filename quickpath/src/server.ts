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
import { clamp, makePlan, pickModel, type Plan, type Shape } from "./plan.ts";
import { imageInfo, MAX_PICTURE_BYTES, MEDIA_NAME } from "./images.ts";
import { looksLikeMp4, MAX_CLIP_BYTES, mp4Info } from "./mp4.ts";
import { generatePicture, picturePrompt, Spend, SpendRefused } from "./ai.ts";
import { canSaveKeys, keyStatus, kieKey, PROVIDERS, providerKey, removeKey, saveKey, type Provider } from "./keys.ts";
import { effectiveCap, saveCap } from "./settings.ts";
import { MOODS } from "./music.ts";
import { resolveSound, SoundRefused, type Level } from "./sound.ts";
import { makeOpenAILines, openAIMissing, OPENAI_VOICES, spokenText, VOICE_CHOICE, windowsVoices } from "./voice.ts";
import { audioKind, AUDIO_NAME, MAX_AUDIO_BYTES, wavInfo } from "./wav.ts";

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

const MIME: Record<string, string> = { ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".png": "image/png" };
const SHAPES: Shape[] = ["16:9", "9:16", "1:1"];

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

/** Checks and trims a plan from the page: the page is never trusted. */
export function checkPlan(raw: any): Plan {
  if (!raw || !Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > 12) throw new Refused("A video needs between 1 and 12 scenes.");
  const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const scenes = raw.scenes.map((s: any) => ({ headline: text(s?.headline, 90), sub: text(s?.sub, 120), seconds: clamp(Number(s?.seconds) || 3, 1.5, 30), ...(typeof s?.picture === "string" && MEDIA_NAME.test(s.picture) ? { picture: s.picture } : {}), ...(typeof s?.say === "string" && s.say.trim() ? { say: text(s.say, 600) } : {}) }));
  if (scenes.some((s: { headline: string }) => !s.headline)) throw new Refused("Every scene needs some words.");
  const total = scenes.reduce((n: number, s: { seconds: number }) => n + s.seconds, 0);
  if (total > 180) throw new Refused("Keep it under three minutes.");
  const voice = typeof raw.voice === "string" && VOICE_CHOICE.test(raw.voice) ? raw.voice : undefined;
  const m = raw.music;
  const level: Level = m?.level === "soft" || m?.level === "loud" ? m.level : "medium";
  const music = m && typeof m.file === "string" && AUDIO_NAME.test(m.file) ? { file: m.file, level } : m && typeof m.mood === "string" && MOODS.some((x) => x.id === m.mood) ? { mood: m.mood, level } : undefined;
  return { title: text(raw.title, 60) || scenes[0].headline, look: lookById(raw.look).id, scenes, source: raw.source === "model" ? "model" : "words", ...(voice ? { voice } : {}), ...(music ? { music } : {}) };
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
        return send(res, 200, { recycles: process.platform === "win32" && process.env.QUICKPATH_DELETE !== "permanent", engine: !!cliPath(), voices: await windowsVoices(), openaiVoices: (await providerKey("openai")) ? [...OPENAI_VOICES] : [], moods: MOODS, looks: LOOKS.map((l) => ({ id: l.id, name: l.name, bg: l.bg, text: l.text, accent: l.accent })), home: HOME });
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
        try { await saveKey(p, String(b.key ?? "")); } catch (e) { throw new Refused((e as Error).message); }
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
        const id = String(b.id ?? "");
        if (!/^[a-f0-9]{12}$/.test(id) || !existsSync(join(HOME, "projects", id))) throw new Refused("Make your video first.");
        const plan = checkPlan(b.plan);
        if (!plan.voice?.startsWith("openai:")) return send(res, 200, { needed: false });
        const texts = plan.scenes.map((x) => spokenText(x));
        const miss = openAIMissing(join(HOME, "projects", id), plan.voice, texts);
        if (miss.chars === 0) return send(res, 200, { needed: false });
        if (!(await providerKey("openai"))) throw new Refused("No OpenAI key was found. Save one in Windows Credential Manager as QuickPath/openai, or set OPENAI_API_KEY, and try again.");
        const offer = { provider: "OpenAI", model: "tts-1 voice " + plan.voice.slice(7), usd: Math.max(0.001, miss.usd), note: "Priced by OpenAI at $15 per million characters.", what: `${miss.chars} characters of speech` };
        return send(res, 200, { needed: true, ...spend.quote(id, texts.join("|"), "16:9", offer) });
      }
      if (req.method === "POST" && url.pathname === "/api/voice/make") {
        const b = await readJson(req);
        const id = String(b.id ?? "");
        if (!/^[a-f0-9]{12}$/.test(id) || !existsSync(join(HOME, "projects", id))) throw new Refused("Make your video first.");
        const plan = checkPlan(b.plan);
        if (!plan.voice?.startsWith("openai:")) throw new Refused("Only OpenAI voices need to be made first.");
        const texts = plan.scenes.map((x) => spokenText(x));
        const held = spend.redeem(String(b.token ?? ""), id, texts.join("|"));
        const key = await providerKey("openai");
        if (!key) throw new Refused("No OpenAI key was found.");
        const made = await makeOpenAILines(join(HOME, "projects", id), plan.voice, texts, key, { base: process.env.QUICKPATH_OPENAI_BASE });
        spend.record(id, held.offer.usd, `${made} spoken lines`, held.offer);
        return send(res, 200, { made, spentUsd: spend.spent() });
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
      const known = e instanceof Refused || e instanceof EngineError || e instanceof SpendRefused || e instanceof SoundRefused || /^(Kie\.ai|OpenAI|The picture|What came back|Your Kie|That Windows voice|The Windows voice)/.test(msg);
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

