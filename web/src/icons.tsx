// Drawn line icons, keyed by game concept (the same keys as theme.icons). Emoji stay in theme text for logs;
// the interface uses these so the look is consistent, crisp on a 4K TV and printable-feeling.
import type { JSX } from 'preact'

const P: Record<string, JSX.Element> = {
  president: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" />
    </>
  ),
  chancellor: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2.8h6V4M8.5 10h7M8.5 14h7M8.5 18h4" />
    </>
  ),
  breezy: (
    <>
      <path d="M3 18c3-3 6-3 9 0s6 3 9 0" />
      <path d="M2 14c4-4 8-6 10-6s6 2 10 6" />
      <circle cx="17" cy="6" r="2.4" />
    </>
  ),
  over: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17.5h2M11 17.5h2M15 17.5h2" />
    </>
  ),
  investigate: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
  special_election: (
    <>
      <path d="M4 11h13v3a6 6 0 0 1-6 6h-1a6 6 0 0 1-6-6z" />
      <path d="M17 12h1.5a2.5 2.5 0 0 1 0 5H16M8 4c0 2 2 2 2 4M12 4c0 2 2 2 2 4" />
    </>
  ),
  peek: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l3 2M9 2.5h6" />
    </>
  ),
  execute: (
    <>
      <path d="M10 2.5h4v3h-4zM9 5.5h6l1 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-11z" />
      <path d="M8 12h8M8 16h8" />
    </>
  ),
  handoff: (
    <>
      <path d="M17 15.5A7.5 7.5 0 0 1 8.5 5a7.5 7.5 0 1 0 8.5 10.5z" />
      <path d="M15 4h4l-4 4h4" />
    </>
  ),
  sleeping: (
    <>
      <path d="M4 8h5l-5 6h5M13 4h4l-4 5h4M16 13h4l-4 6h4" />
    </>
  ),
  meter: (
    <>
      <circle cx="6" cy="12" r="3" />
      <circle cx="12" cy="12" r="3" />
      <circle cx="18" cy="12" r="3" />
    </>
  ),
  voted: <path d="M4 12.5l5 5L20 6.5" />,
  arrow: <path d="M3 12h16M13 6l6 6-6 6" />,
  yes: <path d="M4 12.5l5 5L20 6.5" />,
  no: <path d="M6 6l12 12M18 6L6 18" />,
  chill: (
    <>
      <path d="M12 21c-5-2-8-6-8-11 4 0 7 2 8 5 1-3 4-5 8-5 0 5-3 9-8 11z" />
      <path d="M12 21V11" />
    </>
  ),
  over_team: (
    <>
      <path d="M12 3a9 9 0 1 0 9 9" />
      <path d="M12 7v5l3 2M17 3h4v4" />
    </>
  ),
  chief: <path d="M3 18h18L19 8l-4 4-3-6-3 6-4-4z" />,
  veto: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6l12.8 12.8" />
    </>
  ),
  grapes: (
    <>
      <circle cx="9" cy="10" r="2.2" /><circle cx="14" cy="10" r="2.2" /><circle cx="11.5" cy="14" r="2.2" />
      <circle cx="7" cy="14" r="2.2" /><circle cx="16" cy="14" r="2.2" /><circle cx="9" cy="18" r="2.2" /><circle cx="14" cy="18" r="2.2" />
      <path d="M11.5 7.8V4c2-1 4-.5 5 1" />
    </>
  ),
}

export function Icon(props: { name: string; size?: number | string; class?: string; label?: string }) {
  const body = P[props.name]
  if (!body) return null
  const size = props.size ?? '1em'
  return (
    <svg
      class={`icon ${props.class ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : 'true'}
    >
      {body}
    </svg>
  )
}

export const ICON_NAMES = Object.keys(P)
