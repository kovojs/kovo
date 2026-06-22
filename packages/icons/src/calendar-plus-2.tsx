/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Calendar Plus 2 icon (Lucide). https://lucide.dev/icons/calendar-plus-2 */
export function CalendarPlus2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 2v4"></path>
      <path d="M16 2v4"></path>
      <rect width="18" height="18" x="3" y="4" rx="2"></rect>
      <path d="M3 10h18"></path>
      <path d="M10 16h4"></path>
      <path d="M12 14v4"></path>
    </svg>
  );
}
