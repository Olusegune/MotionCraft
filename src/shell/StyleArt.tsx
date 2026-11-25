import { useId, type ReactNode } from "react";
import { FAMILIES } from "../lib/styles";

/**
 * Small drawn pictures for the style families, made in code so they are crisp at any size and need no image files.
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
    "flat-2d": <><rect width="160" height="100" fill={c("bg")} /><circle cx="116" cy="30" r="16" fill={c("a")} /><path d="M0 78 Q40 46 84 72 T160 64 V100 H0Z" fill={c("b")} /><rect x="30" y="52" width="10" height="26" fill={c("c")} /><circle cx="35" cy="48" r="7" fill={c("c")} /></>,
    "vector-illustration": <><rect width="160" height="100" fill={c("bg")} /><path d="M20 70 C10 40 50 20 74 38 C100 56 70 90 20 70Z" fill={c("a")} /><polygon points="118,18 124,36 142,36 128,46 133,64 118,53 103,64 108,46 94,36 112,36" fill={c("b")} /><circle cx="128" cy="78" r="12" fill={c("c")} /></>,
    "isometric": <><rect width="160" height="100" fill={c("bg")} /><polygon points="80,16 116,36 80,56 44,36" fill={c("a")} /><polygon points="44,36 80,56 80,92 44,72" fill={c("b")} /><polygon points="80,56 116,36 116,72 80,92" fill={c("c")} /></>,
    "3d-render": <><defs><radialGradient id={`g${uid}`} cx="0.35" cy="0.3" r="0.8"><stop offset="0" stopColor={c("a")} /><stop offset="1" stopColor={c("b")} /></radialGradient></defs><rect width="160" height="100" fill={c("bg")} /><ellipse cx="80" cy="84" rx="38" ry="6" fill="black" opacity="0.45" /><circle cx="80" cy="50" r="30" fill={`url(#g${uid})`} /></>,
    "claymation": <><rect width="160" height="100" fill={c("bg")} /><ellipse cx="46" cy="58" rx="28" ry="26" fill={c("a")} /><ellipse cx="100" cy="46" rx="22" ry="24" fill={c("b")} /><ellipse cx="128" cy="76" rx="20" ry="14" fill={c("c")} /><ellipse cx="38" cy="48" rx="8" ry="5" fill="white" opacity="0.35" /></>,
    "low-poly": <><rect width="160" height="100" fill={c("bg")} /><polygon points="0,100 0,60 40,30 70,100" fill={c("a")} /><polygon points="40,30 70,100 110,100 90,50" fill={c("b")} /><polygon points="90,50 110,100 160,100 160,44 130,26" fill={c("c")} /><polygon points="40,30 0,60 24,64" fill="white" opacity="0.2" /></>,
    "glassmorphism": <><defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={c("a")} /><stop offset="1" stopColor={c("b")} /></linearGradient></defs><rect width="160" height="100" fill={c("bg")} /><circle cx="46" cy="36" r="28" fill={`url(#g${uid})`} /><circle cx="118" cy="68" r="26" fill={c("a")} /><rect x="38" y="30" width="86" height="46" rx="10" fill="white" opacity="0.22" stroke="white" strokeOpacity="0.6" /></>,
    "hand-drawn": <><rect width="160" height="100" fill={c("bg")} /><path d="M20 66 C30 24 66 20 78 44 C90 68 58 78 44 58" fill="none" stroke={c("a")} strokeWidth="3" strokeLinecap="round" /><path d="M96 30 L134 34 M100 46 L138 52 M96 62 L126 66" stroke={c("a")} strokeWidth="3" strokeLinecap="round" /><path d="M18 86 Q50 78 82 88 T146 84" fill="none" stroke={c("b")} strokeWidth="4" strokeLinecap="round" /></>,
    "line-art": <><rect width="160" height="100" fill={c("bg")} /><circle cx="64" cy="50" r="30" fill="none" stroke={c("a")} strokeWidth="1.2" /><circle cx="64" cy="50" r="18" fill="none" stroke={c("a")} strokeWidth="1.2" /><path d="M96 20 L146 80 M106 14 L156 74" stroke={c("a")} strokeWidth="1.2" /><circle cx="124" cy="30" r="5" fill="none" stroke={c("b")} strokeWidth="1.5" /></>,
    "pixel-art": <><rect width="160" height="100" fill={c("bg")} />{[[3,2],[4,2],[6,2],[7,2],[2,3],[3,3],[4,3],[5,3],[6,3],[7,3],[8,3],[2,4],[3,4],[4,4],[5,4],[6,4],[7,4],[8,4],[3,5],[4,5],[5,5],[6,5],[7,5],[4,6],[5,6],[6,6],[5,7]].map(([x, y]) => <rect key={`${x}${y}`} x={30 + x * 8} y={8 + y * 8} width="8" height="8" fill={y < 4 ? c("a") : y < 6 ? c("b") : c("c")} />)}</>,
    "watercolour": <><defs><filter id={`f${uid}`} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" /></filter></defs><rect width="160" height="100" fill={c("bg")} /><g filter={`url(#f${uid})`}><circle cx="56" cy="46" r="28" fill={c("a")} opacity="0.7" /><circle cx="98" cy="54" r="26" fill={c("b")} opacity="0.6" /><circle cx="78" cy="68" r="20" fill={c("c")} opacity="0.55" /></g></>,
    "cel-animation": <><rect width="160" height="100" fill={c("bg")} /><ellipse cx="52" cy="34" rx="28" ry="14" fill={c("a")} stroke="black" strokeWidth="3" /><path d="M0 84 Q50 48 110 78 T160 70 V100 H0Z" fill={c("b")} stroke="black" strokeWidth="3" /><circle cx="128" cy="26" r="12" fill={c("c")} stroke="black" strokeWidth="3" /></>,
    "art-deco": <><rect width="160" height="100" fill={c("bg")} />{[-60,-40,-20,0,20,40,60].map((a) => <line key={a} x1="80" y1="100" x2={80 + Math.sin((a * Math.PI) / 180) * 90} y2={100 - Math.cos((a * Math.PI) / 180) * 90} stroke={c("a")} strokeWidth="1.5" />)}<path d="M52 100 V50 A28 28 0 0 1 108 50 V100" fill="none" stroke={c("b")} strokeWidth="2.5" /><rect x="6" y="6" width="148" height="88" fill="none" stroke={c("a")} strokeWidth="1" /></>,
    "memphis": <><rect width="160" height="100" fill={c("bg")} /><path d="M14 26 q8 -12 16 0 t16 0 t16 0" fill="none" stroke={c("a")} strokeWidth="4" strokeLinecap="round" /><polygon points="100,18 130,18 115,46" fill={c("b")} /><circle cx="40" cy="70" r="14" fill={c("c")} />{[0,1,2,3].map((i) => <circle key={i} cx={96 + i * 14} cy={78} r="3" fill={c("a")} />)}<rect x="116" y="56" width="26" height="8" fill={c("c")} transform="rotate(-20 129 60)" /></>,
    "mid-century": <><rect width="160" height="100" fill={c("bg")} /><circle cx="52" cy="52" r="26" fill={c("a")} /><ellipse cx="110" cy="40" rx="30" ry="12" fill={c("b")} transform="rotate(-24 110 40)" /><circle cx="120" cy="74" r="10" fill={c("c")} />{[0,1,2,3,4,5].map((i) => <line key={i} x1="20" y1={86 + i * 0} x2="20" y2="86" stroke={c("b")} />)}<path d="M18 88 L140 88" stroke={c("b")} strokeWidth="1.5" /></>,
    "pop-art": <><rect width="160" height="100" fill={c("bg")} />{Array.from({ length: 5 }).flatMap((_, r) => Array.from({ length: 8 }).map((__, k) => <circle key={`${r}${k}`} cx={14 + k * 18 + (r % 2) * 9} cy={12 + r * 18} r={6 - r * 0.6} fill={c("a")} />))}<rect x="70" y="30" width="70" height="42" fill={c("b")} stroke="black" strokeWidth="4" /></>,
    "psychedelic": <><rect width="160" height="100" fill={c("bg")} /><circle cx="80" cy="50" r="48" fill={c("a")} /><circle cx="80" cy="50" r="38" fill={c("b")} /><circle cx="80" cy="50" r="28" fill={c("c")} /><circle cx="80" cy="50" r="18" fill={c("bg")} /><circle cx="80" cy="50" r="8" fill={c("a")} /></>,
    "vaporwave": <><defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={c("bg")} /><stop offset="1" stopColor={c("a")} /></linearGradient></defs><rect width="160" height="100" fill={`url(#g${uid})`} /><circle cx="80" cy="46" r="24" fill={c("b")} /><rect x="0" y="58" width="160" height="42" fill={c("bg")} />{[0,1,2,3,4,5].map((i) => <line key={i} x1={80 + (i - 2.5) * 6} y1="58" x2={80 + (i - 2.5) * 40} y2="100" stroke={c("c")} strokeWidth="1" />)}{[0,1,2].map((i) => <line key={`h${i}`} x1="0" y1={66 + i * 12} x2="160" y2={66 + i * 12} stroke={c("c")} strokeWidth="1" />)}</>,
    "y2k-chrome": <><defs><linearGradient id={`g${uid}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="white" /><stop offset="0.5" stopColor={c("a")} /><stop offset="1" stopColor={c("b")} /></linearGradient></defs><rect width="160" height="100" fill={c("bg")} /><ellipse cx="62" cy="52" rx="34" ry="26" fill={`url(#g${uid})`} /><polygon points="124,20 130,38 148,38 134,48 139,66 124,55 109,66 114,48 100,38 118,38" fill={`url(#g${uid})`} /></>,
    "art-nouveau": <><rect width="160" height="100" fill={c("bg")} /><path d="M30 94 C20 60 50 50 44 22 M44 22 C60 30 64 44 52 54 M80 94 C92 66 70 52 84 24" fill="none" stroke={c("a")} strokeWidth="2.5" strokeLinecap="round" /><circle cx="116" cy="40" r="12" fill={c("b")} /><circle cx="116" cy="40" r="5" fill={c("c")} /><rect x="6" y="6" width="148" height="88" rx="14" fill="none" stroke={c("c")} strokeWidth="2" /></>,
    "title-sequence-60s": <><rect width="160" height="100" fill={c("bg")} /><polygon points="20,80 60,18 74,30 46,86" fill={c("a")} /><polygon points="86,22 142,30 124,84 96,70" fill={c("a")} /><rect x="14" y="88" width="132" height="3" fill={c("b")} /><rect x="14" y="8" width="60" height="3" fill={c("b")} /></>,
    "abstract-film": <><rect width="160" height="100" fill={c("bg")} />{[0,1,2,3,4].map((i) => <circle key={i} cx={22 + i * 28} cy={50 + Math.sin(i * 1.3) * 26} r={6 + i * 2} fill={[c("a"), c("b"), c("c")][i % 3]} />)}<line x1="8" y1="50" x2="152" y2="50" stroke={c("b")} strokeWidth="1" /></>,
    "glitch": <><rect width="160" height="100" fill={c("bg")} /><rect x="20" y="22" width="90" height="56" fill={c("a")} opacity="0.85" /><rect x="34" y="28" width="90" height="56" fill={c("b")} opacity="0.7" style={{ mixBlendMode: "screen" }} /><rect x="0" y="44" width="160" height="6" fill={c("bg")} /><rect x="40" y="60" width="100" height="4" fill={c("bg")} /></>,
    "vhs-analog": <><rect width="160" height="100" fill={c("bg")} /><circle cx="64" cy="48" r="24" fill={c("a")} /><rect x="86" y="26" width="46" height="40" fill={c("b")} opacity="0.85" />{Array.from({ length: 25 }).map((_, i) => <rect key={i} x="0" y={i * 4} width="160" height="1" fill="black" opacity="0.35" />)}<rect x="0" y="78" width="160" height="5" fill="white" opacity="0.5" /></>,
    "blueprint": <><rect width="160" height="100" fill={c("bg")} />{[0,1,2,3,4,5,6,7].map((i) => <line key={`v${i}`} x1={i * 22} y1="0" x2={i * 22} y2="100" stroke={c("b")} strokeOpacity="0.35" strokeWidth="0.8" />)}{[0,1,2,3,4].map((i) => <line key={`h${i}`} x1="0" y1={i * 24} x2="160" y2={i * 24} stroke={c("b")} strokeOpacity="0.35" strokeWidth="0.8" />)}<circle cx="70" cy="50" r="26" fill="none" stroke={c("a")} strokeWidth="1.5" /><rect x="94" y="28" width="40" height="44" fill="none" stroke={c("a")} strokeWidth="1.5" /><line x1="44" y1="86" x2="134" y2="86" stroke={c("a")} strokeWidth="1" /></>,
    "duotone": <><rect width="160" height="100" fill={c("bg")} /><circle cx="60" cy="50" r="30" fill={c("a")} /><rect x="76" y="28" width="52" height="44" fill={c("a")} opacity="0.9" /><circle cx="60" cy="50" r="30" fill={c("b")} opacity="0.55" /><rect x="14" y="84" width="132" height="3" fill={c("b")} /></>,
    "liquid-gradient": <><defs><filter id={`f${uid}`} x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="10" /></filter></defs><rect width="160" height="100" fill={c("bg")} /><g filter={`url(#f${uid})`}><ellipse cx="46" cy="38" rx="40" ry="28" fill={c("a")} /><ellipse cx="112" cy="46" rx="42" ry="30" fill={c("b")} /><ellipse cx="80" cy="82" rx="46" ry="22" fill={c("c")} /></g></>,
    "data-viz": <><rect width="160" height="100" fill={c("bg")} />{[28,44,36,62,52,74].map((h, i) => <rect key={i} x={16 + i * 22} y={88 - h} width="14" height={h} fill={c("a")} />)}<polyline points="22,64 44,52 66,58 88,34 110,42 132,20" fill="none" stroke={c("b")} strokeWidth="2.5" />{[[22,64],[66,58],[110,42],[132,20]].map(([x, y]) => <circle key={`${x}`} cx={x} cy={y} r="3.5" fill={c("c")} />)}</>,
    "film-noir": <><rect width="160" height="100" fill={c("bg")} />{[0,1,2,3,4].map((i) => <polygon key={i} points={`${10 + i * 28},0 ${28 + i * 28},0 ${70 + i * 28},100 ${40 + i * 28},100`} fill={c("a")} opacity="0.16" />)}<circle cx="96" cy="40" r="10" fill={c("b")} /><path d="M76 92 C78 62 114 62 116 92Z" fill={c("b")} /></>,
    "cyberpunk": <><rect width="160" height="100" fill={c("bg")} /><rect x="10" y="10" width="46" height="80" fill="none" stroke={c("b")} strokeWidth="1.5" /><rect x="62" y="30" width="38" height="60" fill={c("a")} opacity="0.85" /><rect x="106" y="16" width="44" height="74" fill="none" stroke={c("a")} strokeWidth="1.5" /><line x1="0" y1="60" x2="160" y2="60" stroke={c("c")} strokeWidth="1" strokeDasharray="4 3" /><rect x="14" y="14" width="22" height="3" fill={c("c")} /></>,
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
