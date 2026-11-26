// Makes sample videos in the newer shapes through the running server. Usage: node scripts/samples2.cjs <port> <output folder>
"use strict";
const { copyFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const port = process.argv[2], out = process.argv[3];
const post = async (path, body) => { const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(path + ": " + j.error); return j; };

(async () => {
  mkdirSync(out, { recursive: true });
  const cinema = {
    title: "Deep Water", look: "ocean", source: "words", music: { mood: "cinematic", level: "medium" },
    scenes: [
      { headline: "Some places the light never reaches", sub: "", seconds: 4 },
      { headline: "DEEP WATER", sub: "A film about what lives below", seconds: 4 },
      { headline: "Coming this autumn", sub: "", seconds: 4 },
    ],
  };
  const a = await post("/api/render", { plan: cinema, shape: "21:9", quality: "final" });
  copyFileSync(a.path, join(out, "sample-3-cinema-21x9.mp4"));
  console.log("cinema:", a.seconds, "s", a.frames, "frames");
  const portrait = {
    title: "Three calm habits", look: "paper", source: "words", music: { mood: "calm", level: "soft" },
    scenes: [
      { headline: "Three habits that make you calmer", sub: "", seconds: 3 },
      { headline: "Breathe before you reply", sub: "One slow breath is enough", seconds: 3 },
      { headline: "Walk after lunch", sub: "Ten minutes, no phone", seconds: 3 },
      { headline: "Switch off one hour before bed", sub: "", seconds: 3 },
    ],
  };
  const b = await post("/api/render", { plan: portrait, shape: "4:5", quality: "final" });
  copyFileSync(b.path, join(out, "sample-4-portrait-4x5.mp4"));
  console.log("portrait:", b.seconds, "s", b.frames, "frames");
})().catch((e) => { console.error("FAILED", e.message); process.exit(1); });
