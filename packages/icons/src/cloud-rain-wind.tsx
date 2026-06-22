/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Cloud Rain Wind icon (Lucide). https://lucide.dev/icons/cloud-rain-wind */
export function CloudRainWind(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
      <path d="m9.2 22 3-7"></path>
      <path d="m9 13-3 7"></path>
      <path d="m17 13-3 7"></path>
    </svg>
  );
}
