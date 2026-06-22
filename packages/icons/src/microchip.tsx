/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Microchip icon (Lucide). https://lucide.dev/icons/microchip */
export function Microchip(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M10 12h4"></path>
      <path d="M10 17h4"></path>
      <path d="M10 7h4"></path>
      <path d="M18 12h2"></path>
      <path d="M18 18h2"></path>
      <path d="M18 6h2"></path>
      <path d="M4 12h2"></path>
      <path d="M4 18h2"></path>
      <path d="M4 6h2"></path>
      <rect x="6" y="2" width="12" height="20" rx="2"></rect>
    </svg>
  );
}
