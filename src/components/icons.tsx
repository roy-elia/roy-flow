import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

/** Roy Flow glyph: five rounded audio bars (original artwork). */
export function Glyph({ size = 25, ...p }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 25 25" fill="currentColor" aria-hidden {...p}>
      <rect x="1" y="5" width="3.2" height="15" rx="1.6" />
      <rect x="6.2" y="10" width="3.2" height="10" rx="1.6" />
      <rect x="11.4" y="2" width="3.2" height="18" rx="1.6" />
      <rect x="16.6" y="8" width="3.2" height="12" rx="1.6" />
      <rect x="21.8" y="4" width="2.2" height="16" rx="1.1" />
    </svg>
  );
}

export function NotetakerIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="9.5" />
      <circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />
    </svg>
  );
}
export function InsightsIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M3.5 3.5v17h17" />
      <rect x="7.5" y="9" width="3.5" height="8" rx="1" />
      <rect x="14" y="5.5" width="3.5" height="11.5" rx="1" />
    </svg>
  );
}
export function DictionaryIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M14 2.5H7a2.5 2.5 0 0 0-2.5 2.5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z" />
      <path d="M14 2.5V8h5.5" />
      <path d="M10 11v6.5M10 14.2a2.2 2.2 0 1 1 0 .1" />
    </svg>
  );
}
export function StyleIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p} strokeWidth={2.2}>
      <path d="M3 5h10M8 5v14M14 11h7M17.5 11v8" />
    </svg>
  );
}
export function ScratchpadIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M20.5 13V5a2 2 0 0 0-2-2h-13a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2H13" />
      <path d="M13 20.5V15a2 2 0 0 1 2-2h5.5zM7.5 8h9M7.5 12h5" />
    </svg>
  );
}
export function ConnectorsIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M5 3v4M9 3v4M3.5 7h7v3a3.5 3.5 0 0 1-7 0zM7 13.5V18a3 3 0 0 0 6 0V6a3 3 0 0 1 6 0v8" />
      <path d="M16.5 14h5v3a2.5 2.5 0 0 1-5 0zM17.5 19.5V21M20.5 19.5V21" />
    </svg>
  );
}
export function McpIcon({ size, ...p }: P) {
  return (
    <svg {...base(size)} {...p}>
      <path d="M3 13.5 12.5 4a2.9 2.9 0 0 1 4 4l-7.5 7.5" />
      <path d="M8 18.5l8-8a2.9 2.9 0 0 1 4 4L12.5 22" />
      <path d="M9.5 9.5 14 14" />
    </svg>
  );
}
