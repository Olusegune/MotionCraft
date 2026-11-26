// The sound of a plan: which voice line goes with which scene, how long each scene must be to fit its voice, and which music plays under it all.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeMusic, MOODS } from "./music.ts";
import type { Plan } from "./plan.ts";
import { lineFor, spokenText, VOICE_CHOICE } from "./voice.ts";
import { AUDIO_NAME } from "./wav.ts";

export type Level = "soft" | "medium" | "loud";
export const LEVEL_DB: Record<Level, number> = { soft: -22, medium: -16, loud: -10 };
export const DUCK_DB = 8;                       // how far music dips under a voice
export const VOICE_LEAD = 0.35;                 // a voice starts a little after its scene does
export const VOICE_TAIL = 0.6;                  // and the scene holds a little after it ends

export class SoundRefused extends Error {}

export type VoiceCue = { file: string; start: number; seconds: number };
export type MusicCue = { file: string; db: number; seconds?: number };
export type Sound = { voices: (VoiceCue | null)[]; music: MusicCue | null };

/** Resolves the plan's sound. Scenes are lengthened (never shortened) to fit their voice; the returned plan carries the new lengths. */
export async function resolveSound(dir: string, planIn: Plan): Promise<{ plan: Plan; sound: Sound }> {
  const plan: Plan = { ...planIn, scenes: planIn.scenes.map((s) => ({ ...s })) };
  const voice = plan.voice && VOICE_CHOICE.test(plan.voice) ? plan.voice : "";
  const lines: (Awaited<ReturnType<typeof lineFor>>)[] = [];
  for (const s of plan.scenes) {
    const line = voice ? await lineFor(dir, voice, spokenText(s)) : null;
    if (voice && !line && (voice.startsWith("openai:") || voice.startsWith("kie:"))) throw new SoundRefused("Make the voiceover first: that voice has not been made yet, and it needs your confirmation.");
    lines.push(line);
    if (line) s.seconds = Math.max(s.seconds, Math.ceil((VOICE_LEAD + line.info.seconds + VOICE_TAIL) * 10) / 10);
  }
  let t = 0;
  const voices = plan.scenes.map((s, i) => {
    const start = Math.round((t + VOICE_LEAD) * 100) / 100;
    t += s.seconds;
    const l = lines[i];
    return l ? { file: l.file, start, seconds: l.info.seconds } : null;
  });
  const total = Math.round(t * 10) / 10;
  let music: MusicCue | null = null;
  const m = plan.music;
  if (m?.file && AUDIO_NAME.test(m.file) && existsSync(join(dir, "assets", "audio", m.file))) {
    music = { file: m.file, db: LEVEL_DB[m.level ?? "medium"] };
  } else if (m?.mood && MOODS.some((x) => x.id === m.mood)) {
    const secs = Math.ceil(total) + 1;
    const file = createHash("sha1").update(`music\0${m.mood}\0${secs}`).digest("hex").slice(0, 12) + ".wav";
    const path = join(dir, "assets", "audio", file);
    if (!existsSync(path)) { mkdirSync(join(dir, "assets", "audio"), { recursive: true }); writeFileSync(path, makeMusic(m.mood, secs)); }
    music = { file, db: LEVEL_DB[m.level ?? "medium"] };
  }
  return { plan, sound: { voices, music } };
}

/** The music level keys: fade in, dip under each voice, fade out. Times strictly increase; levels are decibels. */
export function musicKeys(total: number, base: number, voices: (VoiceCue | null)[]): [number, number][] {
  const duck = base - DUCK_DB;
  const levelAt = (t: number) => (voices.some((v) => v && t >= v.start - 0.35 && t <= v.start + v.seconds + 0.6) ? duck : base);   // ducked wherever a voice is speaking
  const inAt = Math.min(1.2, total / 4), outAt = Math.max(0, total - 2);
  const raw: [number, number][] = [[0, -48], [inAt, levelAt(inAt)]];
  for (const v of voices) {
    if (!v) continue;
    const a = v.start, b = Math.min(total, v.start + v.seconds);
    raw.push([Math.max(0, a - 0.35), base], [a, duck], [b, duck], [b + 0.6, base]);
  }
  raw.push([outAt, levelAt(outAt)], [Math.max(0, total - 0.05), -48]);
  const out: [number, number][] = [];
  for (const [time, db] of raw.sort((x, y) => x[0] - y[0])) {
    const tt = Math.round(time * 100) / 100;
    const last = out[out.length - 1];
    if (last && tt <= last[0] + 0.01) { if (tt >= last[0]) last[1] = Math.min(last[1], db); continue; }   // a crowded moment keeps the quieter level
    out.push([tt, db]);
  }
  return out;
}
