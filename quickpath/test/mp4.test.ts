import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { looksLikeMp4, mp4Info } from "../src/mp4.ts";

function ffmpeg(): boolean { try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; } }
const skip = ffmpeg() ? false : "ffmpeg not installed: NOT CHECKED";

export function makeClip(seconds: number, w = 320, h = 180): string {
  const f = join(mkdtempSync(join(tmpdir(), "qp-clip-")), "c.mp4");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=duration=${seconds}:size=${w}x${h}:rate=30`, "-pix_fmt", "yuv420p", f]);
  return f;
}

test("a real MP4's length and size are read from its boxes", { skip }, () => {
  const info = mp4Info(readFileSync(makeClip(2, 320, 180)))!;
  assert.equal(info.width, 320);
  assert.equal(info.height, 180);
  assert.ok(Math.abs(info.seconds - 2) < 0.1, `got ${info.seconds}`);
  const tall = mp4Info(readFileSync(makeClip(1, 180, 320)))!;
  assert.equal(tall.height, 320);
});

test("things that are not clips are refused", () => {
  for (const b of [Buffer.from("hello world, not a movie"), Buffer.alloc(0), Buffer.from("GIF89a....................."), Buffer.from("<html></html>"), Buffer.alloc(64, 0)]) {
    assert.equal(mp4Info(b), null);
  }
  assert.equal(looksLikeMp4(Buffer.from("....ftypisom........")), true);
  assert.equal(looksLikeMp4(Buffer.from("....nope............")), false);
});

test("a truncated or damaged MP4 never throws", { skip }, () => {
  const b = readFileSync(makeClip(1));
  for (const cut of [20, 100, 400, Math.floor(b.length / 2)]) assert.doesNotThrow(() => mp4Info(b.subarray(0, cut)));
  const bad = Buffer.from(b); bad.writeUInt32BE(0xffffff00, 0);
  assert.doesNotThrow(() => mp4Info(bad));
});
