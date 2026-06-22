/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Clock Alert icon (Lucide). https://lucide.dev/icons/clock-alert */
export function ClockAlert(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 6v6l4 2"></path>
      <path d="M20 12v5"></path>
      <path d="M20 21h.01"></path>
      <path d="M21.25 8.2A10 10 0 1 0 16 21.16"></path>
    </svg>
  );
}
