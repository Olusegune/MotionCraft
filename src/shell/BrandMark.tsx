/** Simplified M mark for small sizes: flat, no texture or glow (UI_UX section 10). */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="MotionCraft" focusable="false">
      <path d="M3 20V6.5L12 15 21 6.5V20" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
