/**
 * Turning what a video model can do (its schema) and what the person chose into the request: the settings to send and the project files to give it.
 * Pure, so it is tested without a provider. The schema comes from the provider's own published page (see engine/providers/schema.py).
 */
export interface SchemaField {
  name: string; role: string; type: string; required: boolean; description: string;
  enum?: (string | number | boolean)[]; default?: string | number | boolean; min?: number; max?: number; maxItems?: number; list?: boolean;
}
export interface Caps {
  text: boolean; imageFirst: boolean; imageLast: boolean; imageRefs: number; videoRefs: number; audioRefs: number; soundOut: boolean; negativePrompt: boolean; seed: boolean;
  aspects: (string | number)[]; resolutions: (string | number)[]; durations: { values?: (string | number)[]; min?: number; max?: number; default?: string | number; type?: string };
}
export interface ModelSchema { provider: string; model: string; fields: SchemaField[]; caps: Caps }

export interface RequestChoices {
  aspect?: string; resolution?: string; duration?: number; sound?: boolean; negative?: string; seed?: number;
  firstFrame?: string; lastFrame?: string; refImages?: string[]; refVideos?: string[]; refAudios?: string[];
}
export interface Request { params: Record<string, string | number | boolean>; files: Record<string, { paths: string[]; list: boolean }> }

const ratio = (s: string): number | null => { const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s); return m ? Number(m[1]) / Number(m[2]) : null; };

/** The aspect ratio of those a model offers that is closest to the film's: an exact match, else the nearest by shape (never "auto" while a real ratio is offered). */
export function chooseAspect(offered: (string | number)[], film: string): string | undefined {
  const list = offered.map(String);
  if (!list.length) return undefined;
  if (list.includes(film)) return film;
  const want = ratio(film);
  const numeric = list.map((a) => ({ a, r: ratio(a) })).filter((x): x is { a: string; r: number } => x.r !== null);
  if (want !== null && numeric.length) return numeric.reduce((best, x) => (Math.abs(Math.log(x.r / want)) < Math.abs(Math.log(best.r / want)) ? x : best)).a;
  return list.find((a) => /^(auto|adaptive)$/.test(a)) ?? list[0];
}

/** The lengths to offer: the listed ones, or every whole second between the limits (at most 16). Empty: the model has no length setting. */
export function durationChoices(c: Caps["durations"]): number[] {
  const parse = (v: string | number) => parseInt(String(v), 10);
  if (c.values?.length) return c.values.map(parse).filter((n) => Number.isFinite(n) && n > 0);
  if (typeof c.min === "number" && typeof c.max === "number") {
    const out: number[] = [];
    for (let n = Math.ceil(c.min); n <= c.max && out.length < 16; n++) out.push(n);
    return out;
  }
  return [];
}

/** A length in the form the model's own field wants: "8s" when its values end in s, "8" for text numbers, 8 for a number. */
export function formatDuration(field: SchemaField | undefined, seconds: number): string | number {
  const sample = field?.enum?.[0] ?? field?.default;
  if (typeof sample === "string") return /s$/i.test(sample) ? `${seconds}s` : String(seconds);
  return seconds;
}

/** The closest length the model offers to what was asked. */
export function nearestDuration(offered: number[], want: number): number | undefined {
  return offered.length ? offered.reduce((b, n) => (Math.abs(n - want) < Math.abs(b - want) ? n : b)) : undefined;
}

export function buildRequest(schema: ModelSchema, c: RequestChoices, film: string): Request {
  const params: Request["params"] = {};
  const files: Request["files"] = {};
  const by = (role: string) => schema.fields.find((f) => f.role === role);
  const put = (role: string, paths: string[] | undefined, max?: number) => {
    const f = by(role);
    if (!f || !paths?.length) return;
    files[f.name] = { paths: paths.slice(0, max ?? f.maxItems ?? 12), list: !!f.list };
  };
  put("image_first", c.firstFrame ? [c.firstFrame] : undefined);
  put("image_last", c.lastFrame ? [c.lastFrame] : undefined);
  put("image_refs", c.refImages);
  put("video_refs", c.refVideos);
  put("audio_refs", c.refAudios);
  const asp = by("aspect_ratio");
  if (asp) { const a = c.aspect ?? chooseAspect(schema.caps.aspects, film); if (a) params[asp.name] = a; }
  const res = by("resolution");
  if (res && c.resolution && (!res.enum || res.enum.map(String).includes(c.resolution))) params[res.name] = c.resolution;
  const dur = by("duration");
  if (dur && typeof c.duration === "number") {
    const offered = durationChoices(schema.caps.durations);
    const secs = nearestDuration(offered, c.duration) ?? c.duration;
    params[dur.name] = formatDuration(dur, secs);
  }
  const snd = by("sound");
  if (snd && typeof c.sound === "boolean") params[snd.name] = c.sound;
  const neg = by("negative_prompt");
  if (neg && c.negative?.trim()) params[neg.name] = c.negative.trim().slice(0, 190);
  const seed = by("seed");
  if (seed && typeof c.seed === "number") params[seed.name] = c.seed;
  return { params, files };
}
