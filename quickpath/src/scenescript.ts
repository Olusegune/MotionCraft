// A script with no times, written as scenes: "SCENE 1 — THE LAST LIGHT", a line saying where and what part of the song, then paragraphs of action.
// (A music-video or screenplay style script, as it comes out of a PDF or a Word file.) Pure text work: no files, no network.
import type { ScriptPlan, ScriptScene } from "./script.ts";

const HEAD = /^\s*SCENE\s+(\d+)\s*[—–:\-]\s*(.+?)\s*$/i;
const STOP = /^\s*(?:END\.?|THE END\.?|Direction and (?:science )?notes.*)\s*$/i;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const mostlyCaps = (s: string) => { const letters = s.replace(/[^A-Za-z]/g, ""); return letters.length >= 6 && letters.replace(/[^A-Z]/g, "").length / letters.length > 0.6; };

export const looksLikeSceneScript = (text: string) => /^\s*SCENE\s+\d+\s*[—–:\-]/im.test(String(text ?? ""));

/**
 * Reads scenes from "SCENE n — TITLE" blocks. Each block becomes a scene with no words on screen and no voice; its title, its "where and what part of the song"
 * line and its action paragraphs become the scene's direction (the starting words for an AI clip). There are no times in such a script, so the lengths are
 * a fair guess (about 15 seconds a scene, longer for scenes with more to show) and meant to be changed, or fitted to the song with "Fit scenes to the music".
 */
export function parseSceneScript(raw: string): ScriptPlan {
  const lines = String(raw ?? "").slice(0, 120_000).split(/\r?\n/);
  const first = lines.map((l) => l.trim()).find((l) => l && !HEAD.test(l));
  const title = squash((first ?? "").replace(/\*\*/g, "")).slice(0, 60) || "My film";
  type Block = { name: string; lines: string[] };
  const blocks: Block[] = [];
  for (const line of lines) {
    const m = HEAD.exec(line);
    if (m) { blocks.push({ name: squash(m[2]), lines: [] }); continue; }
    if (blocks.length && STOP.test(line)) break;
    if (blocks.length) blocks[blocks.length - 1].lines.push(line);
  }
  if (!blocks.length) throw new Error("I could not find any scenes. Each scene needs a heading like SCENE 1 — THE LAST LIGHT.");
  if (blocks.length > 12) throw new Error(`A video can have up to 12 scenes; this script has ${blocks.length}. Join some scenes and try again.`);
  const scenes: (ScriptScene & { weight: number })[] = blocks.map((b) => {
    const nonEmpty = b.lines.map((l) => l.trim()).filter(Boolean);
    const where = nonEmpty.length && mostlyCaps(nonEmpty[0]) ? nonEmpty.shift()! : "";
    const body = squash(nonEmpty.join(" ").replace(/\*\*/g, ""));
    const stop = (s: string) => (/[.!?]$/.test(s) ? s : s + ".");                       // no doubled marks after a title that ends in a question mark
    const note = squash(`${stop(b.name)} ${where ? stop(where) + " " : ""}${body}`).slice(0, 900);
    return { headline: "", sub: "", seconds: 0, note, speaker: "", sound: "", weight: 1 + Math.min(body.length, 1500) / 700 };
  });
  const total = Math.max(20, Math.min(300, blocks.length * 15));
  const sum = scenes.reduce((n, s) => n + s.weight, 0);
  for (const s of scenes) s.seconds = Math.max(4, Math.round((total * s.weight) / sum * 2) / 2);
  const out = scenes.map(({ weight, ...s }) => s);
  const scriptSeconds = Math.round(out.reduce((n, s) => n + s.seconds, 0) * 10) / 10;
  return { title, look: "midnight", scenes: out, source: "words", scriptSeconds };
}
