/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Up Right icon (Lucide). https://lucide.dev/icons/square-arrow-up-right */
export function SquareArrowUpRight(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <path d="M15 15V9H9"></path>
      <path d="m9 15 6-6"></path>
      <rect x="3" y="3" width="18" height="18" rx="2"></rect>
    </svg>
  );
}
