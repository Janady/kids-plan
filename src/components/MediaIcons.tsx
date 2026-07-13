// Monochrome SVG transport icons.
// We use SVG (not emoji like ▶ ⏸ ⏮ ⏭) because Android renders those code points
// as multi-colored emoji glyphs that clash with a filled button background.
// SVG fills with `currentColor`, so the icon color is fully controlled by CSS.

interface IconProps {
  size?: number;
  className?: string;
}

export function PlayIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

export function PauseIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function PrevIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M6 6h2v12H6z" />
      <path d="M20 6v12l-9-6z" />
    </svg>
  );
}

export function NextIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M16 6h2v12h-2z" />
      <path d="M4 6v12l9-6z" />
    </svg>
  );
}
