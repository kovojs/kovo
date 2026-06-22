/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Wifi Zero icon (Lucide). https://lucide.dev/icons/wifi-zero */
export function WifiZero(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 20h.01"></path>
    </svg>
  );
}
