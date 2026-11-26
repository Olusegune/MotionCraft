// Kie.ai, the one provider for AI pictures, voices, music and video. Every call is: make a task, wait for it, fetch what it made. This file does that once,
// for all of them, and reports what the task really cost (Kie reports credits; one credit is about $0.005).
// Nothing here runs without a confirmed quote (see ai.ts): this file only talks to Kie.
export const KIE_BASE = "https://api.kie.ai/api/v1";
export const UPLOAD_BASE = "https://kieai.redpandaai.co";
export const USD_PER_CREDIT = 0.005;

export class KieError extends Error {}

type Fetch = typeof fetch;
export type KieOpts = { fetchImpl?: Fetch; base?: string; pollMs?: number; timeoutMs?: number; allowLocalHttp?: boolean };

const header = (key: string) => ({ Authorization: `Bearer ${key}`, "content-type": "application/json" });

/** What Kie says when it refuses, in a sentence a person can act on. Nothing was charged for a refusal. */
export function refusal(code: unknown, msg: unknown): string {
  const c = Number(code), m = String(msg ?? "");
  if (c === 401 || c === 403) return "Kie.ai did not accept the key.";
  if (c === 402) return "Your Kie.ai account is out of credit.";
  if (c === 429) return "Kie.ai says you are asking too fast. Wait a minute and try again.";
  if (c >= 400 && c < 500) return `Kie.ai refused this request, so nothing was charged: ${m || "invalid input"}`;
  return m || "Kie.ai could not start this.";
}

/** The credits left on the account (a free question), or null if it cannot be read. */
export async function balance(key: string, o: KieOpts = {}): Promise<number | null> {
  try {
    const r = await (o.fetchImpl ?? fetch)(`${o.base ?? KIE_BASE}/chat/credit`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { code?: number; data?: unknown };
    const n = Number(j.data);
    return r.ok && (j.code === undefined || j.code === 200) && Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export type Made = { urls: string[]; credits: number | null; tracks?: { url: string; seconds: number | null }[] };

/** Starts a task and waits for it. `model` and `input` are exactly as Kie documents them. */
export async function runTask(model: string, input: Record<string, unknown>, key: string, o: KieOpts = {}): Promise<Made> {
  const f = o.fetchImpl ?? fetch, base = o.base ?? KIE_BASE;
  const made = await f(`${base}/jobs/createTask`, { method: "POST", headers: header(key), signal: AbortSignal.timeout(30_000), body: JSON.stringify({ model, input }) });
  const j = (await made.json().catch(() => ({}))) as { code?: number; msg?: string; data?: { taskId?: string } };
  const task = j.data?.taskId;
  if (!made.ok || (j.code !== undefined && j.code !== 200) || !task) throw new KieError(refusal(made.ok ? j.code : made.status, j.msg));
  const until = Date.now() + (o.timeoutMs ?? 600_000);
  for (;;) {
    await new Promise((r) => setTimeout(r, o.pollMs ?? 3000));
    const r = await f(`${base}/jobs/recordInfo?taskId=${encodeURIComponent(task)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
    const d = ((await r.json().catch(() => ({}))) as { data?: Record<string, any> }).data ?? {};
    const state = String(d.state ?? "");
    if (state === "fail") throw new KieError(String(d.failMsg || "Kie.ai could not make this."));
    if (state === "success") {
      const credits = Number.isFinite(Number(d.creditsConsumed)) && d.creditsConsumed !== null && d.creditsConsumed !== undefined ? Number(d.creditsConsumed) : null;
      const ok = (u: unknown): u is string => typeof u === "string" && (u.startsWith("https://") || (o.allowLocalHttp === true && u.startsWith("http://127.0.0.1")));
      let urls: string[] = [];
      try { urls = ((JSON.parse(String(d.resultJson ?? "{}")) as { resultUrls?: unknown[] }).resultUrls ?? []).filter(ok); } catch { /* the music shape is tried next */ }
      const tracks = (Array.isArray(d.response?.data) ? d.response.data : []).filter((t: any) => ok(t?.audio_url)).map((t: any) => ({ url: t.audio_url as string, seconds: Number.isFinite(Number(t.duration)) ? Number(t.duration) : null }));
      if (!urls.length && tracks.length) urls = tracks.map((t: { url: string }) => t.url);
      if (!urls.length) throw new KieError("Kie.ai finished but sent nothing back.");
      return { urls, credits, tracks };
    }
    if (Date.now() > until) throw new KieError("Kie.ai is taking too long. It may still charge for this: check your Kie.ai usage.");
  }
}

/** Fetches what a task made. Only https addresses, a size limit, and a plain message if anything is off. */
export async function download(url: string, maxBytes: number, o: KieOpts = {}): Promise<Buffer> {
  if (!(url.startsWith("https://") || (o.allowLocalHttp === true && url.startsWith("http://127.0.0.1")))) throw new KieError("Kie.ai sent an address that is not safe to open.");
  const r = await (o.fetchImpl ?? fetch)(url, { signal: AbortSignal.timeout(120_000) });
  const declared = Number(r.headers.get("content-length") ?? 0);
  if (!r.ok || declared > maxBytes) throw new KieError("What Kie.ai made could not be downloaded.");
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > maxBytes) throw new KieError("What Kie.ai made is too large.");
  return b;
}

/** Puts one picture on Kie.ai (kept there for 24 hours) so a video model can start from it. Returns its address. Only used for a picture the person chose to animate. */
export async function uploadPicture(bytes: Buffer, mime: string, fileName: string, key: string, o: KieOpts = {}): Promise<string> {
  if (bytes.length > 10 * 1024 * 1024) throw new KieError("That picture is over 10 MB, the most Kie.ai takes for this.");
  const r = await (o.fetchImpl ?? fetch)(`${o.base ?? UPLOAD_BASE}/api/file-base64-upload`, {
    method: "POST", headers: header(key), signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ base64Data: `data:${mime};base64,${bytes.toString("base64")}`, uploadPath: "quickpath/images", fileName }),
  });
  const j = (await r.json().catch(() => ({}))) as { success?: boolean; msg?: string; data?: { downloadUrl?: string } };
  const url = j.data?.downloadUrl;
  if (!r.ok || !url || !(url.startsWith("https://") || (o.allowLocalHttp === true && url.startsWith("http://127.0.0.1")))) throw new KieError(`Kie.ai could not take the picture: ${j.msg || "no reason given"}`);
  return url;
}

/** What a finished task cost in dollars: Kie's own credit count when it gave one, else the estimate that was quoted. */
export const dollars = (credits: number | null, estimate: number) => (credits !== null && credits >= 0 ? Math.round(credits * USD_PER_CREDIT * 10000) / 10000 : estimate);
