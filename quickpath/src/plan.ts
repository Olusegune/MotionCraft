// From an idea to scenes. A local model (Ollama) writes them when one is running; otherwise the idea's own words are used.
// Nothing here needs a key or the network beyond 127.0.0.1.
import { LOOKS, suggestLook, lookById } from "./looks.ts";

export type Scene = { headline: string; sub: string; seconds: number; picture?: string };
export type Plan = { title: string; look: string; scenes: Scene[]; source: "model" | "words" };
export type Shape = "16:9" | "9:16" | "1:1";

export const SIZES: Record<Shape, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 }, "9:16": { width: 1080, height: 1920 }, "1:1": { width: 1080, height: 1080 },
};

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** How many scenes suit a length: about one every four seconds, between 2 and 8. */
export const sceneCount = (seconds: number) => clamp(Math.round(seconds / 4), 2, 8);

const tidy = (s: unknown, max: number) => String(s ?? "").replace(/\s+/g, " ").replace(/^["'\s]+|["'\s]+$/g, "").slice(0, max).trim();

/** Spreads the total length over the scenes: each at least 2 s, the sum as close to `seconds` as that allows. */
export function spread(count: number, seconds: number): number[] {
  const each = Math.max(2, Math.round((seconds / count) * 10) / 10);
  const out = Array<number>(count).fill(each);
  out[count - 1] = Math.max(2, Math.round((seconds - each * (count - 1)) * 10) / 10);
  return out;
}

/** The scenes from the idea's own words: its sentences, then its clauses, merged or split to the wanted number. */
export function planFromWords(idea: string, seconds: number): Plan {
  const n = sceneCount(seconds);
  let parts = idea.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < n) {
    parts = parts.flatMap((p) => (p.length > 50 ? p.split(/,\s+|;\s+|\s+(?:and|but|then)\s+/i) : [p])).map((x) => x.trim()).filter((x) => x.length > 1);
  }
  while (parts.length > n) {                       // merge the two shortest neighbours
    let k = 0, best = Infinity;
    for (let i = 0; i < parts.length - 1; i++) {
      const l = parts[i].length + parts[i + 1].length;
      if (l < best) { best = l; k = i; }
    }
    parts.splice(k, 2, `${parts[k]} ${parts[k + 1]}`);
  }
  if (!parts.length) parts = [tidy(idea, 60) || "Your idea"];
  const secs = spread(parts.length, seconds);
  const scenes = parts.map((p, i) => {
    const clean = p.replace(/[.!?]+$/g, "");
    const words = clean.split(" ");
    const headline = tidy(words.length > 8 ? words.slice(0, 8).join(" ") : clean, 70);
    return { headline, sub: words.length > 8 ? tidy(words.slice(8).join(" "), 90) : "", seconds: secs[i] };
  });
  return { title: tidy(parts[0], 40), look: suggestLook(idea).id, scenes, source: "words" };
}

/** Validates what a model said into a plan, or null. Never trusts the shape. */
export function cleanModelPlan(raw: unknown, seconds: number): Plan | null {
  const o = raw as { title?: unknown; look?: unknown; scenes?: unknown } | null;
  if (!o || !Array.isArray(o.scenes)) return null;
  const scenes = o.scenes.slice(0, 8)
    .map((s: any) => ({ headline: tidy(s?.headline ?? s?.text, 70), sub: tidy(s?.sub ?? s?.subtitle, 90) }))
    .filter((s) => s.headline);
  if (scenes.length < 2) return null;
  const secs = spread(scenes.length, seconds);
  const look = LOOKS.some((l) => l.id === o.look) ? String(o.look) : "";
  return { title: tidy(o.title, 40) || scenes[0].headline, look, scenes: scenes.map((s, i) => ({ ...s, seconds: secs[i] })), source: "model" };
}

async function pickModel(base: string): Promise<string | null> {
  try {
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    const names: string[] = ((await r.json()) as { models?: { name: string }[] }).models?.map((m) => m.name) ?? [];
    const text = names.filter((n) => !/vl|vision|embed|llava/i.test(n));
    return text.find((n) => /qwen3|llama3|mistral|gemma|phi/i.test(n)) ?? text[0] ?? null;
  } catch { return null; }
}

/** Asks a local model for the scenes. Resolves to null on any trouble (not running, slow, odd answer): the caller then uses the words. */
export async function planWithModel(idea: string, seconds: number, base = "http://127.0.0.1:11434", timeoutMs = 45_000): Promise<Plan | null> {
  const model = await pickModel(base);
  if (!model) return null;
  const n = sceneCount(seconds);
  const prompt = `Write the on-screen text for a ${seconds} second video about this idea:\n"${idea.slice(0, 1500)}"\n\n`
    + `Reply with ONLY a JSON object: {"title": short title, "look": one of ${LOOKS.map((l) => l.id).join("|")}, "scenes": [exactly ${n} items {"headline": at most 8 words, "sub": at most 14 words or empty}]}. `
    + "The scenes tell the idea in order: a hook first, a clear closing line last. Plain words, no emoji, no quotes inside text.";
  try {
    const r = await fetch(`${base}/v1/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" }, reasoning_effort: "none", temperature: 0.7 }),
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    const text = (j.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start < 0 || end < start) return null;
    return cleanModelPlan(JSON.parse(text.slice(start, end + 1)), seconds);
  } catch { return null; }
}

/** The plan for an idea: the model's when there is one, else the idea's own words. Always returns something. */
export async function makePlan(idea: string, seconds: number, ollama?: string): Promise<Plan> {
  const secs = clamp(Math.round(seconds), 6, 120);
  const p = (await planWithModel(idea, secs, ollama)) ?? planFromWords(idea, secs);
  if (!p.look) p.look = suggestLook(idea).id;
  p.look = lookById(p.look).id;
  return p;
}
