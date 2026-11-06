/**
 * Navi's cute robot mascot — original flat SVG (kawaii chatbot vibe).
 */
export function NaviLogo({
  size = 40,
  className = "",
  title = "Navi",
}: {
  size?: number;
  className?: string;
  title?: string;
}) {
  const id = "navi-blush";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* Soft purple circle — Navi brand badge */}
      <circle cx="32" cy="32" r="32" fill="#7C3AED" />
      {/* Antenna */}
      <line x1="32" y1="10" x2="32" y2="16" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="32" cy="8.5" r="2.6" fill="#FFFFFF" />
      {/* Head (rounded capsule) */}
      <rect x="14" y="18" width="36" height="28" rx="14" fill="#FFFFFF" />
      {/* Side ears / speakers */}
      <circle cx="14" cy="32" r="3.2" fill="#FFFFFF" />
      <circle cx="50" cy="32" r="3.2" fill="#FFFFFF" />
      {/* Blush */}
      <circle cx="22.5" cy="34.5" r="3.2" fill="#F9A8D4" fillOpacity="0.85" />
      <circle cx="41.5" cy="34.5" r="3.2" fill="#F9A8D4" fillOpacity="0.85" />
      {/* Eyes */}
      <ellipse cx="25.5" cy="30" rx="2.1" ry="2.8" fill="#1F2937" />
      <ellipse cx="38.5" cy="30" rx="2.1" ry="2.8" fill="#1F2937" />
      {/* Smile */}
      <path
        d="M28.5 36.5c1.2 1.6 2.8 2.4 3.5 2.4s2.3-.8 3.5-2.4"
        stroke="#1F2937"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* tiny sparkle — Navi personality */}
      <circle cx="48" cy="14" r="1.2" fill="#FFFFFF" fillOpacity="0.7" />
      <defs>
        <radialGradient id={id} cx="0" cy="0" r="1">
          <stop stopColor="#F9A8D4" />
          <stop offset="1" stopColor="#F9A8D4" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/** Compact icon for sidebar nav (matches lucide size API). */
export function NaviNavIcon({ size = 16 }: { size?: number }) {
  return <NaviLogo size={size} />;
}
