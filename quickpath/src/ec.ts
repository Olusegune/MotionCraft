// A small client for EffectCraft: `effectcraft-cli mcp` over stdio, JSON-RPC one message per line. No shell is ever used.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export const PINNED = "0.24.1";
const ENV_KEEP = new Set(["PATH", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "HOME", "WINDIR", "COMSPEC", "PATHEXT"]);

export class EngineError extends Error {}

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

export class EffectCraft {
  private p: ChildProcessWithoutNullStreams | null = null;
  private n = 0;
  private pending = new Map<number, Pending>();
  private err: string[] = [];

  private cli: string;
  private roots: string[];

  constructor(cli: string, roots: string[]) {
    if (!roots.length) throw new EngineError("The engine is always confined to a folder.");
    this.cli = cli;
    this.roots = roots;
  }

  /** Starts the engine, confined to the project folder. Throws a plain sentence if it is missing or the wrong version. */
  async start(): Promise<void> {
    const v = await this.version();
    if (v !== PINNED) throw new EngineError(`QuickPath needs EffectCraft ${PINNED}; found ${v || "nothing"}.`);
    const args = ["mcp"];
    for (const r of this.roots) args.push("--automation-read-root", r, "--automation-write-root", r);
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => ENV_KEEP.has(k.toUpperCase()))) as NodeJS.ProcessEnv;
    this.p = spawn(this.cli, args, { env, shell: false, windowsHide: true });
    createInterface({ input: this.p.stdout }).on("line", (line) => {
      let m: any;
      try { m = JSON.parse(line); } catch { return; }
      const w = this.pending.get(m.id);
      if (!w) return;
      this.pending.delete(m.id);
      if (m.error) w.reject(new EngineError(m.error.message ?? "engine error")); else w.resolve(m.result);
    });
    createInterface({ input: this.p.stderr }).on("line", (l) => { this.err.push(l); if (this.err.length > 20) this.err.shift(); });
    this.p.on("exit", () => { for (const w of this.pending.values()) w.reject(new EngineError(`EffectCraft stopped: ${this.err.slice(-2).join(" ")}`)); this.pending.clear(); this.p = null; });
    await this.rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "quickpath", version: "0" } });
    this.p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  }

  private version(): Promise<string> {
    return new Promise((res) => {
      const p = spawn(this.cli, ["--version"], { shell: false, windowsHide: true });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.on("error", () => res(""));
      p.on("close", () => res(/\d+\.\d+\.\d+/.exec(out)?.[0] ?? ""));
    });
  }

  private rpc(method: string, params: unknown): Promise<any> {
    if (!this.p) return Promise.reject(new EngineError("EffectCraft is not running."));
    const id = ++this.n;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.p!.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  /** Runs one EffectCraft command (the same ids as its own automation: comp.new, layer.newText, prop.addKey ...). */
  async run<T = any>(id: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await this.rpc("tools/call", { name: "command_run", arguments: { id, params } });
    const text = (res.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    let val: any = text;
    try { val = text ? JSON.parse(text) : null; } catch { /* plain text answer */ }
    if (res.isError) throw new EngineError(typeof val === "string" ? val : JSON.stringify(val));
    return val as T;
  }

  /** A still of the composition at one time, as PNG bytes (EffectCraft's own render_preview tool). */
  async still(comp: number, time: number, maxSide = 960): Promise<Buffer> {
    const res = await this.rpc("tools/call", { name: "render_preview", arguments: { comp, time, max_side: maxSide } });
    const img = (res.content ?? []).find((c: any) => c.type === "image");
    if (!img) throw new EngineError("EffectCraft returned no picture.");
    return Buffer.from(img.data, "base64");
  }

  stop(): void { try { this.p?.stdin.end(); this.p?.kill(); } catch { /* already gone */ } }
}
