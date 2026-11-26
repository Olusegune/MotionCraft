// Reads just enough of a picture file to trust it: its real type (from its first bytes, never its name) and its size.
export type ImageInfo = { ext: "png" | "jpg"; width: number; height: number };

/** Names the server gives pictures: 12 random hex characters and the real extension. */
export const PICTURE_NAME = /^[a-f0-9]{12}\.(?:png|jpg)$/;
export const MAX_PICTURE_BYTES = 12 * 1024 * 1024;
export const MAX_PICTURE_SIDE = 12000;

export function imageInfo(b: Buffer): ImageInfo | null {
  if (b.length > 24 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && b.toString("ascii", 12, 16) === "IHDR") {
    return ok({ ext: "png", width: b.readUInt32BE(16), height: b.readUInt32BE(20) });
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return ok({ ext: "jpg", height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) });
      }
      i += 2 + len;
    }
  }
  return null;
}

function ok(i: ImageInfo): ImageInfo | null {
  return i.width > 0 && i.height > 0 && i.width <= MAX_PICTURE_SIDE && i.height <= MAX_PICTURE_SIDE ? i : null;
}
