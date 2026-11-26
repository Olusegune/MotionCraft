// Small sound effects made here, from nothing (like the music): no licence, no key, no network. They are simple synthesised sounds, not recordings:
// good enough to mark a moment (a match strike, a switch clack) under a voice, not a replacement for a sound designer.
import { createHash } from "node:crypto";
import { writeWav } from "./wav.ts";

export type Effect = { id: string; name: string; words: RegExp; seconds: number; db: number };

/** Every effect, the words in a script's sound note that ask for it, its length, and how loud it sits (decibels, under the voice). */
export const EFFECTS: Effect[] = [
  { id: "scratch", name: "Pencil scratch", words: /pencil|scratch/i, seconds: 2.0, db: -16 },
  { id: "fan", name: "Fan winding down", words: /\bfan\b/i, seconds: 3.6, db: -24 },
  { id: "match", name: "Match strike", words: /match/i, seconds: 1.4, db: -14 },
  { id: "tones", name: "Confirmation tones", words: /confirmation tones?|\btones\b/i, seconds: 2.6, db: -20 },
  { id: "clack", name: "Switch clack", words: /switch|clack/i, seconds: 0.5, db: -12 },
  { id: "hum", name: "Electrical hum", words: /\bhum\b|humming/i, seconds: 5, db: -28 },
  { id: "paper", name: "Paper sliding", words: /paper|sliding/i, seconds: 1.3, db: -20 },
  { id: "click", name: "Click off", words: /clicks?\b/i, seconds: 0.3, db: -14 },
  { id: "cable", name: "Pulling cable", words: /cable|crew/i, seconds: 3.2, db: -22 },
  { id: "footsteps", name: "Footsteps", words: /footsteps?|steps\b/i, seconds: 3.0, db: -20 },
  { id: "knock", name: "Door knocks", words: /knock/i, seconds: 1.4, db: -14 },
];
export const effectById = (id: string) => EFFECTS.find((e) => e.id === id);

/** Which effects a sound note asks for, in the order the note names them (each once). */
export function effectsFor(note: string): string[] {
  const hits: { id: string; at: number }[] = [];
  for (const e of EFFECTS) { const m = e.words.exec(note); if (m) hits.push({ id: e.id, at: m.index }); }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.id).slice(0, 6);
}

/** The file an effect is saved as: 12 hex characters from its id (so it is made once per video). */
export const fxFileName = (id: string) => createHash("sha1").update(`fx\0${id}`).digest("hex").slice(0, 12) + ".wav";

const RATE = 44100;
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; }; }

/** A stereo WAV for one effect. The same effect always makes the same sound, never clips, and starts and ends at silence. */
export function makeEffect(id: string): Buffer {
  const e = effectById(id) ?? EFFECTS[0];
  const n = Math.round(e.seconds * RATE), L = new Float32Array(n), R = new Float32Array(n);
  const noise = rng(id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const at = (t: number) => Math.min(n - 1, Math.max(0, Math.round(t * RATE)));
  /** Adds filtered noise for `dur` seconds from `t0`: `lp` smooths it (low-pass amount 0..0.99), `hp` removes the lows, `env` shapes it. */
  const burst = (t0: number, dur: number, amp: number, lp: number, hp: number, env: (x: number) => number) => {
    let lo = 0, prev = 0;
    for (let i = at(t0), k = 0; i < Math.min(n, at(t0 + dur)); i++, k++) {
      const raw = noise();
      lo = lo * lp + raw * (1 - lp);
      const hi = lo - prev * hp; prev = lo;
      const v = (hp > 0 ? hi : lo) * amp * env(k / (dur * RATE));
      L[i] += v; R[i] += v * 0.96;
    }
  };
  const tone = (t0: number, dur: number, f: number, amp: number, decay = 5) => {
    for (let i = at(t0), k = 0; i < Math.min(n, at(t0 + dur)); i++, k++) {
      const t = k / RATE, v = Math.sin(2 * Math.PI * f * t) * amp * Math.exp(-decay * t) * Math.min(1, t * 200);
      L[i] += v; R[i] += v;
    }
  };
  const bell = (x: number) => Math.sin(Math.PI * Math.min(1, Math.max(0, x)));
  const decay = (k: number) => (x: number) => Math.exp(-k * x) * Math.min(1, x * 40);
  switch (e.id) {
    case "scratch": for (const [t, d] of [[0.05, 0.3], [0.45, 0.35], [0.9, 0.25], [1.25, 0.4]]) burst(t, d, 0.5, 0.25, 0.9, bell); break;
    case "fan": { const dur = e.seconds; for (let i = 0; i < n; i++) { const t = i / RATE, slow = 1 - t / dur, rpm = 18 * slow * slow + 1.5; const v = noise() * 0.12 * (0.6 + 0.4 * Math.sin(2 * Math.PI * rpm * t)) * slow * Math.min(1, t * 8) * Math.min(1, (dur - t) * 4); L[i] = v; R[i] = v; } break; }
    case "match": burst(0.02, 0.18, 0.6, 0.35, 0.9, decay(6)); burst(0.18, 1.1, 0.35, 0.7, 0, (x) => Math.min(1, x * 12) * Math.exp(-3.2 * x)); break;
    case "tones": [660, 880, 990].forEach((f, k) => tone(k * 0.4, 0.3, f, 0.35, 9)); for (const f of [110, 165, 220]) tone(1.3, 1.3, f, 0.22, 1.6); break;
    case "clack": tone(0, 0.08, 1800, 0.5, 60); tone(0.09, 0.08, 1300, 0.45, 60); burst(0, 0.12, 0.4, 0.6, 0, decay(30)); break;
    case "hum": for (let i = 0; i < n; i++) { const t = i / RATE, v = (Math.sin(2 * Math.PI * 50 * t) * 0.5 + Math.sin(2 * Math.PI * 100 * t) * 0.3 + Math.sin(2 * Math.PI * 150 * t) * 0.12) * 0.3 * Math.min(1, t * 2) * Math.min(1, (e.seconds - t) * 2); L[i] = v; R[i] = v; } break;
    case "paper": burst(0.05, 1.1, 0.3, 0.4, 0.8, bell); break;
    case "click": tone(0, 0.05, 2200, 0.5, 90); burst(0, 0.05, 0.3, 0.5, 0, decay(40)); break;
    case "cable": for (let k = 0; k < 6; k++) burst(0.1 + k * 0.5, 0.35, 0.28, 0.5, 0.7, bell); break;
    case "footsteps": for (let k = 0; k < 6; k++) { burst(0.1 + k * 0.48, 0.12, 0.45, 0.93, 0, decay(14)); tone(0.1 + k * 0.48, 0.12, 70, 0.35, 25); } break;
    case "knock": for (let k = 0; k < 3; k++) { tone(0.1 + k * 0.38, 0.14, 150, 0.55, 28); burst(0.1 + k * 0.38, 0.08, 0.3, 0.9, 0, decay(30)); } break;
  }
  let peak = 0; for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peak > 0 ? 0.7 / peak : 1;                                    // always the same peak, so the level in the plan is the level heard
  for (let i = 0; i < n; i++) { const edge = Math.min(1, i / 200, (n - 1 - i) / 200); L[i] *= g * edge; R[i] *= g * edge; }   // a tiny fade at each end: no click
  return writeWav(L, R, RATE);
}

/** Where a scene's effects start: the first just after the scene begins, the others spread over the rest, each cut off at the end of the scene. */
export function fxTimes(sceneStart: number, sceneSeconds: number, ids: string[]): { id: string; start: number; seconds: number }[] {
  const out: { id: string; start: number; seconds: number }[] = [];
  const slot = Math.max(0.3, (sceneSeconds - 0.4) / Math.max(1, ids.length));
  for (const [k, id] of ids.entries()) {
    const e = effectById(id); if (!e) continue;
    const start = Math.round((sceneStart + 0.25 + k * slot) * 100) / 100;
    const room = sceneStart + sceneSeconds - start;
    if (room < 0.15) continue;
    out.push({ id, start, seconds: Math.round(Math.min(e.seconds, room) * 100) / 100 });
  }
  return out;
}
