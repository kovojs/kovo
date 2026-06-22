/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Wifi icon (Lucide). https://lucide.dev/icons/wifi */
export function Wifi(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 20h.01"></path>
      <path d="M2 8.82a15 15 0 0 1 20 0"></path>
      <path d="M5 12.859a10 10 0 0 1 14 0"></path>
      <path d="M8.5 16.429a5 5 0 0 1 7 0"></path>
    </svg>
  );
}
