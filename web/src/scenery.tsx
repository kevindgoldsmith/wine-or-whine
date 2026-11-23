// Wine-country illustrations in a vintage travel-print style. Flat shapes in a limited palette, so they
// stay crisp at any size and quiet enough to sit behind text. Purely decorative unless a label is given.

const SKY = '#F3D7A8'
const SUN = '#E9A23B'
const FAR = '#B5BE93'
const MID = '#8DA06B'
const FIELD = '#6F8A4E'
const ROW = '#3F5634'
const BARN = '#A8432F'
const ROOF = '#6E2A1E'

/** The "Greetings from Napa Valley" scene: vineyard rows, hills, cypresses, a barn winery, a balloon. */
export function NapaScene(props: { label?: string; class?: string }) {
  const rows = [-120, -30, 60, 150, 240, 330, 420, 510, 600, 690]
  return (
    <svg class={props.class} viewBox="0 0 560 188" preserveAspectRatio="xMidYMid slice"
      role={props.label ? 'img' : undefined} aria-label={props.label} aria-hidden={props.label ? undefined : 'true'}>
      <rect width="560" height="188" fill={SKY} />
      <circle cx="452" cy="58" r="30" fill={SUN} />
      <g transform="translate(108 30)" class="balloon">
        <path d="M0 26 C 0 6, 34 6, 34 26 C 34 40, 22 48, 17 54 C 12 48, 0 40, 0 26 Z" fill="#C8372D" />
        <path d="M11 9 C 9 22, 12 40, 17 54 M23 9 C 25 22, 22 40, 17 54" fill="none" stroke="#F1E3A0" stroke-width="3" />
        <path d="M13 54 L 14 62 M21 54 L 20 62" stroke="#4A3526" stroke-width="1.5" />
        <rect x="12" y="62" width="10" height="7" fill="#7A5232" />
      </g>
      <path d="M0 98 C 70 72, 140 88, 210 76 S 340 56, 420 80 S 520 70, 560 84 V 188 H 0 Z" fill={FAR} />
      <path d="M0 118 C 90 100, 170 114, 260 104 S 420 96, 560 110 V 188 H 0 Z" fill={MID} />
      <g fill={ROW}>
        <ellipse cx="64" cy="100" rx="5" ry="15" /><ellipse cx="78" cy="102" rx="5" ry="13" />
        <ellipse cx="300" cy="94" rx="5" ry="15" /><ellipse cx="313" cy="96" rx="5" ry="12" /><ellipse cx="326" cy="95" rx="5" ry="14" />
        <circle cx="510" cy="100" r="11" />
      </g>
      <g transform="translate(372 82)">
        <rect x="0" y="12" width="44" height="26" fill={BARN} />
        <path d="M-4 14 L22 0 L48 14 Z" fill={ROOF} />
        <rect x="18" y="24" width="9" height="14" fill="#F3E2C0" />
        <rect x="50" y="4" width="12" height="34" rx="6" fill="#D8CDB2" />
      </g>
      <path d="M0 128 C 120 116, 300 122, 560 120 V 188 H 0 Z" fill={FIELD} />
      <g stroke={ROW} stroke-width="5" stroke-linecap="round" stroke-dasharray="1 9" fill="none">
        {rows.map((x) => <path d={`M${x} 188 L ${262 + (x + 120) * 0.0889} 126`} />)}
      </g>
    </svg>
  )
}

/** A short vineyard band (phone boarding pass). */
export function VineyardBand(props: { class?: string }) {
  return (
    <svg class={props.class} viewBox="0 0 354 96" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="354" height="96" fill={SKY} />
      <circle cx="290" cy="30" r="17" fill={SUN} />
      <path d="M0 52 C 60 36, 120 48, 180 40 S 300 30, 354 42 V 96 H 0 Z" fill={FAR} />
      <g fill={ROW}><ellipse cx="226" cy="44" rx="3.5" ry="10" /><ellipse cx="236" cy="45" rx="3.5" ry="9" /><circle cx="40" cy="48" r="7" /></g>
      <g transform="translate(120 34)"><rect x="0" y="8" width="28" height="16" fill={BARN} /><path d="M-3 10 L14 0 L31 10 Z" fill={ROOF} /></g>
      <path d="M0 62 C 100 56, 240 60, 354 58 V 96 H 0 Z" fill={FIELD} />
      <g stroke={ROW} stroke-width="4" stroke-linecap="round" stroke-dasharray="1 8" fill="none">
        {[-80, 0, 80, 160, 240, 320, 400].map((x, i) => <path d={`M${x} 96 L ${170 + i * 4} 62`} />)}
      </g>
    </svg>
  )
}

/** A tiny vineyard vignette (the Breezy Day ticket stub). */
export function MiniVineyard(props: { class?: string }) {
  return (
    <svg class={props.class} viewBox="0 0 64 96" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="64" height="96" fill={SKY} />
      <circle cx="44" cy="26" r="10" fill={SUN} />
      <path d="M0 52 C 20 42, 40 50, 64 44 V 96 H 0 Z" fill={FAR} />
      <path d="M0 64 C 22 60, 44 62, 64 60 V 96 H 0 Z" fill={FIELD} />
      <g stroke={ROW} stroke-width="3" stroke-linecap="round" stroke-dasharray="1 6" fill="none">
        {[-20, 6, 32, 58, 84].map((x, i) => <path d={`M${x} 96 L ${30 + i} 62`} />)}
      </g>
    </svg>
  )
}

/** A grapevine the luggage tags hang from. */
export function Vine(props: { class?: string }) {
  return (
    <svg class={props.class} viewBox="0 0 268 58" preserveAspectRatio="none" aria-hidden="true">
      <path d="M2 22 C 50 8, 90 30, 134 18 S 220 6, 266 20" fill="none" stroke="#6B4A2E" stroke-width="5" stroke-linecap="round" />
      <path d="M60 18 c -10 -14, 6 -20, 14 -10 c 6 -12, 22 -4, 14 8 c 12 2, 8 16, -4 14 c -4 10, -18 6, -14 -4 z" fill="#6F8A4E" />
      <path d="M176 12 c -8 -14, 8 -18, 14 -8 c 8 -10, 22 0, 12 10 c 12 4, 6 16, -6 12 c -6 8, -18 2, -12 -8 z" fill="#5B7446" />
      <g fill="#5A2343">
        <circle cx="112" cy="30" r="5" /><circle cx="122" cy="30" r="5" /><circle cx="117" cy="38" r="5" />
        <circle cx="107" cy="38" r="5" /><circle cx="127" cy="38" r="5" /><circle cx="112" cy="46" r="5" />
        <circle cx="122" cy="46" r="5" /><circle cx="117" cy="53" r="4.5" />
      </g>
      <g fill="#6D2B4F">
        <circle cx="226" cy="26" r="4.5" /><circle cx="235" cy="26" r="4.5" /><circle cx="230" cy="34" r="4.5" />
        <circle cx="221" cy="34" r="4.5" /><circle cx="226" cy="41" r="4" />
      </g>
    </svg>
  )
}

/** Faint vineyard rows for the bottom edge of the TV board. */
export function VineRows(props: { class?: string }) {
  return (
    <svg class={props.class} viewBox="0 0 1280 30" preserveAspectRatio="none" aria-hidden="true">
      <rect width="1280" height="30" fill="#D9C39A" />
      <g stroke="#9E8B5E" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 10">
        <path d="M0 8 H 1280" /><path d="M6 16 H 1280" /><path d="M0 24 H 1280" />
      </g>
    </svg>
  )
}
