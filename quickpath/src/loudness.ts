// How loud a voice is, so a narrator, a character and a different provider's voice can all sit at the same level.
// Measured on the speech only (quiet gaps are ignored), in decibels below full scale. WAV is read here; an MP3 is measured by the page (the browser can decode it)
// and the number is saved beside the sound files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIO_NAME, wavInfo } from "./wav.ts";

export const VOICE_TARGET_DB = -20;        // speech sits about here, measured the same way
export const MAX_GAIN_DB = 12;             // never push or pull a voice further than this

/** The level of the speech in a set of samples (blocks of 50 ms; blocks well below the loudest, or nearly silent, are the gaps and are left out). */
export function speechDb(blocks: number[]): number | null {
  const loud = Math.max(0, ...blocks);
  if (loud <= 0) return null;
  const gate = Math.max(1e-5, loud * Math.pow(10, -35 / 10));                 // mean-square values: -35 dB under the loudest block
  const kept = blocks.filter((b) => b >= gate);
  if (!kept.length) return null;
  const ms = kept.reduce((a, b) => a + b, 0) / kept.length;
  const db = 10 * Math.log10(ms);
  return Number.isFinite(db) ? Math.round(db * 10) / 10 : null;
}

/** Mean-square per 50 ms block of mono samples (any scale; callers pass -1..1). */
export function blocksOf(samples: ArrayLike<number>, rate: number): number[] {
  const size = Math.max(1, Math.round(rate * 0.05)), out: number[] = [];
  for (let i = 0; i < samples.length; i += size) {
    let s = 0; const end = Math.min(samples.length, i + size);
    for (let k = i; k < end; k++) s += samples[k] * samples[k];
    out.push(s / (end - i));
  }
  return out;
}

/** The speech level of a 16-bit WAV (all channels averaged), or null when it cannot be read or is silent. */
export function wavSpeechDb(b: Buffer): number | null {
  const info = wavInfo(b);
  if (!info) return null;
  let bits = 0, dataAt = -1, dataLen = 0;
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString("latin1", i, i + 4); let size = b.readUInt32LE(i + 4);
    if (id === "fmt " && i + 24 <= b.length) bits = b.readUInt16LE(i + 22);
    else if (id === "data") { dataAt = i + 8; dataLen = size === 0 || size === 0xffffffff ? b.length - dataAt : Math.min(size, b.length - dataAt); break; }
    i += 8 + size + (size & 1);
  }
  if (bits !== 16 || dataAt < 0) return null;
  const frames = Math.floor(dataLen / (2 * info.channels)), mono = new Float32Array(frames);
  for (let f = 0; f < frames; f++) { let s = 0; for (let c = 0; c < info.channels; c++) s += b.readInt16LE(dataAt + (f * info.channels + c) * 2) / 32768; mono[f] = s / info.channels; }
  return speechDb(blocksOf(mono, info.rate));
}

/** How many decibels to add to a voice to bring it to the target; limited so a bad measurement can never do harm. */
export function voiceGain(measured: number | null | undefined): number {
  if (typeof measured !== "number" || !Number.isFinite(measured)) return 0;
  return Math.round(Math.max(-MAX_GAIN_DB, Math.min(MAX_GAIN_DB, VOICE_TARGET_DB - measured)) * 10) / 10;
}

const levelsFile = (dir: string) => join(dir, "assets", "audio", "levels.json");

/** The saved levels for a video's sound files: { "<12 hex>.mp3": -23.4 }. */
export function readLevels(dir: string): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(levelsFile(dir), "utf-8")), out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw)) if (AUDIO_NAME.test(k) && typeof v === "number" && v >= -80 && v <= 0) out[k] = v;
    return out;
  } catch { return {}; }
}

/** Saves one measured level, after checking the name and the number. Returns false when either is not acceptable. */
export function saveLevel(dir: string, file: string, db: unknown): boolean {
  if (!AUDIO_NAME.test(file) || typeof db !== "number" || !Number.isFinite(db) || db < -80 || db > 0) return false;
  if (!existsSync(join(dir, "assets", "audio", file))) return false;
  const all = readLevels(dir); all[file] = Math.round(db * 10) / 10;
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  writeFileSync(levelsFile(dir), JSON.stringify(all, null, 2));
  return true;
}

/** The level of a sound file in a video's folder: the saved number, else (for a WAV) measured now, else null. */
export function levelOf(dir: string, file: string): number | null {
  const saved = readLevels(dir)[file];
  if (typeof saved === "number") return saved;
  if (file.endsWith(".wav")) { try { return wavSpeechDb(readFileSync(join(dir, "assets", "audio", file))); } catch { return null; } }
  return null;
}
