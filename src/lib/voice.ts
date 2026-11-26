import type { Beat, MotionProject } from "../types";
import { parseTimedScript } from "./briefParse";

/** A voice model the helper offers (official providers only: OpenAI and Google). */
export interface VoiceModel { provider: "openai" | "google"; model: string; name: string; voices: string[]; instructions: boolean }

export interface VoiceSettings { model: string; voice: string; text: string; delivery: string; speed: number; assetId?: string; placed?: boolean }

const PACE = ["a very slow, hushed pace", "a slow, unhurried pace", "a calm, steady pace", "a lively pace", "a fast, driving pace"];
const INTENSITY = ["", "barely there", "subtle", "clear", "strong", "overwhelming"];

/** The voiceover line the script gives this scene (the Voiceover or Audio column), without its quotation marks. Empty when the script has none. */
export function voiceLineFor(p: Pick<MotionProject, "brief">, b: Pick<Beat, "startSec" | "endSec">): string {
  const dur = p.brief.deliverables[0]?.durationSec;
  const segs = parseTimedScript(`${p.brief.text}\n${p.brief.script ?? ""}`, dur);
  const mid = (b.startSec + b.endSec) / 2;
  const seg = segs.find((s) => mid >= s.start && mid < s.end);
  return (seg?.audio ?? "").replace(/^[“"'‘]+|[”"'’]+$/g, "").trim();
}

/** How to say it, from the scene's feeling and energy: the delivery note a steerable voice model follows. */
export function deliveryFor(b: Pick<Beat, "primary" | "secondary" | "intensity" | "energy">): string {
  const feeling = [b.primary, b.secondary].filter(Boolean).join(" and ");
  return `Narrate with ${feeling || "quiet attention"} (${INTENSITY[b.intensity] ?? "clear"}), at ${PACE[b.energy - 1] ?? PACE[2]}. Natural and human, not theatrical. Leave small pauses at commas and full stops.`;
}

export function defaultVoice(p: MotionProject, b: Beat, models: VoiceModel[]): VoiceSettings {
  const saved = p.treatment[b.beatId]?.voice;
  if (saved) return saved;
  const m = models[0];
  return { model: m ? `${m.provider}/${m.model}` : "", voice: m?.voices[0] ?? "", text: voiceLineFor(p, b), delivery: deliveryFor(b), speed: 1 };
}

/** Voiceovers made for scenes and not yet in the composition: the file and the second it starts (its scene's start). */
export function voiceItems(p: MotionProject): { rel: string; t_in: number; beatId: string }[] {
  return p.intent.arc.flatMap((b) => {
    const v = p.treatment[b.beatId]?.voice;
    const a = v?.assetId ? (p.assets ?? []).find((x) => x.id === v.assetId && x.kind === "audio") : undefined;
    return a && !v?.placed ? [{ rel: a.path, t_in: b.startSec, beatId: b.beatId }] : [];
  }).slice(0, 40);
}

/** Voice models whose provider has a key, the steerable ones first. */
export function voiceChoices(models: VoiceModel[], keys: Record<string, boolean>): VoiceModel[] {
  return models.filter((m) => keys[m.provider]).sort((a, b) => Number(b.instructions) - Number(a.instructions) || a.name.localeCompare(b.name));
}
