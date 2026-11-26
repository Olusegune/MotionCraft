// A small set of looks. Colours are EffectCraft floats (0 to 1). No look is the default identity: the person picks one.
export type Rgb = [number, number, number];
export type Look = { id: string; name: string; bg: Rgb; bg2: Rgb; text: Rgb; accent: Rgb; words: string[] };

const c = (hex: string): Rgb => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

export const LOOKS: Look[] = [
  { id: "midnight", name: "Midnight", bg: c("#12142B"), bg2: c("#1B1F45"), text: c("#F4F5FB"), accent: c("#FFC857"), words: ["night", "tech", "future", "premium", "luxury", "dark", "cinematic", "space"] },
  { id: "sunrise", name: "Sunrise", bg: c("#FFF1E0"), bg2: c("#FFE2C2"), text: c("#2A1B12"), accent: c("#F25C2A"), words: ["warm", "coffee", "food", "morning", "cozy", "family", "friendly", "bakery"] },
  { id: "paper", name: "Paper", bg: c("#F5F3EE"), bg2: c("#EAE6DC"), text: c("#1A1A1A"), accent: c("#C8382B"), words: ["editorial", "minimal", "story", "clean", "book", "news", "calm", "elegant"] },
  { id: "forest", name: "Forest", bg: c("#0F2A22"), bg2: c("#17382E"), text: c("#EFF7F1"), accent: c("#9BE564"), words: ["nature", "green", "eco", "garden", "outdoor", "plant", "sustainable", "health"] },
  { id: "ocean", name: "Ocean", bg: c("#0B3A5B"), bg2: c("#0F4C75"), text: c("#F2FAFF"), accent: c("#5CE1E6"), words: ["ocean", "blue", "water", "travel", "trust", "finance", "corporate"] },
  { id: "pop", name: "Pop", bg: c("#7B2FF7"), bg2: c("#5B1FC4"), text: c("#FFFFFF"), accent: c("#FFE14D"), words: ["fun", "playful", "party", "kids", "launch", "sale", "bold", "music", "energy"] },
];

export const lookById = (id: string | undefined): Look => LOOKS.find((l) => l.id === id) ?? LOOKS[0];

/** The look whose words appear most in the idea; the first look when nothing matches. */
export function suggestLook(idea: string): Look {
  const t = idea.toLowerCase();
  let best = LOOKS[0], score = 0;
  for (const l of LOOKS) {
    const s = l.words.filter((w) => t.includes(w)).length;
    if (s > score) { best = l; score = s; }
  }
  return best;
}
