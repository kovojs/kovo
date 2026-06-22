/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Ice Cream Cone icon (Lucide). https://lucide.dev/icons/ice-cream-cone */
export function IceCreamCone(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="m7 11 4.08 10.35a1 1 0 0 0 1.84 0L17 11"></path>
      <path d="M17 7A5 5 0 0 0 7 7"></path>
      <path d="M17 7a2 2 0 0 1 0 4H7a2 2 0 0 1 0-4"></path>
    </svg>
  );
}
