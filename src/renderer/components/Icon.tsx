import type { JSX } from 'react';

/** Inline stroke icons (no icon-font / library dependency). */
const PATHS = {
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  circle: <circle cx="12" cy="12" r="8" />,
  square: <rect x="4.5" y="4.5" width="15" height="15" rx="4" />,
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-5-5-9 9" />
    </>
  ),
  folder: <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor" stroke="none" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11.5" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </>
  ),
  micOff: (
    <>
      <path d="M15 9.5V6a3 3 0 0 0-5.7-1.3M9 9v2.5a3 3 0 0 0 4.6 2.5M18.5 11a6.5 6.5 0 0 1-1.1 3.6M5.5 11a6.5 6.5 0 0 0 10.2 5.3M12 17.5V21" />
      <path d="m3 3 18 18" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="m15.5 10.5 5-3v9l-5-3" />
    </>
  ),
  cameraOff: (
    <>
      <path d="M15.5 13v2a2.5 2.5 0 0 1-2.5 2.5H5.5A2.5 2.5 0 0 1 3 15V9a2.5 2.5 0 0 1 2.5-2.5h1M10.5 6.5H13a2.5 2.5 0 0 1 2.5 2.5v1.5l5-3v9" />
      <path d="m3 3 18 18" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12.5" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  window: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.2" />
      <path d="M3 9h18M6.5 6.8h.01M9 6.8h.01" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  remote: (
    <>
      <rect x="2.5" y="4" width="13" height="9.5" rx="1.8" />
      <path d="M6 17h6M9 13.5V17" />
      <rect x="12.5" y="9" width="9" height="11" rx="1.8" />
      <path d="M15.5 17.5h3" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 3.5V8h4.5M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20.5V16h-4.5" />
    </>
  ),
  x: <path d="M6 6l12 12M18 6 6 18" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" />
    </>
  ),
  edit: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M5.5 7l1 12a2 2 0 0 0 2 1.8h7a2 2 0 0 0 2-1.8l1-12M9 7V4.8A.8.8 0 0 1 9.8 4h4.4a.8.8 0 0 1 .8.8V7" />,
  copy: (
    <>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2.2" />
      <path d="M15.5 8.5V5.7a2.2 2.2 0 0 0-2.2-2.2H5.7a2.2 2.2 0 0 0-2.2 2.2v7.6a2.2 2.2 0 0 0 2.2 2.2h2.8" />
    </>
  ),
  external: <path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />,
  folderOpen: <path d="M3.5 18.5V7A2 2 0 0 1 5.5 5H9l2 2.5h6.5a2 2 0 0 1 2 2V11M3.5 18.5l2.6-6.4A1.8 1.8 0 0 1 7.8 11h12.4a1 1 0 0 1 .9 1.4l-2.4 5.8a1.8 1.8 0 0 1-1.7 1.1H4.3a.8.8 0 0 1-.8-.8z" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  alert: (
    <>
      <path d="M10.3 4.3 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4.5M12 17.2h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8h.01" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  volume: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  share: (
    <>
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="m8.2 10.8 7.1-3.6M8.2 13.2l7.1 3.6" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="7" r="1.1" fill="currentColor" />
      <circle cx="15" cy="7" r="1.1" fill="currentColor" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" />
      <circle cx="9" cy="17" r="1.1" fill="currentColor" />
      <circle cx="15" cy="17" r="1.1" fill="currentColor" />
    </>
  ),
  film: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2.2" />
      <path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  cloud: <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.1 4.75 4.75 0 0 0 7 18.5z" />
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className, strokeWidth = 1.9 }: { name: IconName; size?: number; className?: string; strokeWidth?: number }) {
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
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** OneLoom brand mark: a lens ring with a record dot. */
export function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="ol-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7468ff" />
          <stop offset="1" stopColor="#4a3fd8" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#ol-g)" />
      <circle cx="16" cy="16" r="8.2" fill="none" stroke="#fff" strokeWidth="2.6" />
      <circle cx="16" cy="16" r="3.6" fill="#ff6168" />
    </svg>
  );
}
