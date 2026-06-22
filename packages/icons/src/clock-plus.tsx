/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clock Plus icon (Lucide). https://lucide.dev/icons/clock-plus */
export function ClockPlus(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6v6l3.644 1.822"></path>
      <path d="M16 19h6"></path>
      <path d="M19 16v6"></path>
      <path d="M21.92 13.267a10 10 0 1 0-8.653 8.653"></path>
    </svg>
  );
}
