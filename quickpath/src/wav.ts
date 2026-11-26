// Reading and writing WAV files: just enough to know a voice clip's length and to save generated music. 16-bit PCM only for writing.
export type WavInfo = { seconds: number; rate: number; channels: number };

export const AUDIO_NAME = /^[a-f0-9]{12}\.(?:wav|mp3)$/;
export const MAX_AUDIO_BYTES = 40 * 1024 * 1024;

/** What an uploaded sound file really is, from its first bytes: a WAV (readable), an MP3 (an ID3 tag or a frame sync), or neither. */
export function audioKind(b: Buffer): "wav" | "mp3" | null {
  if (wavInfo(b)) return "wav";
  if (b.length > 1024 && (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && (b[1] & 0x06) !== 0))) return "mp3";
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
