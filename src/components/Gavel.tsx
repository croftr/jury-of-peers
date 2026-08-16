/**
 * The court's mark.
 *
 * Drawn once and shared, because it was previously drawn twice — slightly
 * differently — in the header and in the case form.
 *
 * Built to survive being small. The old mark outlined the head as a stroked,
 * rotated, rounded rectangle, which at 20px is a hairline outline enclosing
 * four pixels of nothing and reads as a smudge. This draws the head as a single
 * thick round-capped stroke instead: a solid form holds its shape at any size,
 * and the handle meets it square on, the way a gavel is actually built.
 *
 * `withBlock` adds the sounding block underneath. Worth it at header size,
 * where there is room for three marks to stay separate; noise at button size,
 * where the head and handle alone are already unmistakable.
 */
export default function Gavel({
  className,
  withBlock = false,
}: {
  className?: string;
  withBlock?: boolean;
}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeLinecap="round">
        {/* The head — a short, heavy stroke lying across the handle's line. */}
        <path d="M4.4 14.1 10.5 8" strokeWidth="5.2" />
        {/* The handle, leaving the head at a right angle. */}
        <path d="M8.6 12.3 16.8 20.5" strokeWidth="2.3" />
        {withBlock && <path d="M3 21.2h7.4" strokeWidth="2.1" opacity="0.75" />}
      </g>
    </svg>
  );
}
