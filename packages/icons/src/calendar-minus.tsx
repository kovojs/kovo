/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps, type IconRenderResult } from './icon-base.js';

/** Calendar Minus icon (Lucide). https://lucide.dev/icons/calendar-minus */
export function CalendarMinus(props: IconProps = {}): IconRenderResult {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M16 19h6"></path>
      <path d="M16 2v4"></path>
      <path d="M21 15V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8.5"></path>
      <path d="M3 10h18"></path>
      <path d="M8 2v4"></path>
    </svg>
  );
}
