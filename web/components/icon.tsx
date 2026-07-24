import type { SVGProps } from 'react';

export type IconName =
  | 'activity'
  | 'arrow-down'
  | 'arrow-up-right'
  | 'check'
  | 'chevron-down'
  | 'clipboard'
  | 'cloud-download'
  | 'external'
  | 'filter'
  | 'hash'
  | 'heart'
  | 'loader'
  | 'map-pin'
  | 'play'
  | 'refresh'
  | 'search'
  | 'send'
  | 'share'
  | 'sparkles'
  | 'trend-up'
  | 'users'
  | 'x';

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 18, strokeWidth = 1.8, ...props }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  };

  switch (name) {
    case 'activity':
      return <svg {...common}><path d="M3 12h4l2.2-7 4.1 14L16 12h5" /></svg>;
    case 'arrow-down':
      return <svg {...common}><path d="M12 4v15M6 13l6 6 6-6" /></svg>;
    case 'arrow-up-right':
      return <svg {...common}><path d="M7 17 17 7M8 7h9v9" /></svg>;
    case 'check':
      return <svg {...common}><path d="m5 12 4 4L19 6" /></svg>;
    case 'chevron-down':
      return <svg {...common}><path d="m6 9 6 6 6-6" /></svg>;
    case 'clipboard':
      return <svg {...common}><rect x="7" y="5" width="12" height="15" rx="2" /><path d="M9 5V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1M4 16V6a2 2 0 0 1 2-2h1" /></svg>;
    case 'cloud-download':
      return <svg {...common}><path d="M7 18a5 5 0 1 1 1.2-9.85A6 6 0 0 1 20 10a4 4 0 0 1-1 7.75H7Z" /><path d="M12 12v7m-3-3 3 3 3-3" /></svg>;
    case 'external':
      return <svg {...common}><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" /></svg>;
    case 'filter':
      return <svg {...common}><path d="M4 5h16M7 12h10M10 19h4" /></svg>;
    case 'hash':
      return <svg {...common}><path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" /></svg>;
    case 'heart':
      return <svg {...common}><path d="M20.8 8.7c0 5.4-8.8 10.3-8.8 10.3S3.2 14.1 3.2 8.7A4.7 4.7 0 0 1 12 6.2a4.7 4.7 0 0 1 8.8 2.5Z" /></svg>;
    case 'loader':
      return <svg {...common} className={`icon-spin ${props.className || ''}`}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
    case 'map-pin':
      return <svg {...common}><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>;
    case 'play':
      return <svg {...common} fill="currentColor" stroke="none"><path d="m8 5 11 7-11 7V5Z" /></svg>;
    case 'refresh':
      return <svg {...common}><path d="M20 11a8 8 0 0 0-14.9-3L3 11" /><path d="M3 5v6h6M4 13a8 8 0 0 0 14.9 3L21 13" /><path d="M21 19v-6h-6" /></svg>;
    case 'search':
      return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>;
    case 'send':
      return <svg {...common}><path d="m21 3-7.2 18-3.6-7.2L3 10.2 21 3Z" /><path d="M10.2 13.8 21 3" /></svg>;
    case 'share':
      return <svg {...common}><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></svg>;
    case 'sparkles':
      return <svg {...common}><path d="m12 3-1.4 4.6L6 9l4.6 1.4L12 15l1.4-4.6L18 9l-4.6-1.4L12 3ZM19 15l-.7 2.3L16 18l2.3.7L19 21l.7-2.3L22 18l-2.3-.7L19 15ZM5 14l-.6 2L2 17l2.4.8L5 20l.6-2.2L8 17l-2.4-1L5 14Z" /></svg>;
    case 'trend-up':
      return <svg {...common}><path d="M3 17 9 11l4 4 7-8" /><path d="M15 7h5v5" /></svg>;
    case 'users':
      return <svg {...common}><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20" /><circle cx="10" cy="7" r="3" /><path d="M16 11a3 3 0 1 0-1.1-5.8M20 20v-1.5a4.5 4.5 0 0 0-2.9-4.2" /></svg>;
    case 'x':
      return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
    default:
      return null;
  }
}
