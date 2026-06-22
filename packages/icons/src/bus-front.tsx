/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Bus Front icon (Lucide). https://lucide.dev/icons/bus-front */
export function BusFront(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M4 6 2 7"></path>
      <path d="M10 6h4"></path>
      <path d="m22 7-2-1"></path>
      <rect width="16" height="16" x="4" y="3" rx="2"></rect>
      <path d="M4 11h16"></path>
      <path d="M8 15h.01"></path>
      <path d="M16 15h.01"></path>
      <path d="M6 19v2"></path>
      <path d="M18 21v-2"></path>
    </svg>
  );
}
