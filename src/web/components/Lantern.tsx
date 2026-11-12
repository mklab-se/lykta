/**
 * Lykta's mark: a Scandinavian storm lantern (lykta) with a living flame. The flame and its
 * halo are the one bright thing; the frame is quiet iron. The flame sways slowly unless the
 * wall is in low-power mode or the viewer prefers reduced motion (styles.css).
 */
export function Lantern(props: { size?: number }) {
  const h = props.size ?? 44;
  return (
    <svg
      className="lantern"
      viewBox="0 0 64 88"
      width={(h * 64) / 88}
      height={h}
      role="img"
      aria-label="Lykta"
    >
      <defs>
        <radialGradient id="lk-halo" cx="50%" cy="58%" r="50%">
          <stop offset="0" stopColor="#ffb224" stopOpacity="0.7" />
          <stop offset="0.6" stopColor="#ffb224" stopOpacity="0.16" />
          <stop offset="1" stopColor="#ffb224" stopOpacity="0" />
        </radialGradient>
        {/* the glass is lit from within: brightest around the flame */}
        <radialGradient id="lk-glass" cx="50%" cy="68%" r="65%">
          <stop offset="0" stopColor="#9a5c0e" />
          <stop offset="0.55" stopColor="#4a2c06" />
          <stop offset="1" stopColor="#1e1404" />
        </radialGradient>
        <radialGradient id="lk-flame" cx="50%" cy="70%" r="60%">
          <stop offset="0" stopColor="#fff1c4" />
          <stop offset="0.45" stopColor="#ffd060" />
          <stop offset="1" stopColor="#ff8a1c" />
        </radialGradient>
      </defs>
      <circle className="lk-halo" cx="32" cy="52" r="32" fill="url(#lk-halo)" />
      {/* ring and cap */}
      <circle cx="32" cy="7" r="4.5" fill="none" stroke="#5b6676" strokeWidth="3" />
      <path d="M32 11.5v5" stroke="#5b6676" strokeWidth="3" strokeLinecap="round" />
      <path d="M14 30 L24 17 H40 L50 30 Z" fill="#3a4250" />
      <path d="M12 30 H52" stroke="#5b6676" strokeWidth="3" strokeLinecap="round" />
      {/* glass with its two side bars */}
      <path d="M16 32 H48 L46 70 H18 Z" fill="url(#lk-glass)" />
      <g className="lk-flame">
        <path
          d="M32 38 C39 47 41 54 37.5 60 C35.5 63.5 28.5 63.5 26.5 60 C23 54 25 47 32 38 Z"
          fill="url(#lk-flame)"
        />
        <path
          d="M32 49 C35 53 35.5 56.5 33.8 59 C33 60.2 31 60.2 30.2 59 C28.5 56.5 29 53 32 49 Z"
          fill="#fffbe9"
        />
      </g>
      <path
        d="M16 32 H48 L46 70 H18 Z M23.5 32 L22.5 70 M40.5 32 L41.5 70"
        fill="none"
        stroke="#5b6676"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {/* base */}
      <rect x="13" y="70" width="38" height="8" rx="3" fill="#3a4250" />
      <rect x="20" y="78" width="24" height="5" rx="2" fill="#2a3039" />
    </svg>
  );
}
