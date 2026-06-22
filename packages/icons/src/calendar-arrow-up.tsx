/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Calendar Arrow Up icon (Lucide). https://lucide.dev/icons/calendar-arrow-up */
export function CalendarArrowUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m14 18 4-4 4 4"></path>
      <path d="M16 2v4"></path>
      <path d="M18 22v-8"></path>
      <path d="M21 11.343V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h9"></path>
      <path d="M3 10h18"></path>
      <path d="M8 2v4"></path>
    </svg>
  );
}
