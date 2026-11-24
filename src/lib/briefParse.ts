import type { Beat, Deliverable } from "../types";
import { BASE_SIZES, nearestFps, sizeFor, fpsLabel } from "./formats";
import { clock } from "./songmap";

/**
 * Reading what a person already wrote. A brief often says how long, what shape, how fast and how sharp ("10 seconds, 16:9, 4K, 24 fps"), and often
 * carries a timed script as a table. This turns that text into settings, scenes and sound cues so nobody types them twice. Pure, no guessing beyond
 * what the words say: anything it cannot read is left out, and the page shows what it found before anything is used.
 */

export interface FoundSettings { durationSec?: number; aspect?: Deliverable["aspect"]; fps?: Deliverable["fps"]; width?: number; height?: number; resolution?: string }

const ASPECTS: Deliverable["aspect"][] = ["16:9", "9:16", "1:1", "4:5", "2.39:1", "21:9"];

/** Duration, aspect, frame rate and resolution as written. Only the first mention of each is used. */
export function parseSettings(text: string): FoundSettings {
  const t = String(text || "");
  const out: FoundSettings = {};
  const d = /(\d{1,4}(?:\.\d+)?)\s*[- ]?\s*(?:seconds?|secs?|s)\b(?![a-z])/i.exec(t);
  if (d) { const n = parseFloat(d[1]); if (n >= 1 && n <= 600) out.durationSec = n; }
  const a = /(?<![\d:.])(16\s*:\s*9|9\s*:\s*16|1\s*:\s*1|4\s*:\s*5|21\s*:\s*9|2\.39\s*:\s*1)(?![\d:])/.exec(t);
  if (a) { const v = a[1].replace(/\s+/g, "") as Deliverable["aspect"]; if (ASPECTS.includes(v)) out.aspect = v; }
  const f = /(\d{2}(?:\.\d{1,3})?)\s*(?:fps|frames per second|frames\/s)\b/i.exec(t);
  if (f) { const v = nearestFps(parseFloat(f[1])); if (v) out.fps = v; }
  const wh = /\b(\d{3,5})\s*[x×]\s*(\d{3,5})\b/.exec(t);
  if (wh) {
    const w = parseInt(wh[1], 10), h = parseInt(wh[2], 10);
    if (w >= 320 && h >= 240 && w <= 8192 && h <= 8192) {
      out.width = w - (w % 2); out.height = h - (h % 2);
      if (!out.aspect) out.aspect = [...BASE_SIZES].sort((p, q) => Math.abs(p.width / p.height - w / h) - Math.abs(q.width / q.height - w / h))[0].aspect;
    }
  } else {
    const r = /\b(8K|4K|UHD|2160p|2K|1440p|QHD|1080p|FHD|full hd|720p)\b/i.exec(t);
    if (r) {
      const k = r[1].toLowerCase();
      const scale = k === "8k" ? 4 : k === "4k" || k === "uhd" || k === "2160p" ? 2 : k === "2k" || k === "1440p" || k === "qhd" ? 4 / 3 : k === "720p" ? 2 / 3 : 1;
      out.resolution = r[1];
      const s = sizeFor(out.aspect ?? "16:9", scale);
      out.width = s.width; out.height = s.height;
    }
  }
  return out;
}

/** A line of readable facts for the page: "10 seconds", "16:9", "24 fps", "3840 × 2160". */
export function describeSettings(s: FoundSettings): string[] {
  const out: string[] = [];
  if (s.durationSec !== undefined) out.push(`${s.durationSec} seconds`);
  if (s.aspect) out.push(s.aspect);
  if (s.fps) out.push(`${fpsLabel(s.fps)} fps`);
  if (s.width && s.height) out.push(`${s.width} × ${s.height}${s.resolution ? ` (${s.resolution.toUpperCase() === s.resolution ? s.resolution : s.resolution})` : ""}`);
  return out;
}

export interface ScriptSegment { start: number; end: number; visual: string; onScreen: string; audio: string }

const NUM = String.raw`(\d{1,2}:\d{2}(?:\.\d+)?|\d+(?:\.\d+)?)`;
const RANGE = new RegExp(String.raw`^\s*${NUM}\s*s?\s*[–—-]\s*${NUM}\s*s?\s*$`);
const toSec = (v: string): number => (v.includes(":") ? v.split(":").reduce((acc, p) => acc * 60 + parseFloat(p), 0) : parseFloat(v));
const strip = (v: string): string => v.replace(/\*+|`/g, "").replace(/\s+/g, " ").trim();
const unlabel = (v: string, ...labels: string[]): string => v.replace(new RegExp(String.raw`^(?:${labels.join("|")})\s*[:\-]\s*`, "i"), "").trim();

/**
 * Rows that start with a time range, as a table or as pipe-separated lines: "0:00–0:02 | what happens | on-screen text | audio".
 * Cells can carry the labels "On-screen text:" and "Audio:", in any order. Rows must go forward in time and sit inside `maxSec` when given.
 */
export function parseTimedScript(text: string, maxSec?: number): ScriptSegment[] {
  const rows: ScriptSegment[] = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    if (!line.includes("|") && !line.includes("\t")) continue;
    if (/^[\s|:\-]+$/.test(line)) continue;                                   // a table's separator row
    const cells = line.split(/\||\t/).map(strip).filter((c) => c.length);
    if (cells.length < 2) continue;
    const m = RANGE.exec(cells[0]);
    if (!m) continue;
    const start = toSec(m[1]), end = toSec(m[2]);
    if (!(end > start) || start < 0) continue;
    const rest = cells.slice(1);
    let visual = "", onScreen = "", audio = "";
    const loose: string[] = [];
    for (const c of rest) {
      if (/^(?:on[- ]?screen(?: text)?|text|title|caption)\s*[:\-]/i.test(c)) onScreen = unlabel(c, "on-?screen(?: text)?", "text", "title", "caption");
      else if (/^(?:audio|sound|music|sfx|vo|narration)\s*[:\-]/i.test(c)) audio = unlabel(c, "audio", "sound", "music", "sfx", "vo", "narration");
      else if (/^(?:visual|picture|image|action)\s*[:\-]/i.test(c)) visual = unlabel(c, "visual", "picture", "image", "action");
      else loose.push(c);
    }
    if (!visual && loose.length) visual = loose.shift()!;
    if (!onScreen && loose.length) onScreen = loose.shift()!;
    if (!audio && loose.length) audio = loose.shift()!;
    rows.push({ start, end, visual, onScreen, audio });
  }
  rows.sort((a, b) => a.start - b.start);
  const kept: ScriptSegment[] = [];
  for (const r of rows) {
    if (maxSec !== undefined && r.start >= maxSec) continue;
    const prev = kept[kept.length - 1];
    if (prev && r.start < prev.end - 1e-6) continue;                          // overlapping rows: keep the first
    kept.push(maxSec !== undefined ? { ...r, end: Math.min(r.end, maxSec) } : r);
  }
  return kept;
}

/** The emotional journey as written: "curiosity → awe → quiet mastery" gives ["curiosity", "awe", "quiet mastery"]. */
export function parseEmotionArc(text: string): string[] {
  const m = /(?:journey|arc|progression)[^\n.]*?(?:is|:)\s*\**\s*([^\n.]*?(?:→|->|—>|=>)[^\n.]*)/i.exec(String(text || ""));
  if (!m) return [];
  return m[1].split(/→|->|—>|=>/).map((x) => strip(x).replace(/[.;,]+$/, "").toLowerCase()).filter((x) => x.length > 0 && x.length < 40).slice(0, 8);
}

const clamp5 = (n: number): Beat["energy"] => Math.min(5, Math.max(1, Math.round(n))) as Beat["energy"];
const LOUD = /(bass|impact|swell|chord|hit|drop|crescendo|rise|reveal|surge|boom)/i;
const SOFT = /(quiet|silence|delicate|soft|resolve|resonance|fade|hush|calm|gentle|whisper)/i;

/**
 * One beat for every row of the timed script. The names come from the emotional journey when there is one, spread over the piece by where each row sits;
 * otherwise the row's own opening words. Intensity rises across the piece; energy follows the sound the script describes (a bass impact is higher than a hush).
 */
export function beatsFromScript(segments: ScriptSegment[], journey: string[] = [], durationSec?: number): Beat[] {
  if (!segments.length) return [];
  const total = durationSec ?? segments[segments.length - 1].end;
  return segments.map((s, i) => {
    const mid = (s.start + s.end) / 2;
    const name = journey.length ? journey[Math.min(journey.length - 1, Math.floor((mid / Math.max(total, 1e-6)) * journey.length))]
      : (s.visual.split(/[.;,]/)[0] || `Scene ${i + 1}`).slice(0, 32).trim();
    const progress = segments.length > 1 ? i / (segments.length - 1) : 0.5;
    const sound = `${s.audio} ${s.visual}`;
    const energy = clamp5(2 + (LOUD.test(sound) ? 1.5 : 0) - (SOFT.test(sound) ? 1 : 0) + (progress > 0.3 && progress < 0.8 ? 0.5 : 0));
    return { beatId: `b${i + 1}`, startSec: s.start, endSec: s.end, primary: name, intensity: clamp5(2 + progress * 2.5), energy };
  });
}

/** The sound the script asks for, as time-pinned cues: the start of each row that has an audio note. */
export function cuesFromScript(segments: ScriptSegment[]): { t: number; text: string }[] {
  return segments.filter((s) => s.audio.trim()).map((s) => ({ t: s.start, text: `Sound at ${clock(s.start)}: ${s.audio.trim().replace(/\.$/, "")}` }));
}
