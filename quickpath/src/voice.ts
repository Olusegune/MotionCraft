// Voiceover. Two sources: the voices built into Windows (free, offline, no key) and OpenAI's speech (paid, confirmed first).
// Each spoken line is saved once under a name made from the voice and the words, so the same words are never made, or paid for, twice.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wavInfo, type WavInfo } from "./wav.ts";

export const OPENAI_VOICES = ["nova", "onyx", "alloy", "shimmer"] as const;
/** What a voice choice looks like: "win:Microsoft David Desktop" or "openai:nova". Anything else is refused. */
export const VOICE_CHOICE = /^(?:win:[A-Za-z0-9][A-Za-z0-9 .\-]{0,59}|openai:(?:nova|onyx|alloy|shimmer))$/;
export const OPENAI_USD_PER_CHAR = 0.000015;       // tts-1, as OpenAI lists it: $15 per million characters
export const MAX_SPOKEN_CHARS = 600;

/** The words actually spoken for a scene: what the person wrote for the voice, else the scene's own words. */
export function spokenText(scene: { headline: string; sub?: string; say?: string }): string {
  const t = (scene.say?.trim() ? scene.say : `${scene.headline}${scene.sub ? `. ${scene.sub}` : ""}`).replace(/\s+/g, " ").trim();
  return t.slice(0, MAX_SPOKEN_CHARS);
}

/** The file a line of speech is saved as: 12 hex characters from the voice and the words. */
export function voiceFileName(voice: string, text: string): string {
  return createHash("sha1").update(voice).update("\0").update(text).digest("hex").slice(0, 12) + ".wav";
}

const ps = (script: string, timeout = 60_000) => new Promise<string>((resolve, reject) => {
  execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, timeout, maxBuffer: 256 * 1024 }, (err, stdout, stderr) => err ? reject(new Error(String(stderr || err.message).slice(0, 200))) : resolve(String(stdout)));
});

let voices: string[] | undefined;
/** The voices installed in Windows, by name. Empty on other systems. */
export async function windowsVoices(): Promise<string[]> {
  if (voices) return voices;
  if (process.platform !== "win32") return (voices = []);
  try {
    const out = await ps("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo.Name }", 20_000);
    voices = out.split(/\r?\n/).map((x) => x.trim()).filter((x) => VOICE_CHOICE.test(`win:${x}`));
  } catch { voices = []; }
  return voices;
}

/** Speaks text with a Windows voice into a WAV file. The voice name must be one that is installed; the words travel in a file, never in a command. */
export async function speakWindows(text: string, voiceName: string, out: string): Promise<void> {
  if (!(await windowsVoices()).includes(voiceName)) throw new Error("That Windows voice is not installed.");
  const textFile = out + ".txt";
  writeFileSync(textFile, text, "utf-8");
  const q = (p: string) => p.replace(/'/g, "''");
  try {
    await ps(`Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SelectVoice('${q(voiceName)}'); $s.SetOutputToWaveFile('${q(out)}'); $s.Speak([IO.File]::ReadAllText('${q(textFile)}', [Text.Encoding]::UTF8)); $s.Dispose()`);
  } finally { try { (await import("node:fs")).unlinkSync(textFile); } catch { /* already gone */ } }
}

/** Speaks text with OpenAI into WAV bytes. `fetchImpl` and `base` are for tests. */
export async function speakOpenAI(text: string, voice: string, key: string, opts: { fetchImpl?: typeof fetch; base?: string } = {}): Promise<Buffer> {
  const f = opts.fetchImpl ?? fetch;
  const r = await f(`${opts.base ?? "https://api.openai.com/v1"}/audio/speech`, {
    method: "POST", signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice, input: text, response_format: "wav" }),
  });
  if (r.status === 401 || r.status === 403) throw new Error("OpenAI did not accept the key.");
  if (r.status === 429) throw new Error("OpenAI says you are out of credit or asking too fast.");
  if (!r.ok) throw new Error(`OpenAI could not make the voice (${r.status}).`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024 || !wavInfo(bytes)) throw new Error("What came back from OpenAI was not a usable sound.");
  return bytes;
}

export type Spoken = { file: string; info: WavInfo };

/** The speech for one line, from the saved copy if there is one. OpenAI lines that are not saved yet are refused here: they must be confirmed first. */
export async function lineFor(dir: string, voice: string, text: string, ask: { openaiKey?: () => Promise<string | null>; fetchImpl?: typeof fetch; base?: string } = {}): Promise<Spoken | null> {
  if (!VOICE_CHOICE.test(voice) || !text) return null;
  const file = voiceFileName(voice, text);
  const path = join(dir, "assets", "audio", file);
  if (existsSync(path)) { const info = wavInfo(readFileSync(path)); if (info) return { file, info }; }
  if (voice.startsWith("openai:")) return null;                       // paid: made only by makeLines, after a confirmation
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  await speakWindows(text, voice.slice(4), path);
  const info = existsSync(path) ? wavInfo(readFileSync(path)) : null;
  if (!info) throw new Error("The Windows voice did not make a sound file.");
  return { file, info };
}

/** Makes (and saves) the OpenAI lines that are missing. The caller has already had the person confirm the price. */
export async function makeOpenAILines(dir: string, voice: string, texts: string[], key: string, opts: { fetchImpl?: typeof fetch; base?: string } = {}): Promise<number> {
  const v = voice.slice("openai:".length);
  let made = 0;
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  for (const text of new Set(texts)) {
    const path = join(dir, "assets", "audio", voiceFileName(voice, text));
    if (existsSync(path)) continue;
    writeFileSync(path, await speakOpenAI(text, v, key, opts), { flag: "wx" });
    made++;
  }
  return made;
}

/** How many characters of OpenAI speech still have to be made, and what that costs. */
export function openAIMissing(dir: string, voice: string, texts: string[]): { chars: number; usd: number } {
  let chars = 0;
  for (const text of new Set(texts)) if (!existsSync(join(dir, "assets", "audio", voiceFileName(voice, text)))) chars += text.length;
  return { chars, usd: Math.round(chars * OPENAI_USD_PER_CHAR * 10000) / 10000 };
}
