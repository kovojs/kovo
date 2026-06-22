/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Calendar 1 icon (Lucide). https://lucide.dev/icons/calendar-1 */
export function Calendar1(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M11 14h1v4"></path>
      <path d="M16 2v4"></path>
      <path d="M3 10h18"></path>
      <path d="M8 2v4"></path>
      <rect x="3" y="4" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
