// Voiceover. Two sources: the voices built into Windows (free, offline, no key) and OpenAI's speech (paid, confirmed first).
// Each spoken line is saved once under a name made from the voice and the words, so the same words are never made, or paid for, twice.
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { audioInfo, audioKind, wavInfo } from "./wav.ts";
import { dollars, download, KieError, runTask, type KieOpts } from "./kie.ts";

export const OPENAI_VOICES = ["nova", "onyx", "alloy", "shimmer"] as const;
/** What a voice choice looks like: "win:Microsoft David Desktop" or "openai:nova". Anything else is refused. */
export const VOICE_CHOICE = /^(?:win:[A-Za-z0-9][A-Za-z0-9 .\-]{0,59}|openai:(?:nova|onyx|alloy|shimmer)|kie:[A-Za-z0-9]{20}|eleven:[A-Za-z0-9]{20}|vk:[A-Za-z0-9][A-Za-z0-9 ._\-]{0,39})$/;
export const OPENAI_USD_PER_CHAR = 0.000015;       // tts-1, as OpenAI lists it: $15 per million characters
export const KIE_USD_PER_LINE = 0.03;              // ElevenLabs on Kie.ai: 6 credits ($0.03) for each line of up to 1,000 characters. Measured on a real call: 4 short lines cost $0.12, so it is per line, not per character
export const ELEVEN_USD_PER_CHAR = 0.00015;       // ElevenLabs bills characters against your plan; about $0.15 per 1,000 characters is a fair figure for extra use on a paid plan. An estimate: the plan decides
export const MAX_SPOKEN_CHARS = 600;

/** Which paid provider makes a voice choice, or null for the free Windows voices. */
export type VoiceKind = "kie" | "openai" | "eleven" | "vk";
export const voiceKind = (v: string): VoiceKind | null => (v.startsWith("kie:") ? "kie" : v.startsWith("openai:") ? "openai" : v.startsWith("eleven:") ? "eleven" : v.startsWith("vk:") ? "vk" : null);
export const isPaidVoice = (v: string) => voiceKind(v) !== null;

/** The words actually spoken for a scene: what the person wrote for the voice, else the scene's own words. */
export function spokenText(scene: { headline: string; sub?: string; say?: string }): string {
  const t = (scene.say?.trim() ? scene.say : `${scene.headline}${scene.sub ? `. ${scene.sub}` : ""}`).replace(/\s+/g, " ").trim();
  return t.slice(0, MAX_SPOKEN_CHARS);
}

/** The file a line of speech is saved as: 12 hex characters from the voice and the words. */
export function voiceFileName(voice: string, text: string): string {
  return createHash("sha1").update(voice).update("\0").update(text).digest("hex").slice(0, 12) + (voiceKind(voice) === "kie" || voiceKind(voice) === "eleven" || voiceKind(voice) === "vk" ? ".mp3" : ".wav");
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

export type Spoken = { file: string; info: { seconds: number } };

/** The speech for one line, from the saved copy if there is one. OpenAI lines that are not saved yet are refused here: they must be confirmed first. */
export async function lineFor(dir: string, voice: string, text: string, ask: { openaiKey?: () => Promise<string | null>; fetchImpl?: typeof fetch; base?: string } = {}): Promise<Spoken | null> {
  if (!VOICE_CHOICE.test(voice) || !text) return null;
  const file = voiceFileName(voice, text);
  const path = join(dir, "assets", "audio", file);
  if (existsSync(path)) { const info = audioInfo(readFileSync(path)); if (info) return { file, info }; }
  if (isPaidVoice(voice)) return null;                                              // paid: made only after a confirmation
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  await speakWindows(text, voice.slice(4), path);
  const info = existsSync(path) ? audioInfo(readFileSync(path)) : null;
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
export function voiceMissing(dir: string, voice: string, texts: string[]): { chars: number; usd: number; lines: number } {
  let chars = 0, usd = 0, lines = 0;
  for (const text of new Set(texts)) {
    if (existsSync(join(dir, "assets", "audio", voiceFileName(voice, text)))) continue;
    chars += text.length; lines++;
    const kind = voiceKind(voice);
    usd += kind === "kie" ? Math.ceil(Math.max(1, text.length) / 1000) * KIE_USD_PER_LINE : kind === "eleven" ? text.length * ELEVEN_USD_PER_CHAR : kind === "vk" ? 0 : text.length * OPENAI_USD_PER_CHAR;
  }
  return { chars, lines, usd: Math.round(usd * 10000) / 10000 };
}
export const openAIMissing = voiceMissing;

// ---- Kie.ai voices (ElevenLabs Turbo 2.5): more voices than Windows, one provider with pictures, music and video. Paid, confirmed first.
export const KIE_VOICES: { id: string; name: string }[] = [
  ["EXAVITQu4vr4xnSDxMaL", "Sarah"], ["Xb7hH8MSUJpSbSDYk0k2", "Alice"], ["cgSgspJ2msm6clMCkdW9", "Jessica"], ["FGY2WhTYpPnrIDTdsKH5", "Laura"], ["XrExE9yKIg1WjnnlVkGX", "Matilda"],
  ["pFZP5JQG7iQjIQuC4Bku", "Lily"], ["SAz9YHcvj6GT2YYXdXww", "River"], ["pNInz6obpgDQGcFmaJgB", "Adam"], ["nPczCjzI2devNBz1zQrb", "Brian"], ["onwK4e9ZLuTAKqWW03F9", "Daniel"],
  ["JBFqnCBsd6RMkjVDRZzb", "George"], ["TX3LPaxmHKxFdv7VOQHJ", "Liam"], ["CwhRBWXzGAHq8TQ4Fs17", "Roger"], ["bIHbv24MWmeRgasZH58o", "Will"], ["iP95p4xoKVk53GoZ742B", "Chris"],
  ["cjVigY5qzO86Huf0OWal", "Eric"], ["IKne3meq5aSn9XLyUdCD", "Charlie"], ["N2lVS1w4EtoT3dr4eOWO", "Callum"], ["pqHfZKP75CvOlQylNhV4", "Bill"], ["SOYHLrjzK2X1ezoPC6cr", "Harry"],
].map(([id, name]) => ({ id, name }));
/** Whether a voice choice names a real voice: Kie voices must be one of the listed ones. */
export const knownVoice = (choice: string) => VOICE_CHOICE.test(choice) && (!choice.startsWith("kie:") || KIE_VOICES.some((v) => v.id === choice.slice(4)));

/** Makes (and saves) the Kie lines that are missing, as MP3. The caller has already had the person confirm the price. Returns how many were made and what Kie says they cost. */
export async function makeKieLines(dir: string, voice: string, texts: string[], key: string, opts: KieOpts = {}): Promise<{ made: number; usd: number }> {
  if (!knownVoice(voice) || !voice.startsWith("kie:")) throw new KieError("That Kie.ai voice is not one of the listed voices.");
  let made = 0, usd = 0;
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  for (const text of new Set(texts)) {
    const path = join(dir, "assets", "audio", voiceFileName(voice, text));
    if (existsSync(path)) continue;
    const m = await runTask("elevenlabs/text-to-speech-turbo-2-5", { text, voice: voice.slice(4), stability: 0.5, similarity_boost: 0.75, style: 0, speed: 1, language_code: "" }, key, { pollMs: 2000, timeoutMs: 180_000, ...opts });
    const bytes = await download(m.urls[0], 20 * 1024 * 1024, opts);
    if (audioKind(bytes) === null || !audioInfo(bytes)) throw new KieError("What came back from Kie.ai was not a usable sound.");
    writeFileSync(path, bytes, { flag: "wx" });
    made++; usd += dollars(m.credits, Math.ceil(Math.max(1, text.length) / 1000) * KIE_USD_PER_LINE);
  }
  return { made, usd: Math.round(usd * 10000) / 10000 };
}

// ---- ElevenLabs directly (your own account and plan). A voice choice is "eleven:<voice id>"; the id is the 20-character one from your ElevenLabs voice library.
export const ELEVEN_BASE = "https://api.elevenlabs.io";
export const ELEVEN_MODEL = "eleven_turbo_v2_5";       // good quality at half the credits of the multilingual model

async function saveMp3(path: string, bytes: Buffer, who: string) {
  if (bytes.length > 20 * 1024 * 1024 || audioKind(bytes) === null || !audioInfo(bytes)) throw new Error(`What came back from ${who} was not a usable sound.`);
  writeFileSync(path, bytes, { flag: "wx" });
}

/** One line of speech from ElevenLabs as MP3 bytes. `base` and `fetchImpl` are for tests. */
export async function speakEleven(text: string, voiceId: string, key: string, opts: { fetchImpl?: typeof fetch; base?: string } = {}): Promise<Buffer> {
  if (!/^[A-Za-z0-9]{20}$/.test(voiceId)) throw new Error("That ElevenLabs voice is not a valid voice id.");
  const r = await (opts.fetchImpl ?? fetch)(`${opts.base ?? ELEVEN_BASE}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: ELEVEN_MODEL, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
  });
  if (r.status === 401) throw new Error("ElevenLabs did not accept the key. Copy it again from your ElevenLabs profile.");
  if (r.status === 402 || r.status === 403) throw new Error("Your ElevenLabs plan cannot make this voice (out of characters, or a voice that needs a higher plan).");
  if (r.status === 404 || r.status === 422) throw new Error("ElevenLabs does not have that voice in your account.");
  if (r.status === 429) throw new Error("ElevenLabs says you are asking too fast. Wait a minute and try again.");
  if (!r.ok) throw new Error(`ElevenLabs could not make the voice (${r.status}).`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (audioKind(bytes) === null) throw new Error("What came back from ElevenLabs was not a usable sound.");
  return bytes;
}

/** Makes (and saves) the ElevenLabs lines that are missing. The caller has already had the person confirm the price. */
export async function makeElevenLines(dir: string, voice: string, texts: string[], key: string, opts: { fetchImpl?: typeof fetch; base?: string } = {}): Promise<{ made: number; usd: number }> {
  if (voiceKind(voice) !== "eleven") throw new Error("That is not an ElevenLabs voice.");
  let made = 0, usd = 0;
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  for (const text of new Set(texts)) {
    const path = join(dir, "assets", "audio", voiceFileName(voice, text));
    if (existsSync(path)) continue;
    await saveMp3(path, await speakEleven(text, voice.slice("eleven:".length), key, opts), "ElevenLabs");
    made++; usd += text.length * ELEVEN_USD_PER_CHAR;
  }
  return { made, usd: Math.round(usd * 10000) / 10000 };
}

// ---- Voicekiller (your own account). A voice choice is "vk:<voice name>". Its key is two parts, written USERID:APIKEY, because the service wants both in every request.
export const VOICEKILLER_BASE = "https://voicekiller.com";

/** Splits "USERID:APIKEY" (the first colon divides them). Null when it is not in that shape. */
export function splitVoicekillerKey(key: string): { userId: string; apiKey: string } | null {
  const i = key.indexOf(":");
  if (i < 1 || i === key.length - 1) return null;
  const userId = key.slice(0, i).trim(), apiKey = key.slice(i + 1).trim();
  return userId && apiKey && !/\s/.test(userId + apiKey) ? { userId, apiKey } : null;
}

export async function speakVoicekiller(text: string, voiceName: string, key: string, opts: { fetchImpl?: typeof fetch; base?: string; instructions?: string } = {}): Promise<Buffer> {
  const k = splitVoicekillerKey(key);
  if (!k) throw new Error("QuickPath needs both your Voicekiller User ID and your API key. Save them again in Settings.");
  const r = await (opts.fetchImpl ?? fetch)(`${opts.base ?? VOICEKILLER_BASE}/api/generate-speech`, {
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { "api-key": k.apiKey, userid: k.userId, "content-type": "application/json" },
    body: JSON.stringify({ script: text, voice_name: voiceName, voice: voiceName, ...(opts.instructions ? { instructions: opts.instructions } : {}) }),
  });
  if (r.status === 401 || r.status === 403) throw new Error("Voicekiller did not accept the User ID and key. Copy them again from your Voicekiller API page.");
  if (r.status === 402) throw new Error("Voicekiller says your plan has no credit left for this.");
  if (r.status === 429) throw new Error("Voicekiller says you are asking too fast. Wait a minute and try again.");
  if (!r.ok) throw new Error(`Voicekiller could not make the voice (${r.status}).`);
  const bytes = Buffer.from(await r.arrayBuffer());
  if (audioKind(bytes) === null) throw new Error("What came back from Voicekiller was not a usable sound (it may have sent a message instead; check the voice name).");
  return bytes;
}

/** Makes (and saves) the Voicekiller lines that are missing. Voicekiller bills through your own plan, so nothing is added to QuickPath's ledger. */
export async function makeVoicekillerLines(dir: string, voice: string, texts: string[], key: string, opts: { fetchImpl?: typeof fetch; base?: string } = {}): Promise<{ made: number; usd: number }> {
  if (voiceKind(voice) !== "vk") throw new Error("That is not a Voicekiller voice.");
  let made = 0;
  mkdirSync(join(dir, "assets", "audio"), { recursive: true });
  for (const text of new Set(texts)) {
    const path = join(dir, "assets", "audio", voiceFileName(voice, text));
    if (existsSync(path)) continue;
    await saveMp3(path, await speakVoicekiller(text, voice.slice(3), key, opts), "Voicekiller");
    made++;
  }
  return { made, usd: 0 };
}

/** The voice names in whatever Voicekiller's voice list answers with: an array of names, an array of objects with a name, or an object holding such an array. */
export function parseVoicekillerVoices(body: unknown): string[] {
  const arr = Array.isArray(body) ? body : body && typeof body === "object" ? Object.values(body as object).find(Array.isArray) ?? [] : [];
  const names = (arr as unknown[]).map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as any).name ?? (v as any).voice_name ?? (v as any).voice ?? (v as any).id ?? "") : "")).map((s) => s.trim());
  return [...new Set(names.filter((n) => /^[A-Za-z0-9][A-Za-z0-9 ._\-]{0,39}$/.test(n)))].slice(0, 200);
}
