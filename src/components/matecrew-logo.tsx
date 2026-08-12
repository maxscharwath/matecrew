/**
 * The MateCrew mark: a maté gourd with its bombilla straw.
 *
 * Replaces the generic lucide cup, because a product with its own mark stops
 * looking like a component-library demo. Built from primitives rather than a
 * traced path, and deliberately reduced to three shapes: an earlier version
 * carried leaf veins inside the body, which turned into mud at 16px. The neck is
 * a visible notch so the silhouette reads as a gourd rather than a circle.
 *
 * Inherits `currentColor`, so it works on the brand tile, in the sidebar, and on
 * a light surface without needing variants.
 */
export function MateCrewLogo({ className }: { readonly className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Bombilla, angled out of the neck. Drawn first so the body overlaps it. */}
      <path
        d="M14.9 6.6 20.4 2.2"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
      />
      {/* Gourd body. */}
      <circle cx="11.6" cy="14.8" r="6.9" fill="currentColor" />
      {/* Neck: a short collar, offset toward the straw. */}
      <rect
        x="10.2"
        y="4.9"
        width="5.2"
        height="4.6"
        rx="1.6"
        transform="rotate(12 12.8 7.2)"
        fill="currentColor"
      />
    </svg>
  );
}
