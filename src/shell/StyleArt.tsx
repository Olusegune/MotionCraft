import { useId, type ReactNode } from "react";
import { FAMILIES } from "../lib/styles";

/**
 * Small drawn pictures for the twelve style families, made in code so they are crisp at any size and need no image files.
 * They are illustrations of the idea of each family (shapes, colour, mood), not renders from the engine and not anyone's artwork.
 * Colours come from the --mc-art-* tokens, so the palette lives with the rest of the design tokens.
 */
export function StyleArt({ id, className }: { id: string; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const c = (k: string) => `var(--mc-art-${id}-${k})`;
  const art: Record<string, ReactNode> = {
    swiss: <>
      <rect width="160" height="100" fill={c("bg")} />
      <circle cx="108" cy="46" r="26" fill={c("a")} />
      <rect x="14" y="14" width="64" height="8" fill={c("b")} />
      <rect x="14" y="28" width="40" height="4" fill={c("b")} />
      <rect x="14" y="78" width="132" height="2" fill={c("b")} />
    </>,
    "editorial-minimal": <>
      <rect width="160" height="100" fill={c("bg")} />
      <rect x="18" y="20" width="58" height="5" fill={c("a")} />
      <rect x="18" y="32" width="38" height="3" fill={c("a")} opacity="0.6" />
      <circle cx="112" cy="56" r="22" fill="none" stroke={c("b")} strokeWidth="1.5" />
      <rect x="18" y="82" width="124" height="1" fill={c("a")} />
    </>,
    bauhaus: <>
      <rect width="160" height="100" fill={c("bg")} />
      <circle cx="52" cy="50" r="30" fill={c("a")} />
      <rect x="82" y="22" width="52" height="52" fill={c("b")} />
      <polygon points="98,84 126,84 112,56" fill={c("c")} />
    </>,
    brutalist: <>
      <rect width="160" height="100" fill={c("bg")} />
      <rect x="10" y="12" width="96" height="40" fill={c("a")} />
      <rect x="62" y="40" width="88" height="46" fill={c("b")} stroke={c("a")} strokeWidth="5" />
      <rect x="10" y="62" width="40" height="26" fill={c("a")} />
    </>,
    "bold-kinetic": <>
      <rect width="160" height="100" fill={c("bg")} />
      <polygon points="10,36 120,26 118,52 8,62" fill={c("a")} />
      <polygon points="30,66 150,54 148,80 28,92" fill={c("b")} />
    </>,
    "cinematic-title": <>
      <defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c("bg")} /><stop offset="1" stopColor={c("a")} /></linearGradient></defs>
      <rect width="160" height="100" fill={`url(#g${uid})`} />
      <rect width="160" height="12" fill="black" opacity="0.7" /><rect y="88" width="160" height="12" fill="black" opacity="0.7" />
      <rect x="44" y="49" width="72" height="1.5" fill={c("b")} />
      <rect x="62" y="56" width="36" height="2" fill={c("b")} opacity="0.7" />
    </>,
    "clean-broadcast": <>
      <defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c("a")} /><stop offset="1" stopColor={c("bg")} /></linearGradient></defs>
      <rect width="160" height="100" fill={`url(#g${uid})`} />
      <rect x="0" y="64" width="116" height="20" fill={c("b")} />
      <rect x="10" y="70" width="64" height="5" fill={c("bg")} />
      <rect x="10" y="78" width="40" height="3" fill={c("a")} />
    </>,
    "cut-paper": <>
      <rect width="160" height="100" fill={c("bg")} />
      <polygon points="8,70 40,18 92,30 80,86" fill={c("a")} />
      <polygon points="64,20 140,12 150,58 96,64" fill={c("b")} />
      <polygon points="88,52 148,50 140,92 82,88" fill={c("c")} />
      <polygon points="8,70 40,18 92,30 80,86" fill="none" stroke="black" strokeOpacity="0.12" strokeWidth="2" />
    </>,
    risograph: <>
      <rect width="160" height="100" fill={c("bg")} />
      <g style={{ mixBlendMode: "multiply" }}>
        <circle cx="66" cy="50" r="34" fill={c("a")} opacity="0.85" />
        <circle cx="96" cy="50" r="34" fill={c("b")} opacity="0.75" />
      </g>
    </>,
    "retro-futurist": <>
      <defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c("bg")} /><stop offset="1" stopColor={c("a")} /></linearGradient></defs>
      <rect width="160" height="100" fill={`url(#g${uid})`} />
      <circle cx="80" cy="52" r="26" fill={c("b")} />
      <rect x="0" y="62" width="160" height="38" fill={c("bg")} />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="0" y={66 + i * 7} width="160" height="1.5" fill={c("a")} />)}
    </>,
    "neon-light": <>
      <defs><filter id={`f${uid}`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" /></filter></defs>
      <rect width="160" height="100" fill={c("bg")} />
      <circle cx="64" cy="50" r="26" fill="none" stroke={c("a")} strokeWidth="5" filter={`url(#f${uid})`} />
      <circle cx="64" cy="50" r="26" fill="none" stroke={c("a")} strokeWidth="2" />
      <rect x="98" y="26" width="42" height="48" rx="6" fill="none" stroke={c("b")} strokeWidth="5" filter={`url(#f${uid})`} />
      <rect x="98" y="26" width="42" height="48" rx="6" fill="none" stroke={c("b")} strokeWidth="2" />
    </>,
    collage: <>
      <rect width="160" height="100" fill={c("bg")} />
      <rect x="14" y="16" width="62" height="46" fill={c("a")} transform="rotate(-6 45 39)" />
      <circle cx="104" cy="44" r="26" fill={c("b")} />
      <polygon points="60,92 112,54 142,92" fill={c("c")} />
      <rect x="22" y="64" width="34" height="20" fill={c("bg")} stroke={c("a")} strokeWidth="2" transform="rotate(5 39 74)" />
    </>,
  };
  return (
    <svg className={className} viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" role="img" aria-hidden="true" focusable="false">
      {art[id] ?? <rect width="160" height="100" fill="var(--mc-bg-raised)" />}
    </svg>
  );
}

/** A style family as a card: its picture, its name and its tags. `on` marks the family currently used for everything. */
export function StyleCard({ id, on, disabled, compact, onPick }: { id: string; on: boolean; disabled?: boolean; compact?: boolean; onPick: () => void }) {
  const f = FAMILIES.find((x) => x.id === id);
  if (!f) return null;
  return (
    <button type="button" className={`style-card${on ? " on" : ""}${compact ? " compact" : ""}`} aria-pressed={on} disabled={disabled} onClick={onPick}
      title={disabled ? "The direction is approved. Unlock it to change the look." : `Use ${f.label} for typography, motion, colour, texture, camera, transitions and composition`}>
      <span className="style-art"><StyleArt id={f.id} /></span>
      <span className="style-name">{f.label}</span>
      {!compact && <span className="style-tags muted">{f.tags.join(" · ")}</span>}
    </button>
  );
}
