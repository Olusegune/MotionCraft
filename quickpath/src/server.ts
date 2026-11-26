// The local app: a tiny web server on 127.0.0.1 and one page. Nothing leaves the computer except what the person chooses to ask a model.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { EffectCraft, EngineError } from "./ec.ts";
import { buildComposition, renderVideo } from "./build.ts";
import { LOOKS, lookById } from "./looks.ts";
import { clamp, makePlan, type Plan, type Shape } from "./plan.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI = resolve(HERE, "..", "ui");
export const HOME = process.env.QUICKPATH_HOME ?? join(homedir(), "Documents", "QuickPath");
const CANDIDATES = [
  process.env.EFFECTCRAFT_CLI ?? "",
  "C:/Program Files/EffectCraft/effectcraft-cli.exe",
  "/Applications/EffectCraft.app/Contents/MacOS/effectcraft-cli",
  "/usr/local/bin/effectcraft-cli",
].filter(Boolean);
const cliPath = () => CANDIDATES.find((p) => existsSync(p)) ?? "";

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".mp4": "video/mp4", ".svg": "image/svg+xml", ".png": "image/png" };
const SHAPES: Shape[] = ["16:9", "9:16", "1:1"];

class Refused extends Error {}

/** Checks and trims a plan from the page: the page is never trusted. */
export function checkPlan(raw: any): Plan {
  if (!raw || !Array.isArray(raw.scenes) || raw.scenes.length < 1 || raw.scenes.length > 12) throw new Refused("A video needs between 1 and 12 scenes.");
  const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const scenes = raw.scenes.map((s: any) => ({ headline: text(s?.headline, 90), sub: text(s?.sub, 120), seconds: clamp(Number(s?.seconds) || 3, 1.5, 30) }));
  if (scenes.some((s: { headline: string }) => !s.headline)) throw new Refused("Every scene needs some words.");
  const total = scenes.reduce((n: number, s: { seconds: number }) => n + s.seconds, 0);
  if (total > 180) throw new Refused("Keep it under three minutes.");
  return { title: text(raw.title, 60) || scenes[0].headline, look: lookById(raw.look).id, scenes, source: raw.source === "model" ? "model" : "words" };
}

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(job: () => Promise<T>): Promise<T> => { const r = queue.then(job, job); queue = r.catch(() => undefined); return r; };

async function render(planIn: unknown, shapeIn: unknown, quality: "draft" | "final", idIn?: unknown) {
  const cli = cliPath();
  if (!cli) throw new Refused("EffectCraft was not found. Install EffectCraft 0.24.1, or set EFFECTCRAFT_CLI to its effectcraft-cli program.");
  const plan = checkPlan(planIn);
  const shape: Shape = SHAPES.includes(shapeIn as Shape) ? (shapeIn as Shape) : "16:9";
  const id = typeof idIn === "string" && /^[a-f0-9]{12}$/.test(idIn) ? idIn : randomBytes(6).toString("hex");
  const dir = join(HOME, "projects", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plan.json"), JSON.stringify({ plan, shape }, null, 2));
  const ec = new EffectCraft(cli, [dir]);
  try {
    await ec.start();
    const built = await buildComposition(ec, plan, shape, dir);
    const file = quality === "draft" ? "draft.mp4" : `final-${Date.now()}.mp4`;
    const frames = await renderVideo(ec, built.comp, join(dir, file), quality);
    return { id, file, url: `/media/${id}/${file}`, frames, seconds: built.total, path: join(dir, file) };
  } finally { ec.stop(); }
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  const data = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" });
  res.end(data);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += (c as Buffer).length; if (size > 64 * 1024) throw new Refused("That request is too big."); chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}"); } catch { throw new Refused("That request was not understood."); }
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
  res.writeHead(200, { "content-type": type, "content-length": st.size, "accept-ranges": "bytes", "cache-control": type === "video/mp4" ? "no-store" : "no-cache", "x-content-type-options": "nosniff" });
  createReadStream(file).pipe(res);
}

function openFolder(path: string) {
  const [cmd, args] = process.platform === "win32" ? ["explorer.exe", ["/select,", path]] : process.platform === "darwin" ? ["open", ["-R", path]] : ["xdg-open", [resolve(path, "..")]];
  try { spawn(cmd as string, args as string[], { shell: false, detached: true, stdio: "ignore" }).unref(); } catch { /* the person can still find it from the path shown */ }
}

export function start(port = Number(process.env.PORT ?? 4177)) {
  mkdirSync(join(HOME, "projects"), { recursive: true });
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
        return send(res, 200, { engine: !!cliPath(), looks: LOOKS.map((l) => ({ id: l.id, name: l.name, bg: l.bg, text: l.text, accent: l.accent })), home: HOME });
      }
      if (req.method === "POST" && url.pathname === "/api/plan") {
        const b = await readJson(req);
        const idea = String(b.idea ?? "").trim().slice(0, 3000);
        if (idea.length < 3) throw new Refused("Tell me a little about your video first.");
        return send(res, 200, await makePlan(idea, Number(b.seconds) || 15));
      }
      if (req.method === "POST" && url.pathname === "/api/render") {
        const b = await readJson(req);
        const out = await serial(() => render(b.plan, b.shape, b.quality === "final" ? "final" : "draft", b.id));
        return send(res, 200, out);
      }
      if (req.method === "POST" && url.pathname === "/api/reveal") {
        const b = await readJson(req);
        const m = /^\/media\/([a-f0-9]{12})\/([\w.-]+\.mp4)$/.exec(String(b.url ?? ""));
        if (!m) throw new Refused("Nothing to show.");
        openFolder(join(HOME, "projects", m[1], m[2]));
        return send(res, 200, { ok: true });
      }
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
      const known = e instanceof Refused || e instanceof EngineError;
      send(res, known ? 400 : 500, { error: known ? (e as Error).message : "Something went wrong. Try again." });
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const s = start();
  s.on("listening", () => {
    const a = s.address();
    console.log(`QuickPath is running: http://127.0.0.1:${typeof a === "object" && a ? a.port : ""}`);
  });
}

