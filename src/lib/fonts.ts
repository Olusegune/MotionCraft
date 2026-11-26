import type { MotionProject } from "../types";

/**
 * Choosing type for a project. A mood names a look for the lettering (sleek and futuristic, cinematic, editorial...) and lists, in order of preference,
 * the typefaces that carry it: the first one EffectCraft can actually use on this computer is chosen. Fonts that are not installed are never picked, because
 * EffectCraft would draw the text in a substitute. Everything can be overridden by hand.
 */
export interface FontMood {
  id: string; label: string; blurb: string;
  display: string[];     // titles and labels, best first
  body: string[];        // small text, tags, supporting lines
  sample: string;        // the specimen shown in the picker
}

export const FONT_MOODS: FontMood[] = [
  { id: "futuristic", label: "Sleek futuristic", blurb: "Wide, geometric, a little technical: space, technology, the future.",
    display: ["Orbitron", "Michroma", "Audiowide", "Oxanium", "Chakra Petch", "Exo 2", "Exo", "Rajdhani", "Agency FB", "Bahnschrift", "Space Grotesk", "Segoe UI", "Helvetica Neue"],
    body: ["Space Grotesk", "Exo 2", "Inter", "Bahnschrift", "Segoe UI", "Helvetica Neue"], sample: "TYPE I · PLANETARY" },
  { id: "cinematic", label: "Cinematic title", blurb: "Quiet, wide-set capitals with a serif for the details: film titles, trailers.",
    display: ["Cormorant Garamond", "Cormorant", "Playfair Display", "Trajan Pro", "Cinzel", "Bodoni MT", "Book Antiqua", "Noto Serif", "Georgia"],
    body: ["Inter", "Montserrat", "Segoe UI", "Helvetica Neue"], sample: "A QUIET MASTERY" },
  { id: "editorial", label: "Editorial", blurb: "Refined and readable: luxury, essays, long captions.",
    display: ["Playfair Display", "Lora", "Cormorant Garamond", "Noto Serif", "Georgia", "Baskerville Old Face", "Bodoni MT"],
    body: ["Inter", "DM Sans", "Source Sans 3", "Segoe UI", "Helvetica Neue"], sample: "The Quiet Hours" },
  { id: "kinetic", label: "Bold kinetic", blurb: "Heavy, condensed, loud: promos, sports, music, fast cuts.",
    display: ["Bebas Neue", "Anton", "Oswald", "Antonio", "Barlow Condensed", "Teko", "Impact", "Franklin Gothic Demi Cond", "Bahnschrift"],
    body: ["Barlow", "Inter", "Archivo", "Segoe UI", "Helvetica Neue"], sample: "TURN IT UP" },
  { id: "technical", label: "Technical", blurb: "Monospaced and exact: code, data, engineering, blueprints.",
    display: ["JetBrains Mono", "IBM Plex Mono", "Share Tech Mono", "Space Mono", "Major Mono Display", "Cascadia Code", "Consolas"],
    body: ["JetBrains Mono", "IBM Plex Mono", "Inter", "Consolas"], sample: "v0.24.1 / READY" },
  { id: "friendly", label: "Friendly and clear", blurb: "Rounded and warm: explainers, education, products, kids.",
    display: ["Poppins", "Lexend", "Sora", "Montserrat", "Century Gothic", "Trebuchet MS", "Segoe UI", "Verdana"],
    body: ["Inter", "Lexend", "DM Sans", "Segoe UI", "Verdana"], sample: "Let's get started" },
  { id: "brutalist", label: "Brutalist", blurb: "Raw and blunt: heavy grotesques, no polish.",
    display: ["Archivo", "Anton", "Impact", "Arial Black", "Bahnschrift", "Roboto Condensed", "Arial"],
    body: ["Space Mono", "Archivo", "Arial", "Inter"], sample: "NO DECORATION" },
  { id: "clean", label: "Clean and modern", blurb: "Neutral and sharp: product, corporate, broadcast.",
    display: ["Inter", "Manrope", "DM Sans", "Montserrat", "Segoe UI", "Helvetica Neue", "Arial"],
    body: ["Inter", "DM Sans", "Segoe UI", "Helvetica Neue", "Arial"], sample: "Introducing the new standard" },
];

export interface FontChoice { mood: string; display: string; body: string }

/** The first candidate that is installed, ignoring case. With no list of installed fonts, the first candidate (so the choice still reads sensibly, marked as unchecked). */
export function firstAvailable(candidates: string[], available: Set<string> | null): string {
  if (!available) return candidates[0];
  const have = new Map([...available].map((f) => [f.toLowerCase(), f]));
  for (const c of candidates) { const hit = have.get(c.toLowerCase()); if (hit) return hit; }
  return "";
}

export function pickFonts(moodId: string, available: Set<string> | null): FontChoice {
  const m = FONT_MOODS.find((x) => x.id === moodId) ?? FONT_MOODS[FONT_MOODS.length - 1];
  const display = firstAvailable(m.display, available);
  const body = firstAvailable(m.body, available) || display;
  return { mood: m.id, display: display || body, body: body || display };
}

/** Which mood suits a project: from the look chosen in Direction first, then the words of the brief, then the tone. */
const LOOK_MOOD: Record<string, string> = {
  "neon-light": "futuristic", "retro-futurist": "futuristic", "cyberpunk": "futuristic", "glitch": "futuristic", "vaporwave": "futuristic", "y2k-chrome": "futuristic", "data-viz": "technical", "blueprint": "technical",
  "cinematic-title": "cinematic", "film-noir": "cinematic", "art-deco": "cinematic", "title-sequence-60s": "cinematic", "editorial-minimal": "editorial", "art-nouveau": "editorial",
  "bold-kinetic": "kinetic", "pop-art": "kinetic", "brutalist": "brutalist", "swiss": "clean", "clean-broadcast": "clean", "glassmorphism": "clean", "bauhaus": "clean",
  "cut-paper": "friendly", "claymation": "friendly", "flat-2d": "friendly", "cel-animation": "friendly", "memphis": "friendly", "hand-drawn": "friendly", "pixel-art": "technical",
};
const WORD_MOOD: [RegExp, string][] = [
  [/\b(futur|sci-?fi|space|cosmic|galax|civili[sz]ation|kardashev|cyber|robot|ai\b|quantum|orbit|stellar|planet)/i, "futuristic"],
  [/\b(code|developer|api|engineering|schematic|dataset|terminal)/i, "technical"],
  [/\b(luxury|fashion|heritage|boutique|editorial|essay)/i, "editorial"],
  [/\b(trailer|film title|cinematic|epic|noir)/i, "cinematic"],
  [/\b(kids|children|learn|tutorial|explain|friendly)/i, "friendly"],
  [/\b(sport|festival|promo|drop|hype|loud)/i, "kinetic"],
];
export function suggestMood(p: Pick<MotionProject, "style" | "brief" | "intent">): string {
  const words = `${p.brief?.text ?? ""} ${p.intent?.summary ?? ""}`;
  for (const [re, m] of WORD_MOOD) if (re.test(words)) return m;           // what the piece is about first: a space film is futuristic whatever look it was given
  const fam = p.style?.dimensions?.typography?.familyId ?? p.style?.dimensions?.composition?.familyId;
  if (fam && LOOK_MOOD[fam]) return LOOK_MOOD[fam];
  return "clean";
}

/** The fonts for a project: the person's choice if there is one, otherwise the best for its mood from what is installed. */
export function projectFonts(p: MotionProject, available: Set<string> | null): FontChoice {
  const chosen = p.style.fonts;
  if (chosen?.display) return chosen;
  return pickFonts(suggestMood(p), available);
}
