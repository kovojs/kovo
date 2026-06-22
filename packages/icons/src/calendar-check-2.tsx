/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Calendar Check 2 icon (Lucide). https://lucide.dev/icons/calendar-check-2 */
export function CalendarCheck2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 2v4"></path>
      <path d="M16 2v4"></path>
      <path d="M21 14V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"></path>
      <path d="M3 10h18"></path>
      <path d="m16 20 2 2 4-4"></path>
    </svg>
  );
}
