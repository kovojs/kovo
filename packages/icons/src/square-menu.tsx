/** @jsxImportSource @kovojs/server */
import { iconRootAttrs, type IconProps } from './icon-base.js';

/** Square Menu icon (Lucide). https://lucide.dev/icons/square-menu */
export function SquareMenu(props: IconProps = {}): string {
  return (
    <svg {...iconRootAttrs(props)}>
      <rect width="18" height="18" x="3" y="3" rx="2"></rect>
      <path d="M7 8h10"></path>
      <path d="M7 12h10"></path>
      <path d="M7 16h10"></path>
    </svg>
  );
}
