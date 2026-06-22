/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Left icon (Lucide). https://lucide.dev/icons/square-arrow-left */
export function SquareArrowLeft(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="m12 8-4 4 4 4"></path>
      <path d="M16 12H8"></path>
    </svg>
  );
}
