/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Arrow Down icon (Lucide). https://lucide.dev/icons/square-arrow-down */
export function SquareArrowDown(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M12 8v8"></path>
      <path d="m8 12 4 4 4-4"></path>
    </svg>
  );
}
