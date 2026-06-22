/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Calendar X icon (Lucide). https://lucide.dev/icons/calendar-x */
export function CalendarX(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 2v4"></path>
      <path d="M16 2v4"></path>
      <rect width="18" height="18" x="3" y="4" rx="2"></rect>
      <path d="M3 10h18"></path>
      <path d="m14 14-4 4"></path>
      <path d="m10 14 4 4"></path>
    </svg>
  );
}
