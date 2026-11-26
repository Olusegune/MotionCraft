// Makes the two sample videos for the delivery folder through the running server: one plain, one with a picture, a voice and music.
// Usage: node scripts/samples.cjs <port> <output folder>
"use strict";
const { readFileSync, copyFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const port = process.argv[2], out = process.argv[3];
const home = process.env.QUICKPATH_HOME || join(require("node:os").homedir(), "Documents", "QuickPath");
const post = async (path, body) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(path + ": " + j.error); return j; };

(async () => {
  mkdirSync(out, { recursive: true });
  // 1. plain: the idea's own words, the Midnight look
  const idea = "Introducing Lumen, the desk lamp that follows the sun. Soft light from morning to night. Pre-order today.";
  const plan = await post("/api/plan", { idea, seconds: 15 });
  const a = await post("/api/render", { plan: { ...plan, look: "midnight" }, shape: "16:9", quality: "final", id: plan.id });
  copyFileSync(a.path, join(out, "sample-1-plain.mp4"));
  console.log("plain:", a.seconds, "s", a.frames, "frames");
  // 2. rich: a saved video that already has an AI picture on scene 1, now with a voice and music
  const id = process.argv[4];
  const saved = JSON.parse(readFileSync(join(home, "projects", id, "plan.json"), "utf-8"));
  saved.plan.voice = "win:Microsoft Zira Desktop";
  saved.plan.music = { mood: "warm", level: "medium" };
  const b = await post("/api/render", { plan: saved.plan, shape: saved.shape, quality: "final", id });
  copyFileSync(b.path, join(out, "sample-2-picture-voice-music.mp4"));
  console.log("rich:", b.seconds, "s", b.frames, "frames");
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
