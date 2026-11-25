import type { Beat, MotionProject, Purpose, Tone } from "../types";
import { beatsFromScript, parseEmotionArc, parseTimedScript } from "./briefParse";

/**
 * "Make it": the Director's draft turned into a starting look and a plan for every scene, so nobody fills three pages before seeing anything.
 * Everything here only proposes. The person reviews once, and approving is theirs.
 */

const TONE_LOOK: Partial<Record<Tone, string>> = {
  playful: "bold-kinetic", elegant: "editorial-minimal", authoritative: "clean-broadcast", trustworthy: "clean-broadcast",
  instructional: "swiss", provocative: "brutalist", restrained: "editorial-minimal",
};

/** What a piece is about, in its own words, decides the look before any tone word does. */
const SUBJECT_LOOK: [RegExp, string][] = [
  [/\b(cosmic|universe|galax|space|sci-?fi|futur|civili[sz]ation|planet|orbit|stellar)/i, "cinematic-title"],
  [/\b(neon|nightclub|club|synth|cyber|rave)/i, "neon-light"],
  [/\b(luxury|premium|fashion|boutique|editorial|heritage)/i, "editorial-minimal"],
  [/\b(startup|saas|software|dashboard|fintech|product launch)/i, "clean-broadcast"],
  [/\b(kids|children|party|birthday|toy|fun)\b/i, "cut-paper"],
];

/** A look that fits the piece: what it is about first (a cosmic piece is cinematic whatever the tone word), then the tone, then the energy. */
export function suggestLook(p: Pick<MotionProject, "intent"> & { brief?: { text?: string } }): string {
  const about = `${p.intent.summary} ${p.brief?.text ?? ""}`;
  for (const [re, look] of SUBJECT_LOOK) if (re.test(about)) return look;
  for (const t of p.intent.tone) { const f = TONE_LOOK[t]; if (f) return f; }
  const arc = p.intent.arc;
  const avg = arc.length ? arc.reduce((n, b) => n + b.energy, 0) / arc.length : 3;
  return avg >= 4 ? "bold-kinetic" : avg <= 2 ? "cinematic-title" : "editorial-minimal";
}

const PACE = ["a very slow, still pace", "a slow, calm pace", "a steady pace", "a lively pace", "a fast, driving pace"];

function planFor(b: Beat): string {
  const len = Math.max(0, b.endSec - b.startSec);
  return `${b.primary || "This scene"} (${len % 1 ? len.toFixed(1) : len} seconds): one clear idea on screen, set up in the first second and held with room to breathe.`;
}

/** One plan and one motion note per scene that has none yet, written from the scene's own name, length and energy. Never overwrites what a person wrote. */
export function fillTreatment(p: MotionProject): MotionProject {
  const treatment = { ...p.treatment };
  const segs = parseTimedScript(`${p.brief.text}
${p.brief.script ?? ""}`, p.brief.deliverables[0]?.durationSec);
  for (const b of p.intent.arc) {
    const cur = treatment[b.beatId];
    if ((cur?.plan ?? "").trim()) continue;
    const mid = (b.startSec + b.endSec) / 2;
    const seg = segs.find((x) => mid >= x.start && mid < x.end);              // what the script itself says happens in this scene
    treatment[b.beatId] = { ...cur, plan: seg?.visual ? `${seg.visual}${seg.onScreen ? ` On screen: ${seg.onScreen}` : ""}` : planFor(b), motion: cur?.motion?.trim() ? cur.motion : `${PACE[b.energy - 1]}, building to intensity ${b.intensity} of 5` };
  }
  return { ...p, treatment };
}

/**
 * A picture for every scene that has none: the project's pictures not yet used by a scene, in the order they were added (made or imported).
 * Never replaces a picture a person chose, and never reuses one while there are unused ones left.
 */
export function fillFrames(p: MotionProject): MotionProject {
  const images = (p.assets ?? []).filter((a) => (a.kind === "image" || a.kind === "video") && a.check?.lettering !== true);   // the person's own pictures and clips first; a picture with lettering in it is not given out
  const used = new Set(p.intent.arc.map((b) => p.treatment[b.beatId]?.frameAssetId).filter(Boolean) as string[]);
  const free = images.filter((a) => !used.has(a.id));
  if (!free.length) return p;
  const treatment = { ...p.treatment };
  let n = 0;
  for (const b of p.intent.arc) {
    if (treatment[b.beatId]?.frameAssetId || n >= free.length) continue;
    treatment[b.beatId] = { ...(treatment[b.beatId] ?? { plan: "", motion: "" }), frameAssetId: free[n++].id };
  }
  return n ? { ...p, treatment } : p;
}

/** The pictures and clips to put behind the scenes: one per scene that has one chosen, with the scene's time range. At most 16. */
export function scenePictureItems(p: MotionProject): { rel: string; t_in: number; t_out: number; name: string; loop?: boolean }[] {
  return p.intent.arc.flatMap((b) => {
    const a = (p.assets ?? []).find((x) => (x.kind === "image" || x.kind === "video") && x.id === p.treatment[b.beatId]?.frameAssetId);
    return a ? [{ rel: a.path, t_in: b.startSec, t_out: b.endSec, name: b.primary, ...(a.kind === "video" && p.treatment[b.beatId]?.frameLoop ? { loop: true } : {}) }] : [];
  }).slice(0, 16);
}

const TONE_WORDS: [RegExp, Tone][] = [
  [/\b(playful|fun|joy|whimsical|cheeky)/i, "playful"], [/\b(elegant|luxur|refined|premium|graceful)/i, "elegant"],
  [/\b(authorit|expert|official|bold claim)/i, "authoritative"], [/\b(trust|reliable|safe|honest|secure)/i, "trustworthy"],
  [/\b(explain|tutorial|how to|learn|instruct|guide)/i, "instructional"], [/\b(provocat|shock|disrupt|rebel|edgy)/i, "provocative"],
  [/\b(calm|quiet|minimal|restrained|still|understated)/i, "restrained"],
];
const DEFAULT_SCENES = ["Opening", "Build", "Peak", "Resolution"];

/**
 * A starting intent with no language model: the scenes from a timed script when there is one, otherwise four even scenes; the tone
 * from the words in the brief. It is a plain draft for the person to review and change, and says so. Never needs a key or the network.
 */
export function offlineIntent(p: Pick<MotionProject, "brief">): MotionProject["intent"] {
  const text = `${p.brief.text}
${p.brief.script ?? ""}`;
  const dur = Math.max(1, p.brief.deliverables[0]?.durationSec ?? 15);
  const segs = parseTimedScript(text, dur);
  const journey = parseEmotionArc(p.brief.text).map((j) => j.charAt(0).toUpperCase() + j.slice(1));
  let arc: Beat[];
  if (segs.length) arc = beatsFromScript(segs, journey, dur);
  else {
    // The emotional journey the brief names ("curiosity -> awe -> quiet mastery") gives the scenes; otherwise four even ones.
    const names = journey.length >= 2 ? journey : DEFAULT_SCENES;
    const n = names.length, len = dur / n;
    arc = names.map((name, i) => {
      const progress = n > 1 ? i / (n - 1) : 0.5;
      const energy = Math.min(5, Math.max(1, Math.round(i === n - 1 && n > 2 ? 2 : 2 + progress * 3))) as Beat["energy"];
      return { beatId: `b${i + 1}`, startSec: Math.round(i * len * 10) / 10, endSec: Math.round((i + 1) * len * 10) / 10, primary: name, intensity: Math.min(5, Math.max(1, Math.round(2 + progress * 3))) as Beat["intensity"], energy };
    });
  }
  const tone = TONE_WORDS.filter(([re]) => re.test(text)).map(([, t]) => t).slice(0, 3);
  const first = p.brief.text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  const purpose: Purpose = /\b(sell|launch|buy|offer|sale|product)/i.test(text) ? "sell" : /\b(teach|tutorial|how to|learn|lesson)/i.test(text) ? "teach"
    : /\b(announce|introducing|unveil|reveal)/i.test(text) ? "announce" : /\b(celebrate|birthday|anniversary|thank)/i.test(text) ? "celebrate"
    : /\b(remember|memorial|tribute|in memory)/i.test(text) ? "memorialize" : /\b(persuade|convince|campaign|cause)/i.test(text) ? "persuade"
    : /\b(story|film|trailer|music|cosmic)/i.test(text) ? "entertain" : "inform";
  return { purpose, tone, arc, summary: first.slice(0, 220), firedRules: [], source: "user" };
}

/**
 * The Director's scenes lined up with the script's rows. A language model can drop or merge a row (it gave nine scenes for a ten-row script and
 * left the last seven seconds uncovered). Where a script has timed rows, there is one scene per row: the model's emotion and intensity are kept for
 * every row it covered (matched by start time), and a row it missed gets a scene from the script itself.
 */
export function reconcileArc(arc: Beat[], text: string, durationSec: number): Beat[] {
  const segs = parseTimedScript(text, durationSec);
  if (segs.length < 2) return arc;
  return beatsFromScript(segs, [], durationSec).map((sb) => {
    const m = arc.find((b) => Math.abs(b.startSec - sb.startSec) <= 0.6);
    return m ? { ...m, beatId: sb.beatId, startSec: sb.startSec, endSec: sb.endSec } : sb;
  });
}
