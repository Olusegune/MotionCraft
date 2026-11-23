/** Simplified aperture mark for small sizes: six flat blades, no texture or glow (UI_UX section 10). Colours come from tokens. */
export function BrandMark({ size = 24 }: { size?: number }) {
  const blade = "M12 2.2 C15.4 2.2 18.3 3.7 20.2 6.1 L13.4 11.2 Z";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="MotionCraft" focusable="false">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={blade} transform={`rotate(${i * 60} 12 12)`} fill={i % 2 === 0 ? "var(--mc-brand-gold)" : "var(--mc-accent)"} />
      ))}
    </svg>
  );
}
