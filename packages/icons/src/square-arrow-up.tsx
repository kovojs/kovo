/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Up icon (Lucide). https://lucide.dev/icons/square-arrow-up */
export function SquareArrowUp(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="m16 12-4-4-4 4"></path>
      <path d="M12 16V8"></path>
    </svg>
  );
}
