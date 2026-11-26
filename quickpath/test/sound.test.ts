import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeMusic, MOODS } from "../src/music.ts";
import { audioKind, wavInfo, writeWav } from "../src/wav.ts";
import { DUCK_DB, musicKeys, type VoiceCue } from "../src/sound.ts";
import { makeOpenAILines, openAIMissing, spokenText, speakOpenAI, voiceFileName, VOICE_CHOICE, OPENAI_USD_PER_CHAR } from "../src/voice.ts";

test("music: every mood makes a stereo track of the asked length that never clips, and is the same every time", () => {
  for (const m of MOODS) {
    const a = makeMusic(m.id, 6), b = makeMusic(m.id, 6);
    const info = wavInfo(a)!;
    assert.equal(info.channels, 2);
    assert.ok(Math.abs(info.seconds - 6) < 0.01, `${m.id} length ${info.seconds}`);
    assert.ok(a.equals(b), `${m.id} is deterministic`);
    let peak = 0;
    for (let i = 44; i + 1 < a.length; i += 2) peak = Math.max(peak, Math.abs(a.readInt16LE(i)));
    assert.ok(peak > 2000 && peak < 32000, `${m.id} peak ${peak}`);
  }
  assert.ok(!makeMusic("calm", 6).equals(makeMusic("upbeat", 6)), "moods differ");
  assert.equal(wavInfo(makeMusic("nope", 3))!.seconds > 2.9, true, "an unknown mood still makes calm music");
});

test("wav and sound-file detection read bytes, not names", () => {
  const w = writeWav(new Float32Array(4410), new Float32Array(4410), 44100);
  assert.equal(audioKind(w), "wav");
  assert.ok(Math.abs(wavInfo(w)!.seconds - 0.1) < 0.001);
  const mp3 = Buffer.concat([Buffer.from("ID3\x03\x00\x00\x00\x00\x00\x00"), Buffer.alloc(2000, 1)]);
  assert.equal(audioKind(mp3), "mp3");
  for (const bad of [Buffer.from("hello"), Buffer.alloc(0), Buffer.from("<html>" + "x".repeat(3000)), Buffer.alloc(3000, 0), Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(60)])]) assert.equal(audioKind(bad), null);
});

test("music levels: fade in, dip under each voice, fade out, times strictly increasing", () => {
  const voices: (VoiceCue | null)[] = [{ file: "a", start: 0.35, seconds: 3 }, null, { file: "b", start: 8.5, seconds: 2.5 }];
  const keys = musicKeys(12, -16, voices);
  assert.deepEqual(keys[0], [0, -48]);
  assert.equal(keys[keys.length - 1][1], -48);
  for (let i = 1; i < keys.length; i++) assert.ok(keys[i][0] > keys[i - 1][0], `time ${keys[i][0]} after ${keys[i - 1][0]}`);
  const at = (t: number) => keys.filter((k) => k[0] <= t).pop()![1];
  assert.equal(at(1.5), -16 - DUCK_DB, "ducked under the first voice");
  assert.equal(at(6), -16, "back up between voices");
  assert.equal(at(9.5), -16 - DUCK_DB, "ducked under the second voice");
  assert.ok(Math.max(...keys.map((k) => k[1])) <= -16, "never louder than the chosen level");
});

test("music levels with no voice, and for a very short video, stay valid", () => {
  const k = musicKeys(3, -10, [null, null]);
  for (let i = 1; i < k.length; i++) assert.ok(k[i][0] > k[i - 1][0]);
  assert.ok(k.length >= 2);
});

test("the words spoken are what the person wrote for the voice, else the scene's own words, capped", () => {
  assert.equal(spokenText({ headline: "Warm mornings", sub: "start slowly" }), "Warm mornings. start slowly");
  assert.equal(spokenText({ headline: "Warm mornings", sub: "", say: "  Good   morning. " }), "Good morning.");
  assert.equal(spokenText({ headline: "x".repeat(900) }).length, 600);
});

test("a voice choice is only ever one of the shapes the server makes", () => {
  for (const ok of ["win:Microsoft David Desktop", "win:Microsoft Zira Desktop", "openai:nova", "openai:onyx"]) assert.ok(VOICE_CHOICE.test(ok), ok);
  for (const bad of ["win:'; Remove-Item C:\\ -Recurse #", "win:", "openai:evil", "openai:nova\n", "../x", "win:a\"b", "OPENAI:nova", "win:" + "a".repeat(80)]) assert.ok(!VOICE_CHOICE.test(bad), bad);
});

test("a spoken line is saved once, named from the voice and the words", () => {
  assert.equal(voiceFileName("win:A", "hello"), voiceFileName("win:A", "hello"));
  assert.notEqual(voiceFileName("win:A", "hello"), voiceFileName("win:B", "hello"));
  assert.notEqual(voiceFileName("win:A", "hello"), voiceFileName("win:A", "hello!"));
  assert.match(voiceFileName("openai:nova", "x"), /^[a-f0-9]{12}\.wav$/);
});

function fakeSpeech(wav: Buffer, status = 200) {
  const calls: { url: string; body: any; auth: string }[] = [];
  const fetchImpl = (async (url: string, init: any) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return new Response(status === 200 ? wav : "no", { status }); }) as typeof fetch;
  return { fetchImpl, calls };
}

test("OpenAI speech: the request is right, only missing lines are made (and priced), saved lines are never paid for twice", async () => {
  const dir = mkdtempSync(join(tmpdir(), "qp-voice-"));
  const wav = writeWav(new Float32Array(22050), new Float32Array(22050), 22050);
  const f = fakeSpeech(wav);
  const texts = ["Warm mornings start slowly", "Wake up slowly", "Warm mornings start slowly"];
  const miss = openAIMissing(dir, "openai:nova", texts);
  assert.equal(miss.chars, "Warm mornings start slowly".length + "Wake up slowly".length, "a repeated line is counted once");
  assert.ok(Math.abs(miss.usd - miss.chars * OPENAI_USD_PER_CHAR) < 0.0001);
  assert.equal(await makeOpenAILines(dir, "openai:nova", texts, "k".repeat(20), { fetchImpl: f.fetchImpl }), 2);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].body.voice, "nova");
  assert.equal(f.calls[0].body.response_format, "wav");
  assert.equal(f.calls[0].auth, "Bearer " + "k".repeat(20));
  assert.ok(existsSync(join(dir, "assets", "audio", voiceFileName("openai:nova", "Wake up slowly"))));
  assert.equal(openAIMissing(dir, "openai:nova", texts).chars, 0);
  assert.equal(await makeOpenAILines(dir, "openai:nova", texts, "k".repeat(20), { fetchImpl: f.fetchImpl }), 0);
  assert.equal(f.calls.length, 2, "nothing was asked for again");
});

test("OpenAI speech trouble gives plain sentences", async () => {
  const wav = writeWav(new Float32Array(2205), new Float32Array(2205), 22050);
  await assert.rejects(speakOpenAI("hi", "nova", "k".repeat(20), { fetchImpl: fakeSpeech(wav, 401).fetchImpl }), /did not accept the key/);
  await assert.rejects(speakOpenAI("hi", "nova", "k".repeat(20), { fetchImpl: fakeSpeech(wav, 429).fetchImpl }), /out of credit/);
  await assert.rejects(speakOpenAI("hi", "nova", "k".repeat(20), { fetchImpl: fakeSpeech(wav, 500).fetchImpl }), /could not make the voice/);
  await assert.rejects(speakOpenAI("hi", "nova", "k".repeat(20), { fetchImpl: fakeSpeech(Buffer.from("<html>not sound</html>")).fetchImpl }), /not a usable sound/);
});
