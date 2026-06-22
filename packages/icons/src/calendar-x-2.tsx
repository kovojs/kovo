/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Calendar X 2 icon (Lucide). https://lucide.dev/icons/calendar-x-2 */
export function CalendarX2(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M8 2v4"></path>
      <path d="M16 2v4"></path>
      <path d="M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8"></path>
      <path d="M3 10h18"></path>
      <path d="m17 22 5-5"></path>
      <path d="m17 17 5 5"></path>
    </svg>
  );
}
