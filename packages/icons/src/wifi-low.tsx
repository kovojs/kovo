/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Wifi Low icon (Lucide). https://lucide.dev/icons/wifi-low */
export function WifiLow(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M12 20h.01"></path>
      <path d="M8.5 16.429a5 5 0 0 1 7 0"></path>
    </svg>
  );
}
