// Reading and writing WAV files: just enough to know a voice clip's length and to save generated music. 16-bit PCM only for writing.
export type WavInfo = { seconds: number; rate: number; channels: number };

export const AUDIO_NAME = /^[a-f0-9]{12}\.(?:wav|mp3)$/;
export const MAX_AUDIO_BYTES = 40 * 1024 * 1024;

/** What an uploaded sound file really is, from its first bytes: a WAV (readable), an MP3 (an ID3 tag or a frame sync), or neither. */
export function audioKind(b: Buffer): "wav" | "mp3" | null {
  if (wavInfo(b)) return "wav";
  if (b.length > 1024 && (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0)) && mp3Seconds(b) !== null) return "mp3";
  return null;
}

/** The length and format of a RIFF/WAVE file, or null when it cannot be read. Walks the chunks by their sizes. */
export function wavInfo(b: Buffer): WavInfo | null {
  if (b.length < 44 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WAVE") return null;
  let rate = 0, channels = 0, bits = 0, data = -1;
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString("latin1", i, i + 4);
    let size = b.readUInt32LE(i + 4);
    if (id === "fmt " && i + 8 + 16 <= b.length) {
      channels = b.readUInt16LE(i + 10); rate = b.readUInt32LE(i + 12); bits = b.readUInt16LE(i + 22);
    } else if (id === "data") {
      data = Math.min(size, b.length - (i + 8));          // a streamed file may say 0 or too much: trust what is there
      if (size === 0 || size === 0xffffffff) data = b.length - (i + 8);
      break;
    }
    i += 8 + size + (size & 1);
  }
  if (!rate || !channels || !bits || data < 0 || channels > 8 || rate < 4000 || rate > 192000) return null;
  const seconds = data / (rate * channels * (bits / 8));
  return seconds > 0 && Number.isFinite(seconds) ? { seconds, rate, channels } : null;
}

/** A stereo 16-bit WAV from two channels of floats in -1..1. */
export function writeWav(left: Float32Array, right: Float32Array, rate: number): Buffer {
  const n = Math.min(left.length, right.length);
  const out = Buffer.alloc(44 + n * 4);
  out.write("RIFF", 0, "latin1"); out.writeUInt32LE(36 + n * 4, 4); out.write("WAVEfmt ", 8, "latin1");
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 4, 28); out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36, "latin1"); out.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(left[i] * 32767))), 44 + i * 4);
    out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(right[i] * 32767))), 46 + i * 4);
  }
  return out;
}

/** The length of an MP3 in seconds, read from its frame headers (MPEG layer III; an ID3 tag in front is skipped). Null when it does not hold at least a few real frames. */
export function mp3Seconds(b: Buffer): number | null {
  let i = 0;
  if (b.length > 10 && b.toString("latin1", 0, 3) === "ID3") i = 10 + (((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f));
  const BR1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], BR2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
  const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let frames = 0, samples = 0, rate = 0;
  for (let guard = 0; i + 4 <= b.length && guard < 3_000_000; guard++) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, br = (b[i + 2] >> 4) & 15, sri = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sri === 3) { i++; continue; }
    const sr = SR[ver][sri], kbps = (ver === 3 ? BR1 : BR2)[br];
    const len = Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / sr) + pad;
    if (len < 4) { i++; continue; }
    frames++; samples += ver === 3 ? 1152 : 576; rate ||= sr; i += len;
  }
  return frames >= 3 && rate ? samples / rate : null;
}

/** The length of a sound file, WAV or MP3, or null when it is neither. */
export function audioInfo(b: Buffer): { seconds: number } | null {
  const w = wavInfo(b);
  if (w) return { seconds: w.seconds };
  const m = mp3Seconds(b);
  return m !== null && Number.isFinite(m) && m > 0 ? { seconds: m } : null;
}
