// Reads just enough of an MP4 (or MOV) file to trust it: that it is one, how long it is and how big its picture is.
// Boxes are walked by their sizes; nothing is executed or decoded.
export type Mp4Info = { seconds: number; width: number; height: number };

export const MAX_CLIP_BYTES = 150 * 1024 * 1024;

type Box = { type: string; start: number; end: number; body: number };

function* boxes(b: Buffer, from: number, to: number): Generator<Box> {
  let i = from;
  while (i + 8 <= to) {
    let size = b.readUInt32BE(i);
    const type = b.toString("latin1", i + 4, i + 8);
    let body = i + 8;
    if (size === 1) { if (i + 16 > to) return; size = Number(b.readBigUInt64BE(i + 8)); body = i + 16; }
    else if (size === 0) size = to - i;
    if (size < body - i || i + size > to) return;
    yield { type, start: i, end: i + size, body };
    i += size;
  }
}

const find = (b: Buffer, parent: { body: number; end: number }, type: string): Box | undefined => {
  for (const x of boxes(b, parent.body, parent.end)) if (x.type === type) return x;
  return undefined;
};

/** True when the file starts like an MP4 or QuickTime file (an `ftyp` box, or `moov` first for a plain MOV). */
export function looksLikeMp4(b: Buffer): boolean {
  return b.length > 12 && (b.toString("latin1", 4, 8) === "ftyp" || b.toString("latin1", 4, 8) === "moov");
}

/** The length and picture size of an MP4, or null when it cannot be read (no moov box, no video track, an odd size). */
export function mp4Info(b: Buffer): Mp4Info | null {
  if (!looksLikeMp4(b)) return null;
  let moov: Box | undefined;
  for (const x of boxes(b, 0, b.length)) if (x.type === "moov") { moov = x; break; }
  if (!moov) return null;
  const mvhd = find(b, moov, "mvhd");
  if (!mvhd) return null;
  const v = b[mvhd.body];
  const scale = b.readUInt32BE(mvhd.body + (v === 1 ? 20 : 12));
  const dur = v === 1 ? Number(b.readBigUInt64BE(mvhd.body + 24)) : b.readUInt32BE(mvhd.body + 16);
  if (!scale || !dur) return null;
  for (const t of boxes(b, moov.body, moov.end)) {
    if (t.type !== "trak") continue;
    const mdia = find(b, t, "mdia");
    const hdlr = mdia && find(b, mdia, "hdlr");
    if (!hdlr || b.toString("latin1", hdlr.body + 8, hdlr.body + 12) !== "vide") continue;
    const tkhd = find(b, t, "tkhd");
    if (!tkhd) continue;
    const tv = b[tkhd.body];
    const o = tkhd.body + (tv === 1 ? 88 : 76);
    if (o + 8 > tkhd.end) continue;
    const width = Math.round(b.readUInt32BE(o) / 65536), height = Math.round(b.readUInt32BE(o + 4) / 65536);
    if (width > 0 && height > 0 && width <= 16384 && height <= 16384) return { seconds: dur / scale, width, height };
  }
  return null;
}
