/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Satellite Dish icon (Lucide). https://lucide.dev/icons/satellite-dish */
export function SatelliteDish(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 10a7.31 7.31 0 0 0 10 10Z"></path>
      <path d="m9 15 3-3"></path>
      <path d="M17 13a6 6 0 0 0-6-6"></path>
      <path d="M21 13A10 10 0 0 0 11 3"></path>
    </svg>
  );
}
