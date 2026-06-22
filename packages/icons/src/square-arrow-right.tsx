/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Right icon (Lucide). https://lucide.dev/icons/square-arrow-right */
export function SquareArrowRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M8 12h8"></path>
      <path d="m12 16 4-4-4-4"></path>
    </svg>
  );
}
