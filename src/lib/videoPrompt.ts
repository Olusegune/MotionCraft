import type { Beat, MotionProject } from "../types";
import { familyPrompt } from "./styles";

/**
 * Turning a still into a shot: the pieces a director would say (camera, performance, emotion, sound), joined into the prompt a video model gets.
 * Everything is shown to the person and can be edited; the finished prompt can also be replaced by hand.
 */

export interface CameraMove { id: string; label: string; text: string }
export const CAMERA_MOVES: CameraMove[] = [
  { id: "hold", label: "Locked off (no camera move)", text: "The camera is locked off and does not move; only the people and the world inside the frame move" },
  { id: "push", label: "Slow push in", text: "A slow, steady push-in towards the subject" },
  { id: "pull", label: "Slow pull back", text: "A slow pull-back that gradually reveals more of the surroundings" },
  { id: "pan-left", label: "Pan left", text: "A smooth pan to the left" },
  { id: "pan-right", label: "Pan right", text: "A smooth pan to the right" },
  { id: "tilt-up", label: "Tilt up", text: "A slow, smooth tilt upwards" },
  { id: "orbit", label: "Slow orbit around the subject", text: "A slow orbit around the subject, keeping them centred" },
  { id: "crane-up", label: "Rise and reveal (crane up)", text: "The camera rises slowly and reveals the wider scene" },
  { id: "handheld", label: "Gentle handheld", text: "Gentle handheld camera with a small, natural sway" },
  { id: "dolly-zoom", label: "Dolly zoom (vertigo)", text: "A dolly zoom: the camera moves back while the lens zooms in, so the background seems to stretch" },
];

export interface AnimateSettings {
  camera: string;                // a CAMERA_MOVES id
  performance: string;           // what the people (or things) do, and how
  emotion: string;               // what the shot should make you feel
  spoken: string;                // a line said by someone in the scene (not the voiceover)
  sound: boolean;                // ask for sound that belongs to the scene
  ambience: string;              // what that sound is
  duration: number;              // seconds
  resolution: "720p" | "1080p";
  negative: string;              // what must not appear
  keyColor?: "green" | "blue";   // shoot against a flat screen of this colour, to be keyed out and composited
  model?: string;                // "provider/model" last used
  prompt?: string;               // the whole prompt, written by hand; replaces the one built from the pieces above
}

const INTENSITY = ["", "barely felt", "subtle", "clear", "strong", "overwhelming"];

/** The scene's feeling in words, from its beat: "awe, with wonder; strong". */
export function emotionText(b: Pick<Beat, "primary" | "secondary" | "intensity">): string {
  const e = [b.primary, b.secondary].filter(Boolean).join(", with ");
  return `${e || "quiet attention"}; ${INTENSITY[b.intensity] ?? "clear"}`;
}

/** What the scene's plan says happens, trimmed to two sentences for the performance note. */
export function performanceFrom(plan: string): string {
  const t = (plan || "").replace(/\s+/g, " ").trim();
  let sentences: string[] = (t.match(/[^.!?]+[.!?]+/g) ?? [t]).map((x) => x.trim());
  if (sentences.length > 1 && /\s·\s/.test(sentences[0])) sentences = sentences.slice(1);       // "Opening · One window." is the shot's name, not the acting
  return sentences.slice(0, 2).join(" ").trim().slice(0, 320);
}

const SCREEN = {
  green: "pure chroma-key green (RGB 0, 177, 64)",
  blue: "pure chroma-key blue (RGB 0, 71, 255)",
};

export const screenName = (c: "green" | "blue"): string => SCREEN[c];

/** The words that ask a model for a clean, keyable screen. */
export function screenText(c: "green" | "blue"): string {
  const col = SCREEN[c];
  return `Background: the subject is shot against one flat, evenly lit, ${col} screen, edge to edge. Keep that screen exactly as it is: no gradient, no floor line, no shadows cast on it, no texture, nothing new behind it. `
    + `Keep the subject sharply lit and in focus, with a clean edge, no motion blur on the outline, and none of that colour on the subject, its clothes or its props.`;
}

export function defaultAnimate(p: MotionProject, b: Beat): AnimateSettings {
  const saved = p.treatment[b.beatId]?.animate;
  const t = p.treatment[b.beatId];
  const still = (p.assets ?? []).find((a) => a.id === (t?.stillAssetId ?? t?.frameAssetId));
  if (saved) return still?.screen && !saved.keyColor ? { ...saved, keyColor: still.screen } : saved;      // a new picture on a screen is animated keyed
  return {
    ...(still?.screen ? { keyColor: still.screen } : {}),
    camera: still?.screen ? "hold" : b.energy >= 4 ? "handheld" : b.energy <= 2 ? "push" : "pan-right",
    performance: performanceFrom(p.treatment[b.beatId]?.plan ?? "") || b.primary,
    emotion: emotionText(b),
    spoken: "",
    sound: true,
    ambience: "natural sound that belongs to the place, softly, with no music",
    duration: 8,
    resolution: "720p",
    negative: "text, captions, subtitles, logos, watermarks, extra fingers, distorted faces",
  };
}

/** The prompt sent to the model. A hand-written prompt replaces it whole. */
export function videoPrompt(p: MotionProject, _beat: Beat, s: AnimateSettings): string {
  if (s.prompt && s.prompt.trim()) return s.prompt.trim();
  const fam = p.style.dimensions.composition?.familyId ?? p.style.dimensions.typography?.familyId;
  const cam = CAMERA_MOVES.find((c) => c.id === s.camera) ?? CAMERA_MOVES[0];
  const parts = [
    s.keyColor ? "Bring this still image to life as one continuous shot of the same subject. Keep the same people, faces and clothing as in the picture." : "Bring this still image to life as one continuous cinematic shot. Keep the same people, faces, clothing, lighting and setting as in the picture.",
    s.keyColor ? screenText(s.keyColor) : "",
    `Camera: ${cam.text}.`,
    s.performance.trim() ? `Performance: ${s.performance.trim().replace(/[.]+$/, "")}. Natural, believable acting, with small human details.` : "",
    s.emotion.trim() ? `Emotion: ${s.emotion.trim()}. Let it show in the faces, the posture and the pace.` : "",
    s.spoken.trim() ? `Dialogue: one person in the scene says, "${s.spoken.trim().replace(/"/g, "'")}".` : "",
    s.sound ? `Sound: ${s.ambience.trim().replace(/[.]+$/, "") || "natural ambience"}.` : "No sound beyond the natural sound of the scene.",
    fam && !s.keyColor ? `Look: ${familyPrompt(fam)}.` : "",
    "No on-screen text, captions, subtitles, logos or watermarks.",
  ];
  return parts.filter(Boolean).join(" ").slice(0, 3900);
}

/** Aspect ratios the video models take. Veo makes 16:9 or 9:16; a wider film (21:9) is cropped to fit when the clip is placed, which the picture already does. */
export function videoAspect(aspect: string): "16:9" | "9:16" {
  return aspect === "9:16" || aspect === "4:5" ? "9:16" : "16:9";
}

export interface VideoLimits { durations: number[]; resolutions: ("720p" | "1080p")[] }
/** What a model can do. Veo 3.1 makes 4, 6 or 8 seconds, and 1080p only at 8 seconds; anything else is offered the safe middle. */
export function videoLimits(model: string): VideoLimits {
  if (model.startsWith("veo-")) return { durations: [4, 6, 8], resolutions: ["720p", "1080p"] };
  if (isFalVeo(model)) return { durations: [4, 6, 8], resolutions: ["720p", "1080p"] };
  return { durations: [5], resolutions: ["720p"] };
}

/** Veo as fal serves it (fal-ai/veo3/..., fal-ai/veo3.1/...): the same lengths, but its own parameter names. */
export const isFalVeo = (model: string) => /(^|\/)veo3(\.\d+)?(\/|$)/.test(model);

/**
 * The parameters to send with the prompt and the picture, for the models whose parameters are known. Anything else gets none and uses its own defaults, which
 * is safe: an unknown parameter is what makes a model refuse the job.
 */
export function modelParams(provider: string, model: string, s: AnimateSettings, aspect: "16:9" | "9:16"): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (provider === "google" && model.startsWith("veo-")) {
    Object.assign(out, { aspect_ratio: aspect, duration: s.duration, resolution: s.resolution, person_generation: "allow_adult" });
    if (s.negative.trim()) out.negative_prompt = s.negative.trim().slice(0, 190);
  } else if (provider === "fal" && isFalVeo(model)) {
    Object.assign(out, { aspect_ratio: aspect, duration: `${s.duration}s`, resolution: s.resolution, generate_audio: s.sound });
    if (s.negative.trim()) out.negative_prompt = s.negative.trim().slice(0, 190);
  }
  return out;
}

/** The settings made valid for the chosen model: a duration it offers, and 1080p only where it is allowed. */
export function fitToModel(s: AnimateSettings, model: string): AnimateSettings {
  const l = videoLimits(model);
  const duration = l.durations.includes(s.duration) ? s.duration : l.durations[l.durations.length - 1];
  const resolution = l.resolutions.includes(s.resolution) && !(model.startsWith("veo-") && s.resolution === "1080p" && duration !== 8) ? s.resolution : "720p";
  return { ...s, duration, resolution };
}
