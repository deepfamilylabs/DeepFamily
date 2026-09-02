export interface BambooSlipsIconProps {
  className?: string;
  /** Pixel size, matching the lucide `size` prop. Ignored when the class name sets a size. */
  size?: number;
  strokeWidth?: number;
}

/**
 * 竹简 — a bundle of bamboo slips, the form a genealogy took before paper.
 *
 * Lucide has no bamboo-slip glyph, and its closest stand-in (`ScrollText`) draws horizontal text
 * lines, which reads as a paper scroll. This keeps that rolled-bundle silhouette — the shape a
 * bound set of slips actually makes — but rules the interior vertically, the way the slips run.
 *
 * Drawn on lucide's 24x24 grid with its stroke conventions so it sits evenly beside the other icons.
 */
export function BambooSlipsIcon({ className, size = 24, strokeWidth = 2 }: BambooSlipsIconProps) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Outer roll: the bundle seen from its side. */}
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
      {/* The slips themselves. */}
      <path d="M10 7v6" />
      <path d="M13 7v6" />
      <path d="M16 7v6" />
    </svg>
  );
}
