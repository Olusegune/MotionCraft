// Draws the app icon (build/icon.png, 512 x 512): the brand squircle in the app's warm gradient, with a play triangle. Run once; the PNG is committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const N = 512;
const px = Buffer.alloc(N * N * 4);
const mix = (a: number[], b: number[], t: number) => a.map((x, i) => Math.round(x + (b[i] - x) * t));
const top = [255, 200, 87], bottom = [242, 100, 60];

// A superellipse (n = 5) gives the rounded-square silhouette.
const inside = (x: number, y: number) => Math.pow(Math.abs((x - N / 2) / (N / 2 - 14)), 5) + Math.pow(Math.abs((y - N / 2) / (N / 2 - 14)), 5) <= 1;
const tri = (x: number, y: number) => {   // play triangle, pointing right, nudged right so it looks centred
  const x0 = 190, x1 = 360, cy = N / 2, h = 105;
  if (x < x0 || x > x1) return false;
  const half = h * (1 - (x - x0) / (x1 - x0));
  return Math.abs(y - cy) <= half;
};

for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
  const o = (y * N + x) * 4;
  // 3x3 supersampling for smooth edges
  let cov = 0, tcov = 0;
  for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 3; sx++) {
    const fx = x + (sx + 0.5) / 3, fy = y + (sy + 0.5) / 3;
    if (inside(fx, fy)) { cov++; if (tri(fx, fy)) tcov++; }
  }
  if (!cov) continue;
  const bg = mix(top, bottom, y / N), fg = [24, 26, 28];
  const t = tcov / cov;
  const c = mix(bg, fg, t);
  px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round((cov / 9) * 255);
}

function crc32(b: Buffer) { let c: number, crc = 0xffffffff; for (let n = 0; n < b.length; n++) { c = (crc ^ b[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const rows: Buffer[] = [];
for (let y = 0; y < N; y++) rows.push(Buffer.concat([Buffer.from([0]), px.subarray(y * N * 4, (y + 1) * N * 4)]));
mkdirSync("build", { recursive: true });
writeFileSync("build/icon.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]));
console.log("wrote build/icon.png");
