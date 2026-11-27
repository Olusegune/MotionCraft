// A timed script (a table of rows: time, picture and motion, voice-over and sound) turned into scenes.
// Pure text work: no network, no files. The page is never trusted and neither is the script.
import type { Plan, Scene } from "./plan.ts";
import { effectsFor } from "./fx.ts";
import { looksLikeSceneScript, parseSceneScript } from "./scenescript.ts";

const TIME = /(\d{1,2}):(\d{2})\s*[–—\-]\s*(\d{1,2}):(\d{2})/;
const QUOTE = /[“"]([^”"]+)[”"]/;
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const plain = (s: string) => squash(s.replace(/\*\*/g, "").replace(/`/g, "").replace(/<br\s*\/?>/gi, " "));

export type ScriptScene = Scene & { speaker: string; sound: string };
export type ScriptPlan = Omit<Plan, "scenes"> & { scenes: ScriptScene[]; scriptSeconds: number };

/** Splits one table line into its cells, ignoring the pipes of an escaped \| . */
function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.replace(/\\\|/g, "|").trim());
}

/**
 * Reads a script. Rows are table lines whose first cell holds a time range such as 00:10-00:22. For each row:
 *  - seconds: the range's length;
 *  - card: the text after "Time card:" in backticks; the End title becomes the scene's headline;
 *  - say: the first quoted sentence of the voice-over cell (who speaks is the word before the colon: VO, or a name);
 *  - note: the picture and motion text, which becomes the starting words for an AI clip;
 *  - sound: what follows "Sound:".
 * Throws a plain sentence when no timed rows are found or the times do not make sense.
 */
export function parseScript(raw: string): ScriptPlan {
  const text = String(raw ?? "").slice(0, 60_000);
  const title = plain((/^\s*#\s+(.+)$/m.exec(text)?.[1] ?? "")).slice(0, 60) || "My film";
  const scenes: ScriptScene[] = [];
  let cursor = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const c = cells(line);
    const t = TIME.exec(plain(c[0] ?? ""));
    if (!t || c.length < 2) continue;
    const start = Number(t[1]) * 60 + Number(t[2]), end = Number(t[3]) * 60 + Number(t[4]);
    if (end <= start) throw new Error(`The times ${plain(c[0])} do not go forward.`);
    if (scenes.length && start + 0.5 < cursor) throw new Error(`The times ${plain(c[0])} start before the row above ends.`);
    cursor = end;
    const seconds = end - start;
    const pic = c[1] ?? "", audio = c.slice(2).join(" | ");
    let card = "", headline = "";
    const cardRe = /\*\*(time card|end title):?\*\*:?\s*`([^`]+)`/i;
    const cm = cardRe.exec(pic);
    if (cm) { if (/end title/i.test(cm[1])) headline = plain(cm[2]); else card = plain(cm[2]); }
    const note = plain(pic.replace(cardRe, "")).slice(0, 900);
    const sm = /\*\*sound:?\*\*:?\s*(.*)$/is.exec(audio);
    const sound = plain(sm ? sm[1] : "").slice(0, 300);
    const voicePart = sm ? audio.slice(0, sm.index) : audio;
    const vm = /\*\*([^*]+?):\*\*\s*(.*)$/s.exec(voicePart);
    const speaker = vm ? plain(vm[1]) : "";
    const spoken = QUOTE.exec(plain(vm ? vm[2] : voicePart))?.[1];
    scenes.push({ headline, sub: "", seconds: Math.round(seconds * 10) / 10, ...(card ? { card } : {}), ...(note ? { note } : {}), ...(spoken ? { say: squash(spoken).slice(0, 600) } : {}), ...(effectsFor(sound).length ? { fx: effectsFor(sound) } : {}), speaker: speaker.slice(0, 40), sound });
  }
  if (!scenes.length && looksLikeSceneScript(text)) return parseSceneScript(text);          // no times, but written as SCENE 1 — TITLE blocks
  if (!scenes.length) throw new Error("I could not find any timed rows or scenes. Each row of a table needs a time range such as 00:10-00:22 in its first column, or each scene a heading like SCENE 1 — THE LAST LIGHT.");
  if (scenes.length > 12) throw new Error("A video can have up to 12 scenes; this script has " + scenes.length + ".");
  const scriptSeconds = Math.round(scenes.reduce((n, s) => n + s.seconds, 0) * 10) / 10;
  if (scriptSeconds > 300) throw new Error("Keep it under five minutes.");
  return { title, look: "midnight", scenes, source: "words", scriptSeconds };
}

/** A person's name for the scene voice: "VO" and "Narrator" are the narrator; any other speaker (such as "Bisi, on mic") is a character. */
export const isNarrator = (speaker: string) => !speaker || /^(vo|v\.o\.|voice[- ]?over|narrator)\b/i.test(speaker.trim());
