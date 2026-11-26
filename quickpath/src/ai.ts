// Paid AI through official or opt-in providers. Nothing is sent until the person confirms a quote: a quote is one-time, expires, and is tied to
// the exact words and project it was made for. A spend ledger caps the total.
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Shape } from "./plan.ts";
import { imageInfo, MAX_PICTURE_BYTES, type ImageInfo } from "./images.ts";

export const MODEL = "google/imagen4-fast";
export const PROVIDER = "Kie.ai";
/** Kie.ai does not publish a price through its API, so this is an estimate, and the confirmation says so. */
export const ESTIMATE_USD = 0.02;
export const QUOTE_SECONDS = 300;
export const NO_LETTERING = "A purely visual still image with no lettering, words, numbers, symbols, logos or watermarks anywhere in it.";
// Imagen 4 Fast offers 1:1, 16:9, 9:16, 3:4 and 4:3. For 21:9 a 16:9 picture is made and the sides are trimmed to fill the frame; for 4:5, a 3:4 one.
export const ASPECT: Record<Shape, string> = { "16:9": "16:9", "9:16": "9:16", "1:1": "1:1", "4:5": "3:4", "21:9": "16:9", "4:3": "4:3" };

export class SpendRefused extends Error {}

export type Offer = { provider: string; model: string; usd: number; note: string; what: string };
export type Quote = { token: string; provider: string; model: string; estimateUsd: number; note: string; prompt: string; what: string; spentUsd: number; capUsd: number };

type Held = { project: string; prompt: string; shape: Shape; expires: number; offer: Offer };

const PICTURE_OFFER: Offer = { provider: PROVIDER, model: MODEL, usd: ESTIMATE_USD, note: "An estimate: Kie.ai does not publish an exact price.", what: "one picture" };

export class Spend {
  private held = new Map<string, Held>();
  private ledger: string;
  private capNow: () => number;
  private now: () => number;

  constructor(ledger: string, capUsd: number | (() => number) = Number(process.env.QUICKPATH_SPEND_CAP_USD ?? 5), now: () => number = Date.now) {
    this.ledger = ledger; this.capNow = typeof capUsd === "function" ? capUsd : () => capUsd; this.now = now;
  }

  spent(): number {
    if (!existsSync(this.ledger)) return 0;
    let n = 0;
    for (const line of readFileSync(this.ledger, "utf-8").split("\n")) {
      try { n += Number(JSON.parse(line).usd) || 0; } catch { /* a half-written line counts for nothing */ }
    }
    return Math.round(n * 1000) / 1000;
  }

  /** Makes a quote the person must confirm. Refused when the cap would be passed. */
  quote(project: string, prompt: string, shape: Shape, offer: Offer = PICTURE_OFFER): Quote {
    const spentUsd = this.spent(), cap = this.capNow();
    if (spentUsd + offer.usd > cap) throw new SpendRefused(`This would pass your spending limit of $${cap.toFixed(2)} (about $${spentUsd.toFixed(2)} used so far). You can change the limit in Settings.`);
    const token = randomBytes(16).toString("hex");
    for (const [k, v] of this.held) if (v.expires < this.now()) this.held.delete(k);
    this.held.set(token, { project, prompt, shape, expires: this.now() + QUOTE_SECONDS * 1000, offer });
    return { token, provider: offer.provider, model: offer.model, estimateUsd: offer.usd, note: offer.note, prompt, what: offer.what, spentUsd, capUsd: cap };
  }

  /** Uses the quote up. It works once, for the project and prompt it was made for, before it expires. */
  redeem(token: string, project: string, prompt: string): Held {
    const h = this.held.get(token);
    this.held.delete(token);
    if (!h || h.expires < this.now()) throw new SpendRefused("That confirmation has run out. Ask again.");
    if (h.project !== project || h.prompt !== prompt) throw new SpendRefused("That confirmation was for something else.");
    return h;
  }

  record(project: string, usd: number, what: string, offer: Offer = PICTURE_OFFER): void {
    mkdirSync(dirname(this.ledger), { recursive: true });
    appendFileSync(this.ledger, JSON.stringify({ at: new Date(this.now()).toISOString(), project, usd, what, provider: offer.provider, model: offer.model }) + "\n");
  }
}

/** The prompt for a scene: the look of the piece, what the scene says, and an explicit ban on lettering. */
export function picturePrompt(headline: string, sub: string, idea: string, shape: Shape): string {
  const orient = { "16:9": "wide", "9:16": "vertical", "1:1": "square", "4:5": "portrait", "21:9": "ultra-wide cinematic", "4:3": "classic" }[shape];
  const keep = shape === "21:9" || shape === "4:5" ? " Keep the main subject in the middle of the frame: the edges will be trimmed." : "";
  const about = idea.replace(/\s+/g, " ").trim().slice(0, 200).replace(/[\s.!?,;:]+$/, "");        // no doubled full stops where the idea already ends in one
  const scene = `${headline.slice(0, 90).replace(/[\s.!?,;:]+$/, "")}${sub ? ` (${sub.slice(0, 90).replace(/[\s.!?,;:]+$/, "")})` : ""}`;
  return `${NO_LETTERING} A ${orient}, cinematic, softly lit photograph that suits this moment of a short video: ${scene}. ${about ? `The video is about: ${about}.` : ""} Generous empty space in the middle for text.${keep}`.slice(0, 700);
}

type Fetch = typeof fetch;

/** Makes one picture and returns its bytes. `fetchImpl` and `base` are for tests; polling stops after `timeoutMs`. */
export async function generatePicture(prompt: string, shape: Shape, key: string, opts: { fetchImpl?: Fetch; base?: string; pollMs?: number; timeoutMs?: number; allowLocalHttp?: boolean } = {}): Promise<{ bytes: Buffer; info: ImageInfo }> {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.base ?? "https://api.kie.ai/api/v1";
  const headers = { Authorization: `Bearer ${key}`, "content-type": "application/json" };
  const made = await f(`${base}/jobs/createTask`, { method: "POST", headers, signal: AbortSignal.timeout(30_000), body: JSON.stringify({ model: MODEL, input: { prompt, negative_prompt: "text, letters, words, numbers, logo, watermark, caption", aspect_ratio: ASPECT[shape], num_images: 1 } }) });
  const j = (await made.json().catch(() => ({}))) as { code?: number; msg?: string; data?: { taskId?: string } };
  const task = j.data?.taskId;
  if (!made.ok || (j.code !== undefined && j.code !== 200) || !task) {
    const refused = typeof j.code === "number" && j.code >= 400 && j.code < 500 && ![401, 402, 403, 429].includes(j.code);
    throw new Error(refused ? `Kie.ai refused this request, so nothing was charged: ${j.msg || "invalid input"}` : j.code === 401 || j.code === 403 ? "Kie.ai did not accept the key." : j.code === 402 ? "Your Kie.ai account is out of credit." : j.msg || "Kie.ai did not start the picture.");
  }
  const until = Date.now() + (opts.timeoutMs ?? 120_000);
  for (;;) {
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
    const r = await f(`${base}/jobs/recordInfo?taskId=${encodeURIComponent(task)}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
    const d = ((await r.json().catch(() => ({}))) as { data?: { state?: string; resultJson?: string; failMsg?: string } }).data ?? {};
    if (d.state === "fail") throw new Error(d.failMsg || "Kie.ai could not make this picture.");
    if (d.state === "success") {
      let urls: unknown[] = [];
      try { urls = (JSON.parse(d.resultJson ?? "{}") as { resultUrls?: unknown[] }).resultUrls ?? []; } catch { /* handled below */ }
      const url = urls.find((u): u is string => typeof u === "string" && (u.startsWith("https://") || (opts.allowLocalHttp === true && u.startsWith("http://127.0.0.1"))));
      if (!url) throw new Error("Kie.ai finished but sent no picture.");
      const img = await f(url, { signal: AbortSignal.timeout(60_000) });
      const declared = Number(img.headers.get("content-length") ?? 0);
      if (!img.ok || declared > MAX_PICTURE_BYTES) throw new Error("The picture could not be downloaded.");
      const bytes = Buffer.from(await img.arrayBuffer());
      const info = bytes.length <= MAX_PICTURE_BYTES ? imageInfo(bytes) : null;
      if (!info) throw new Error("What came back was not a usable picture.");
      return { bytes, info };
    }
    if (Date.now() > until) throw new Error("Kie.ai is taking too long. It may still charge for this picture: check your Kie.ai usage.");
  }
}
