export function ShuttleIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 23 L17 6 M11 23 L22 8 M11 23 L27 12 M11 23 L30 18" />
        <path d="M17 6 Q27 3 30 18" />
      </g>
      <circle cx="9.5" cy="24.5" r="5.5" fill="#f3b33d" />
    </svg>
  );
}
