// Music made here, from nothing: no licence, no key, no network. Four moods, each a short chord loop played by a few synthesised voices
// with a little echo, as long as the video needs. It is background music, not a composition: soft, steady, easy to talk over.
import { writeWav } from "./wav.ts";

export type Mood = { id: string; name: string; note: string };
export const MOODS: Mood[] = [
  { id: "calm", name: "Calm", note: "Slow, soft pads" },
  { id: "warm", name: "Warm", note: "Gentle plucked chords" },
  { id: "upbeat", name: "Upbeat", note: "Light beat and bright plucks" },
  { id: "cinematic", name: "Cinematic", note: "Low drone and slow swells" },
];

const RATE = 44100;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// Four chords as MIDI notes (a gentle pop progression in C and its relative minor), each held for a bar.
const CHORDS: number[][] = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];

type Spec = { bpm: number; pad: number; pluck: number; beat: number; drone: number; bell: number };
const SPEC: Record<string, Spec> = {
  calm: { bpm: 60, pad: 1, pluck: 0.0, beat: 0, drone: 0.2, bell: 0 },
  warm: { bpm: 84, pad: 0.45, pluck: 0.8, beat: 0, drone: 0, bell: 0 },
  upbeat: { bpm: 112, pad: 0.3, pluck: 0.7, beat: 1, drone: 0, bell: 0.3 },
  cinematic: { bpm: 54, pad: 0.7, pluck: 0, beat: 0, drone: 1, bell: 0.5 },
};

/** A deterministic pseudo-random number in 0..1 (so the same mood and length always make the same track). */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

export function makeMusic(moodId: string, seconds: number): Buffer {
  const spec = SPEC[moodId] ?? SPEC.calm;
  const secs = Math.max(2, Math.min(180, seconds));
  const n = Math.round(secs * RATE);
  const L = new Float32Array(n), R = new Float32Array(n);
  const beat = 60 / spec.bpm, bar = beat * 4;
  const rand = rng(moodId.length * 7919 + Math.round(secs));
  const add = (t0: number, dur: number, f: number, amp: number, shape: (t: number, d: number) => number, wave: (p: number) => number, pan = 0.5) => {
    const a = Math.floor(t0 * RATE), len = Math.min(Math.floor(dur * RATE), n - a);
    const gl = Math.cos(pan * Math.PI / 2), gr = Math.sin(pan * Math.PI / 2);
    for (let i = 0; i < len; i++) {
      const t = i / RATE, v = amp * shape(t, dur) * wave(2 * Math.PI * f * t);
      L[a + i] += v * gl; R[a + i] += v * gr;
    }
  };
  const sine = (p: number) => Math.sin(p);
  const soft = (p: number) => Math.sin(p) + 0.25 * Math.sin(2 * p) + 0.08 * Math.sin(3 * p);
  const swell = (t: number, d: number) => Math.min(1, t / (d * 0.35)) * Math.min(1, (d - t) / (d * 0.35));
  const pluck = (t: number, d: number) => Math.exp(-t * 4.5) * Math.min(1, t * 200) * (t < d ? 1 : 0);
  const bell = (t: number) => Math.exp(-t * 2.2) * Math.min(1, t * 400);

  const bars = Math.ceil(secs / bar);
  for (let b = 0; b < bars; b++) {
    const chord = CHORDS[b % CHORDS.length], t0 = b * bar;
    if (spec.pad > 0) chord.forEach((m, k) => { add(t0 - 0.05, bar + 0.6, hz(m - 12), 0.11 * spec.pad, swell, soft, 0.3 + 0.13 * k); add(t0 - 0.05, bar + 0.6, hz(m) * 1.003, 0.05 * spec.pad, swell, sine, 0.7 - 0.13 * k); });
    if (spec.drone > 0) add(t0 - 0.2, bar + 1, hz(chord[0] - 24), 0.16 * spec.drone, swell, soft, 0.5);
    if (spec.pluck > 0) {
      const steps = spec.beat ? 8 : 4;                                        // eighth notes in an upbeat bar, quarter notes otherwise
      for (let s = 0; s < steps; s++) {
        const m = chord[(s * 3 + (b % 2)) % chord.length] + (s % 4 === 3 ? 12 : 0);
        add(t0 + s * (bar / steps), 0.9, hz(m), 0.13 * spec.pluck, pluck, soft, 0.35 + 0.3 * ((s % 3) / 2));
      }
    }
    if (spec.bell > 0) for (let s = 0; s < 2; s++) add(t0 + (s * 2 + (rand() > 0.5 ? 0.5 : 1)) * beat, 2.5, hz(chord[(s + 1) % 4] + 12), 0.06 * spec.bell, bell, sine, 0.25 + 0.5 * rand());
    if (spec.beat) for (let q = 0; q < 4; q++) {
      const tk = t0 + q * beat;                                                // a soft kick on every beat and a quiet hat between
      add(tk, 0.25, 55, 0.22, (t) => Math.exp(-t * 18), (p) => Math.sin(p * (1 + 2.5 * Math.exp(-p / 300))), 0.5);
      const th = tk + beat / 2, a = Math.floor(th * RATE), len = Math.min(Math.floor(0.05 * RATE), n - a);
      for (let i = 0; i < len; i++) { const v = (rand() * 2 - 1) * 0.025 * Math.exp(-i / (0.012 * RATE)); L[a + i] += v; R[a + i] += v; }
    }
  }

  // A little echo for space, then a gentle fade at both ends and a limiter so nothing clips.
  const d1 = Math.round(beat * 0.75 * RATE), d2 = Math.round(beat * 1.5 * RATE);
  for (let i = n - 1; i >= 0; i--) {
    if (i >= d1) { L[i] += R[i - d1] * 0.28; R[i] += L[i - d1] * 0.28; }
    if (i >= d2) { L[i] += L[i - d2] * 0.16; R[i] += R[i - d2] * 0.16; }
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const gain = peak > 0 ? 0.8 / peak : 1;
  const fadeIn = Math.min(n / 4, Math.round(0.8 * RATE)), fadeOut = Math.min(n / 2, Math.round(2 * RATE));
  for (let i = 0; i < n; i++) {
    const g = gain * Math.min(1, i / fadeIn) * Math.min(1, (n - i) / fadeOut);
    L[i] *= g; R[i] *= g;
  }
  return writeWav(L, R, RATE);
}
